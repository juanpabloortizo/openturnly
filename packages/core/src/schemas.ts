import { z } from "zod";
import { hoursProblem } from "./availability.ts";
import { normalizePhone } from "./phone.ts";
import { checkSlug } from "./slug.ts";
import { addDays, isDateString, isTimeString } from "./time.ts";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Currencies a business can price in: the active ISO 4217 codes. Prices are informative
 * only (customers pay at the business).
 */
export const CURRENCIES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
] as const;

/** For new passwords only: signing in still accepts the ones set before it was raised. */
export const PASSWORD_MIN_LENGTH = 10;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(PASSWORD_MIN_LENGTH).max(128);
/** Words that stay lowercase inside a name: "María de la Cruz". */
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos"]);

/**
 * "  ana   maría " → "Ana María", "JUAN DE LA CRUZ" → "Juan de la Cruz". Only names typed all
 * in lower or upper case get capitalized; "McDonald" or "DeLuca" stay as typed.
 */
export function tidyName(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed !== collapsed.toLowerCase() && collapsed !== collapsed.toUpperCase()) {
    return collapsed;
  }
  return collapsed
    .toLowerCase()
    .split(" ")
    .map((word, index) =>
      index > 0 && NAME_PARTICLES.has(word)
        ? word
        : word.replace(/(^|[-'’])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase()),
    )
    .join(" ");
}

const personName = z.string().transform(tidyName).pipe(z.string().min(1).max(100));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((slug, ctx) => {
    const problem = checkSlug(slug);
    if (problem) ctx.addIssue({ code: "custom", message: `slug_${problem}` });
  });

export const setupSchema = z.object({ name: personName, email, password });
export type SetupInput = z.infer<typeof setupSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof loginSchema>;

export const businessCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  timezone: z.string().refine(isValidTimeZone, "invalid_timezone"),
  currency: z.enum(CURRENCIES),
  locale: z.enum(LOCALES),
});
export type BusinessCreateInput = z.infer<typeof businessCreateSchema>;

/** "#0F766E" → "#0f766e". Only 6-digit hex, so colours can be mixed and compared. */
const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => /^#[0-9a-f]{6}$/.test(value), "invalid_color");

/**
 * Looks for the booking page background: a soft brand glow, colourful aurora, the cover
 * photo blurred, plain light grey, or dark.
 */
export const PAGE_THEMES = ["soft", "plain", "cover", "dark", "aurora"] as const;
export type PageTheme = (typeof PAGE_THEMES)[number];

export const SLOT_INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

// --- Booking form -------------------------------------------------------------

/** Whether the booking page asks for a field, and whether it must be filled in. */
export const FIELD_RULES = ["required", "optional", "hidden"] as const;
export type FieldRule = (typeof FIELD_RULES)[number];

export const QUESTION_TYPES = ["text", "textarea", "select"] as const;
export const MAX_QUESTIONS = 10;

/** An extra question the business adds to the booking form ("¿Es tu primera vez?"). */
export const bookingQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().trim().min(1).max(80),
    type: z.enum(QUESTION_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .refine((question) => question.type !== "select" || question.options.length >= 2, {
    message: "options_required",
    path: ["options"],
  });
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

export const bookingFormSchema = z
  .object({
    phone: z.enum(FIELD_RULES),
    email: z.enum(FIELD_RULES),
    questions: z.array(bookingQuestionSchema).max(MAX_QUESTIONS),
  })
  .refine((form) => form.phone === "required" || form.email === "required", {
    message: "contact_required",
    path: ["phone"],
  });
export type BookingForm = z.infer<typeof bookingFormSchema>;

/** New businesses ask for a mobile number; email is up to the customer. */
export const DEFAULT_BOOKING_FORM: BookingForm = {
  phone: "required",
  email: "optional",
  questions: [],
};

export const businessUpdateSchema = businessCreateSchema.partial().extend({
  description: optionalText(1000),
  phone: optionalText(40),
  email: z
    .union([email, z.literal("")])
    .transform((value) => value || null)
    .nullable()
    .optional(),
  address: optionalText(200),
  slotIntervalMin: z
    .number()
    .int()
    .refine((value) => (SLOT_INTERVALS as readonly number[]).includes(value), "invalid_value")
    .optional(),
  minNoticeMin: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  closedOnHolidays: z.boolean().optional(),
  /** Minutes before an appointment that customers can still change it; null: never. */
  customerChangeNoticeMin: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14)
    .nullable()
    .optional(),
  /** Booking page accent; null goes back to OpenTurnly's. */
  brandColor: hexColor.nullable().optional(),
  pageTheme: z.enum(PAGE_THEMES).optional(),
  bookingForm: bookingFormSchema.optional(),
});
export type BusinessUpdateInput = z.infer<typeof businessUpdateSchema>;

