# 3. Many businesses per install, owner created on first run

- Status: accepted
- Date: 2026-10-20

## Context

Most service businesses will not run a server themselves. A common case is one person
(a freelancer, an agency, a tech-savvy friend) hosting OpenTurnly for several businesses.
Adding multi-business support later would mean migrating every table.

## Decision

- Every business-owned table has a `business_id` from day one.
- First run shows a single screen: create the **owner** account. After that, setup is closed.
- Public sign-up is disabled. The owner creates businesses without limit and gives each
  business's people access through invitation links.
- Each business has a unique slug and its public booking page at `/<slug>`.

## Consequences

- One domain serves every business on the install.
- Members are isolated: they only see businesses they belong to, and other businesses
  return 404.
- Until the owner account is created, anyone who reaches the install can claim it, so the
  docs tell people to complete setup right after installing.
