# 2. SQLite as the only database

- Status: superseded by [ADR 5](0005-postgresql.md)
- Date: 2026-10-20

## Context

Small businesses make a few dozen bookings a day. A separate database server means another
container, more RAM, more configuration and more ways for an install to break.

## Decision

Use **SQLite** (WAL mode, via `better-sqlite3`) with **Drizzle ORM** and SQL migrations
that run automatically on startup. Support only SQLite in v1.

## Consequences

- Zero configuration: the database is a file in the data volume. Backups are a file copy.
- SQLite serializes writes, which also makes "check the slot is free, then insert the
  appointment" safe inside one transaction.
- Horizontal scaling (several app servers) is not possible. That is fine for the target
  audience; if it is ever needed, Postgres can be added later with a parallel schema.
