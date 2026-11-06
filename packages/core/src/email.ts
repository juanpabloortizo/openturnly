import type { WhatsappLanguage } from "./whatsapp.ts";

/**
 * Almost every email provider takes SMTP, so one connection serves them all: choosing one of
 * these only fills in its server. Those that log in with a fixed user say so.
 */
export const EMAIL_PROVIDERS = [
  { id: "resend", host: "smtp.resend.com", port: 465, username: "resend" },
  { id: "sendgrid", host: "smtp.sendgrid.net", port: 587, username: "apikey" },
  { id: "mailgun", host: "smtp.mailgun.org", port: 587, username: "" },
  { id: "ses", host: "email-smtp.us-east-1.amazonaws.com", port: 587, username: "" },
  { id: "postmark", host: "smtp.postmarkapp.com", port: 587, username: "" },
  { id: "brevo", host: "smtp-relay.brevo.com", port: 587, username: "" },
  { id: "google", host: "smtp.gmail.com", port: 465, username: "" },
  { id: "microsoft", host: "smtp.office365.com", port: 587, username: "" },
  { id: "other", host: "", port: 587, username: "" },
] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number]["id"];
export const EMAIL_PROVIDER_IDS = EMAIL_PROVIDERS.map((provider) => provider.id) as [
  EmailProvider,
  ...EmailProvider[],
];

/** The ports mail servers listen on. Anything else isn't a mail server. */
export const EMAIL_PORTS = [465, 587, 2465, 2587] as const;

export const EMAIL_TEMPLATE_NAMES = [
  "appointment_confirmation",
  "appointment_reminder",
  "appointment_rescheduled",
  "appointment_cancelled",
] as const;
export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

export type EmailTemplateDefinition = {
  name: EmailTemplateName;
  subject: Record<WhatsappLanguage, string>;
  body: Record<WhatsappLanguage, string>;
};

const DETAILS = {
  es: "Fecha: {{appointment.date_text}}\nHora: {{appointment.time_text}}",
  en: "Date: {{appointment.date_text}}\nTime: {{appointment.time_text}}",
};
const ADDRESS = {
  es: "Dirección: {{appointment.location_address}}",
  en: "Address: {{appointment.location_address}}",
};
const QUESTIONS = {
  es: "Dudas al {{business.phone}}, con gusto te atendemos.",
  en: "Questions? Call {{business.phone}}, we're happy to help.",
};

export const EMAIL_TEMPLATES: readonly EmailTemplateDefinition[] = [
  {
    name: "appointment_confirmation",
    subject: {
      es: "Cita confirmada en {{business.name}}",
      en: "Appointment confirmed at {{business.name}}",
    },
    body: {
      es: `Hola {{customer.first_name}}, tu cita en {{business.name}} ya está agendada.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer.first_name}}, your appointment at {{business.name}} is booked.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_reminder",
    subject: {
      es: "Recordatorio de tu cita en {{business.name}}",
      en: "Reminder of your appointment at {{business.name}}",
    },
    body: {
      es: `Hola {{customer.first_name}}, te esperamos en {{business.name}}.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer.first_name}}, we're expecting you at {{business.name}}.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_rescheduled",
    subject: {
      es: "Tu cita en {{business.name}} cambió",
      en: "Your appointment at {{business.name}} changed",
    },
    body: {
      es: `Hola {{customer.first_name}}, tu cita en {{business.name}} tiene un nuevo horario.\n\n${DETAILS.es}\n${ADDRESS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer.first_name}}, your appointment at {{business.name}} has a new time.\n\n${DETAILS.en}\n${ADDRESS.en}\n\n${QUESTIONS.en}`,
    },
  },
  {
    name: "appointment_cancelled",
    subject: {
      es: "Tu cita en {{business.name}} fue cancelada",
      en: "Your appointment at {{business.name}} was cancelled",
    },
    body: {
      es: `Hola {{customer.first_name}}, tu cita en {{business.name}} fue cancelada.\n\n${DETAILS.es}\n\n${QUESTIONS.es}`,
      en: `Hi {{customer.first_name}}, your appointment at {{business.name}} was cancelled.\n\n${DETAILS.en}\n\n${QUESTIONS.en}`,
    },
  },
];

export function emailTemplate(name: EmailTemplateName): EmailTemplateDefinition | undefined {
  return EMAIL_TEMPLATES.find((template) => template.name === name);
}
