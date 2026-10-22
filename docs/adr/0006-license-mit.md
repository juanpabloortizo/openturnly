# 6. MIT license

- Status: accepted (supersedes [ADR 4](0004-license-agpl.md))
- Date: 2026-10-22

## Context

ADR 4 chose AGPL-3.0 so that nobody could turn OpenTurnly into a closed hosted service. Before
the first release we weighed that against what the project is: a small, focused booking tool
for service businesses. Its value is in being easy to install, adapt and build on, and the
AGPL's obligations would keep away exactly the agencies, freelancers and small companies most
likely to use and improve it.

## Decision

- License the project under the **MIT license**.
- Contributions are accepted under the same license (inbound = outbound), with no Contributor
  License Agreement.

## Consequences

- Anyone can use, modify, host and sell OpenTurnly, including as a closed product, as long
  as they keep the copyright and license notice.
- Changes made by others don't have to be shared back. We accept that in exchange for the
  widest possible use.
