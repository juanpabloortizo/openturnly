/**
 * WhatsApp only delivers messages a business starts through templates it has approved
 * beforehand, so these are the texts a business can ask for in one step. Each variable is
 * filled from the appointment's data when the message goes out.
 */
export const WHATSAPP_LANGUAGES = ["es", "en"] as const;
export type WhatsappLanguage = (typeof WHATSAPP_LANGUAGES)[number];

/** The appointment's data for each variable the ready-made templates use. */
export const WHATSAPP_VARIABLE_DATA: Record<string, string> = {
  customer_name: "{{customer.first_name}}",
  business_name: "{{business.name}}",
  appointment_date: "{{appointment.date_text}}",
  appointment_time: "{{appointment.time_text}}",
  business_address: "{{appointment.location_address}}",
  business_phone: "{{business.phone}}",
};

/** What WhatsApp's reviewers see in place of each variable. */
export const WHATSAPP_VARIABLE_EXAMPLES: Record<WhatsappLanguage, Record<string, string>> = {
  es: {
    customer_name: "Ana",
    business_name: "Barbería Central",
    appointment_date: "jueves, 12 de noviembre",
    appointment_time: "10:00 a. m.",
    business_address: "Calle 10 # 20-30",
    business_phone: "+573001234567",
  },
  en: {
    customer_name: "Ana",
    business_name: "Central Barbershop",
    appointment_date: "Thursday, November 12",
    appointment_time: "10:00 AM",
    business_address: "10 Main Street",
    business_phone: "+13055550100",
  },
};

export type WhatsappTemplateDefinition = {
  name: string;
  header: Record<WhatsappLanguage, string>;
  body: Record<WhatsappLanguage, string>;
};

const DETAILS = {
  es: "📅 Fecha: {{appointment_date}}\n🕙 Hora: {{appointment_time}}",
  en: "📅 Date: {{appointment_date}}\n🕙 Time: {{appointment_time}}",
};
const ADDRESS = {
  es: "📍 Dirección: {{business_address}}",
  en: "📍 Address: {{business_address}}",
};
/** WhatsApp refuses a template that starts or ends with a variable. */
const QUESTIONS = {
  es: "Dudas al {{business_phone}}, con gusto te atendemos.",
  en: "Questions? Call {{business_phone}}, we're happy to help.",
};

export const WHATSAPP_TEMPLATES: readonly WhatsappTemplateDefinition[] = [
  {
    name: "appointment_confirmation",
    header: { es: "Cita confirmada", en: "Appointment confirmed" },
    body: {
      es: `Hola {{customer_name}}, tu cita en {{business_name}} ya está agendada.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer_name}}, your appointment at {{business_name}} is booked.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_reminder",
    header: { es: "Recordatorio de cita", en: "Appointment reminder" },
    body: {
      es: `Hola {{customer_name}}, te esperamos en {{business_name}}.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer_name}}, we're expecting you at {{business_name}}.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_rescheduled",
    header: { es: "Tu cita cambió", en: "Your appointment changed" },
    body: {
      es: `Hola {{customer_name}}, tu cita en {{business_name}} tiene un nuevo horario.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer_name}}, your appointment at {{business_name}} has a new time.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_cancelled",
    header: { es: "Cita cancelada", en: "Appointment cancelled" },
    body: {
      es: `Hola {{customer_name}}, tu cita en {{business_name}} fue cancelada.\n\n${DETAILS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer_name}}, your appointment at {{business_name}} was cancelled.\n\n${DETAILS.en}\n\n${QUESTIONS.en}`,
    },
  },
];

/** A template's variables in order of appearance: named, or "1", "2"… in older templates. */
export function whatsappVariableNames(body: string): string[] {
  const names = [...body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((match) => match[1] ?? "");
  return [...new Set(names)];
}

/** The components of a ready-made template, as WhatsApp's API takes them. */
export function whatsappTemplateComponents(
  template: WhatsappTemplateDefinition,
  language: WhatsappLanguage,
  footer?: string,
) {
  const examples = WHATSAPP_VARIABLE_EXAMPLES[language];
  return [
    { type: "HEADER", format: "TEXT", text: template.header[language] },
    {
      type: "BODY",
      text: template.body[language],
      example: {
        body_text_named_params: whatsappVariableNames(template.body[language]).map((name) => ({
          param_name: name,
          example: examples[name] ?? name,
        })),
      },
    },
    ...(footer ? [{ type: "FOOTER", text: footer }] : []),
  ];
}
