# Architecture

OpenTurnly is a modular monolith: one Node.js process serves the API, the web app and (soon)
the background jobs, backed by PostgreSQL. The goal is an install that is a single
`docker compose up`, and a codebase a newcomer can read in an afternoon.

```
 Customer ──► https://example.com/<slug>      public booking page
 Business ──► https://example.com/admin       admin panel
                       │
 ┌─────────────────────▼────────── openturnly container ┐
 │ Node.js + Hono                                   │
 │   /api/auth/*     Better Auth (sessions)         │
 │   /api/setup      first-run owner account        │
 │   /api/businesses admin API (session required)   │
 │   /api/invitations                               │
 │   /api/public/*   booking page data, no login    │
 │   /*              built React app (SPA fallback) │
 └─────────────────────┬────────────────────────────┘
                       ▼
          PostgreSQL 18 (db container, postgres-data volume)
          — or embedded PGlite in development and tests
```

## Packages

| Path | Role |
| --- | --- |
| `packages/core` | Pure domain code shared by server and web: Zod schemas, slug rules. Later the availability engine. No I/O, so it is easy to test. |
| `apps/server` | Hono app (`src/app.ts`), routes, Better Auth setup, Drizzle schema and migrations (PostgreSQL). Runs TypeScript directly through Node's type stripping. |
| `apps/web` | React + Vite app: setup, sign-in, invitations, admin panel and public pages. The admin panel is a lazy-loaded chunk so the public page stays light. |

## Accounts and access

- The **owner** (`users.role = "owner"`) is created on first run through `/api/setup`,
  which closes as soon as an owner exists. The owner sees every business.
- Public sign-up is disabled. Other people get accounts through **invitations**: the owner
  enters an email, OpenTurnly returns a one-time link valid for 7 days. Only a SHA-256 hash of
  the token is stored.
- **Members** (`business_members`) only see the businesses they were added to. Requests for
  other businesses return 404 so their existence is not revealed.
- Sessions are HTTP-only cookies managed by Better Auth. Failed sign-ins are rate limited
  per client IP; the IP comes from the socket, or from `X-Forwarded-For` when
  `TRUST_PROXY=true` (see `src/lib/client-ip.ts`).

### Bots on the booking page

Anyone can reach the public booking page, so fake bookings are held back in layers, all
self-hosted and free (`src/lib/booking-guard.ts`):

- **Proof of work** ([ALTCHA](https://altcha.org), MIT). `GET .../challenge` returns a signed
  puzzle (PBKDF2-SHA-256) that the page solves in Web Workers while the visitor picks a
  time; about a second on a phone. Each booking needs a proof: signed for that business,
  valid 10 minutes, spent on use, and solved no sooner than 3 seconds after it was issued.
- **Rate limits** per network (IPv4 address or IPv6 /64), per phone or email, and for
  challenges and availability. Internal addresses (a proxy without `TRUST_PROXY`, the
  Docker Desktop gateway) can't tell visitors apart, so network limits skip them rather
  than block everyone together.
- **Surge brake** per business: when online bookings in the last hour reach
  `max(12, 2 × the busiest hour of the previous two weeks)`, for an hour puzzles take
  about 20 times longer, each network gets 2 bookings per hour, admins see a warning in the
  calendar, and at twice the threshold online bookings stop until the hour is over.
- A honeypot field, and at most 3 upcoming bookings per customer.

No free defense stops a determined attacker completely; the aim is that filling a
calendar is slow, costly and noticed. The owner is warned in the admin panel when a proxy
forwards requests but `TRUST_PROXY` is off. Limits and spent proofs live in memory, which
suits the single-process install.


### Roles

The instance owner can do everything. Each business member has a role:

- `admin`: everything about that business, including its users (but not creating or
  deleting businesses).
- `professional`: linked to one professional profile (`business_members.resource_id`).
  The scoped router lets them reach only their agenda routes; the appointment routes then
  narrow lists, free times and changes to their own profile. They can book and move their
  own appointments but not cancel them.

Admins create accounts with a password (`POST /members`) instead of sending an invitation
link; resetting a password signs the person out everywhere. An admin can only reset the
password of someone who works exclusively in businesses they manage.

Each business has its own sign-in page, `/<slug>/login`, with its name, logo and colours.
Accounts are the same as on `/login` (one per email for the whole install); the business
page only signs out anyone without access to that business and takes members straight to
it. The browser remembers which page was used, so signing out returns there.

### AI agents (MCP)

Each business has an MCP server at `/<slug>/mcp` (Streamable HTTP, stateless, official SDK
v2; `src/routes/mcp.ts`). Requests need an access key of that business
(`Authorization: Bearer ot_…`), created in Settings → Integrations (MCP); only its SHA-256 hash
is stored (`api_keys`). The key's kind picks the tools (`src/mcp/`):

- `agent`, for bots that talk to customers: business info, services, professionals, free
  times, booking, and finding, moving or cancelling an appointment with its booking code
  plus the customer's phone or email (any mismatch reads as "not found"), within the
  business's `customer_change_notice_min`.
- `admin`: the same with the business's own rules, plus calendar, customers, services,
  professionals, hours, closures, holidays, booking rules and a summary.

Tools call OpenTurnly's own HTTP API with the key (admin keys act as an admin on
`/api/businesses/:id/…`; any key of the business skips the booking page's puzzle and
network limits), so they follow the same validation and rules. Appointments they create are
marked `source = agent` with the key's name. A key can't manage keys, and keys of another
business get 401.

### Automations (outgoing webhooks)

A business's automations (`automations`) are a trigger (an appointment is created, moved
or cancelled, or some time before or after it) plus an ordered list of steps (`actions`,
jsonb): up to five webhook steps, each POSTing appointment data to a URL, and wait steps
that delay the webhook steps after them (`webhookSteps` in `src/lib/automations.ts` adds
the waits up). Each webhook step gets its own delivery, so one failing receiver doesn't
hold back the others. Every send is a row in `automation_deliveries`, which is both
the queue and the history: changes queue a row right away; a loop inside the server
process (every 15 seconds, no extra service) finds reminders and follow-ups that came due
(a `dedupe_key` of automation, appointment and time keeps each from going out twice) and
sends what's pending, retrying after 1, 5 and 30 minutes. Deliveries are signed with the
automation's secret (`X-OpenTurnly-Signature`, HMAC-SHA256 of `<timestamp>.<body>`), and
destinations inside the server's network are refused unless `WEBHOOKS_ALLOW_PRIVATE=true`.

