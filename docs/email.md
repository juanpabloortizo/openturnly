# Email messages

A workflow can email the appointment's customer: a confirmation when they book, a reminder the
day before. Emails go straight from your server to your provider over SMTP, so any provider
works, with no service in between.

## Who sets it up

Email belongs to whoever runs the install, not to one business: it's set in **Channels**, in
the account menu, and every business sends through it. There are two ways:

- **An account in the panel.** In **Channels → Email**, choose your provider and paste its
  details. Once the server accepts the login, emails go out from that account, and you can
  reword each message in the workflow.
- **An account in the environment.** Set it in `.env` and it's used from the first day. It only
  sends the ready-made texts: when an install shares one account between clients, its
  reputation is everybody's. An account connected in the panel takes over from it, and removing
  that one goes back.

Emails carry the business's name as the sender, and answers go to the business's email.

## Providers

Choosing a provider fills in its server, and those that log in with a fixed user fill that in
too. Choose **Other** for any other server. The sender address has to be on a domain verified
with your provider, or it will refuse the email or it will land in spam.

Only public servers on mail ports (465, 587, 2465 and 2587) are accepted, over an encrypted
connection. The password is stored encrypted with the install's `SECRET` and never comes back
to the browser. If you change `SECRET` it can't be read anymore and has to be pasted again.

## The messages

**Send email** in a workflow has four ready-made texts: a confirmation, a reminder, a
rescheduling notice and a cancellation notice, in Spanish and English. They use the same
placeholders as webhooks (`{{customer.first_name}}`). A line whose data is missing is left out,
so an email never says "Address:" and nothing after it.

## Testing

A test in a workflow only goes to a real appointment you choose, never to the example data: the
email is real, and that example address could be somebody's. To try the account without an
appointment, use **Test the email** in **Channels → Email**.

## How sending behaves

Emails go through the same queue as webhooks, with the same history. Passing failures are
retried after 1, 5 and 30 minutes. A final no from the server fails at once. A customer without
an email, or an install without a connected account, shows as failed with the reason.

## Settings

Set these in `.env` for an account in the environment:

| Variable | What it is |
| --- | --- |
| `SMTP_HOST` | The server. With the next three, it turns this account on |
| `SMTP_USER` | The user |
| `SMTP_PASSWORD` | The password or API key |
| `EMAIL_FROM` | The sender address |
| `SMTP_PORT` | The port. 587 unless you say otherwise |
| `EMAIL_FOOTER` | Optional. A last line for every email |
