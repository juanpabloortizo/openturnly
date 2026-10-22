# Workflows (outgoing webhooks)

Each business can send an appointment's data to any system that takes webhooks when
something happens: an automation platform, a CRM, a WhatsApp bot, your own API. Set them up
in **Settings → Workflows**.

A workflow is built on a canvas that starts empty: add the **trigger**
(what has to happen to an appointment), then use the **+** buttons between nodes to add
steps:

- **Notify another system**: sends the appointment's data to a webhook (up to 5 per flow).
- **Wait**: pauses the flow; the steps after it go out once that time has passed.

So "booked → notify the bot → wait 1 day → notify the CRM" is one flow. Click a node to set
it up in the side panel, or the trash icon on its corner to remove it. You can also start
from a template (reminder 1 hour before, new booking notice, review request) and just
paste the address of the system that receives it.

**Test** sends the event right away to every step (waits are skipped), using one of your
appointments or example data, and each node shows how its system answered (status, time,
its response and the data sent). Tests work before saving too, and never change any
appointment.

## When they run

| Trigger | Event | The flow starts |
| --- | --- | --- |
| When an appointment is booked | `appointment.created` | Right away, from the booking page, the panel or an AI agent |
| When an appointment is moved | `appointment.rescheduled` | Right away, with `previous_date` and `previous_time` |
| When an appointment is cancelled | `appointment.cancelled` | Right away |
| An appointment is coming up | `appointment.reminder` | X minutes, hours or days before it starts |
| When an appointment ends | `appointment.followup` | When it ends (add a wait step to ask for a review later) |

Only the reminder has a time of its own, because a wait can't go back in time; every other
trigger starts the moment it happens, and **wait** steps send later. Waits add up: a step
after "wait 10 minutes" and "wait 1 hour" goes out 1 hour and 10 minutes after the flow
starts (so "appointment ends → wait 1 hour → notify" asks for the review an hour after the
appointment). If the
appointment is cancelled while a step waits, it isn't sent (it shows as skipped); steps
sent right away always go out.

Reminders go out once per confirmed appointment, and only if it was booked before that
moment (an appointment booked 30 minutes ahead gets no "1 hour before" reminder). If an
appointment moves, its reminder goes out again for the new time; cancelled appointments get
none. OpenTurnly checks every 15 seconds; if the server was down when a reminder came due, it
still goes out up to 15 minutes late.

## What they send

A **Notify another system** step is set up in four parts, so it can call each system the
way that system asks:

1. **Address**: the method (`POST`, `PUT` or `PATCH`) and the URL the receiving system
   gives you. It has to be `https://`: appointments carry your customers' personal data,
   so it only crosses the internet encrypted. Plain `http://` is accepted only for
   addresses inside your own network (see below), where it never leaves the machine.
2. **Authentication** (optional), the usual ways a webhook checks who's calling:

   | Option | What OpenTurnly sends |
   | --- | --- |
   | None | Nothing extra. |
   | Basic Auth | `Authorization: Basic …` with the username and password you give. |
   | Header Auth | One header with the name and value you give, such as `Authorization: Bearer <token>` or `X-Api-Key: <key>`. |
   | JWT Auth | `Authorization: Bearer <jwt>`: a JWT signed with HS256 and your secret, new on every send and valid for 5 minutes. Claims: `iss` (`openturnly`), `event`, `delivery`, `iat`, `exp`. The receiver checks it with the same secret. |

3. **Headers** (optional): any other header the receiver needs, like an account id.
4. **Body**: built from **fields** or written as **JSON**.

"See how it's sent", at the bottom of the panel, shows the whole request with example
data, and **Test this step** sends it.

### The appointment's data

The data comes in three groups, and each piece is named by its group and its name:
`{{customer.first_name}}` is the customer's first name, and in a body built from fields
it arrives at `customer.first_name`. **Insert data**, above the message and the JSON
boxes, lists the groups (Appointment, Customer, Business); open one to see its data with
an example of each, or search them all.