## Validation and errors

The same Zod schemas from `@openturnly/core` validate forms in the browser and requests on
the server. Errors are returned as stable codes (`{ error: { code, fields } }`) and
translated by the web app, so the API stays language-neutral.

The schemas also clean what people type, so the same value is never stored two ways:
names are trimmed with single spaces, emails trimmed and lowercased, and phone numbers
parsed with `libphonenumber-js` and stored in E.164 (`+573001234567`). The web app shows
them back with `formatPhone` (`+57 300 1234567`).

## Data

Tables: `users`, `sessions`, `accounts`, `verifications` (Better Auth), `businesses`,
`business_members`, `invitations`, `business_images`, `services`, `resources` (staff,
courts…), `resource_services`, `weekly_hours`, `closures`, `holiday_overrides`,
`customers`, `appointments`. See
[`apps/server/src/db/schema.ts`](../apps/server/src/db/schema.ts).

Conventions:

- IDs are random strings (UUIDs for OpenTurnly tables).
- Timestamps are stored as milliseconds since epoch (UTC).
- Each business has an IANA time zone. Opening hours are stored as wall-clock times
  in that zone and appointments as UTC instants.
- Prices are integers in the currency's minor unit; the currency belongs to the business.
- Tokens sent in links are stored hashed.
- The holiday country is not stored: it is the country of the business's time zone
  (`countryForTimeZone`, built from date-holidays' data), so holidays and appointment
  times always agree. Changing to another country's zone resets per-holiday exceptions.
- Customers are matched by mobile number (E.164), then email (unique per business); either
  may be empty, never both. A booking only fills in what the record is missing. The same
  customer can't book two overlapping appointments (`already_booked`).
- Each business has a `bookingForm` (JSON): phone/email rules and extra questions.
  `bookingDetailsSchema(form)` in `@openturnly/core` validates a booking against it on both
  sides; answers are stored on the appointment with the question text as it was asked.
  Each appointment has a random 6-character `code` (no 0/O or 1/I), unique across the
  install.
- Closures are date ranges (`date`..`endDate`, inclusive); availability expands them into
  closed days inside the requested window.
- The booking page accent (`brandColor`) is a hex string and its background a named
  `pageTheme` (`soft`, `aurora`, `cover`, `plain`, `dark`). The web app turns
  the brand colour into the `--color-brand-*` CSS variables, so every `brand-*` utility
  follows it, and picks dark or white text on it by contrast.
- The public page's logo and cover live in `business_images` (`bytea`), so a backup of the
  database is a backup of everything. The browser resizes them before upload (at most
  1600×900); the server checks the file signature and serves them with immutable,
  versioned URLs.

## Availability and booking

`packages/core/src/availability.ts` turns opening hours into free start times. It is pure
and fully tested; `apps/server/src/lib/schedules.ts` loads what it needs from the database:

1. For each candidate resource, its own weekly hours or else the business hours.
2. Minus closed days (business-wide or per resource) and confirmed appointments.
3. Start times every `slotIntervalMin` from the start of each range where the whole
   service fits, after the minimum notice and within the booking window.

Public holidays are computed on the fly with `date-holidays` for the business's country
(`apps/server/src/lib/holidays.ts`), so nothing has to be imported each year. With
`closedOnHolidays` on, every holiday is a closed day except the dates listed in
`holiday_overrides`; with it off, only the listed dates are closed.

A business without staff has a single schedule (`resourceId: null`) on its own hours.
"Anyone available" merges every resource offering the service and, when booking, picks the
one with the fewest appointments that day.

Booking runs in a transaction that first takes a PostgreSQL advisory lock for the business
(`pg_advisory_xact_lock`), then recomputes the slot and inserts the appointment. Bookings
for the same business queue up behind each other, so two people can never take the same
time, even with several app servers. Prices are stored
in minor units with a fixed number of decimals per currency (`money.ts`), never taken from
the browser's `Intl` data, which differs between versions.

## Coming next

- **Outbox**: a table of pending emails processed by a loop inside the same process
  (no Redis, no external cron), for confirmations and reminders.
- **OAuth** for the MCP server, to connect from Claude.ai or ChatGPT with one click.

Major decisions are recorded in [`docs/adr`](adr/).
