# 5. PostgreSQL as the database

- Status: accepted (supersedes [ADR 2](0002-sqlite.md))
- Date: 2026-10-20

## Context

OpenTurnly started on SQLite to keep the install to a single container. As the project aims to
be a serious, long-lived alternative to commercial booking platforms, including installs
that host many businesses, we want the database most operators and contributors already
know, that managed providers offer, and that lets several app servers share one database.

## Decision

- Use **PostgreSQL** (18 in `docker-compose.yml`) through Drizzle ORM and `node-postgres`.
- `docker compose up` starts OpenTurnly and a `db` container; the app waits for the database
  and applies migrations on start.
- Without `DATABASE_URL`, development and tests run on **PGlite** (PostgreSQL compiled to
  WebAssembly, in-process), so contributors still need nothing but Node.js. Production
  requires `DATABASE_URL`; PGlite is only a dev dependency.
- Double bookings are prevented with a per-business advisory lock
  (`pg_advisory_xact_lock`) taken at the start of the booking transaction.

## Consequences

- One more container and about 50 MB more RAM; backups use `pg_dump`.
- Managed PostgreSQL works out of the box, and several OpenTurnly containers can run behind a
  load balancer against the same database.
- Major PostgreSQL upgrades need a dump and restore, documented in the self-hosting guide.
- Tests exercise real PostgreSQL behavior (PGlite) without Docker.
