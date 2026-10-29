import {
  API_KEY_KINDS,
  AUTOMATION_TRIGGERS,
  type AutomationAction,
  type BookingAnswer,
  type BookingForm,
  BUSINESS_ROLES,
  DEFAULT_BOOKING_FORM,
  GIFT_CARD_KINDS,
  PAGE_THEMES,
  PAYMENT_METHODS,
  SALE_ITEM_KINDS,
  SALE_PAYMENT_METHODS,
} from "@openturnly/core";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
/** A point in time, stored as `timestamptz` and read as a JS Date. */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () =>
  instant("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

// ---------------------------------------------------------------------------
// Authentication. Column keys must match the field names Better Auth expects.
// ---------------------------------------------------------------------------

export const USER_ROLES = ["owner", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** "owner" installed this OpenTurnly instance and sees every business. */
  role: text("role", { enum: USER_ROLES }).notNull().default("member"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: instant("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/** The guided tours each person has already seen (or skipped), so each shows only once. */
export const userTours = pgTable(
  "user_tours",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tour: text("tour").notNull(),
    /** When the person saw or skipped it. */
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tour] })],
);

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

export const businesses = pgTable("businesses", {
  id: id(),
  /** Public booking page lives at /<slug>. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** IANA time zone. Opening hours are wall-clock times in this zone. */
  timezone: text("timezone").notNull(),
  /** ISO 4217 code. Prices are stored as integers in the currency's minor unit. */
  currency: text("currency").notNull(),
  /** Default language of the public booking page. */
  locale: text("locale").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  /** Minutes between offered start times. */
  slotIntervalMin: integer("slot_interval_min").notNull().default(30),
  /** Customers must book at least this many minutes ahead. */
  minNoticeMin: integer("min_notice_min").notNull().default(60),
  /** Customers can book up to this many days ahead. */
  maxAdvanceDays: integer("max_advance_days").notNull().default(30),
  /** Closed on public holidays unless a holiday is listed in holiday_overrides. */
  closedOnHolidays: boolean("closed_on_holidays").notNull().default(true),
  /**
   * Customers can move or cancel their own appointment (through an AI agent) up to this
   * many minutes before it starts; null means only the business can.
   */
  customerChangeNoticeMin: integer("customer_change_notice_min").default(120),
  /** Booking page accent as "#rrggbb"; null uses OpenTurnly's. */
  brandColor: text("brand_color"),
  /** Background look of the booking page (see PAGE_THEMES). */
  pageTheme: text("page_theme", { enum: PAGE_THEMES }).notNull().default("soft"),
  /** Which customer details the booking page asks for, plus the business's own questions. */
  bookingForm: jsonb("booking_form").$type<BookingForm>().notNull().default(DEFAULT_BOOKING_FORM),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Users other than the instance owner who can work in a business, and how. */
export const businessMembers = pgTable(
  "business_members",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: BUSINESS_ROLES }).notNull().default("admin"),
    /** For professionals: the profile whose agenda they see. */
    resourceId: text("resource_id").references((): AnyPgColumn => resources.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.userId] }),
    index("business_members_user_id_idx").on(table.userId),
  ],
);

/** A link that lets someone without an account create one and join a business. */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** SHA-256 of the token in the link. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: instant("expires_at").notNull(),
    acceptedAt: instant("accepted_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_idx").on(table.tokenHash),
    index("invitations_business_id_idx").on(table.businessId),
  ],
);

/** Raw bytes. node-postgres returns a Buffer, PGlite a Uint8Array: both become a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

export const IMAGE_KINDS = ["logo", "cover"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * The business logo and cover photo for the booking page. Kept in the database so they
 * are part of backups and work with several app servers.
 */
export const businessImages = pgTable(
  "business_images",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: IMAGE_KINDS }).notNull(),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.businessId, table.kind] })],
);

// ---------------------------------------------------------------------------
// Locations: the places a business works from. Every business has at least one.
// ---------------------------------------------------------------------------

