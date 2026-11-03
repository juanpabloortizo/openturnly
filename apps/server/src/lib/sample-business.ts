import {
  addDays,
  type Locale,
  parseTime,
  type SampleBusinessInput,
  todayIn,
  toMinorUnits,
  weekdayOf,
  zonedTimeToInstant,
} from "@openturnly/core";
import { like } from "drizzle-orm";
import {
  type AppointmentStatus,
  appointments,
  businesses,
  customers,
  locationServices,
  resourceLocations,
  resourceServices,
  resources,
  services,
} from "../db/schema.ts";
import { insertBusiness } from "./businesses.ts";
import { newBookingCode, newCustomerShortId } from "./codes.ts";
import { closedHolidayDates } from "./holidays.ts";
import { DEFAULT_HOURS } from "./locations.ts";
import type { Queryable } from "./schedules.ts";

type SampleService = {
  category: string;
  name: string;
  description: string;
  durationMin: number;
  /** In "US dollars", scaled to the business's currency by PRICE_SCALE. */
  price: number;
  /** Only the first professional offers it. */
  specialist?: boolean;
};

type SampleContent = {
  name: string;
  slug: string;
  description: string;
  services: SampleService[];
  professionals: string[];
  customers: { firstName: string; lastName: string; email: string; notes: string | null }[];
};

const CONTENT: Record<Locale, SampleContent> = {
  es: {
    name: "Barbería de ejemplo",
    slug: "ejemplo",
    description:
      "Un negocio de ejemplo para conocer OpenTurnly. Cámbialo a tu gusto o bórralo cuando quieras.",
    services: [
      {
        category: "Cortes",
        name: "Corte clásico",
        description: "Con tijera o máquina, incluye lavado.",
        durationMin: 30,
        price: 25,
      },
      {
        category: "Cortes",
        name: "Corte y barba",
        description: "Corte completo y arreglo de barba con toalla caliente.",
        durationMin: 60,
        price: 40,
      },
      {
        category: "Cortes",
        name: "Corte infantil",
        description: "Para menores de 12 años.",
        durationMin: 30,
        price: 18,
      },
      {
        category: "Barba",
        name: "Arreglo de barba",
        description: "Perfilado y recorte a tu medida.",
        durationMin: 30,
        price: 15,
      },
      {
        category: "Barba",
        name: "Afeitado clásico",
        description: "Con navaja y toalla caliente.",
        durationMin: 45,
        price: 22,
      },
      {
        category: "Color",
        name: "Tinte",
        description: "Color completo, con lavado y secado.",
        durationMin: 90,
        price: 60,
        specialist: true,
      },
    ],
    professionals: ["Camila", "Daniel", "Mateo"],
    customers: [
      {
        firstName: "Laura",
        lastName: "Gómez",
        email: "laura.gomez@example.com",
        notes: "Prefiere degradado bajo.",
      },
      { firstName: "Andrés", lastName: "Ruiz", email: "andres.ruiz@example.com", notes: null },
      { firstName: "Paula", lastName: "Ríos", email: "paula.rios@example.com", notes: null },
    ],
  },
  en: {
    name: "Sample Barbershop",
    slug: "sample",
    description:
      "A sample business to get to know OpenTurnly. Change it as you like or delete it any time.",
    services: [
      {
        category: "Haircuts",
        name: "Classic haircut",
        description: "Scissors or clippers, with a wash.",
        durationMin: 30,
        price: 25,
      },
      {
        category: "Haircuts",
        name: "Haircut and beard",
        description: "A full haircut plus a beard trim with a hot towel.",
        durationMin: 60,
        price: 40,
      },
      {
        category: "Haircuts",
        name: "Kids' haircut",
        description: "For children under 12.",
        durationMin: 30,
        price: 18,
      },
      {
        category: "Beard",
        name: "Beard trim",
        description: "Shaped and trimmed the way you like it.",
        durationMin: 30,
        price: 15,
      },
      {
        category: "Beard",
        name: "Classic shave",
        description: "Straight razor and a hot towel.",
        durationMin: 45,
        price: 22,
      },
      {
        category: "Color",
        name: "Hair color",
        description: "All-over color, with a wash and blow-dry.",
        durationMin: 90,
        price: 60,
        specialist: true,
      },
    ],
    professionals: ["Camila", "Daniel", "Mateo"],
    customers: [
      {
        firstName: "Laura",
        lastName: "Gomez",
        email: "laura.gomez@example.com",
        notes: "Likes a low fade.",
      },
      { firstName: "Andrew", lastName: "Ruiz", email: "andrew.ruiz@example.com", notes: null },
      { firstName: "Paula", lastName: "Rios", email: "paula.rios@example.com", notes: null },
    ],
  },
};

/** About what one dollar of a haircut costs in each currency, so prices look right there. */
const PRICE_SCALE: Record<string, number> = {
  ARS: 1000,
  BOB: 7,
  BRL: 3,
  CLP: 500,
  COP: 1000,
  CRC: 300,
  DOP: 30,
  GTQ: 5,
  HNL: 15,
  INR: 20,
  JPY: 100,
  KRW: 1000,
  MXN: 10,
  NIO: 20,
  PEN: 2,
  PHP: 20,
  PYG: 4000,
  UYU: 25,
};

const DAY = 24 * 60 * 60 * 1000;

/** 23_456 → 23_000: two significant digits, like a price list. */
function roundPrice(amount: number) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(amount)) - 1);
  return Math.round(amount / step) * step;
}

/**
 * The appointments, by open day counted from today (negative: already past), professional,
 * service and customer, all by index. Later ones that don't fit a short day are left out.
 */