| Group | Data |
| --- | --- |
| — | `event` (`appointment.created`, `appointment.reminder`…) |
| `appointment` | `code`, `status`, `date` (YYYY-MM-DD), `time`, `end_time`, `weekday`, `date_text`, `starts_at` and `ends_at` (ISO, UTC), `service`, `duration_minutes`, `professional`, `price` (a number), `price_text`, `booked_via` (`online`, `admin` or the AI agent's key name), `answers`, `previous_date`, `previous_time` |
| `customer` | `name`, `first_name`, `last_name`, `phone` (+573001234567), `phone_digits` (573001234567, as WhatsApp APIs expect), `email` |
| `business` | `name`, `phone`, `address`, `booking_page`, `time_zone` |

Dates and times are in the business's time zone.

### Body from fields

Every piece of data by default, or only the ones you pick, nested by group, plus an
optional **message** with placeholders and any **extra fields** (under Advanced):

```json
{
  "event": "appointment.reminder",
  "appointment": { "code": "5NSQL5", "time": "16:30" },
  "customer": { "first_name": "Laura", "phone_digits": "573125557788" },
  "message": "Hola Laura, tu cita de Corte clásico es a las 16:30. Código 5NSQL5."
}
```

### Body as JSON

When the receiver expects its own format, write that JSON and add the data with **Insert
data**: it goes where the cursor is or, if you haven't clicked in the box yet, as one more
property at the end. Inside quotes a piece of data goes in as text, with its quotes and
line breaks escaped; on its own it goes in as its JSON value (a number, an object or
`null`), and a whole group (`{{customer}}`) goes in as an object. For example, a WhatsApp
notification service that expects a phone, template variables and buttons:

```json
{
  "phone": "{{customer.phone_digits}}",
  "variables": { "contact_name": "{{customer.first_name}}" },
  "buttons": ["Confirmar", "Cambiar hora", ""],
  "context": "Cita de {{appointment.service}} el {{appointment.date_text}} a las {{appointment.time}}. Código {{appointment.code}}.",
  "price": {{appointment.price}}
}
```

goes out as:

```json
{
  "phone": "573125557788",
  "variables": { "contact_name": "Laura" },
  "buttons": ["Confirmar", "Cambiar hora", ""],
  "context": "Cita de Corte clásico el viernes, 23 de octubre a las 16:30. Código 5NSQL5.",
  "price": 18000
}
```

The JSON is checked before saving: it has to be valid, be an object and use only the data
above. Switching a step from fields to JSON starts the JSON from what it sent.

### Headers OpenTurnly adds

Every request is sent with `Content-Type: application/json`, and with these headers,
which your own headers and the authentication can't replace:

- `X-OpenTurnly-Event`: the event name.
- `X-OpenTurnly-Delivery`: a unique id, to ignore repeats.
- `X-OpenTurnly-Timestamp`: Unix seconds.
- `X-OpenTurnly-Signature`: `sha256=` + HMAC-SHA256 of `<timestamp>.<body>` with the
  workflow's signing secret (shown in its settings).

Checking the signature in Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function fromOpenTurnly(rawBody, headers, secret) {
  const expected = `sha256=${createHmac("sha256", secret)
    .update(`${headers["x-openturnly-timestamp"]}.${rawBody}`)
    .digest("hex")}`;
  const given = String(headers["x-openturnly-signature"] ?? "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

## How it runs

There's no cron job or extra service: a small loop inside OpenTurnly's own server wakes up
every 15 seconds. Changes to appointments queue their notices in the database right away
(each one due after the waits before it); each pass the loop also looks for appointments whose reminder or
follow-up time has arrived and queues those (once each), then sends whatever is due. The
queue lives in PostgreSQL, so nothing is lost on a restart.

## Deliveries and retries

Any 2xx answer counts as received. Otherwise (an error, a timeout after 10 seconds, or no
answer) OpenTurnly tries again after 1 minute, 5 minutes and 30 minutes, then marks it as
failed. Each step is sent and retried on its own, so one system being down doesn't hold
back the others. The workflow's settings show the latest sends. Tests carry the
`X-OpenTurnly-Test: true` header, and `"test": true` in bodies built from fields (a JSON
body is sent exactly as written). The history is kept 30 days.

## Addresses inside your network

For safety, in production workflows can't post to addresses inside the server's own
network (localhost, private IPs, other containers), so one business can't reach your
internal services. If your receiver runs next to OpenTurnly (for example in the same
Docker network), set `WEBHOOKS_ALLOW_PRIVATE=true`. Those addresses (`localhost`, a private
IP or a container's name, like `http://crm:8080/hooks`) may use plain `http://`.