/**
 * A branch of the business, with its own address, opening hours, services and people.
 * All of a business's locations share its time zone, currency and booking rules.
 */
export const locations = pgTable(
  "locations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    /** Inactive locations take no bookings and are hidden from the booking page. */
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("locations_business_id_idx").on(table.businessId)],
);

// ---------------------------------------------------------------------------
// Catalog: what can be booked, and with whom
// ---------------------------------------------------------------------------

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    /** Minor currency units. Null: price shown as "ask at the business". */
    priceAmount: bigint("price_amount", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("services_business_id_idx").on(table.businessId)],
);

/**
 * Professionals (or courts, rooms…) customers book with. A business with none takes
 * bookings on its own opening hours, one at a time.
 */
export const resources = pgTable(
  "resources",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("resources_business_id_idx").on(table.businessId)],
);

/** Which services each professional offers. */
export const resourceServices = pgTable(
  "resource_services",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.serviceId] }),
    index("resource_services_service_id_idx").on(table.serviceId),
  ],
);

/** Which services each location offers. */
export const locationServices = pgTable(
  "location_services",
  {
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.locationId, table.serviceId] }),
    index("location_services_service_id_idx").on(table.serviceId),
  ],
);

/** Where each professional works. Someone can work in several locations. */
export const resourceLocations = pgTable(
  "resource_locations",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.locationId] }),
    index("resource_locations_location_id_idx").on(table.locationId),
  ],
);

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

/**
 * Weekly opening hours as wall-clock times in the business time zone, per location.
 * `resourceId` null: the location's hours. A professional without rows at a location
 * works there on the location's hours.
 */
export const weeklyHours = pgTable(
  "weekly_hours",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    /** 0 = Sunday … 6 = Saturday */
    weekday: integer("weekday").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
  },
  (table) => [index("weekly_hours_business_id_idx").on(table.businessId)],
);

/**
 * Days without bookings: holidays, vacations. A professional's closure applies wherever
 * they work; otherwise `locationId` closes one location, or every one when null.
 */
export const closures = pgTable(
  "closures",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    /** First and last closed day (inclusive), "YYYY-MM-DD" in the business time zone. */
    date: date("date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [index("closures_business_date_idx").on(table.businessId, table.date)],
);

/**
 * Public holidays where the business does the opposite of `closedOnHolidays`:
 * opens on that holiday when it normally closes on holidays, or the other way round.
 */
export const holidayOverrides = pgTable(
  "holiday_overrides",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.businessId, table.date] })],
);

// ---------------------------------------------------------------------------
// Customers and appointments
// ---------------------------------------------------------------------------

/** People who booked. No account: identified by email within each business. */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** Either may be missing, depending on the booking form; never both. */
    email: text("email"),
    phone: text("phone"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Private notes for the business ("prefers a fade"), never shown to the customer. */
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("customers_business_email_idx").on(table.businessId, table.email),
    index("customers_business_phone_idx").on(table.businessId, table.phone),
  ],
);

