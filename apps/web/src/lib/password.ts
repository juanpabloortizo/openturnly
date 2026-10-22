/** Characters that can't be mistaken for each other (no 0/O, 1/l/I), by kind. */
const GROUPS = [
  "abcdefghijkmnpqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  // Symbols that survive being pasted into a chat or a terminal: no quotes or backslashes.
  "!@#$%&*?+=",
];
const ALPHABET = GROUPS.join("");
const LENGTH = 14;

function randomChars(count: number): string[] {
  const chars: string[] = [];
  while (chars.length < count) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      // Skip the bytes that would make some characters more likely than others.
      if (byte < 256 - (256 % ALPHABET.length) && chars.length < count) {
        chars.push(ALPHABET[byte % ALPHABET.length] as string);
      }
    }
  }
  return chars;
}

/**
 * A strong password like "kT7m#qP4x!Lw9z": 14 characters with lower and upper case
 * letters, digits and symbols (about 85 bits of randomness).
 */
export function generatePassword(): string {
  for (;;) {
    const chars = randomChars(LENGTH);
    // Drawn again until every kind shows up, so all passwords stay equally likely.
    if (GROUPS.every((group) => chars.some((char) => group.includes(char)))) {
      return chars.join("");
    }
  }
}