const BOOKINGS: {
  day: number;
  time: string;
  professional: number;
  service: number;
  customer: number;
  status?: AppointmentStatus;
  admin?: boolean;
}[] = [
  { day: -2, time: "10:00", professional: 0, service: 1, customer: 0 },
  { day: -2, time: "15:00", professional: 1, service: 0, customer: 2, status: "no_show" },
  { day: -1, time: "11:00", professional: 2, service: 3, customer: 1, admin: true },
  { day: 0, time: "09:30", professional: 0, service: 0, customer: 1 },
  { day: 0, time: "11:00", professional: 1, service: 1, customer: 2 },
  { day: 0, time: "16:00", professional: 2, service: 4, customer: 0 },
  { day: 1, time: "10:00", professional: 0, service: 5, customer: 2 },
  { day: 1, time: "10:30", professional: 2, service: 2, customer: 1, admin: true },
  { day: 1, time: "14:30", professional: 1, service: 0, customer: 0 },
  { day: 2, time: "09:00", professional: 1, service: 3, customer: 1 },
  { day: 2, time: "12:00", professional: 0, service: 1, customer: 0 },
  { day: 2, time: "15:30", professional: 2, service: 0, customer: 2 },
  { day: 3, time: "11:00", professional: 0, service: 4, customer: 1 },
  { day: 3, time: "16:30", professional: 1, service: 1, customer: 2 },
  { day: 4, time: "10:00", professional: 2, service: 1, customer: 0 },
];

/** Open days around today, skipping closed weekdays and public holidays. */
function openDays(today: string, closed: ReadonlySet<string>) {
  const isOpen = (date: string) =>
    DEFAULT_HOURS.some((range) => range.weekday === weekdayOf(date)) && !closed.has(date);
  const days = new Map<number, string>();
  if (isOpen(today)) days.set(0, today);
  for (let offset = 1, found = 0; found < 6 && offset < 30; offset++) {
    const date = addDays(today, offset);
    if (isOpen(date)) days.set(++found, date);
  }
  for (let offset = 1, found = 0; found < 3 && offset < 30; offset++) {
    const date = addDays(today, -offset);
    if (isOpen(date)) days.set(-++found, date);
  }
  return days;
}

/** "ejemplo", or "ejemplo-2"… when the owner already has one. */
async function freeSlug(tx: Queryable, base: string) {
  const taken = new Set(
    (
      await tx
        .select({ slug: businesses.slug })
        .from(businesses)
        .where(like(businesses.slug, `${base}%`))
    ).map((row) => row.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * A barbershop with services in categories, three professionals, three customers and a
 * week of appointments, so the calendar, the booking page and the reports have something
 * to show. Prices follow the currency; texts follow the language.
 */
export async function createSampleBusiness(tx: Queryable, input: SampleBusinessInput) {
  const content = CONTENT[input.locale];
  const { business, location } = await insertBusiness(tx, {
    ...input,
    name: content.name,
    slug: await freeSlug(tx, content.slug),
    description: content.description,
    sample: true,
  });

  const team = await tx
    .insert(resources)
    .values(
      content.professionals.map((name, position) => ({ businessId: business.id, name, position })),
    )
    .returning();
  await tx
    .insert(resourceLocations)
    .values(team.map((member) => ({ resourceId: member.id, locationId: location.id })));

  const scale = PRICE_SCALE[input.currency] ?? 1;
  const menu = await tx
    .insert(services)
    .values(
      content.services.map((service, position) => ({
        businessId: business.id,
        name: service.name,
        description: service.description,
        category: service.category,
        durationMin: service.durationMin,
        priceAmount: toMinorUnits(roundPrice(service.price * scale), input.currency),
        position,
      })),
    )
    .returning();
  await tx
    .insert(locationServices)
    .values(menu.map((service) => ({ locationId: location.id, serviceId: service.id })));
  await tx.insert(resourceServices).values(
    menu.flatMap((service, index) =>
      (content.services[index]?.specialist ? team.slice(0, 1) : team).map((member) => ({
        resourceId: member.id,
        serviceId: service.id,
      })),
    ),
  );

  const people = [];
  for (const person of content.customers) {
    const [customer] = await tx
      .insert(customers)
      .values({
        ...person,
        businessId: business.id,
        shortId: await newCustomerShortId(tx, business.id),
      })
      .returning();
    if (customer) people.push(customer);
  }

  const now = Date.now();
  const today = todayIn(input.timezone, now);
  const closed = new Set(
    closedHolidayDates(business, new Set(), addDays(today, -30), addDays(today, 30)),
  );
  const days = openDays(today, closed);
  for (const booking of BOOKINGS) {
    const date = days.get(booking.day);
    const member = team[booking.professional];
    const service = menu[booking.service];
    const customer = people[booking.customer];
    if (!date || !member || !service || !customer) continue;
    const start = parseTime(booking.time);
    const fits = DEFAULT_HOURS.some(
      (range) =>
        range.weekday === weekdayOf(date) &&
        parseTime(range.start) <= start &&
        start + service.durationMin <= parseTime(range.end),
    );
    if (!fits) continue;
    const startsAt = zonedTimeToInstant(date, start, input.timezone);
    await tx.insert(appointments).values({
      // Booked days before, like real ones: thirteen bookings "in the last hour" would set
      // off the alarm for a wave of bot bookings.
      createdAt: new Date(Math.min(now, startsAt) - (2 + booking.customer) * DAY),
      code: await newBookingCode(tx),
      businessId: business.id,
      locationId: location.id,
      serviceId: service.id,
      resourceId: member.id,
      customerId: customer.id,
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + service.durationMin * 60_000),
      status: booking.status ?? "confirmed",
      serviceName: service.name,
      resourceName: member.name,
      priceAmount: service.priceAmount,
      source: booking.admin ? "admin" : "online",
    });
  }
  return business;
}
