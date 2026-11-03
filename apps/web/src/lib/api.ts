import type {
  ApiKeyKind,
  AutomationAction,
  AutomationTrigger,
  BookingAnswer,
  BookingForm,
  CommissionType,
  Gender,
  GiftCardKind,
  PageTheme,
  PaymentMethod,
  ProductAttributeKind,
  ProductUnit,
  SaleItemKind,
  SalePaymentMethod,
  StockMovementKind,
} from "@openturnly/core";

/** Error returned by the OpenTurnly API or by Better Auth, normalized to a lowercase code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, fields: Record<string, string> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type RequestOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown };

export async function api<T>(path: string, { method = "GET", body }: RequestOptions = {}) {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // OpenTurnly: { error: { code, fields } }. Better Auth: { code: "INVALID_EMAIL_OR_PASSWORD" }.
    const code = String(data?.error?.code ?? data?.code ?? "unknown_error").toLowerCase();
    throw new ApiError(res.status, code, data?.error?.fields);
  }
  return data as T;
}

export type User = { id: string; name: string; email: string; role: "owner" | "member" };

/** How the signed-in user works in a business. */
export type BusinessAccess = {
  role: "owner" | "admin" | "professional";
  /** For professionals: their own profile, whose agenda they see. */
  resourceId: string | null;
};

export type Business = {
  id: string;
  /** What admin URLs use instead of the id: /admin/<shortId>. */
  shortId: string;
  slug: string;
  name: string;
  description: string | null;
  timezone: string;
  currency: string;
  locale: "es" | "en";
  phone: string | null;
  email: string | null;
  address: string | null;
  slotIntervalMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  /** Follows the time zone: holidays and the default phone country come from it. */
  country: string | null;
  /** The logo uploaded in Settings → Booking page, or null. */
  logoUrl: string | null;
  closedOnHolidays: boolean;
  /** Customers can change or cancel (through an AI agent) up to this many minutes before; null: never. */
  customerChangeNoticeMin: number | null;
  /** Booking page colours, "#rrggbb"; null is the default look. */
  brandColor: string | null;
  pageTheme: PageTheme;
  bookingForm: BookingForm;
  /** Made-up data to try OpenTurnly with (see "Try a sample"). */
  sample: boolean;
  access: BusinessAccess;
  createdAt: string;
};

export type HolidaySettings = {
  /** The country of the business's time zone; null for zones like UTC. */
  country: string | null;
  closedOnHolidays: boolean;
  holidays: { date: string; name: string; closed: boolean }[];
};

/** "no_show": the customer didn't come; it frees the time it had. */
export type AppointmentStatus = "confirmed" | "cancelled" | "no_show";

export type Service = {
  id: string;
  name: string;
  description: string | null;
  /** Groups the booking page's menu; null: no group. */
  category: string | null;
  durationMin: number;
  priceAmount: number | null;
  active: boolean;
  /** Locations that offer it. */
  locationIds: string[];
};

export type Professional = {
  id: string;
  name: string;
  active: boolean;
  serviceIds: string[];
  /** Locations they work at. */
  locationIds: string[];
  hasOwnHours: boolean;
  /** Their photo for the booking page, or null (their initials show). */
  photoUrl: string | null;
  /** Percent of the services and products they sell that is theirs. */
  serviceCommission: number;
  productCommission: number;
};

/** A place the business works from, with what it offers and who works there. */
export type Location = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
  serviceIds: string[];
  resourceIds: string[];
  /** Appointments booked there: a location with history can't be deleted. */
  appointmentCount: number;
};

export type WeeklyRange = { weekday: number; start: string; end: string };

/** Closed from `date` to `endDate`, both included. */
export type Closure = {
  id: string;
  date: string;
  endDate: string;
  /** One location; null with no professional closes every location. */
  locationId: string | null;
  resourceId: string | null;
  note: string | null;
};

/** Booking page, the business's own people, or an AI agent through MCP. */
export type AppointmentSource = "online" | "admin" | "agent";

export type Appointment = {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  locationId: string | null;
  locationName: string | null;
  serviceId: string | null;
  serviceName: string;
  resourceId: string | null;
  resourceName: string | null;
  priceAmount: number | null;
  source: AppointmentSource;
  /** For agent bookings: the name of the access key used. */
  sourceLabel: string | null;
  createdAt: string;
  cancelledAt: string | null;
  answers: BookingAnswer[];
  /** Taken off by the discount code used to book it (`giftCode`). */
  discountAmount: number;
  giftCode: string | null;
  /** The sale that charged it, if it was charged. */
  sale: { id: string; number: number } | null;
  /** Deposits left for it and not used yet. */
  depositAmount: number;
  customer: {
    id: string;
    shortId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
};

export type PublicBusiness = Pick<
  Business,
  | "name"
  | "slug"
  | "description"
  | "timezone"
  | "currency"
  | "locale"
  | "phone"
  | "email"
  | "address"
  | "maxAdvanceDays"
  | "brandColor"
  | "pageTheme"
  | "bookingForm"
> & {
  /** Country of the business, for the default calling code of the phone input. */
  country: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
};

export type PublicCatalog = {
  business: PublicBusiness;
  services: Omit<Service, "active" | "locationIds">[];
  professionals: { id: string; name: string; photoUrl: string | null; serviceIds: string[] }[];
  /** Locations taking bookings, with what each offers and who works there. */
  locations: PublicLocation[];
};

export type PublicLocation = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  serviceIds: string[];
  professionalIds: string[];
};

