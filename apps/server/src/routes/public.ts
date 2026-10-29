import {
  addDays,
  bookingDetailsSchema,
  bookingSchema,
  isDateString,
  parseTime,
  slotsBetween,
  slotsForDate,
  todayIn,
  zonedTimeToInstant,
} from "@openturnly/core";
import { and, asc, count, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  appointments,
  type Business,
  businesses,
  locationServices,
  resourceLocations,
  resourceServices,
  resources,
  services,
} from "../db/schema.ts";
import { bearerToken, findApiKey } from "../lib/api-keys.ts";
import { clientIp, networkKey } from "../lib/client-ip.ts";
import { newBookingCode } from "../lib/codes.ts";
import { matchCustomer, saveBookingCustomer } from "../lib/customers.ts";
import { discountFor, usableGiftCard } from "../lib/gift-cards.ts";
import { businessCountry } from "../lib/holidays.ts";
import { type AppEnv, apiError, type Deps, parseBody, validateWith } from "../lib/http.ts";
import { findImage, imageUrls } from "../lib/images.ts";
import { listLocations, resolveLocation } from "../lib/locations.ts";
import { bookingRules, loadSchedules, pickLeastBusy } from "../lib/schedules.ts";

/** Longest range the booking calendar can ask for at once. */
const MAX_AVAILABILITY_DAYS = 62;
/** Upcoming bookings one customer can hold at the same business. */
const MAX_ACTIVE_BOOKINGS_PER_CUSTOMER = 3;

const giftCheckSchema = z.object({ code: z.string().min(1).max(40), serviceId: z.string().min(1) });

