import { Hono } from "hono";
import { timeZoneCountries } from "../lib/holidays.ts";
import { type AppEnv, requireUser } from "../lib/http.ts";
import { VERSION } from "../version.ts";

/** Reference data for admin forms, and the version of this install. */
export function metaRoutes() {
  return (
    new Hono<AppEnv>()
      .get("/timezones", (c) => {
        requireUser(c);
        c.header("Cache-Control", "private, max-age=86400");
        // { "America/Bogota": "CO", … }: lets the picker search time zones by country.
        return c.json({ countries: timeZoneCountries() });
      })
      // Signed-in only: no need to tell the world which version to look up exploits for.
      .get("/version", (c) => {
        requireUser(c);
        return c.json({ version: VERSION });
      })
  );
}