export type BookedAppointment = {
  id: string;
  /** Short code the customer can quote, e.g. "K7Q4XM". */
  code: string;
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  resourceName: string | null;
  priceAmount: number | null;
  discountAmount: number;
  currency: string;
  location: { name: string; address: string | null };
};

export type Sale = {
  id: string;
  /** 1, 2, 3… per business. */
  number: number;
  status: "paid" | "void";
  internal: boolean;
  locationId: string | null;
  locationName: string | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  tipAmount: number;
  note: string | null;
  createdAt: string;
  voidedAt: string | null;
  soldByName: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null;
  items: {
    id: string;
    kind: SaleItemKind;
    appointmentId: string | null;
    serviceId: string | null;
    giftCardId: string | null;
    productId: string | null;
    name: string;
    resourceId: string | null;
    resourceName: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    total: number;
    /** Products: the IVA their price included when sold, in percent. */
    taxRate: number | null;
  }[];
  tips: { id: string; resourceId: string | null; resourceName: string; amount: number }[];
  payments: {
    id: string;
    method: SalePaymentMethod;
    amount: number;
    depositId: string | null;
    giftCardId: string | null;
  }[];
};

/** Something the business sells or uses, with its stock at each location. */
export type Product = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  brandId: string | null;
  /** How much it holds, in `unit`: 400 (ml); both or neither. */
  content: number | null;
  unit: ProductUnit | null;
  description: string | null;
  priceAmount: number;
  internalPriceAmount: number | null;
  costAmount: number | null;
  /** A percent, or for "fixed" an amount per unit in minor units; null: the seller's own. */
  commissionValue: number | null;
  commissionType: CommissionType;
  /** The price includes this IVA, in percent. */
  taxRate: number | null;
  forSale: boolean;
  active: boolean;
  /** Units by location id. */
  stock: Record<string, number>;
  /** Where a warning shows, by location id: at this many units or fewer. */
  alerts: Record<string, number>;
};

/** An entry of the business's categories or brands, with how many products use it. */
export type ProductAttribute = {
  id: string;
  kind: ProductAttributeKind;
  /** "Cuidado capilar", "Pantene". */
  name: string;
  products: number;
  createdAt: string;
};

export type StockMovement = {
  id: string;
  kind: StockMovementKind;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  note: string | null;
  createdAt: string;
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  sale: { id: string; number: number } | null;
  createdByName: string | null;
};

/** A discount code or a gift card with a balance, with how it was used. */
export type GiftCard = {
  id: string;
  code: string;
  kind: GiftCardKind;
  percent: number | null;
  amount: number | null;
  maxUses: number | null;
  validFrom: string | null;
  validUntil: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  uses: number;
  spent: number;
  /** Gift cards: what's left on it. */
  remaining: number | null;
  state: "active" | "inactive" | "scheduled" | "expired" | "used_up" | "spent";
  customer: { id: string; firstName: string; lastName: string } | null;
};

/** Money a customer left in advance ("abono"). */
export type Deposit = {
  id: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  status: "active" | "void";
  createdAt: string;
  voidedAt: string | null;
  appointmentId: string | null;
  appointmentCode: string | null;
  locationId: string | null;
  locationName: string | null;
  /** The sale it paid for, once used. */
  appliedSale: { id: string; number: number } | null;
  customer: { id: string; firstName: string; lastName: string };
};

/** A row of the customer list. */
export type CustomerSummary = {
  id: string;
  /** What links use instead of the id: ?customer=<shortId>. */
  shortId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Optional details, asked on the booking form if the business wants. */
  birthDate: string | null;
  document: string | null;
  gender: Gender | null;
  /** Private notes; only admins get them. */
  notes: string | null;
  createdAt: string;
  /** Confirmed appointments, past and upcoming. */
  visits: number;
  lastVisit: string | null;
  nextVisit: string | null;
};

export type Customer = Omit<CustomerSummary, "visits" | "lastVisit" | "nextVisit"> & {
  updatedAt: string;
};

export type CustomerAppointment = {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  serviceName: string;
  resourceName: string | null;
  priceAmount: number | null;
  answers: BookingAnswer[];
  source: AppointmentSource;
};

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "professional";
  resourceId: string | null;
  resourceName: string | null;
};
export type PendingInvitation = { id: string; email: string; expiresAt: string; createdAt: string };

/** An access key for the business's MCP server; the key itself is only shown once. */
export type ApiKey = {
  id: string;
  name: string;
  kind: ApiKeyKind;
  /** Last characters of the key. */
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdByName: string | null;
};

export type AutomationDelivery = {
  id: string;
  /** The step of the flow it belongs to. */
  actionId: string | null;
  event: string;
  payload: Record<string, unknown>;
  /** "skipped": the appointment was cancelled while it waited, or the step was removed. */
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

/** A flow: when it fires and the steps it runs (for now, POSTs to other tools). */
export type Automation = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  offsetMin: number;
  actions: AutomationAction[];
  /** Signs every delivery (X-OpenTurnly-Signature). */
  secret: string;
  active: boolean;
  createdAt: string;
  lastDelivery: Pick<
    AutomationDelivery,
    "status" | "responseStatus" | "error" | "createdAt"
  > | null;
};

/** How one step answered a test run. */
export type AutomationStepResult = {
  actionId: string;
  event: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  /** Start of the receiver's answer. */
  response: string | null;
  /** The data that was sent. */
  payload: Record<string, unknown>;
};
