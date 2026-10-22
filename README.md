<div align="center">

<img src="docs/brand/openturnly-mark.svg" width="72" height="72" alt="">

# OpenTurnly

**Open-source, self-hosted online booking for service businesses.**

Barbershops, hair salons, spas, clinics, therapists, vets, sports courts — give your
customers a page to book appointments, on your own server, for free.

[![CI](https://github.com/juanpabloortizo/openturnly/actions/workflows/ci.yml/badge.svg)](https://github.com/juanpabloortizo/openturnly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## Why

Small businesses pay a monthly subscription to closed booking platforms and get far more
features than they need. OpenTurnly aims to be the free, simple alternative that you own:

- **One command to install**: `docker compose up -d` starts OpenTurnly and its PostgreSQL.
- **Light**: around 200 MB of RAM in total. Runs on a $5 VPS, a free cloud VM or a Raspberry Pi.
- **Your data stays yours**: everything lives in a single volume on your server.
- **Many businesses per install**: host your own business, or all of your clients'.
- **Ready for AI agents**: each business has its own MCP server, so a WhatsApp bot or an
  assistant like Claude can answer questions, find free times and book.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/booking-page.png" alt="A business's booking page, listing its services with length and price"></td>
    <td width="50%"><img src="docs/screenshots/booking-time.png" alt="Choosing a day and a free time on the booking page"></td>
  </tr>
  <tr>
    <td align="center">The booking page</td>
    <td align="center">Picking a day and a time</td>
  </tr>
</table>

<img src="docs/screenshots/agenda.png" alt="The admin calendar, a week of appointments by staff member">
<p align="center">The calendar, where the business sees and manages its appointments</p>

## How it works

1. You install OpenTurnly and create the **owner account** on the first visit.
2. You create **businesses**. Each one gets a public booking page at `your-domain/<slug>`.
3. Each business sets up its **services**, **staff** (optional) and **opening hours**.
4. Customers open the booking page, pick a service, a date and a free time (and, if they
   like, who attends them), then leave their details. No account needed.
5. You **give access** to each business's people: admins run the business, professionals
   see their own calendar. Each business has its own sign-in page at `your-domain/<slug>/login`.
6. Optionally, a business connects **AI agents** at `your-domain/<slug>/mcp` with access keys
   from Settings → Integrations (MCP), see [docs/mcp.md](docs/mcp.md). It can also set up
   **workflows** that send appointment data to other tools when something happens, before
   it or after it, see [docs/workflows.md](docs/workflows.md).

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

```bash
git clone https://github.com/juanpabloortizo/openturnly.git
cd openturnly
docker compose up -d --build
```

Open <http://localhost:3000> and create the owner account. Bookings are stored in
PostgreSQL, in the `postgres-data` Docker volume. Set `POSTGRES_PASSWORD` in a `.env` file
before the first start (see [`.env.example`](.env.example)).

You can also skip the clone: download [`docker-compose.yml`](docker-compose.yml) and run
`docker compose up -d`, which pulls the published image.

To put OpenTurnly online with your own domain and HTTPS, free hosting options, backups and
updates, read the [self-hosting guide](docs/self-hosting.md), or follow the
[step-by-step guide for an Azure VM](docs/deploy-azure.md) with a Cloudflare domain.

## Configuration

| Variable       | Default                    | Description                                                         |
| -------------- | -------------------------- | ------------------------------------------------------------------- |
| `APP_URL`      | `http://localhost:3000`    | Public URL of your install. Used in invitation and booking links.   |
| `OPENTURNLY_PORT` | `3000`                     | Port published on the host by `docker-compose.yml`.                 |
| `POSTGRES_PASSWORD` | `openturnly`             | Password of the bundled PostgreSQL. Set it before the first start.  |
| `DATABASE_URL` | built by `docker-compose.yml` | PostgreSQL connection URL, if you use your own database server.  |
| `SECRET`       | generated on first start   | Signs sessions. Saved to `/data/secret` if you don't set one.       |
| `WEBHOOKS_ALLOW_PRIVATE` | `false`          | Let workflows post to addresses inside your network (e.g. a receiver in the same Docker network). |
| `TRUST_PROXY`  | `false`                    | Set to `true` behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) so login and anti-bot limits use the visitor's real IP. |
| `DATA_DIR`     | `/data`                    | Where the generated secret is saved.                                |

## Features

- **Booking page** per business with its logo, cover, brand colour and own questions, in
  Spanish or English. Customers book without an account and get a booking code.
- **Calendar** with day, week, month and list views, booking and moving appointments,
  and Excel/CSV export.
- **Customers** with their history, notes and duplicate merging.
- **Services, staff and hours**: split shifts, closures, automatic public holidays per
  country and booking rules, all time-zone aware.
- **Team access** with admin and professional roles, and a branded sign-in page per business.
- **AI agents** through an MCP server per business ([docs/mcp.md](docs/mcp.md)).
- **Workflows** that send appointment data to any system that takes webhooks: an
  automation platform, a CRM, a WhatsApp bot or your own API ([docs/workflows.md](docs/workflows.md)).
- **Protection against fake bookings**: self-hosted proof of work (ALTCHA), rate limits and
  a surge brake per business. No third-party service needed.

See the [changelog](CHANGELOG.md) for what each release brings.

## Roadmap

Next on the list:

- Confirmation and reminder emails with `.ics`, and cancel or reschedule links without an
  account.
- An embeddable booking widget for existing websites.

Not planned: online payments, built-in WhatsApp/SMS, marketing tools. Workflows and the
MCP server let you connect those from other tools.

## Tech stack

TypeScript everywhere. [Hono](https://hono.dev) API and [React](https://react.dev) +
[Vite](https://vite.dev) web app in one Node.js process, [PostgreSQL](https://www.postgresql.org)
with [Drizzle ORM](https://orm.drizzle.team), [Better Auth](https://www.better-auth.com) for
sign-in. See [docs/architecture.md](docs/architecture.md).

## Credits

Public holiday data comes from [date-holidays](https://github.com/commenthol/date-holidays)
(ISC; holiday data CC-BY-3.0) and phone number rules from
[libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (MIT). The interface uses the [Inter](https://rsms.me/inter/) typeface
(SIL Open Font License), served by your own install.

## Contributing

Contributions are welcome — code, translations, docs, bug reports and ideas.
Read [CONTRIBUTING.md](CONTRIBUTING.md) to get the project running locally in two commands.

## License

[MIT](LICENSE). You can use, modify, host and sell OpenTurnly, as long as you keep the
copyright and license notice. See [ADR 0006](docs/adr/0006-license-mit.md) for why.
