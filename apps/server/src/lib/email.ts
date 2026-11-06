import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { emailConnections } from "../db/schema.ts";
import { isInternalAddress } from "./client-ip.ts";
import { decryptSecret } from "./secrets.ts";

const TIMEOUT_MS = 10_000;

/** The account an email goes out on, and where it was set. */
export type EmailSender = {
  source: "own" | "default";
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  footer: string | null;
};

export type EmailSend = {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  response: string | null;
  /** Whether trying again later could work. */
  retry: boolean;
};

type EmailMessage = {
  to: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  body: string;
};

/** The text as a plain email page: it's written by people, so nothing in it is markup. */
function htmlOf(body: string, footer: string | null) {
  const safe = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const paragraphs = body
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 16px">${safe(part).replaceAll("\n", "<br>")}</p>`)
    .join("");
  const end = footer
    ? `<p style="margin:24px 0 0;font-size:12px;color:#71717a">${safe(footer)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#18181b">${paragraphs}${end}</body></html>`;
}

/** What a failure says, without the server's address or the login in it. */
function describe(error: unknown) {
  const failure = error as { code?: string; responseCode?: number; message?: string };
  if (failure.code === "EAUTH") return { code: failure.responseCode ?? null, text: "email_login" };
  if (failure.code === "ETIMEDOUT") return { code: null, text: "timeout" };
  if (failure.code === "ESOCKET" || failure.code === "ECONNECTION") {
    return { code: null, text: "email_unreachable" };
  }
  return {
    code: failure.responseCode ?? null,
    text: (failure.message ?? "email_failed").slice(0, 300),
  };
}

export type Email = ReturnType<typeof createEmail>;

/** Sends the install's emails: which account to use, and sending on it. */
export function createEmail({ db, config }: { db: Db; config: Config }) {
  const findConnection = async () => {
    const [connection] = await db.select().from(emailConnections).limit(1);
    return connection ?? null;
  };

  const readSecret = (stored: string | null) => {
    if (!stored) return null;
    try {
      return decryptSecret(config.secret, stored);
    } catch {
      return null;
    }
  };

  /**
   * Where to connect for an account set in the panel. It's typed there, so it could name
   * something inside the server's network: only public addresses are used, and the
   * connection goes to the address checked here, not to a name that could change after.
   */
  const publicAddress = async (host: string) => {
    if (config.allowPrivateWebhooks) return host;
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((entry) => entry.address);
    const [first] = addresses;
    if (!first || addresses.some(isInternalAddress)) throw new Error("internal_address");
    return first;
  };

  const transport = async (sender: EmailSender) =>
    nodemailer.createTransport({
      host: sender.source === "own" ? await publicAddress(sender.host) : sender.host,
      port: sender.port,
      secure: sender.port === 465 || sender.port === 2465,
      requireTLS: true,
      auth: { user: sender.username, pass: sender.password },
      tls: { servername: sender.host },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });

  return {
    findConnection,
    readSecret,

    defaultSender: (): EmailSender | null => config.email && { source: "default", ...config.email },

    /** The address the environment's account sends from, to tell the owner what's in use. */
    defaultAddress: () => config.email?.fromEmail ?? null,

    /** The account connected in the install, or the one from the environment, or null. */
    async sender(): Promise<EmailSender | null> {
      const own = await findConnection();
      const password = readSecret(own?.encryptedPassword ?? null);
      if (own?.status === "connected" && password) {
        return {
          source: "own",
          host: own.host,
          port: own.port,
          username: own.username,
          password,
          fromEmail: own.fromEmail,
          footer: null,
        };
      }
      return this.defaultSender();
    },

    /** Logs in to the account without sending anything. */
    async verify(sender: EmailSender): Promise<{ ok: true } | { ok: false; error: string }> {
      try {
        const client = await transport(sender);
        await client.verify();
        client.close();
        return { ok: true };
      } catch (error) {
        const internal = error instanceof Error && error.message === "internal_address";
        return { ok: false, error: internal ? "internal_address" : describe(error).text };
      }
    },

    async send(sender: EmailSender, message: EmailMessage): Promise<EmailSend> {
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
      try {
        const client = await transport(sender);
        const info = await client.sendMail({
          from: { name: message.fromName, address: sender.fromEmail },
          to: message.to,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          text: sender.footer ? `${message.body}\n\n${sender.footer}` : message.body,
          html: htmlOf(message.body, sender.footer),
        });
        client.close();
        return {
          ok: true,
          status: 250,
          error: null,
          durationMs: elapsed(),
          response: String(info.response ?? "").slice(0, 300),
          retry: false,
        };
      } catch (error) {
        if (error instanceof Error && error.message === "internal_address") {
          return {
            ok: false,
            status: null,
            error: "internal_address",
            durationMs: elapsed(),
            response: null,
            retry: false,
          };
        }
        const { code, text } = describe(error);
        // A 5xx is the server's final no; anything else can be a passing problem.
        return {
          ok: false,
          status: code,
          error: text,
          durationMs: elapsed(),
          response: null,
          retry: code === null || code < 500,
        };
      }
    },
  };
}
