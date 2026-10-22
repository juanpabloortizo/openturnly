/**
 * A business slug is the public part of its booking URL: `https://example.com/<slug>`.
 * It shares the URL space with the app's own routes, so those names are reserved.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "dashboard",
  "docs",
  "embed",
  "embed.js",
  "favicon.ico",
  "health",
  "help",
  "openturnly",
  "invite",
  "login",
  "logout",
  "manage",
  "public",
  "robots.txt",
  "settings",
  "setup",
  "signup",
  "static",
  "support",
  "www",
]);

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

export function checkSlug(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN_LENGTH) return "too_short";
  if (slug.length > SLUG_MAX_LENGTH) return "too_long";
  if (!SLUG_PATTERN.test(slug)) return "invalid_characters";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

/** Turns a business name into a slug suggestion: "Peluquería Doña Ana" → "peluqueria-dona-ana". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}
