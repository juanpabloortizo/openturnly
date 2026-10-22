# Security policy

OpenTurnly stores personal data (names, emails, phone numbers) for the businesses that use it,
so we take security reports seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
go to the repository's **Security** tab and choose **Report a vulnerability**.

Include the version (or commit), how to reproduce the issue and what an attacker could do.
We will acknowledge your report within a few days and keep you updated until it is fixed.
We are happy to credit you in the release notes.

## Supported versions

Security fixes go into the latest release of the current major version (for example
`1.4.2` → `1.4.3`). Update to it to stay protected; see the
[self-hosting guide](docs/self-hosting.md) for how.

## What is built in

- **Database**: every query goes through Drizzle with its values sent as parameters, never
  pasted into SQL, so input can't change a query.
- **Sign-in**: passwords are hashed with scrypt and need at least 10 characters. Sign-in
  attempts are limited per network (3 every 10 seconds in production), and changing your
  email or password in "My account" waits 15 minutes after 5 wrong current passwords.
- **Sessions**: the session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when
  `APP_URL` uses `https`. Changes made with it are refused unless they come from the
  install's own pages (`APP_URL`), so other sites can't act for someone signed in.
- **Access**: every business route checks that the person belongs to that business and what
  their role allows; records are always looked up within the business.
- **AI agent keys** are stored hashed and shown once. **Webhooks** are signed, go out only
  over `https` and can't reach the server's own network unless you allow it.
- **Bookings** are guarded against bots and floods without third-party services: a
  proof-of-work puzzle, limits per network, phone and email, and a surge brake.
