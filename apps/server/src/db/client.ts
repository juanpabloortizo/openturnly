import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Works the same on a real PostgreSQL server and on embedded PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Database = { db: Db; close: () => Promise<void> };

/** Connects to PostgreSQL (waiting for it to start) and applies pending migrations. */
export async function connectPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await waitUntilReachable(pool);
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => pool.end() };
}

/**
 * PostgreSQL compiled to WebAssembly, running inside Node: development and tests work
 * without a database server. `dataDir` undefined keeps everything in memory.
 * PGlite is a dev dependency, so production always needs DATABASE_URL.
 */
export async function openEmbeddedPostgres(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = await import("drizzle-orm/pglite");
  const { migrate: migrateEmbedded } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dataDir);
  const db = pglite.drizzle({ client, schema });
  await migrateEmbedded(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

async function waitUntilReachable(pool: pg.Pool) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      if (attempt === 1) console.log("Waiting for PostgreSQL…");
      await sleep(1000);
    }
  }
}
