import { describe, expect, it } from "vitest";
import {
  fieldsBody,
  jsonTemplateProblem,
  renderJsonTemplate,
  renderTemplate,
  webhookActionSchema,
} from "../src/schemas.ts";

const values = {
  event: "appointment.created",
  appointment: {
    code: "K7Q4XM",
    service: "Corte",
    time: "10:00",
    price: 18000,
    answers: { primera_vez: "Sí" },
    previous_date: null,
  },
  customer: { first_name: 'Ana "La Jefa"', phone_digits: "573001112233" },
  business: { name: "Barbería" },
};

describe("JSON bodies written by hand", () => {
  it("fill a receiver's own format, like a WhatsApp notification", () => {
    const template = `{
      "phone": "{{customer.phone_digits}}",
      "variables": { "contact_name": "{{customer.first_name}}" },
      "buttons": ["Confirmar", "", ""],
      "context": "Cita de {{appointment.service}} a las {{ appointment.time }}"
    }`;
    expect(renderJsonTemplate(template, values)).toEqual({
      phone: "573001112233",
      variables: { contact_name: 'Ana "La Jefa"' },
      buttons: ["Confirmar", "", ""],
      context: "Cita de Corte a las 10:00",
    });
  });

  it("put values in as JSON when they stand on their own, whole groups too", () => {
    const template =
      '{"price": {{appointment.price}}, "answers": {{appointment.answers}}, "before": {{appointment.previous_date}}, "business": {{business}}}';
    expect(renderJsonTemplate(template, values)).toEqual({
      price: 18000,
      answers: { primera_vez: "Sí" },
      before: null,
      business: { name: "Barbería" },
    });
  });

  it("explain what's wrong before saving", () => {
    expect(jsonTemplateProblem('{"name": "{{customer.first_name}}"}')).toBeNull();
    expect(jsonTemplateProblem('{"customer": {{customer}}}')).toBeNull();
    expect(jsonTemplateProblem('{"name": "{{customer_first_name}}"}')).toBe("unknown_field");
    expect(jsonTemplateProblem('{"name": "{{customer.nombre}}"}')).toBe("unknown_field");
    expect(jsonTemplateProblem('{"name": "{{customer.first_name}}",}')).toBe("invalid_json");
    expect(jsonTemplateProblem('["{{customer.first_name}}"]')).toBe("json_not_object");
  });

  it("are checked by the step schema, and fields aren't required then", () => {
    const step = {
      id: "s1",
      type: "webhook",
      url: "https://agency.example.com/hooks/abc",
      auth: { type: "header", name: "Authorization", value: "Bearer whk_x" },
      body: "json",
      fields: [],
    };
    const ok = webhookActionSchema.safeParse({ ...step, json: '{"a": "{{appointment.time}}"}' });
    expect(ok.success).toBe(true);
    const broken = webhookActionSchema.safeParse({ ...step, json: '{"a": }' });
    expect(broken.error?.issues[0]).toMatchObject({ path: ["json"], message: "invalid_json" });
    const empty = webhookActionSchema.safeParse({ ...step, json: "  " });
    expect(empty.error?.issues[0]).toMatchObject({ message: "json_required" });
  });
});

describe("Bodies built from fields", () => {
  it("nest the chosen data by group, in the data's order, then the extra values", () => {
    const body = fieldsBody(
      {
        fields: ["customer.first_name", "appointment.time", "event"],
        extra: [
          { name: "message", value: "Hola {{customer.first_name}}, a las {{appointment.time}}." },
        ],
      },
      values,
    );
    expect(body).toEqual({
      event: "appointment.created",
      appointment: { time: "10:00" },
      customer: { first_name: 'Ana "La Jefa"' },
      message: 'Hola Ana "La Jefa", a las 10:00.',
    });
    expect(Object.keys(body)).toEqual(["event", "appointment", "customer", "message"]);
  });

  it("leave unknown placeholders and whole groups empty in text", () => {
    expect(
      renderTemplate("{{customer.first_name}}|{{customer}}|{{nada.x}}|{{__proto__}}", values),
    ).toBe('Ana "La Jefa"|||');
  });
});

describe("Webhook addresses", () => {
  const url = (value: string) =>
    webhookActionSchema.safeParse({ id: "s1", type: "webhook", url: value, fields: null }).error
      ?.issues[0]?.message ?? null;

  it("need https, except inside the server's own network", () => {
    expect(url("https://hooks.example.com/citas")).toBeNull();
    expect(url("http://hooks.example.com/citas")).toBe("https_required");
    expect(url("HTTP://34.120.5.1/citas")).toBe("https_required");
    // Never leaves the machine: a container's name, localhost, private IPs.
    expect(url("http://crm:5678/webhook/citas")).toBeNull();
    expect(url("http://localhost:4000/hook")).toBeNull();
    expect(url("http://192.168.1.20/hook")).toBeNull();
    expect(url("ftp://example.com")).toBe("invalid_url");
  });
});
