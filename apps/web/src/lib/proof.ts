import { type Challenge, solveChallenge, solveChallengeWorkers } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import { useCallback, useEffect, useRef } from "react";
import { ApiError, api } from "./api.ts";

/** Same as the server: proofs sent sooner after their puzzle are refused. */
const MIN_AGE_MS = 3_000;
/** Puzzles expire on the server after 10 minutes; start a new one a bit before. */
const MAX_AGE_MS = 9 * 60_000;

type Solved = { proof: string; receivedAt: number };

/**
 * Gets an anti-bot puzzle (ALTCHA proof of work) for one booking and solves it in the
 * background, in Web Workers so the page stays smooth. Takes about a second; longer while
 * the business is getting an unusual number of bookings.
 */
async function solveProof(slug: string): Promise<Solved> {
  const { challenge } = await api<{ challenge: Challenge }>(
    `/api/public/businesses/${slug}/challenge`,
  );
  const receivedAt = Date.now();
  const solution =
    typeof Worker === "undefined"
      ? await solveChallenge({ challenge, deriveKey })
      : await solveChallengeWorkers({
          challenge,
          concurrency: Math.min(4, navigator.hardwareConcurrency || 2),
          createWorker: () =>
            new Worker(new URL("./proof-worker.ts", import.meta.url), { type: "module" }),
        });
  if (!solution) throw new ApiError(0, "challenge_timeout");
  return { proof: btoa(JSON.stringify({ challenge, solution })), receivedAt };
}

/**
 * Keeps a solved proof ready while `enabled` (from the moment someone starts choosing a
 * time), so confirming rarely waits. `take()` hands out a proof for one booking.
 */
export function useBookingProof(slug: string, enabled: boolean) {
  const pending = useRef<Promise<Solved> | null>(null);

  useEffect(() => {
    if (!enabled || pending.current) return;
    const next = solveProof(slug);
    // Errors surface when the proof is taken, not as unhandled rejections.
    next.catch(() => undefined);
    pending.current = next;
  }, [enabled, slug]);

  return useCallback(async (): Promise<string> => {
    const ready = pending.current;
    pending.current = null;
    let solved = ready ? await ready.catch(() => solveProof(slug)) : await solveProof(slug);
    if (Date.now() - solved.receivedAt > MAX_AGE_MS) solved = await solveProof(slug);
    const wait = MIN_AGE_MS - (Date.now() - solved.receivedAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return solved.proof;
  }, [slug]);
}
