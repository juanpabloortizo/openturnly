import {
  type AutomationAction,
  type AutomationTrigger,
  addDays,
  todayIn,
  type WaitAction,
  type WebhookAction,
} from "@openturnly/core";
import type { TFunction } from "i18next";
import {
  BellRing,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  type LucideIcon,
  MessageSquareHeart,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../components/ui.tsx";
import type { Business } from "../../lib/api.ts";
import { formatDay } from "../../lib/format.ts";

/** What can start a flow, with its icon. */
export const TRIGGERS: { value: AutomationTrigger; icon: LucideIcon }[] = [
  { value: "created", icon: CalendarPlus },
  { value: "rescheduled", icon: CalendarClock },
  { value: "cancelled", icon: CalendarX },
  { value: "before", icon: BellRing },
  { value: "after", icon: MessageSquareHeart },
];

export const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
export type Unit = keyof typeof UNITS;

/** The extra field the "Message" box writes to. */
export const MESSAGE = "message";

/**
 * Only reminders have a time of their own (how long before the appointment): the rest start
 * the moment it happens, and wait steps send later.
 */
export const isTimed = (trigger: AutomationTrigger | null) => trigger === "before";

/** 90 → 90 minutes, 120 → 2 hours, 2880 → 2 days; 0 (not set yet) → 1 hour. */
export function splitOffset(minutes: number): { amount: number; unit: Unit } {
  if (minutes === 0) return { amount: 1, unit: "hours" };
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

/** "10 minutos", "2 horas", "1 día". */
export function duration(t: TFunction, minutes: number) {
  const { amount, unit } = splitOffset(minutes);
  return t(`automations.unitsCount.${unit}`, { count: amount });
}

/** How a step reads in the flow: the host it sends to, or how long it waits. */
export function stepTitle(t: TFunction, action: AutomationAction) {
  if (action.type === "wait") {
    return t("automations.timing.wait", { time: duration(t, action.minutes) });
  }
  try {
    return new URL(action.url).host;
  } catch {
    return t("automations.step.untitled");
  }
}

export function newWebhook(message = ""): WebhookAction {
  return {
    id: crypto.randomUUID(),
    type: "webhook",
    method: "POST",
    url: "",
    auth: { type: "none" },
    headers: [],
    body: "fields",
    json: "",
    fields: null,
    extra: message ? [{ name: MESSAGE, value: message }] : [],
  };
}

export function newWait(minutes = 60): WaitAction {
  return { id: crypto.randomUUID(), type: "wait", minutes };
}

/** Ready-made flows a business can start from. */
export type Template = {
  key: "reminder" | "booked" | "review";
  trigger: AutomationTrigger;
  offsetMin: number;
  /** Minutes the flow waits before telling the system, if any. */
  wait?: number;
};
export const TEMPLATES: Template[] = [
  { key: "reminder", trigger: "before", offsetMin: 60 },
  { key: "booked", trigger: "created", offsetMin: 0 },
  { key: "review", trigger: "after", offsetMin: 0, wait: 60 },
];

/** Example values, shaped like what the server sends, for previews. */
export function sampleValues(business: Business, event: string, language: string) {
  const date = addDays(todayIn(business.timezone), 3);
  return {
    event,
    appointment: {
      code: "K7Q4XM",
      status: "confirmed",
      date,
      time: "10:00",
      end_time: "10:30",
      weekday: formatDay(date, language).split(",")[0],
      date_text: formatDay(date, language),
      starts_at: `${date}T15:00:00.000Z`,
      ends_at: `${date}T15:30:00.000Z`,
      service: "Corte clásico",
      duration_minutes: 30,
      professional: "Juan",
      location: business.name,
      location_address: business.address,
      price: 18000,
      price_text: "$ 18.000",
      booked_via: "online",
      answers: {},
      previous_date: null,
      previous_time: null,
    },
    customer: {
      name: "Ana Pérez",
      first_name: "Ana",
      last_name: "Pérez",
      phone: "+573001234567",
      phone_digits: "573001234567",
      email: "ana@example.com",
    },
    business: {
      name: business.name,
      phone: business.phone,
      address: business.address,
      booking_page: `${window.location.origin}/${business.slug}`,
      time_zone: business.timezone,
    },
  } as Record<string, unknown>;
}

export function StatusBadge({
  status,
  label,
}: {
  status: "pending" | "sent" | "failed" | "skipped";
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      tone={
        status === "sent"
          ? "success"
          : status === "failed"
            ? "danger"
            : status === "skipped"
              ? "neutral"
              : "warning"
      }
    >
      {label ?? t(`automations.status.${status}`)}
    </Badge>
  );
}