export const APPOINTMENT_STATUSES = ["confirmed", "cancelled"] as const;
export const APPOINTMENT_SOURCES = ["online", "admin", "agent"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/**
 * Service and professional names and the price are copied at booking time, so the
 * history stays right if they are renamed or deleted later.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    /** Short code the customer can quote ("K7Q4XM"); unique across the install. */
    code: text("code").notNull(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** Locations with appointments can't be deleted, only made inactive. */
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    resourceId: text("resource_id").references(() => resources.id, { onDelete: "set null" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull().default("confirmed"),
    serviceName: text("service_name").notNull(),
    resourceName: text("resource_name"),
    priceAmount: bigint("price_amount", { mode: "number" }),
    /** Taken off the price by a discount code at booking (`giftCardId`). */
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    giftCardId: text("gift_card_id").references((): AnyPgColumn => giftCards.id, {
      onDelete: "set null",
    }),
    /** Answers to the business's extra questions, with each question as it was asked. */
    answers: jsonb("answers").$type<BookingAnswer[]>().notNull().default([]),
    /** Booking page, the business itself, or an AI agent through MCP (see source_label). */
    source: text("source", { enum: APPOINTMENT_SOURCES }).notNull().default("online"),
    /** For agent bookings: the name of the access key used. */
    sourceLabel: text("source_label"),
    cancelledAt: instant("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("appointments_business_starts_idx").on(table.businessId, table.startsAt),
    index("appointments_resource_starts_idx").on(table.resourceId, table.startsAt),
    index("appointments_customer_idx").on(table.customerId),
    index("appointments_location_starts_idx").on(table.locationId, table.startsAt),
    uniqueIndex("appointments_code_idx").on(table.code),
  ],
);

// ---------------------------------------------------------------------------
// Sales: what was charged, how it was paid and who got the tips
// ---------------------------------------------------------------------------

export const SALE_STATUSES = ["paid", "void"] as const;

/**
 * A sale at the counter: appointments charged, products sold… OpenTurnly records how the
 * customer paid; it doesn't take payments itself. Amounts are in minor currency units.
 * A void sale stays in the history but counts nowhere.
 */
export const sales = pgTable(
  "sales",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** Locations with sales can't be deleted, only made inactive. */
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    /** 1, 2, 3… per business, for receipts and for finding a sale. */
    number: integer("number").notNull(),
    /** Walk-in product sales may have no customer. */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Sold to the team or used by the business itself ("ventas internas"). */
    internal: boolean("internal").notNull().default(false),
    /** A discount code used at the counter. */
    giftCardId: text("gift_card_id").references((): AnyPgColumn => giftCards.id, {
      onDelete: "set null",
    }),
    /** Sum of the lines, after each line's discount. */
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),
    /** Discount on the whole sale. */
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    /** What the customer owes for the sale: subtotal minus discount. Tips come on top. */
    total: bigint("total", { mode: "number" }).notNull(),
    tipAmount: bigint("tip_amount", { mode: "number" }).notNull().default(0),
    note: text("note"),
    status: text("status", { enum: SALE_STATUSES }).notNull().default("paid"),
    soldBy: text("sold_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: instant("voided_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sales_business_number_idx").on(table.businessId, table.number),
    index("sales_business_created_idx").on(table.businessId, table.createdAt),
    index("sales_customer_idx").on(table.customerId),
  ],
);

/** The lines of a sale, with names and prices copied so history stays right. */
export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SALE_ITEM_KINDS }).notNull(),
    /** The appointment charged on this line, if any. */
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    /** For a gift card sold: the card. */
    giftCardId: text("gift_card_id").references((): AnyPgColumn => giftCards.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** Who did it, for commissions. */
    resourceId: text("resource_id").references(() => resources.id, { onDelete: "set null" }),
    resourceName: text("resource_name"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    /** quantity × unit price − discount. */
    total: bigint("total", { mode: "number" }).notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    index("sale_items_sale_idx").on(table.saleId),
    index("sale_items_appointment_idx").on(table.appointmentId),
  ],
);