// --- Catalog --------------------------------------------------------------

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  durationMin: z.number().int().min(5).max(600),
  /** Minor currency units (cents). Null means "ask at the business". */
  /** Always shown on the booking page; 0 for free services. */
  priceAmount: z.number().int().min(0).max(1e12),
  active: z.boolean().default(true),
  /** Where it is offered. Left out when creating: every location. */
  locationIds: z.array(z.string().min(1)).max(200).optional(),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

export const professionalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).max(500),
  /** Where they work. Left out when creating: every location. */
  locationIds: z.array(z.string().min(1)).max(200).optional(),
});
export type ProfessionalInput = z.infer<typeof professionalSchema>;

/** A location of the business, with the services it offers and the people who work there. */
export const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: optionalText(300),
  phone: optionalText(40),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).max(500),
  resourceIds: z.array(z.string().min(1)).max(500),
});
export type LocationInput = z.infer<typeof locationSchema>;

// --- Opening hours ---------------------------------------------------------

const timeOfDay = z.string().refine(isTimeString, "invalid_time");
const calendarDate = z.string().refine(isDateString, "invalid_date");

export const weeklyRangeSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: timeOfDay,
  end: timeOfDay,
});

/**
 * Replaces the weekly hours of a location (`resourceId: null`) or of one professional at
 * that location. An empty list for a professional means "use the location's hours".
 * Without `locationId`, the business's first location.
 */
export const weeklyHoursSchema = z.object({
  locationId: z.string().min(1).optional(),
  resourceId: z.string().min(1).nullable(),
  hours: z
    .array(weeklyRangeSchema)
    .max(100)
    .superRefine((hours, ctx) => {
      const problem = hoursProblem(hours);
      if (problem) ctx.addIssue({ code: "custom", message: `hours_${problem}` });
    }),
});
export type WeeklyHoursInput = z.infer<typeof weeklyHoursSchema>;

export const holidayDecisionSchema = z.object({ closed: z.boolean() });

/** Longest closure in one go: a year. */
export const MAX_CLOSURE_DAYS = 366;

/**
 * Days without bookings, from `date` to `endDate` (inclusive; one day when left out), for
 * one professional wherever they work, or else one location (`locationId`) or every
 * location (both null).
 */
export const closureSchema = z
  .object({
    date: calendarDate,
    endDate: calendarDate.optional(),
    locationId: z.string().min(1).nullable().default(null),
    resourceId: z.string().min(1).nullable(),
    note: optionalText(120),
  })
  .transform((closure) => ({ ...closure, endDate: closure.endDate ?? closure.date }))
  .refine((closure) => closure.endDate >= closure.date, {
    message: "end_before_start",
    path: ["endDate"],
  })
  .refine((closure) => addDays(closure.date, MAX_CLOSURE_DAYS - 1) >= closure.endDate, {
    message: "too_long",
    path: ["endDate"],
  });
export type ClosureInput = z.infer<typeof closureSchema>;

// --- Public booking ---------------------------------------------------------

/**
 * A phone number written any common way, stored as E.164 ("+573001234567"); empty is null.
 * `defaultCountry` reads numbers typed without a country code.
 */
