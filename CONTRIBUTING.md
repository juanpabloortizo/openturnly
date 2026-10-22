# Contributing to OpenTurnly

Thanks for helping! OpenTurnly is meant to be easy to install **and** easy to contribute to.
If anything in this guide is unclear, that is a bug — please open an issue.

## Ways to help

- **Try it** and report what breaks or confuses you.
- **Pick an issue** labeled [`good first issue`](https://github.com/juanpabloortizo/openturnly/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/juanpabloortizo/openturnly/labels/help%20wanted).
- **Translate** the interface (see [Translations](#translations)).
- **Improve the docs**, especially the self-hosting guide.

For larger changes, open an issue first so we can agree on the approach before you write code.

## Run it locally

You need **Node.js 26** (see [`.nvmrc`](.nvmrc)). No database server, Redis or Docker needed:
without `DATABASE_URL`, development and tests use [PGlite](https://pglite.dev), the real
PostgreSQL compiled to WebAssembly and running inside Node.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The first visit asks you to create the owner account.

- The API runs on port 4100 and reloads on save. Vite serves the web app on 5173 and
  proxies `/api` to it.
- Data is stored in `./data/pglite`. Delete `./data` to start over from the setup screen.
- To develop against a real PostgreSQL server, set `DATABASE_URL` in a `.env` file at the
  repository root, e.g. `DATABASE_URL=postgres://openturnly:openturnly@localhost:5432/openturnly`.

## Project layout

```
apps/
  server/        Hono API, auth, database schema and migrations
  web/           React app: setup, admin panel and public booking pages
packages/
  core/          Domain rules shared by server and web (validation, slugs…). No I/O.
docs/            Architecture, self-hosting guide, decision records (adr/)
scripts/dev.ts   Starts the API and Vite together
```

The server runs TypeScript directly with Node's built-in type stripping, so there is no
server build step. Use only erasable syntax (no `enum`, no constructor parameter
properties) and import local files with their `.ts` extension.

## Commands

| Command               | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | API + web app with auto-reload                  |
| `npm test`            | Unit and API tests (Vitest)                     |
| `npm run typecheck`   | TypeScript checks for every package             |
| `npm run lint`        | Lint and format check (Biome)                   |
| `npm run format`      | Fix formatting and safe lint issues             |
| `npm run build`       | Build the web app into `apps/web/dist`          |
| `npm start`           | Run the server, serving the built web app       |
| `npm run db:generate` | Create a migration after changing the schema    |

Before opening a pull request, run `npm run lint && npm run typecheck && npm test`.
CI runs the same checks.

## Database changes

1. Edit [`apps/server/src/db/schema.ts`](apps/server/src/db/schema.ts).
2. Run `npm run db:generate` and give the migration a clear name when asked.
3. Commit the generated files in `apps/server/drizzle/`.

Migrations run automatically when the server starts. Never edit a migration that has
already been released; add a new one.

## Translations

UI texts live in [`apps/web/src/i18n/`](apps/web/src/i18n/). `es.ts` is the reference;
other languages are typed against it, so TypeScript tells you about missing keys.
To add a language, copy `en.ts`, translate it and register it in `i18n/index.ts`.

API errors are sent as stable codes (`slug_taken`, `invitation_invalid`…) and translated
in the web app under `errors`.

## Conventions

- **Code, names and comments in English.** Discussions can be in English or Spanish.
- **Small pull requests** that do one thing, with tests for behavior changes.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat: add holiday import`, `fix(booking): handle DST gaps`.
- **Sign off your commits** (`git commit -s`). This is the
  [Developer Certificate of Origin](https://developercertificate.org): you confirm you have
  the right to submit the code under the project's license.
- **Simplicity wins.** If a feature makes installing or using OpenTurnly harder, it probably
  does not belong in the core.

## npm install scripts

npm blocks dependency install scripts unless they are approved in `package.json`
(`allowScripts`). Only `esbuild` is approved. If a new dependency needs one, explain why in your pull request.

## Versions and releases

OpenTurnly follows [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- **Patch** (`1.0.1`): bug and security fixes only.
- **Minor** (`1.1.0`): new features that keep working with existing installs, settings,
  webhooks and MCP clients.
- **Major** (`2.0.0`): anything that makes people change their setup: a removed or renamed
  setting, a changed webhook payload or MCP tool, or a manual migration step.

Database migrations run on start, so updating within a major version is just pulling the new
image. Every change worth mentioning goes under `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md) in the same pull request.

To publish a release (maintainers):

1. Move the `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD` heading and update
   the links at the bottom of the changelog.
2. Set `"version"` in the root and workspace `package.json` files, and run `npm install` so
   `package-lock.json` matches.
3. Commit (`chore: release vx.y.z`), tag it `vx.y.z` and push the tag. The release workflow
   publishes the Docker image as `x.y.z`, `x.y`, `x` and `latest`.
4. Create the GitHub release from the tag with the changelog section as its notes.

## Code of conduct

Everyone taking part in OpenTurnly follows the [Code of Conduct](CODE_OF_CONDUCT.md).
