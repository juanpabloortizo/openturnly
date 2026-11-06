# WhatsApp messages

A workflow can message the appointment's customer on WhatsApp: a reminder the day before, a
confirmation when they book. Messages go through
[WhatsApp's Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), straight from
your server, with no service in between.

## Who sets it up

WhatsApp belongs to whoever runs the install, not to one business: it's set in **Channels**,
in the account menu, and every business sends through it. There are two ways:

- **A number in the panel.** Paste the details of your app in **Channels → WhatsApp**. Once
  WhatsApp accepts them, messages go out from that number.
- **A number in the environment.** Set it in `.env` and it's used from the first day, with
  nothing to configure. A number connected in the panel takes over from it, and removing that
  one goes back.

Saved details only take over after **Save and connect** verifies them with WhatsApp, so a
wrong token never stops messages that were already going out.

## Connect a number

In [Meta for Developers](https://developers.facebook.com/apps), with an app that has the
WhatsApp use case and a number registered on it, you need:

| Field | Where it is |
| --- | --- |
| Phone number ID | WhatsApp → API setup, or the number's page in WhatsApp Manager |
| WhatsApp Business Account ID | The same page. Needed to see and create templates |
| Permanent access token | Business settings → System users. Give it `whatsapp_business_messaging` and `whatsapp_business_management`, and access to the app, the WhatsApp account and the messaging account |
| App secret | App settings → Basic |

The token and the app secret are stored encrypted with the install's `SECRET` and never come
back to the browser. If you change `SECRET` they can't be read anymore and have to be pasted
again.

## Webhook

Sending works without it. With it, the workflow's history shows whether each message was
delivered or read, and a message WhatsApp couldn't deliver shows as failed with the reason.

**Channels → WhatsApp** shows the callback URL and the verify token of the connected number.
Paste them into the app, under WhatsApp → Configuration, and subscribe to the `messages`
field. Each call is checked against the app secret, and anything about another number is
ignored. Meta only sends real events once the app is published.

The number in the environment has its own address, `/api/public/whatsapp/webhook`, with the
`WHATSAPP_VERIFY_TOKEN` you chose.

## Templates

WhatsApp only delivers a message a business starts if it uses a template it has approved. A
step picks one, and fills each variable with the appointment's data, using the same
placeholders as webhooks (`{{customer.first_name}}`). Named variables and numbered ones both
work, as long as they're in the text alone.

**Create appointment templates** in **Channels → WhatsApp** sends a confirmation, a reminder,
a rescheduling notice and a cancellation notice for review, in Spanish and English. Approval usually takes minutes. On a number from the
environment, templates are managed outside the panel.

Empty values are sent as `-`, because WhatsApp refuses them, and line breaks become spaces.

## Testing

A test in a workflow only goes to a real appointment you choose, never to the example data:
the message is real, and that example number could be somebody's. To try a number without an
appointment, use **Send test** in **Channels → WhatsApp**.

## How sending behaves

Messages go through the same queue as webhooks, with the same history. WhatsApp's limits and
temporary failures are retried after 1, 5 and 30 minutes. Anything retrying can't fix, like a
template that doesn't exist or a number that isn't on WhatsApp, fails at once. A customer
without a phone number, or an install without a connected number, shows as failed with the
reason.

## Settings

Set these in `.env` for a number in the environment:

| Variable | What it is |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | The number's ID. With the token, it turns this number on |
| `WHATSAPP_ACCESS_TOKEN` | The permanent token |
| `WHATSAPP_WABA_ID` | The WhatsApp Business Account ID, to list its templates |
| `WHATSAPP_APP_SECRET` | The app secret, to check the webhook's calls |
| `WHATSAPP_VERIFY_TOKEN` | Any text you choose, to paste in the app next to the callback URL |
| `WHATSAPP_CALLBACK_TAG` | Optional. Sent with each message and returned in its updates, so several installs sharing a number can tell theirs apart |