const phoneField = (defaultCountry?: string | null) =>
  z
    .string()
    .nullish()
    .transform((value, ctx) => {
      const text = value?.trim() ?? "";
      if (!text) return null;
      const normalized = normalizePhone(text, defaultCountry ?? undefined);
      if (!normalized) {
        ctx.addIssue({ code: "custom", message: "invalid_phone" });
        return z.NEVER;
      }
      return normalized;
    });
const optionalPhone = phoneField();

/** Trimmed and lowercased; empty is null. */
const optionalEmail = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    const text = value?.trim().toLowerCase() ?? "";
    if (!text) return null;
    if (!z.email().safeParse(text).success) {
      ctx.addIssue({ code: "custom", message: "invalid_format" });
      return z.NEVER;
    }
    return text;
  });

/** At least one way to reach the customer, so they can be told apart and contacted. */
function requireContact(
  customer: { phone?: string | null; email?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!customer.phone && !customer.email) {
    ctx.addIssue({ code: "custom", message: "contact_required", path: ["phone"] });
  }
}

const customerFields = z.object({
  firstName: personName,
  lastName: personName,
  phone: optionalPhone,
  email: optionalEmail,
  /** Private notes for the business, never shown to the customer. */
  notes: optionalText(1000),
});

/** A customer as the business adds them by hand. */
export const customerAdminSchema = customerFields.superRefine(requireContact);
export type CustomerAdminInput = z.input<typeof customerAdminSchema>;
/** Edits send only what changed; the server checks a contact is left. */
export const customerPatchSchema = customerFields.partial();

/**
 * An appointment the business books itself: an existing customer, or a new one's details
 * (matched by phone or email like online bookings).
 */
export const staffBookingSchema = z
  .object({
    /** Needed when the business has more than one active location. */
    locationId: z.string().min(1).optional(),
    serviceId: z.string().min(1),
    /** A professional, or null for whoever is free. */
    resourceId: z.string().min(1).nullable(),
    date: calendarDate,
    time: timeOfDay,
    customerId: z.string().min(1).optional(),
    customer: customerFields.omit({ notes: true }).superRefine(requireContact).optional(),
  })
  .refine((booking) => booking.customerId || booking.customer, {
    message: "required",
    path: ["customerId"],
  });
export type StaffBookingInput = z.input<typeof staffBookingSchema>;

/** An answer, kept with the appointment together with the question as it was asked. */
export type BookingAnswer = { id: string; label: string; value: string };

function contactField(
  rule: FieldRule,
  field: ReturnType<typeof phoneField> | typeof optionalEmail,
) {
  if (rule === "hidden") return z.unknown().transform((): string | null => null);
  if (rule === "optional") return field;
  return field.superRefine((value, ctx) => {
    if (value === null) ctx.addIssue({ code: "custom", message: "required" });
  });
}

/**
 * The customer details and answers a booking needs, following the business's form. Used
 * by the booking page and the server, so both apply the same rules.
 */
export function bookingDetailsSchema(form: BookingForm, country?: string | null) {
  return z.object({
    customer: z.object({
      firstName: personName,
      lastName: personName,
      // Numbers typed without a country code are read as the business's country.
      phone: contactField(form.phone, phoneField(country)),
      email: contactField(form.email, optionalEmail),
    }),
    answers: z
      .record(z.string(), z.string().max(1000))
      .nullish()
      .transform((raw, ctx) => {
        const answers: BookingAnswer[] = [];
        for (const question of form.questions) {
          const value = (raw?.[question.id] ?? "").trim();
          if (!value) {
            if (question.required) {
              ctx.addIssue({ code: "custom", message: "required", path: [question.id] });
            }
          } else if (question.type === "select" && !question.options.includes(value)) {
            ctx.addIssue({ code: "custom", message: "invalid_value", path: [question.id] });
          } else {
            answers.push({ id: question.id, label: question.label, value });
          }
        }
        return answers;
      }),
  });
}
export type BookingDetails = z.output<ReturnType<typeof bookingDetailsSchema>>;

