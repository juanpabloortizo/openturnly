// Solves part of the booking page's anti-bot puzzle off the main thread (see proof.ts).
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import { handler } from "altcha-lib/workers/shared";

handler({ deriveKey });
