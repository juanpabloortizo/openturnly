/**
 * Short ids for admin URLs (/admin/k7m2qx9a4p/customers?customer=x4k9pm2qa7): random, so
 * they can't be guessed in order, and checked against the database so they never repeat.
 * Records keep their UUID as the real id; these only make links short.
 */

/** 32 characters without 0/o and 1/l, which look alike. 256 is a multiple of 32. */
export const SHORT_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
/** 32^10 ≈ 1.1 × 10^15 combinations. */
export const SHORT_ID_LENGTH = 10;

const pattern = new RegExp(`^[${SHORT_ID_ALPHABET}]{${SHORT_ID_LENGTH}}$`);

export function isShortId(value: string): boolean {
  return pattern.test(value);
}