export const bookingSchema = z.object({
  /** Needed when the business has more than one active location. */
  locationId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  /** A professional, or null for "anyone available" (or a business without professionals). */
  resourceId: z.string().min(1).nullable(),
  date: calendarDate,
  time: timeOfDay,
  /** Checked against the business's form with `bookingDetailsSchema`. */
  customer: z.object({
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullish(),
    email: z.string().nullish(),
  }),
  answers: z.record(z.string(), z.string()).nullish(),
  /** A discount code the customer typed. */
  giftCode: z.string().max(40).optional(),
  /** Honeypot: hidden from people, filled in by bots. Must stay empty. */
  website: z.string().max(0).optional(),
  /** Solved anti-bot puzzle (ALTCHA payload, base64 JSON), one per booking. */
  proof: z.string().max(8_000).optional(),
});
export type BookingInput = z.infer<typeof bookingSchema>;

export const grantAccessSchema = z.object({ email });

/**
 * Access keys for a business's MCP server. "agent" is for bots that talk to customers:
 * catalog, availability, booking, and changes only with the booking code and the
 * customer's phone or email. "admin" can do what an admin does in the panel.
 */
export const API_KEY_KINDS = ["agent", "admin"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(API_KEY_KINDS),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

// --- Automations (outgoing webhooks) ----------------------------------------

/**
 * When an automation fires: on a change to an appointment, or some time before it
 * starts (reminders) or after it ends (follow-ups).
 */
export const AUTOMATION_TRIGGERS = [
  "created",
  "rescheduled",
  "cancelled",
  "before",
  "after",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/** The event name each trigger sends (also in the X-OpenTurnly-Event header). */
export const AUTOMATION_EVENTS: Record<AutomationTrigger, string> = {
  created: "appointment.created",
  rescheduled: "appointment.rescheduled",
  cancelled: "appointment.cancelled",
  before: "appointment.reminder",
  after: "appointment.followup",
};

/**
 * Data an automation can send, by group, named by its path in the data:
 * { event, appointment: {…}, customer: {…}, business: {…} }. Placeholders use the same
 * paths, so {{customer.first_name}} is the customer's first name.
 */
export const AUTOMATION_FIELDS = {
  appointment: [
    "event",
    "appointment.code",
    "appointment.status",
    "appointment.date",
    "appointment.time",
    "appointment.end_time",
    "appointment.weekday",
    "appointment.date_text",
    "appointment.starts_at",
    "appointment.ends_at",
    "appointment.service",
    "appointment.duration_minutes",
    "appointment.professional",
    "appointment.location",
    "appointment.location_address",
    "appointment.price",
    "appointment.price_text",
    "appointment.booked_via",
    "appointment.answers",
    "appointment.previous_date",
    "appointment.previous_time",
  ],
  customer: [
    "customer.name",
    "customer.first_name",
    "customer.last_name",
    "customer.phone",
    "customer.phone_digits",
    "customer.email",
  ],
  business: [
    "business.name",
    "business.phone",
    "business.address",
    "business.booking_page",
    "business.time_zone",
  ],
} as const;
export type AutomationGroup = keyof typeof AUTOMATION_FIELDS;
export type AutomationField = (typeof AUTOMATION_FIELDS)[AutomationGroup][number];
export const AUTOMATION_GROUPS = Object.keys(AUTOMATION_FIELDS) as AutomationGroup[];
export const ALL_AUTOMATION_FIELDS = Object.values(AUTOMATION_FIELDS).flat() as AutomationField[];

/** Longest an automation can wait before or after an appointment: 30 days. */
export const MAX_AUTOMATION_OFFSET_MIN = 30 * 24 * 60;

const headerName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/, "invalid_header");
const extraName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_.-]+$/, "invalid_field_name");

/**
 * The steps of a flow, run in order: "webhook" sends to any URL that takes webhooks;
 * "wait" holds the steps after it back for a while.
 */
export const AUTOMATION_ACTION_TYPES = ["webhook", "wait"] as const;
/** Steps in one flow, waits included. */
export const MAX_AUTOMATION_ACTIONS = 10;
/** Systems one flow can tell. */
export const MAX_AUTOMATION_WEBHOOKS = 5;

