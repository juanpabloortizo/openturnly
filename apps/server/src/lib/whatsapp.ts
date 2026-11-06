import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  whatsappTemplateComponents,
  whatsappVariableNames,
} from "@openturnly/core";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { type WhatsappConnection, whatsappConnections } from "../db/schema.ts";
import { decryptSecret } from "./secrets.ts";

const TIMEOUT_MS = 10_000;
/** The install's number rarely changes: its name is asked for once an hour at most. */
const PROFILE_TTL_MS = 60 * 60_000;
/** WhatsApp's "too many, try later" answers, which come as ordinary refusals. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016]);

/** The number a message goes out on, and where it was set. */
export type WhatsappSender = {
  source: "own" | "default";
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
};

export type WhatsappTemplate = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  body: string;
  /** Named, or "1", "2"… in older templates. */
  variables: string[];
  /** Variables outside the text (a header, a button) can't be filled by a step. */
  usable: boolean;
};

export type WhatsappVariable = { name: string; text: string };

export type WhatsappProfile = { phoneNumber: string | null; displayName: string | null };

export type WhatsappSend = {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  response: string | null;
  messageId: string | null;
  /** Whether trying again later could work. */
  retry: boolean;
};

/** What a delivery update says about one message. */
export type WhatsappStatusUpdate = {
  phoneNumberId: string | null;
  messageId: string;
  status: string;
  error: string | null;
  /** What was sent as callback data: the delivery's id, after the install's tag. */
  callback: string | null;
};

type GraphAnswer = {
  status: number | null;
  json: unknown;
  text: string;
  error: string | null;
  code: number | null;
};

const asRecord = (value: unknown) =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asList = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
const asText = (value: unknown) => (typeof value === "string" ? value : null);

/** Calls WhatsApp's API. Never throws: a network failure is an answer without status. */
async function graph(
  config: Pick<Config, "whatsappApiUrl">,
  accessToken: string,
  path: string,
  body?: unknown,
): Promise<GraphAnswer> {
  try {
    const res = await fetch(`${config.whatsappApiUrl}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: the status says what happened.
    }
    if (res.ok) return { status: res.status, json, text, error: null, code: null };
    const problem = asRecord(asRecord(json).error);
    return {
      status: res.status,
      json,
      text,
      error: asText(problem.message) ?? `HTTP ${res.status}`,
      code: typeof problem.code === "number" ? problem.code : null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "TimeoutError"
          ? "timeout"
          : ((error.cause as { code?: string; message?: string } | undefined)?.code ??
            (error.cause as { message?: string } | undefined)?.message ??
            error.message)
        : String(error);
    return { status: null, json: null, text: "", error: message.slice(0, 300), code: null };
  }
}

export type Whatsapp = ReturnType<typeof createWhatsapp>;

/** Talks to WhatsApp for the install: which number to use, and sending on it. */
export function createWhatsapp({ db, config }: { db: Db; config: Config }) {
  let profile: { at: number; value: WhatsappProfile } | null = null;

  const defaultSender = (): WhatsappSender | null =>
    config.whatsapp && {
      source: "default",
      phoneNumberId: config.whatsapp.phoneNumberId,
      wabaId: config.whatsapp.wabaId,
      accessToken: config.whatsapp.accessToken,
    };

  const findConnection = async () => {
    const [connection] = await db.select().from(whatsappConnections).limit(1);
    return connection ?? null;
  };

  /** The saved token, unless a change of SECRET made it unreadable. */
  const readSecret = (stored: string | null) => {
    if (!stored) return null;
    try {
      return decryptSecret(config.secret, stored);
    } catch {
      return null;
    }
  };

  return {
    defaultSender,
    findConnection,
    readSecret,

    /** The number whose name and digits WhatsApp reports, with these credentials. */
    async verifyNumber(accessToken: string, phoneNumberId: string) {
      const answer = await graph(
        config,
        accessToken,
        `${phoneNumberId}?fields=display_phone_number,verified_name`,
      );
      if (answer.error) return { ok: false as const, error: answer.error };
      const data = asRecord(answer.json);
      return {
        ok: true as const,
        phoneNumber: asText(data.display_phone_number),
        displayName: asText(data.verified_name),
      };
    },

    /** The environment's number as WhatsApp shows it, to tell the owner what's in use. */
    async defaultProfile(): Promise<WhatsappProfile | null> {
      if (!config.whatsapp) return null;
      if (profile && Date.now() - profile.at < PROFILE_TTL_MS) return profile.value;
      const answer = await this.verifyNumber(
        config.whatsapp.accessToken,
        config.whatsapp.phoneNumberId,
      );
      const value = answer.ok
        ? { phoneNumber: answer.phoneNumber, displayName: answer.displayName }
        : { phoneNumber: null, displayName: null };
      if (answer.ok) profile = { at: Date.now(), value };
      return value;
    },

    /** The number connected in the install, or the one from the environment, or null. */
    async sender(): Promise<WhatsappSender | null> {
      const own = await findConnection();
      const accessToken = readSecret(own?.encryptedAccessToken ?? null);
      if (own?.status === "connected" && accessToken) {
        return {
          source: "own",
          phoneNumberId: own.phoneNumberId,
          wabaId: own.wabaId,
          accessToken,
        };
      }
      return defaultSender();
    },

    async send(
      sender: WhatsappSender,
      message: {
        to: string;
        template: string;
        language: string;
        variables: readonly WhatsappVariable[];
        callback?: string;
      },
    ): Promise<WhatsappSend> {
      const startedAt = performance.now();
      const tag = config.whatsappCallbackTag;
      const answer = await graph(config, sender.accessToken, `${sender.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to.replace(/\D/g, ""),
        type: "template",
        template: {
          name: message.template,
          language: { code: message.language },
          components:
            message.variables.length > 0
              ? [
                  {
                    type: "body",
                    parameters: message.variables.map(({ name, text }) => ({
                      type: "text",
                      ...(/^\d+$/.test(name) ? {} : { parameter_name: name }),
                      text,
                    })),
                  },
                ]
              : [],
        },
        ...(message.callback
          ? { biz_opaque_callback_data: tag ? `${tag}:${message.callback}` : message.callback }
          : {}),
      });
      const [first] = asList(asRecord(answer.json).messages);
      return {
        ok: answer.error === null,
        status: answer.status,
        error: answer.error,
        durationMs: Math.round(performance.now() - startedAt),
        response: answer.text.slice(0, 2_000),
        messageId: asText(asRecord(first).id),
        retry:
          answer.error !== null &&
          (answer.status === null ||
            answer.status >= 500 ||
            answer.status === 429 ||
            RATE_LIMIT_CODES.has(answer.code ?? 0)),
      };
    },

    /** Every template of the number's account, as a step can use them. */
    async templates(sender: WhatsappSender) {
      if (!sender.wabaId) return { templates: [], error: "whatsapp_account_missing" };
      const answer = await graph(
        config,
        sender.accessToken,
        `${sender.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`,
      );
      if (answer.error) return { templates: [], error: answer.error };
      const templates = asList(asRecord(answer.json).data).map(readTemplate);
      return { templates, error: null };
    },

    /**
     * Asks WhatsApp to approve the ready-made templates a number doesn't have yet. Returns
     * the first refusal, if any: the ones before it were already sent for review.
     */
    async createTemplates(sender: WhatsappSender) {
      if (!sender.wabaId) return { created: 0, error: "whatsapp_account_missing" };
      const existing = await this.templates(sender);
      if (existing.error) return { created: 0, error: existing.error };
      const have = new Set(existing.templates.map((item) => `${item.name}:${item.language}`));
      let created = 0;
      for (const template of WHATSAPP_TEMPLATES) {
        for (const language of WHATSAPP_LANGUAGES) {
          if (have.has(`${template.name}:${language}`)) continue;
          const answer = await graph(
            config,
            sender.accessToken,
            `${sender.wabaId}/message_templates`,
            {
              name: template.name,
              language,
              category: "UTILITY",
              parameter_format: "named",
              components: whatsappTemplateComponents(template, language),
            },
          );
          if (answer.error) return { created, error: answer.error };
          created += 1;
        }
      }
      return { created, error: null };
    },
  };
}

