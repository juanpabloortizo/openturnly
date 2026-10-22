# Self-hosting OpenTurnly

OpenTurnly runs as two Docker containers: the app and its PostgreSQL database, each with a
volume. Anything that can run containers all the time and keep a disk can host it.

For a complete walk-through, from creating the server to HTTPS on your domain, backups and
updates, see [Deploying on an Azure VM](deploy-azure.md); from its step 3 on it works on any
Ubuntu server.

## What you need

- A machine that is always on: a VPS, a free cloud VM, or a computer at home.
- Docker with Docker Compose.
- A domain or subdomain (e.g. `reservas.example.com`) for HTTPS. Sign-in and the booking
  page's anti-bot check need a secure connection outside `localhost`.
- About 200 MB of free RAM (app ~150 MB, PostgreSQL ~50 MB) and a few hundred MB of disk.

Serverless platforms (Vercel, Netlify, Cloudflare Pages…) **cannot** run OpenTurnly: there is
no persistent disk for the database and no process that stays on to send reminders.
Free tiers of PaaS platforms that do not keep a disk (e.g. Render's free web services)
lose the database on every restart.

## Install

```bash
git clone https://github.com/juanpabloortizo/openturnly.git
cd openturnly
cp .env.example .env   # set APP_URL and a strong POSTGRES_PASSWORD
docker compose up -d --build
```

The database password only takes effect the first time PostgreSQL starts, so set it
before that. The database is not published on any port: only OpenTurnly can reach it.

Open your `APP_URL` and create the owner account. Do this right away: until an owner
exists, whoever opens the page first can create it.

## HTTPS with Caddy

[Caddy](https://caddyserver.com) gets and renews certificates automatically.

1. Point your domain's DNS `A` record to the server's public IP.
2. Create a `Caddyfile` next to `docker-compose.yml`:

   ```
   reservas.example.com {
     reverse_proxy openturnly:3000
   }
   ```

3. Create `compose.override.yml`:

   ```yaml
   services:
     openturnly:
       ports: !reset []
       environment:
         APP_URL: https://reservas.example.com
         TRUST_PROXY: "true"
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy-data:/data
   volumes:
     caddy-data:
   ```

4. Run `docker compose up -d`.

`TRUST_PROXY=true` tells OpenTurnly to read the visitor's IP from the proxy, so failed-login
and anti-bot limits apply per visitor. Only set it when OpenTurnly is reachable **only**
through the proxy. If a proxy forwards requests while it is off, the admin panel shows the
owner a warning.

## Free hosting options

Conditions of free tiers change; check them when you sign up.

| Option | What you get | Watch out for |
| --- | --- | --- |
| **Oracle Cloud Always Free** | ARM VM, up to 4 cores and 24 GB RAM, 200 GB disk | Needs a card to verify. Regions run out of capacity. Idle Always Free instances can be reclaimed; upgrading the account to Pay As You Go avoids that and stays free within the free limits. |
| **Google Cloud `e2-micro`** | Small VM (1 GB RAM, 30 GB disk) in some US regions | Needs a card to verify. About 1 GB of free outbound traffic per month. |
| **A computer at home + Cloudflare Tunnel** | HTTPS on your domain without opening router ports | Bookings stop when the power or internet goes down. |

On any of them: install Docker, follow [Install](#install) and [HTTPS with Caddy](#https-with-caddy)
(or Cloudflare Tunnel), and set up [backups](#backups) — free VMs can disappear.

## Backups

Bookings live in PostgreSQL (`postgres-data` volume); `openturnly-data` only holds the session
secret. Back up the database with `pg_dump`, which works while OpenTurnly is running:

```bash
docker compose exec -T db pg_dump -U openturnly -Fc openturnly > openturnly-$(date +%F).dump
```

Copy the file somewhere else (another machine, Backblaze B2, Cloudflare R2…). To restore
into an empty install:

```bash
docker compose exec -T db pg_restore -U openturnly -d openturnly --clean --if-exists < openturnly-2026-10-20.dump
```

Running this once a day from `cron` is enough for most businesses.

## Using your own PostgreSQL

Managed PostgreSQL (Neon, Supabase, your provider's database) works too: remove the `db`
service from `docker-compose.yml` and set `DATABASE_URL` to your connection URL.

Run a single OpenTurnly container per database: the anti-bot limits live in its memory and it
is the process that sends workflows, so several copies would not share them.

## Updating

Back up first, then pull the new image and restart:

```bash
docker compose pull
docker compose up -d
```

If you installed from a clone and build the image yourself, run `git pull` and
`docker compose up -d --build` instead. Database migrations run automatically on start.

The image is published as `latest` and with version tags (`1`, `1.0`, `1.0.0`). To take
only fixes and new features that don't change your setup, pin the major version in
`docker-compose.yml`: `image: ghcr.io/juanpabloortizo/openturnly:1`. Read the
[changelog](../CHANGELOG.md) before moving to a new major version.

Major PostgreSQL upgrades (for example 18 to 19) are not automatic: back up with
`pg_dump`, change the `db` image, start with an empty `postgres-data` volume and restore.

## Troubleshooting

- **Port 3000 already in use**: set `OPENTURNLY_PORT=8080` (or any free port).
- **Invitation links point to localhost**: set `APP_URL` to your public URL and restart.
- **Logs**: `docker compose logs -f openturnly`.