/** Made by the editor, so deliveries and test results can point at their step. */
const stepId = z.string().regex(/^[A-Za-z0-9-]{1,40}$/);

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH"] as const;

const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * A host inside the server's own network (localhost, a private IP, a container's name like
 * "crm"), where plain http never leaves the machine. Those addresses are refused when sending
 * unless the install allows them (WEBHOOKS_ALLOW_PRIVATE).
 */
function insideNetwork(host: string) {
  const name = host.toLowerCase();
  return (
    !name.includes(".") ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name.endsWith(".internal") ||
    PRIVATE_IPV4.test(name)
  );
}
export const WEBHOOK_AUTH_TYPES = ["none", "basic", "header", "jwt"] as const;
export const WEBHOOK_BODY_MODES = ["fields", "json"] as const;

/**
 * How the receiving system checks the call comes from us, the usual ways webhooks offer:
 * nothing, a user and password (Basic), a token in a header ("Authorization: Bearer …"),
 * or a JWT signed with a shared secret (HS256, made fresh for every send).
 */
export const webhookAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("basic"),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal("header"), name: headerName, value: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("jwt"), secret: z.string().min(1).max(500) }),
]);
export type WebhookAuth = z.output<typeof webhookAuthSchema>;

const PLACEHOLDER = /\{\{\s*([A-Za-z_.]+)\s*\}\}/g;
/** What a placeholder can name: one field, or a whole group ({{customer}}) as an object. */
const PLACEHOLDER_NAMES = new Set<string>([...ALL_AUTOMATION_FIELDS, ...AUTOMATION_GROUPS]);

/** The value at a path of the data: "customer.first_name" → values.customer.first_name. */
export function valueAt(values: Record<string, unknown>, path: string): unknown {
  let value: unknown = values;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Fields nested by group, as the data has them: "customer.name" → { customer: { name } }. */
export function nestFields(
  fields: readonly AutomationField[],
  value: (field: AutomationField) => unknown,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const [group = "", key] = field.split(".");
    if (!key) {
      data[group] = value(field);
      continue;
    }
    const groupData = (data[group] ?? {}) as Record<string, unknown>;
    groupData[key] = value(field);
    data[group] = groupData;
  }
  return data;
}

/**
 * The body of a step that sends fields: the chosen ones (all when null), nested by group
 * in the data's order, then its extra values with their placeholders filled.
 */
export function fieldsBody(
  action: { fields: readonly AutomationField[] | null; extra: { name: string; value: string }[] },
  values: Record<string, unknown>,
): Record<string, unknown> {
  const chosen = ALL_AUTOMATION_FIELDS.filter((field) => action.fields?.includes(field) ?? true);
  const data = nestFields(chosen, (field) => valueAt(values, field) ?? null);
  for (const { name, value } of action.extra) data[name] = renderTemplate(value, values);
  return data;
}

/**
 * Fills a JSON body written by hand. Inside quotes, {{field}} becomes the field's text
 * (escaped, so quotes in a name can't break it); on its own it becomes the JSON value
 * (a number, text in quotes, an object or null). Throws when the result isn't valid JSON.
 */
export function renderJsonTemplate(template: string, values: Record<string, unknown>): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < template.length; i++) {
    if (template.startsWith("{{", i)) {
      const end = template.indexOf("}}", i + 2);
      const name = end > 0 ? template.slice(i + 2, end).trim() : "";
      if (/^[A-Za-z_.]+$/.test(name)) {
        const value = valueAt(values, name);
        out += inString
          ? JSON.stringify(
              value === null || value === undefined || typeof value === "object"
                ? ""
                : String(value),
            ).slice(1, -1)
          : JSON.stringify(value === undefined ? null : value);
        i = end + 1;
        continue;
      }
    }
    const char = template[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    }
    out += char;
  }
  return JSON.parse(out);
}

