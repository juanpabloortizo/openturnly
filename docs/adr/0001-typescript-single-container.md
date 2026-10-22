# 1. TypeScript in a single container

- Status: accepted
- Date: 2026-10-20

## Context

OpenTurnly must be easy to install (`docker compose up`), light enough for a $5 VPS or a free
VM, and attractive to contributors. Comparable open-source schedulers are either heavy to
self-host (many services and environment variables) or written in stacks with few
contributors.

## Decision

- TypeScript for everything, in an npm workspaces monorepo (`apps/server`, `apps/web`,
  `packages/core`).
- API with **Hono** on Node.js; web app with **React + Vite**, built to static files that
  the same Node process serves.
- One app process in one container (plus PostgreSQL since [ADR 5](0005-postgresql.md)).
  Background work (email reminders) will run inside the same process using a database
  table as a queue — no Redis.
- The server runs `.ts` files directly with Node's type stripping: no server build step.

Alternatives considered: Next.js (heavier, more framework behavior to learn), Go + React
(lighter, but two languages raise the bar to contribute), Laravel (popular, but a heavier
image and fewer JavaScript contributors).

## Consequences

- One language and one `npm install` for contributors.
- The API is plain REST, so it can be used by integrations (automation tools, apps) later.
- Server code must use only erasable TypeScript syntax and `.ts` import extensions.
