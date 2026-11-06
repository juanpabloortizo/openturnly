# WhatsApp messages

A workflow can message the appointment's customer on WhatsApp: a reminder the day before, a
confirmation when they book. Messages go through
[WhatsApp's Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), straight from
your server, with no service in between.

## Two ways to send

- **The install's number.** Whoever runs the install sets one number in the environment, and
  every business uses it from the first day, with nothing to configure.
- **A business's own number.** In **Settings → WhatsApp**, a business pastes the details of
  its own app. Once WhatsApp accepts them, its messages go out from that number. Removing it
  goes back to the install's number.

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

**Settings → WhatsApp** shows the callback URL and the verify token of the business's number.
Paste them into the app, under WhatsApp → Configuration, and subscribe to the `messages`
field. Each call is checked against the app secret, and anything about another number is
ignored. Meta only sends real events once the app is published.

The install's number has one address, `/api/public/whatsapp/webhook`, with the
`WHATSAPP_VERIFY_TOKEN` you chose.

## Templates

WhatsApp only delivers a message a business starts if it uses a template it has approved. A
step picks one, and fills each variable with the appointment's data, using the same
placeholders as webhooks (`{{customer.first_name}}`). Named variables and numbered ones both
work, as long as they're in the text alone.

**Create appointment templates** in **Settings → WhatsApp** sends a confirmation, a reminder,
a rescheduling notice and a cancellation notice for review, in Spanish and English. Approval usually takes minutes. Businesses
on the install's number use the templates of that account: only whoever runs the install can
create them.

Empty values are sent as `-`, because WhatsApp refuses them, and line breaks become spaces.

## Testing

A test in a workflow only goes to a real appointment you choose, never to the example data:
the message is real, and that example number could be somebody's. To try a number without an
appointment, use **Send test** in **Settings → WhatsApp**.

## How sending behaves

Messages go through the same queue as webhooks, with the same history. WhatsApp's limits and
temporary failures are retried after 1, 5 and 30 minutes. Anything retrying can't fix, like a
template that doesn't exist or a number that isn't on WhatsApp, fails at once. A customer
without a phone number, or a business without a connected number, shows as failed with the
reason.

## Settings

Set these in `.env` for the install's number:

| Variable | What it is |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | The number's ID. With the token, it turns the install's number on |
| `WHATSAPP_ACCESS_TOKEN` | The permanent token |
| `WHATSAPP_WABA_ID` | The WhatsApp Business Account ID, to list its templates |
| `WHATSAPP_APP_SECRET` | The app secret, to check the webhook's calls |
| `WHATSAPP_VERIFY_TOKEN` | Any text you choose, to paste in the app next to the callback URL |
| `WHATSAPP_CALLBACK_TAG` | Optional. Sent with each message and returned in its updates, so several installs sharing a number can tell theirs apart |