/** Why a JSON body can't be used, or null: "invalid_json", "json_not_object", "unknown_field". */
export function jsonTemplateProblem(template: string): string | null {
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!PLACEHOLDER_NAMES.has(match[1] ?? "")) return "unknown_field";
  }
  const sample = nestFields(ALL_AUTOMATION_FIELDS, () => "x");
  try {
    const value = renderJsonTemplate(template, sample);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? null
      : "json_not_object";
  } catch {
    return "invalid_json";
  }
}

export const webhookActionSchema = z
  .object({
    id: stepId,
    type: z.literal("webhook"),
    method: z.enum(WEBHOOK_METHODS).default("POST"),
    url: z
      .string()
      .trim()
      .max(2000)
      .superRefine((value, ctx) => {
        const match = /^(https?):\/\/([a-z0-9.-]+)(:\d+)?(\/[^\s]*)?$/i.exec(value);
        if (!match) ctx.addIssue({ code: "custom", message: "invalid_url" });
        // Appointment data is personal: it only crosses the internet encrypted.
        else if (match[1]?.toLowerCase() === "http" && !insideNetwork(match[2] ?? "")) {
          ctx.addIssue({ code: "custom", message: "https_required" });
        }
      }),
    auth: webhookAuthSchema.default({ type: "none" }),
    headers: z
      .array(z.object({ name: headerName, value: z.string().max(2000) }))
      .max(10)
      .default([]),
    /** "fields": the data picked below, nested by group; "json": the body written by hand. */
    body: z.enum(WEBHOOK_BODY_MODES).default("fields"),
    /** The body for "json", with {{field}} placeholders. */
    json: z.string().max(20_000).default(""),
    /** The fields to send; null sends all of them. */
    fields: z
      .array(z.enum(ALL_AUTOMATION_FIELDS as [AutomationField, ...AutomationField[]]))
      .max(50)
      .nullable()
      .default(null),
    /** Fixed or templated values ("Hola {{customer.first_name}}…") added to the data. */
    extra: z
      .array(z.object({ name: extraName, value: z.string().max(2000) }))
      .max(20)
      .default([]),
  })
  .refine(
    (action) =>
      action.body !== "fields" ||
      action.fields === null ||
      action.fields.length > 0 ||
      action.extra.length > 0,
    { message: "fields_required", path: ["fields"] },
  )
  .superRefine((action, ctx) => {
    if (action.body !== "json") return;
    const problem = action.json.trim() ? jsonTemplateProblem(action.json) : "json_required";
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["json"] });
  });
export type WebhookAction = z.output<typeof webhookActionSchema>;

export const waitActionSchema = z.object({
  id: stepId,
  type: z.literal("wait"),
  minutes: z.number().int().min(1).max(MAX_AUTOMATION_OFFSET_MIN),
});
export type WaitAction = z.output<typeof waitActionSchema>;

export const automationActionSchema = z.discriminatedUnion("type", [
  webhookActionSchema,
  waitActionSchema,
]);
export type AutomationAction = z.output<typeof automationActionSchema>;

export const automationSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    /**
     * Minutes before the start, for "before": the moment the flow starts. Other triggers start
     * the moment they happen and wait with wait steps; flows saved before those existed may
     * still hold a wait here (after the end for "after", before every step for changes).
     */
    offsetMin: z.number().int().min(0).max(MAX_AUTOMATION_OFFSET_MIN).default(0),
    actions: z.array(automationActionSchema).min(1).max(MAX_AUTOMATION_ACTIONS),
    active: z.boolean().default(true),
  })
  .refine((automation) => automation.trigger !== "before" || automation.offsetMin > 0, {
    message: "offset_required",
    path: ["offsetMin"],
  })
  .refine(
    (automation) =>
      new Set(automation.actions.map((action) => action.id)).size === automation.actions.length,
    { message: "duplicate_action", path: ["actions"] },
  )
  .refine(
    (automation) => {
      const webhooks = automation.actions.filter((action) => action.type === "webhook").length;
      return webhooks > 0 && webhooks <= MAX_AUTOMATION_WEBHOOKS;
    },
    { message: "webhook_required", path: ["actions"] },
  );
