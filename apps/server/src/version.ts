import { readFileSync } from "node:fs";

/** The release this install runs, from the root package.json (bumped when a version is tagged). */
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).version;
