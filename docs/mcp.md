# Connecting AI agents (MCP)

Every business in OpenTurnly has its own [MCP](https://modelcontextprotocol.io) server, so an
AI agent can answer questions about the business and book appointments for it: a WhatsApp
bot, Claude, an automation, or any other MCP client.

## Connect

1. In the business, open **Settings → Integrations (MCP)** and create a key:
   - **Booking agent**, for bots that talk to customers.
   - **Administration**, for the business's own assistant.
2. Copy the key: it is shown only once.
3. In the MCP client, add a Streamable HTTP server:
   - URL: `https://your-domain/<slug>/mcp`
   - Header: `Authorization: Bearer ot_…`

For clients configured with JSON (Claude Code, Cursor…), the same screen gives a ready
block:

```json
{
  "mcpServers": {
    "my-business": {
      "type": "http",
      "url": "https://your-domain/my-business/mcp",
      "headers": { "Authorization": "Bearer ot_…" }
    }
  }
}
```

Create one key per agent, so any of them can be revoked without touching the others.
Appointments an agent books show "AI agent · <key name>" in the calendar.

## Tools

Dates are `YYYY-MM-DD` and times `HH:MM`, in the business's time zone. Prices are in the
business's currency, in its main unit.

| Tool | Booking agent | Administration |
| --- | :-: | :-: |
| `get_business_info`: contact, locations and their hours, closures, holidays, rules, what a booking needs | ✓ | ✓ |
| `list_services`, `list_professionals` | ✓ | ✓ (also inactive ones) |
| `find_available_times`, `find_next_available` | ✓ customers' rules | ✓ business rules |
| `book_appointment` | ✓ | ✓ (also existing customers) |
| `find_appointment`: by booking code + phone or email | ✓ | |
| `get_appointment`: by booking code | | ✓ |
| `reschedule_appointment`, `cancel_appointment` | ✓ with code + phone or email, within the business's limit | ✓ |
| `get_agenda`, `get_summary` | | ✓ |
| `search_customers`, `get_customer`, `create_customer`, `update_customer` | | ✓ |
| `create_service`, `update_service`, `create_professional`, `update_professional` | | ✓ |
| `get_opening_hours`, `set_opening_hours` | | ✓ |
| `list_closures`, `add_closure`, `remove_closure`, `list_holidays`, `set_holiday` | | ✓ |
| `update_business_details`: name, description, phone, email, address | | ✓ |
| `update_booking_rules` | | ✓ |

A business with several locations needs a `location_id` (from `get_business_info`) to find
free times and to book; agents should ask the customer which location they want. With one
location it can be left out. Hours and closures tools take an optional `location_id` too.

How close to an appointment customers can still move or cancel it is set in **Opening
hours → Online booking → Customer changes** (2 hours by default, or "only the business").

## Limits and security

- Each key works only at its own business's address.
- A booking agent never sees the customer list or other people's appointments: changes need
  the booking code and the phone or email used to book.
- Keys skip the booking page's anti-bot puzzle (they are trusted like the business), but
  per-customer limits and booking rules still apply. Each key can make 240 requests per
  minute.
- The same admin key also works with OpenTurnly's HTTP API under `/api/businesses/<id>/…`.