function readTemplate(raw: unknown): WhatsappTemplate {
  const template = asRecord(raw);
  const components = asList(template.components).map(asRecord);
  const body = asText(components.find((item) => item.type === "BODY")?.text) ?? "";
  const others = JSON.stringify(components.filter((item) => item.type !== "BODY"));
  return {
    name: asText(template.name) ?? "",
    language: asText(template.language) ?? "",
    status: asText(template.status) ?? "UNKNOWN",
    category: asText(template.category),
    body,
    variables: whatsappVariableNames(body),
    usable: !/\{\{\s*\w+\s*\}\}/.test(others) && !/"format":"(IMAGE|VIDEO|DOCUMENT)"/.test(others),
  };
}

/** Whether a webhook call really comes from WhatsApp: its body signed with the app secret. */
export function validWhatsappSignature(
  appSecret: string,
  body: string,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`,
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Compares a token without saying how much of it matched. */
export function sameWhatsappToken(given: string | undefined, expected: string | null) {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The delivery updates in a webhook call; everything else in it is ignored. */
export function whatsappStatusUpdates(payload: unknown): WhatsappStatusUpdate[] {
  const updates: WhatsappStatusUpdate[] = [];
  for (const entry of asList(asRecord(payload).entry)) {
    for (const change of asList(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      const phoneNumberId = asText(asRecord(value.metadata).phone_number_id);
      for (const item of asList(value.statuses)) {
        const status = asRecord(item);
        const messageId = asText(status.id);
        const state = asText(status.status);
        if (!messageId || !state) continue;
        const [problem] = asList(status.errors).map(asRecord);
        updates.push({
          phoneNumberId,
          messageId,
          status: state,
          callback: asText(status.biz_opaque_callback_data),
          error: problem
            ? [problem.code, problem.title ?? problem.message]
                .filter(Boolean)
                .join(": ")
                .slice(0, 300)
            : null,
        });
      }
    }
  }
  return updates;
}

export type { WhatsappConnection };
