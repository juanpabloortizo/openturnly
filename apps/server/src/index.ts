import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { connectPostgres, openEmbeddedPostgres } from "./db/client.ts";
import { VERSION } from "./version.ts";

const config = loadConfig();
const database = config.databaseUrl
  ? await connectPostgres(config.databaseUrl)
  : await openEmbeddedPostgres(path.join(config.dataDir, "pglite"));
const { db } = database;
const auth = createAuth({ db, config });
const app = createApp({ db, auth, config });
const stopAutomations = app.automations.start();

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`OpenTurnly ${VERSION} is running at ${config.appUrl}`);
  console.log(
    config.databaseUrl
      ? "Database: PostgreSQL"
      : `Database: embedded PostgreSQL (PGlite) in ${config.dataDir}/pglite — development only`,
  );
});

function shutdown() {
  stopAutomations();
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
