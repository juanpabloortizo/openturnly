import { createHmac } from "node:crypto";
import { type Challenge, createChallenge, randomInt, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { and, count, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appointments } from "../db/schema.ts";
import { createRateLimiter } from "./rate-limit.ts";

/**
 * Keeps bots from filling a business's calendar with fake online bookings, without
 * captchas or outside services:
 *
 * - Proof of work (ALTCHA): the booking page's browser solves a small puzzle before each
 *   booking. A proof is good for one booking, at one business, for a few minutes.
 * - Rate limits per network, per phone or email, and for challenges and availability.
 * - A surge brake per business: when online bookings in the last hour run well above that
 *   business's busiest hour, puzzles get much harder for an hour, each network gets fewer
 *   bookings, admins see a warning, and past a cap online bookings wait for the next hour.
 *
 * State lives in memory, like the other limits: enough for the single-process install.
 */
export type BookingGuardSettings = {
  /** PBKDF2 iterations per attempt at the puzzle. */
  cost: number;
  /** The puzzle's secret counter is drawn from these ranges: attempts needed to solve it. */
  counter: { normal: [number, number]; protected: [number, number] };
  /** How long a challenge can be used. */
  ttlMs: number;
  /** Proofs arriving sooner after their challenge are refused: people take longer to fill in the form. */
  minAgeMs: number;
  limits: {
    /** Bookings per network at one business, per hour and per day. */
    perNetworkHour: number;
    perNetworkDay: number;
    /** Bookings per network across all businesses, per hour. */
    perNetworkAllHour: number;
    /** Bookings per network at one business, per hour, during a surge. */
    perNetworkHourInSurge: number;
    /** Bookings per phone number or email at one business, per hour. */
    perContactHour: number;
    challengesPer10Min: number;
    availabilityPerMinute: number;
  };
  surge: {
    /** Online bookings in an hour that always count as normal. */
    minPerHour: number;
    /** A surge is this many times the busiest hour of the previous two weeks. */
    factor: number;
    /** How long harder puzzles stay on once a surge starts. */
    holdMs: number;
    /**
     * During a surge, online bookings stop for the rest of the hour at this many times the
     * threshold: whatever a bot does, it can't take more than that.
     */
    capFactor: number;
  };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_GUARD_SETTINGS: BookingGuardSettings = {
  cost: 5_000,
  // About a second on a phone; with a surge, tens of seconds.
  counter: { normal: [200, 600], protected: [5_000, 10_000] },
  ttlMs: 10 * MINUTE,
  minAgeMs: 3_000,
  limits: {
    perNetworkHour: 6,
    perNetworkDay: 12,
    perNetworkAllHour: 30,
    perNetworkHourInSurge: 2,
    perContactHour: 3,
    challengesPer10Min: 60,
    availabilityPerMinute: 120,
  },
  surge: { minPerHour: 12, factor: 2, holdMs: HOUR, capFactor: 2 },
};

export type ChallengeLevel = "normal" | "protected";

export type SurgeStatus = {
  active: boolean;
  /** Online bookings received in the last hour. */
  lastHour: number;
  /** Bookings in an hour that start a surge for this business. */
  threshold: number;
  /** While active: when harder puzzles switch off again, unless the surge goes on. */
  until: Date | null;
};

/** Why a proof was refused; the booking page answers any of them with a fresh puzzle. */
export type ProofProblem = "missing" | "invalid" | "expired" | "used" | "too_fast" | "too_easy";

export type BookingGuard = ReturnType<typeof createBookingGuard>;

export function createBookingGuard({
  db,
  secret,
  settings,
}: {
  db: Db;
  secret: string;
  settings: BookingGuardSettings;
}) {
  // Separate keys for signing challenges and derived keys, both from the install secret.
  const signatureSecret = createHmac("sha256", secret).update("altcha:challenge").digest("hex");
  const keySecret = createHmac("sha256", secret).update("altcha:key").digest("hex");
  /** Signatures of proofs already spent, until they would have expired anyway. */
  const spent = new Map<string, number>();
  const surges = new Map<string, { status: SurgeStatus; checkedAt: number }>();
  let proxyHeadersSeenAt = 0;

  const { limits } = settings;
  const limiters = {
    networkHour: createRateLimiter({ max: limits.perNetworkHour, windowMs: HOUR }),
    networkDay: createRateLimiter({ max: limits.perNetworkDay, windowMs: DAY }),
    networkAllHour: createRateLimiter({ max: limits.perNetworkAllHour, windowMs: HOUR }),
    networkHourInSurge: createRateLimiter({ max: limits.perNetworkHourInSurge, windowMs: HOUR }),
    contactHour: createRateLimiter({ max: limits.perContactHour, windowMs: HOUR }),
    challenges: createRateLimiter({ max: limits.challengesPer10Min, windowMs: 10 * MINUTE }),
    availability: createRateLimiter({ max: limits.availabilityPerMinute, windowMs: MINUTE }),
  };

  /** Online bookings in the last hour against the busiest hour of the two weeks before. */
  async function measureSurge(businessId: string, now: number): Promise<SurgeStatus> {
    const online = and(eq(appointments.businessId, businessId), eq(appointments.source, "online"));
    const [recent] = await db
      .select({ total: count() })
      .from(appointments)
      .where(and(online, gt(appointments.createdAt, new Date(now - HOUR))));
    const hourly = db
      .select({ total: count().as("total") })
      .from(appointments)
      .where(
        and(
          online,
          gt(appointments.createdAt, new Date(now - 14 * DAY)),
          lte(appointments.createdAt, new Date(now - HOUR)),
        ),
      )
      .groupBy(sql`date_trunc('hour', ${appointments.createdAt})`)
      .as("hourly");
    const [busiest] = await db
      .select({ total: sql<number>`coalesce(max(${hourly.total}), 0)`.mapWith(Number) })
      .from(hourly);
    const lastHour = recent?.total ?? 0;
    const threshold = Math.max(
      settings.surge.minPerHour,
      Math.ceil((busiest?.total ?? 0) * settings.surge.factor),
    );
    return { active: false, lastHour, threshold, until: null };
  }

  /** Starts or extends a surge when the count reaches the threshold. */
  function withHold(status: SurgeStatus, previous: SurgeStatus | undefined, now: number) {
    let until = previous?.until && previous.until.getTime() > now ? previous.until : null;
    if (status.lastHour >= status.threshold) until = new Date(now + settings.surge.holdMs);
    return { ...status, active: until !== null, until };
  }

  return {
    settings,

    /**
     * Rate limits; false means "too many". Network limits need a network key: without one
     * (an internal address, see `networkKey`) they don't apply.
     */
    allow: {
      challenge: (network: string | null) => network === null || limiters.challenges(network),
      availability: (network: string | null) => network === null || limiters.availability(network),
      /** Network limits for one more booking at this business; stricter during a surge. */
      booking: (businessId: string, network: string | null, surge: SurgeStatus) =>
        network === null ||
        (limiters.networkAllHour(network) &&
          limiters.networkHour(`${businessId}:${network}`) &&
          limiters.networkDay(`${businessId}:${network}`) &&
          (!surge.active || limiters.networkHourInSurge(`${businessId}:${network}`))),
      contact: (businessId: string, contact: string) =>
        limiters.contactHour(`${businessId}:${contact.toLowerCase()}`),
    },

    async surge(businessId: string, now = Date.now()): Promise<SurgeStatus> {
      const cached = surges.get(businessId);
      // The count is measured at most every 30 seconds; the hold is re-checked every time
      // so it switches off on time.
      const fresh = cached !== undefined && now - cached.checkedAt < 30_000;
      const measured = fresh ? cached.status : await measureSurge(businessId, now);
      const status = withHold(measured, cached?.status, now);
      surges.set(businessId, { status, checkedAt: fresh ? cached.checkedAt : now });
      return status;
    },

    /** During a surge, whether online bookings already reached the cap for this hour. */
    capped: (surge: SurgeStatus) =>
      surge.active && surge.lastHour >= surge.threshold * settings.surge.capFactor,

    /** Counts a new online booking right away instead of at the next measurement. */
    noteBooking(businessId: string, now = Date.now()) {
      const cached = surges.get(businessId);
      if (!cached) return;
      const counted = { ...cached.status, lastHour: cached.status.lastHour + 1 };
      surges.set(businessId, {
        status: withHold(counted, cached.status, now),
        checkedAt: cached.checkedAt,
      });
    },

    async challenge(businessId: string, level: ChallengeLevel, now = Date.now()) {
      const [min, max] = settings.counter[level];
      return createChallenge({
        algorithm: "PBKDF2/SHA-256",
        cost: settings.cost,
        counter: randomInt(max, min),
        deriveKey,
        expiresAt: Math.floor((now + settings.ttlMs) / 1000),
        data: { business: businessId, level, issuedAt: now },
        hmacSignatureSecret: signatureSecret,
        hmacKeySignatureSecret: keySecret,
      });
    },

    /**
     * Checks a proof sent with a booking (base64 JSON of `{ challenge, solution }`) and
     * spends it. Returns why it was refused, or null when it's good.
     */
    async spendProof(
      proof: string | undefined,
      businessId: string,
      required: ChallengeLevel,
      now = Date.now(),
    ): Promise<ProofProblem | null> {
      if (!proof) return "missing";
      let payload: { challenge?: Challenge; solution?: { counter: number; derivedKey: string } };
      try {
        payload = JSON.parse(Buffer.from(proof, "base64").toString("utf8"));
      } catch {
        return "invalid";
      }
      const { challenge, solution } = payload;
      if (
        !challenge?.parameters ||
        typeof challenge.signature !== "string" ||
        typeof solution?.counter !== "number" ||
        typeof solution.derivedKey !== "string"
      ) {
        return "invalid";
      }
      let result: Awaited<ReturnType<typeof verifySolution>>;
      try {
        result = await verifySolution({
          challenge,
          solution,
          deriveKey,
          hmacSignatureSecret: signatureSecret,
          hmacKeySignatureSecret: keySecret,
        });
      } catch {
        return "invalid";
      }
      if (result.expired) return "expired";
      if (!result.verified) return "invalid";

      // The signature covers this data, so it is what the server issued.
      const data = challenge.parameters.data ?? {};
      if (data.business !== businessId) return "invalid";
      if (required === "protected" && data.level !== "protected") return "too_easy";
      if (now - Number(data.issuedAt) < settings.minAgeMs) return "too_fast";

      for (const [signature, expiresAt] of spent) {
        if (expiresAt <= now) spent.delete(signature);
      }
      if (spent.has(challenge.signature)) return "used";
      spent.set(challenge.signature, now + settings.ttlMs);
      return null;
    },

    /** A reverse proxy is forwarding requests but TRUST_PROXY is off. */
    noteProxyHeaders(now = Date.now()) {
      proxyHeadersSeenAt = now;
    },
    proxyMisconfigured(now = Date.now()) {
      return proxyHeadersSeenAt > 0 && now - proxyHeadersSeenAt < DAY;
    },
  };
}