/** Endpoints used by the public booking page. No login required. */
export function publicRoutes({ db, config, guard, automations }: Deps) {
  const network = (c: Context) => networkKey(clientIp(c, config.trustProxy));

  /**
   * The business's access key when an AI agent calls (see routes/mcp.ts): it is trusted
   * like the business itself, so it skips the anti-bot puzzle and network limits.
   */
  const agentKey = async (c: Context, business: Business) => {
    const token = bearerToken(c);
    if (!token) return null;
    const key = await findApiKey(db, token);
    if (!key || key.businessId !== business.id) throw apiError(401, "invalid_key");
    return key;
  };

  const findBusiness = async (slug: string): Promise<Business> => {
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.slug, slug.toLowerCase()));
    if (!business) throw apiError(404, "business_not_found");
    return business;
  };

  /**
   * Active locations with the services each can actually take bookings for and who works
   * there, and the services and professionals across them. A location without
   * professionals takes bookings on its own hours for every service it offers.
   */
  const loadCatalog = async (business: Business) => {
    const places = (await listLocations(db, business.id)).filter((place) => place.active);
    const team = await db
      .select({ id: resources.id, name: resources.name })
      .from(resources)
      .where(and(eq(resources.businessId, business.id), eq(resources.active, true)))
      .orderBy(asc(resources.position), asc(resources.name));
    const teamIds = new Set(team.map((member) => member.id));
    const placeIds = places.map((place) => place.id);
    const [links, staffed, offered] = await Promise.all([
      team.length > 0
        ? db
            .select()
            .from(resourceServices)
            .where(inArray(resourceServices.resourceId, [...teamIds]))
        : [],
      placeIds.length > 0
        ? db.select().from(resourceLocations).where(inArray(resourceLocations.locationId, placeIds))
        : [],
      placeIds.length > 0
        ? db.select().from(locationServices).where(inArray(locationServices.locationId, placeIds))
        : [],
    ]);
    const catalog = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMin: services.durationMin,
        priceAmount: services.priceAmount,
      })
      .from(services)
      .where(and(eq(services.businessId, business.id), eq(services.active, true)))
      .orderBy(asc(services.position), asc(services.name));

    const doing = (resourceId: string, serviceId: string) =>
      links.some((link) => link.resourceId === resourceId && link.serviceId === serviceId);
    const bookableLocations = places
      .map((place) => {
        const here = staffed
          .filter((link) => link.locationId === place.id && teamIds.has(link.resourceId))
          .map((link) => link.resourceId);
        const serviceIds = catalog
          .filter(
            (service) =>
              offered.some(
                (link) => link.locationId === place.id && link.serviceId === service.id,
              ) &&
              (here.length === 0 || here.some((resourceId) => doing(resourceId, service.id))),
          )
          .map((service) => service.id);
        return {
          id: place.id,
          name: place.name,
          address: place.address,
          phone: place.phone,
          serviceIds,
          professionalIds: here.filter((resourceId) =>
            serviceIds.some((serviceId) => doing(resourceId, serviceId)),
          ),
        };
      })
      // A location with nothing bookable would lead customers to an empty list.
      .filter((place) => place.serviceIds.length > 0);

    const bookable = new Set(bookableLocations.flatMap((place) => place.serviceIds));
    const working = new Set(bookableLocations.flatMap((place) => place.professionalIds));
    return {
      locations: bookableLocations,
      services: catalog.filter((service) => bookable.has(service.id)),
      professionals: team
        .filter((member) => working.has(member.id))
        .map((member) => ({
          ...member,
          serviceIds: links
            .filter((link) => link.resourceId === member.id && bookable.has(link.serviceId))
            .map((link) => link.serviceId),
        })),
    };
  };

  const findActiveService = async (business: Business, serviceId: string) => {
    const [service] = await db
      .select()
      .from(services)
      .where(
        and(
          eq(services.businessId, business.id),
          eq(services.id, serviceId),
          eq(services.active, true),
        ),
      );
    if (!service) throw apiError(404, "service_not_found");
    return service;
  };

  return (
    new Hono<AppEnv>()
      .get("/businesses/:slug", async (c) => {
        const business = await findBusiness(c.req.param("slug"));
        return c.json({
          business: {
            name: business.name,
            slug: business.slug,
            description: business.description,
            timezone: business.timezone,
            currency: business.currency,
            locale: business.locale,
            phone: business.phone,
            email: business.email,
            address: business.address,
            maxAdvanceDays: business.maxAdvanceDays,
            country: businessCountry(business),
            bookingForm: business.bookingForm,
            brandColor: business.brandColor,
            pageTheme: business.pageTheme,
            ...(await imageUrls(db, business.id, business.slug)),
          },
          ...(await loadCatalog(business)),
        });
      })

      .get("/businesses/:slug/images/:kind", async (c) => {
        const business = await findBusiness(c.req.param("slug"));
        const kind = c.req.param("kind");
        if (kind !== "logo" && kind !== "cover") throw apiError(404, "not_found");
        const image = await findImage(db, business.id, kind);
        if (!image) throw apiError(404, "not_found");
        // URLs carry the upload time (?v=…), so a new upload gets a new URL.
        return c.body(new Uint8Array(image.data), 200, {
          "Content-Type": image.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
      })

      /**
       * Free start times per date, { days: { "2026-10-24": ["09:00", "09:30"] } }, and who
       * is free at each one, { staff: { "2026-10-24": { "09:00": [id, …] } } }, so the
       * customer can pick a time first and then a person.
       */
      /**
       * A puzzle to solve before booking, harder while the business gets an unusual
       * number of bookings (see lib/booking-guard.ts).
       */
      /**
       * Whether a discount code works for a service, and how much it takes off. Limited like
       * the availability lookups, so codes can't be guessed by trying many.
       */
      .post("/businesses/:slug/gift-code", async (c) => {
        const business = await findBusiness(c.req.param("slug"));
        if (!(await agentKey(c, business)) && !guard.allow.availability(network(c))) {
          throw apiError(429, "too_many_requests");
        }
        const input = await parseBody(c, giftCheckSchema);
        const service = await findActiveService(business, input.serviceId);
        const card = await usableGiftCard(db, business, { code: input.code }, "discount");
        const price = service.priceAmount ?? 0;
        return c.json({
          code: card.code,
          percent: card.percent,
          amount: card.amount,
          priceAmount: price,
          discountAmount: discountFor(card, price),
        });
      })

      .get("/businesses/:slug/challenge", async (c) => {
        if (!guard.allow.challenge(network(c))) throw apiError(429, "too_many_requests");
        const business = await findBusiness(c.req.param("slug"));
        const surge = await guard.surge(business.id);
        const level = surge.active ? "protected" : "normal";
        return c.json({ challenge: await guard.challenge(business.id, level), level });
      })

      .get("/businesses/:slug/availability", async (c) => {
        const business = await findBusiness(c.req.param("slug"));
        if (!(await agentKey(c, business)) && !guard.allow.availability(network(c))) {
          throw apiError(429, "too_many_requests");
        }
        const { serviceId = "", resourceId, locationId, from = "", to = "" } = c.req.query();
        if (!isDateString(from) || !isDateString(to) || to < from) {
          throw apiError(400, "invalid_range");
        }
        if (to > addDays(from, MAX_AVAILABILITY_DAYS)) throw apiError(400, "invalid_range");
        const location = await resolveLocation(db, business.id, locationId, { forBooking: true });
        const service = await findActiveService(business, serviceId);
        const schedules = await loadSchedules(
          db,
          business,
          location.id,
          service.id,
          resourceId || null,
          from,
          to,
        );
        const slots = slotsBetween(
          from,
          to,
          service.durationMin,
          schedules,
          bookingRules(business),
          Date.now(),
        );
        const days: Record<string, string[]> = {};
        const staff: Record<string, Record<string, string[]>> = {};
        for (const [date, list] of Object.entries(slots)) {
          days[date] = list.map((slot) => slot.time);
          staff[date] = Object.fromEntries(
            list.map((slot) => [
              slot.time,
              slot.resourceIds.filter((id): id is string => id !== null),
            ]),
          );
        }
        return c.json({ days, staff, today: todayIn(business.timezone) });
      })

      .post("/businesses/:slug/bookings", async (c) => {
        const business = await findBusiness(c.req.param("slug"));
        const input = await parseBody(c, bookingSchema);
        const { customer: details, answers } = validateWith(
          bookingDetailsSchema(business.bookingForm, businessCountry(business)),
          { customer: input.customer, answers: input.answers },
        );
        const key = await agentKey(c, business);
        if (!key) {
          // The puzzle first: limits are only counted for requests that did the work, so
          // nobody can use up the quota of a network shared with real customers for free.
          const surge = await guard.surge(business.id);
          const problem = await guard.spendProof(
            input.proof,
            business.id,
            surge.active ? "protected" : "normal",
          );
          if (problem) throw apiError(403, "challenge_failed", { proof: problem });
          if (guard.capped(surge)) throw apiError(429, "busy");
          if (!guard.allow.booking(business.id, network(c), surge)) {
            throw apiError(429, "too_many_requests");
          }
        }
        for (const contact of [details.phone, details.email]) {
          if (contact && !guard.allow.contact(business.id, contact)) {
            throw apiError(429, "too_many_requests");
          }
        }
        const location = await resolveLocation(db, business.id, input.locationId, {
          forBooking: true,
        });
        const service = await findActiveService(business, input.serviceId);
        const now = Date.now();
        const startsAt = zonedTimeToInstant(input.date, parseTime(input.time), business.timezone);
        const endsAt = startsAt + service.durationMin * 60_000;

        const appointment = await db.transaction(async (tx) => {
          // One booking at a time per business: the next one waits here and then sees
          // this appointment when it re-checks the slot, so a time can't be taken twice.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${business.id}, 0))`);

          const match = await matchCustomer(tx, business.id, details);
          if (match.customer) {
            const theirs = and(
              eq(appointments.customerId, match.customer.id),
              eq(appointments.status, "confirmed"),
            );
            // The same person can't be in two places: say which booking they already have.
            const [clash] = await tx
              .select({ code: appointments.code, startsAt: appointments.startsAt })
              .from(appointments)
              .where(
                and(
                  theirs,
                  lt(appointments.startsAt, new Date(endsAt)),
                  gt(appointments.endsAt, new Date(startsAt)),
                ),
              )
              .limit(1);
            if (clash) {
              throw apiError(409, "already_booked", {
                code: clash.code,
                startsAt: clash.startsAt.toISOString(),
              });
            }
            const [upcoming] = await tx
              .select({ total: count() })
              .from(appointments)
              .where(and(theirs, gt(appointments.startsAt, new Date(now))));
            if ((upcoming?.total ?? 0) >= MAX_ACTIVE_BOOKINGS_PER_CUSTOMER) {
              throw apiError(409, "too_many_bookings");
            }
          }

          const schedules = await loadSchedules(
            tx,
            business,
            location.id,
            service.id,
            input.resourceId,
            input.date,
            input.date,
          );
          const slot = slotsForDate(
            input.date,
            service.durationMin,
            schedules,
            bookingRules(business),
            now,
          ).find((candidate) => candidate.time === input.time);
          if (!slot) throw apiError(409, "slot_taken");

          const resourceId = pickLeastBusy(slot.resourceIds, schedules, slot.start);
          const [resource] = resourceId
            ? await tx
                .select({ name: resources.name })
                .from(resources)
                .where(eq(resources.id, resourceId))
            : [];

          // Checked in the booking queue, so a code's last use goes to one booking only.
          const gift = input.giftCode?.trim()
            ? await usableGiftCard(tx, business, { code: input.giftCode }, "discount")
            : null;

          const customerId = await saveBookingCustomer(tx, business.id, match, details);

          const [created] = await tx
            .insert(appointments)
            .values({
              code: await newBookingCode(tx),
              businessId: business.id,
              locationId: location.id,
              serviceId: service.id,
              resourceId,
              customerId,
              startsAt: new Date(slot.start),
              endsAt: new Date(slot.end),
              serviceName: service.name,
              resourceName: resource?.name ?? null,
              priceAmount: service.priceAmount,
              discountAmount: gift ? discountFor(gift, service.priceAmount ?? 0) : 0,
              giftCardId: gift?.id ?? null,
              answers,
              source: key ? "agent" : "online",
              sourceLabel: key?.name ?? null,
            })
            .returning();
          if (!created) throw apiError(500, "internal_error");
          return created;
        });
        if (!key) guard.noteBooking(business.id);
        await automations.emit(appointment.id, "created");

        return c.json(
          {
            appointment: {
              id: appointment.id,
              code: appointment.code,
              date: input.date,
              time: input.time,
              startsAt: appointment.startsAt,
              endsAt: appointment.endsAt,
              serviceName: appointment.serviceName,
              resourceName: appointment.resourceName,
              priceAmount: appointment.priceAmount,
              discountAmount: appointment.discountAmount,
              currency: business.currency,
              location: { name: location.name, address: location.address },
            },
          },
          201,
        );
      })
  );
}