export type AutomationInput = z.input<typeof automationSchema>;

/**
 * Runs a flow right away to see how each step answers: with an appointment of the business
 * or example data, saved or not (unsaved drafts are signed with a throwaway secret).
 */
export const automationTestSchema = z.object({
  automation: automationSchema,
  /** The saved automation being edited: its secret signs the test and it shows in its history. */
  automationId: z.string().min(1).optional(),
  /** null or missing: example data. */
  appointmentId: z.string().min(1).nullable().optional(),
  /** Only this step; missing: every step. */
  actionId: z.string().min(1).optional(),
});
export type AutomationTestInput = z.input<typeof automationTestSchema>;

/** Replaces {{field}} with the field's value; unknown fields and whole groups become empty. */
export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_, field: string) => {
    const value = valueAt(values, field);
    return value === null || value === undefined || typeof value === "object" ? "" : String(value);
  });
}

/**
 * What someone can do in a business: admins manage everything about it; professionals see
 * and book only their own appointments (linked to their professional profile).
 */
export const BUSINESS_ROLES = ["admin", "professional"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

const memberRole = z.object({
  role: z.enum(BUSINESS_ROLES),
  /** The professional profile a "professional" user is; null for admins. */
  resourceId: z.string().min(1).nullable().default(null),
});

function requireProfile(
  member: { role?: BusinessRole; resourceId?: string | null },
  ctx: z.RefinementCtx,
) {
  if (member.role === "professional" && !member.resourceId) {
    ctx.addIssue({ code: "custom", message: "required", path: ["resourceId"] });
  }
}

/**
 * Gives someone access with an account the business creates for them. The password is
 * needed only when the email has no account yet.
 */
export const memberCreateSchema = memberRole
  .extend({ name: personName, email, password: password.optional() })
  .superRefine(requireProfile);
export type MemberCreateInput = z.input<typeof memberCreateSchema>;

export const memberUpdateSchema = memberRole.superRefine(requireProfile);
export type MemberUpdateInput = z.input<typeof memberUpdateSchema>;

export const passwordResetSchema = z.object({ password });

/** The signed-in person's own name and email. A new email needs the current password. */
export const accountUpdateSchema = z.object({
  name: personName,
  email,
  currentPassword: z.string().max(128).optional(),
});
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;

/**
 * The guided tours of the admin: "welcome" walks through every section the first time, and
 * each section has a short one for the first visit. Each is shown once per person.
 */
// --- Sales ----------------------------------------------------------------

/** How customers pay at the counter. OpenTurnly records it; it doesn't take payments. */
export const PAYMENT_METHODS = ["cash", "card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Plus what a sale can be paid with besides money: a deposit left before. */
export const SALE_PAYMENT_METHODS = [...PAYMENT_METHODS, "deposit", "gift_card"] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];
export const SALE_ITEM_KINDS = ["service", "gift_card"] as const;
export type SaleItemKind = (typeof SALE_ITEM_KINDS)[number];

/** An amount in minor currency units. */
const money = z.number().int().min(0).max(1e12);

export const saleItemSchema = z
  .object({
    kind: z.literal("service"),
    /** May be left out when charging an appointment whose service was deleted since. */
    serviceId: z.string().min(1).nullable().default(null),
    /** The appointment being charged, if the line is one. */
    appointmentId: z.string().min(1).optional(),
    /** Who did it, for commissions. */
    resourceId: z.string().min(1).nullable().default(null),
    quantity: z.number().int().min(1).max(999).default(1),
    unitPrice: money,
    discountAmount: money.default(0),
  })
  .refine((item) => item.serviceId || item.appointmentId, {
    message: "required",
    path: ["serviceId"],
  });
export type SaleItemInput = z.input<typeof saleItemSchema>;

export const salePaymentSchema = z.object({
  method: z.enum(SALE_PAYMENT_METHODS),
  amount: money,
  /** For "deposit": which one. */
  depositId: z.string().min(1).optional(),
  /** For "gift_card": the card whose balance pays. */
  giftCardId: z.string().min(1).optional(),
});

/**
 * A sale: its lines, a discount on the whole, tips per professional and how it was paid.
 * The payments must add up to the total plus the tips.
 */
export const saleSchema = z.object({
  /** Without it, the location of the first appointment charged, or the only one. */
  locationId: z.string().min(1).optional(),
  customerId: z.string().min(1).nullable().default(null),
  internal: z.boolean().default(false),
  /** A discount code used at the counter: counts as one of its uses. */
  giftCardId: z.string().min(1).optional(),
  items: z.array(saleItemSchema).min(1).max(100),
  discountAmount: money.default(0),
  tips: z
    .array(z.object({ resourceId: z.string().min(1), amount: money.min(1) }))
    .max(50)
    .default([]),
  payments: z.array(salePaymentSchema).max(10),
  note: optionalText(500),
});
export type SaleInput = z.input<typeof saleSchema>;

/** Money left in advance by a customer, for an appointment or a later visit. */
export const depositSchema = z.object({
  customerId: z.string().min(1),
  appointmentId: z.string().min(1).nullable().default(null),
  locationId: z.string().min(1).optional(),
  amount: money.min(1),
  method: z.enum(PAYMENT_METHODS),
  note: optionalText(300),
});
export type DepositInput = z.input<typeof depositSchema>;

// --- Gift cards -------------------------------------------------------------

/**
 * "discount": a code that takes a percentage or an amount off, on the booking page or at
 * the counter. "balance": a card sold (or given) with money on it, spent as a payment.
 */
export const GIFT_CARD_KINDS = ["discount", "balance"] as const;
export type GiftCardKind = (typeof GIFT_CARD_KINDS)[number];

/** "VERANO20", "GC-7K2M": letters, numbers and dashes; typed in any case. */
export const giftCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, "invalid_code");

