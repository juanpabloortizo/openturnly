# Changelog

All notable changes to OpenTurnly are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- **Locations**: a business can work from several locations (Administration → Locations),
  each with its own address, phone, opening hours, closures, services and team. Someone
  can work at several locations, with their own hours at each, and is never booked at two
  at the same time. With more than one location the booking page starts with "Where would
  you like your appointment?", and a link with `?local=<id>` goes straight to one. The
  calendar filters by location and appointments can move between them. Existing businesses
  get one location with their current hours, services, team and appointments.
- **AI agents (MCP)**: `location_id` for finding times, booking, moving appointments, hours
  and closures; `get_business_info` lists each location with its hours.
- **Workflows**: `appointment.location` and `appointment.location_address` data.

## [1.1.0] - 2026-10-22

### Added

- **AI agents (MCP)**: administration keys can update the business's name, description,
  phone, email and address with the new `update_business_details` tool, so an assistant can
  set up a business's booking page end to end.

### Changed

- **Long service menus**: when a business offers more than six services, its booking page
  picks them from a searchable dropdown (with each one's length and price) and shows the
  chosen one in full, instead of a long wall of cards.
- **Staff services**: choosing which services a professional does is a checklist with a
  count, all/none shortcuts and, for long menus, a search, instead of a pile of buttons.

### Security

- **Development tools**: the old esbuild that drizzle-kit pulled in (a moderate advisory for
  its dev server) is replaced with a patched one. It was never part of the Docker image.

## [1.0.0] - 2026-10-22

The first public release, under the MIT license.

### Added

- **Install**: one `docker compose up -d` starts OpenTurnly and PostgreSQL 18, with images for
  amd64 and arm64. The first visitor creates the owner account; public sign-up is closed.
  Many businesses per install, each with its own booking page at `/<slug>`. Spanish and
  English.
- **Booking page**: one centered card with the business's cover, logo, name and contact
  details, then service, date and time, details and confirmation. Customers can pick who
  attends them or leave it to whoever is free, and get a short booking code (e.g.
  `K7Q4XM`). Their details are remembered on their own device for next time, never looked up
  on the server. Brand colour and five background styles, with a live preview.
- **Booking form**: phone and email can each be required, optional or not asked, plus up to
  10 extra questions (short text, long text or options). Phones are stored in E.164 with a
  country-code picker that starts on the business's country.
- **Calendar**: day, week, month and list views. Book appointments for customers, move them
  to another day, time, staff member or service among the times that are actually free,
  and cancel them. The list view covers any period with search, filters and totals, and
  exports to Excel or CSV.
- **Customers**: every customer with their bookings, visits, total spent and private notes.
  Customers are recognized by mobile number first, then email; bookings only fill in
  missing details. Duplicates are pointed out and can be merged, and the same customer
  can't hold two appointments at the same time.
- **Services, staff and hours**: services with duration and price; staff (or courts, rooms…)
  with the services they provide and optional own hours; weekly hours with split shifts on
  an hour timeline; closures over one or several days; public holidays detected from the
  business's time zone, each one open or closed; booking rules (time step, minimum notice,
  how far ahead) with a preview of the times customers will see. Availability is time-zone
  and DST aware, and double bookings are prevented.
- **Team access**: admins run their business, professionals see and book only their own
  calendar. Access is given from Settings → General → Users with a generated strong
  password, and each business has its own branded sign-in page at `/<slug>/login`.
- **Your account**: a menu at the bottom of the sidebar with your details (name, email, and
  password, which signs you out on your other devices), the language and the theme.
- **Light and dark themes** for the admin, or following the device; booking pages always keep
  the look each business chose. The interface starts in Spanish.
- **Made for phones too**: tables turn into cards, dialogs and menus fit the screen, tabs
  scroll sideways, and the agenda offers day, three-day and list views.
- **Guided tours**: the first time someone opens a business, a short tour shows what each
  section is for, and each section explains its main parts the first time it's opened.
  Professionals get a shorter one. Each shows once per person, and "See the tour again" in
  the account menu brings them back.
- **Settings** in four tabs (General, Booking page, Integrations, Workflows), each saved
  with one bar that shows up only when something changed. Deleting a business lists
  everything that goes with it and asks for its name, then once more, before deleting it.
- **AI agents (MCP)**: an MCP server per business at `/<slug>/mcp`, with access keys shown
  once and stored hashed. Booking agent keys answer questions, find free times and book,
  move or cancel with the booking code; administration keys also run the calendar,
  customers, catalog and hours. See [docs/mcp.md](docs/mcp.md).
- **Workflows**: send appointment data to any system that takes webhooks when an
  appointment is booked, moved, cancelled or over, or some time before it starts. Flows are
  built on a canvas with webhook and wait steps, can start from templates, and are tested
  with a real appointment or example data to see each system's answer. Each webhook picks
  its method, authentication (Basic, Header or JWT), extra headers and body:
  chosen fields or a JSON written in the receiver's own format, with the data picked by
  group (`{{customer.first_name}}`, `{{appointment.time}}`…). Deliveries are
  signed, sent only over HTTPS, retried and kept away from the server's own network. See
  [docs/workflows.md](docs/workflows.md).
- **Protection against fake bookings**, free and self-hosted: a proof-of-work puzzle
  (ALTCHA) solved in the background, limits per network, phone and email, and a surge brake
  per business that hardens the page and warns admins when bookings spike.
- **Account security**: changes made with the session cookie must come from the install's
  own pages, and "My account" waits 15 minutes after 5 wrong current passwords. See
  [SECURITY.md](SECURITY.md) for everything that's built in.

[Unreleased]: https://github.com/juanpabloortizo/openturnly/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/juanpabloortizo/openturnly/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/juanpabloortizo/openturnly/releases/tag/v1.0.0