/** Tips left with a sale, for each professional. */
export const saleTips = pgTable(
  "sale_tips",
  {
    id: id(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resources.id, { onDelete: "set null" }),
    resourceName: text("resource_name").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (table) => [index("sale_tips_sale_idx").on(table.saleId)],
);

/** How a sale was paid: one row per method, adding up to its total plus tips. */
export const salePayments = pgTable(
  "sale_payments",
  {
    id: id(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: text("method", { enum: SALE_PAYMENT_METHODS }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** For "deposit": the deposit used. */
    depositId: text("deposit_id").references((): AnyPgColumn => deposits.id, {
      onDelete: "set null",
    }),
    /** For "gift_card": the card whose balance paid. */
    giftCardId: text("gift_card_id").references((): AnyPgColumn => giftCards.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("sale_payments_sale_idx").on(table.saleId)],
);

/**
 * Discount codes and gift cards with a balance. Uses and balance aren't stored: they come
 * from the appointments and sales that used the card, so voiding or cancelling gives them
 * back on its own.
 */
export const giftCards = pgTable(
  "gift_cards",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** What people type, upper case; unique within the business. */
    code: text("code").notNull(),
    kind: text("kind", { enum: GIFT_CARD_KINDS }).notNull(),
    /** Discount codes: a percentage off… */
    percent: integer("percent"),
    /** …or a fixed amount off. Gift cards: the money on the card. */
    amount: bigint("amount", { mode: "number" }),
    maxUses: integer("max_uses"),
    validFrom: date("valid_from", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    /** Who it was sold or given to. */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("gift_cards_business_code_idx").on(table.businessId, table.code)],
);

export const DEPOSIT_STATUSES = ["active", "void"] as const;

/**
 * Money a customer leaves in advance ("abonos"), usually for an appointment. It counts as
 * cash flow when received and is used up as a payment when the appointment is charged.
 */
export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    note: text("note"),
    status: text("status", { enum: DEPOSIT_STATUSES }).notNull().default("active"),
    /** The sale it paid for, once used. */
    appliedSaleId: text("applied_sale_id").references(() => sales.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: instant("voided_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("deposits_business_created_idx").on(table.businessId, table.createdAt),
    index("deposits_customer_idx").on(table.customerId),
    index("deposits_appointment_idx").on(table.appointmentId),
  ],
);

/**
 * Keys that let an AI agent use a business through its MCP server (/<slug>/mcp). Only a
 * SHA-256 hash of each key is stored; the key itself is shown once, when created.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: API_KEY_KINDS }).notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Last characters of the key, so people can tell their keys apart. */
    hint: text("hint").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: instant("last_used_at"),
  },
  (table) => [
    uniqueIndex("api_keys_token_hash_idx").on(table.tokenHash),
    index("api_keys_business_id_idx").on(table.businessId),
  ],
);

/**
 * Outgoing webhooks a business sets up: when something happens to an appointment, or some
 * time before or after it, OpenTurnly sends the chosen data to any URL that takes webhooks,
 * signed with the automation's secret.
 */
export const automations = pgTable(
  "automations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: text("trigger", { enum: AUTOMATION_TRIGGERS }).notNull(),
    /** Minutes before the start ("before") or after the end ("after"). */
    offsetMin: integer("offset_min").notNull().default(0),
    /** The steps that run when it fires, in order (see AutomationAction). */
    actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
    /** Signs each delivery (X-OpenTurnly-Signature) so receivers can check it came from here. */
    secret: text("secret").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("automations_business_id_idx").on(table.businessId)],
);

/** "skipped": not sent because the step or the appointment no longer applies. */
export const DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped"] as const;

/**
 * Every POST an automation makes: the queue the sender works through (with retries) and
 * the history shown to the business. `dedupeKey` keeps a reminder from going out twice.
 */
export const automationDeliveries = pgTable(
  "automation_deliveries",
  {
    id: id(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    /** The step of the automation this send belongs to. */
    actionId: text("action_id"),
    dedupeKey: text("dedupe_key"),
    event: text("event").notNull(),
    /** `json`, not `jsonb`, so fields keep the order the business chose. */
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: instant("next_attempt_at").notNull(),
    responseStatus: integer("response_status"),
    error: text("error"),
    sentAt: instant("sent_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("automation_deliveries_dedupe_idx").on(table.dedupeKey),
    index("automation_deliveries_due_idx").on(table.status, table.nextAttemptAt),
    index("automation_deliveries_automation_idx").on(table.automationId, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Business = typeof businesses.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type GiftCard = typeof giftCards.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationDelivery = typeof automationDeliveries.$inferSelect;