const giftCardCommon = {
  code: giftCodeSchema,
  /** First and last day it works, in the business's time zone; null: no limit. */
  validFrom: calendarDate.nullable().default(null),
  validUntil: calendarDate.nullable().default(null),
  customerId: z.string().min(1).nullable().default(null),
  note: optionalText(300),
};

export const giftCardSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("discount"),
      ...giftCardCommon,
      /** A percentage off, or else a fixed amount off (`amount`). */
      percent: z.number().int().min(1).max(100).nullable().default(null),
      amount: money.min(1).nullable().default(null),
      /** How many times it can be used in all; null: no limit. */
      maxUses: z.number().int().min(1).max(100_000).nullable().default(null),
    }),
    z.object({
      kind: z.literal("balance"),
      ...giftCardCommon,
      amount: money.min(1),
      /** How it was paid for, recorded as a sale; null when it's given away. */
      paidWith: z.enum(PAYMENT_METHODS).nullable().default(null),
      locationId: z.string().min(1).optional(),
    }),
  ])
  .refine((card) => card.kind === "balance" || (card.percent === null) !== (card.amount === null), {
    message: "percent_or_amount",
    path: ["percent"],
  })
  .refine((card) => !card.validFrom || !card.validUntil || card.validFrom <= card.validUntil, {
    message: "end_before_start",
    path: ["validUntil"],
  });
export type GiftCardInput = z.input<typeof giftCardSchema>;

export const giftCardPatchSchema = z
  .object({
    active: z.boolean(),
    validFrom: calendarDate.nullable(),
    validUntil: calendarDate.nullable(),
    maxUses: z.number().int().min(1).max(100_000).nullable(),
    note: optionalText(300),
  })
  .partial();

export const TOURS = [
  "welcome",
  "agenda",
  "customers",
  "services",
  "professionals",
  "locations",
  "hours",
  "settings",
] as const;
export type Tour = (typeof TOURS)[number];
export type GrantAccessInput = z.infer<typeof grantAccessSchema>;

export const acceptInvitationSchema = z.object({ name: personName, password });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
