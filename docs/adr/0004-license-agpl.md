# 4. AGPL-3.0 license and DCO sign-off

- Status: superseded by [ADR 6](0006-license-mit.md)
- Date: 2026-10-20

## Context

OpenTurnly exists to be a free, self-owned alternative to closed booking platforms. Under a
permissive license (MIT), anyone could turn it into a closed hosted service without giving
anything back — exactly the kind of product OpenTurnly wants to be an alternative to.

## Decision

- License the project under **AGPL-3.0-only**.
- Accept contributions under the **Developer Certificate of Origin** (`git commit -s`)
  instead of a Contributor License Agreement.

## Consequences

- Businesses, freelancers and agencies can use, modify and host OpenTurnly, even charging for
  hosting. If they run a modified version for others, they must publish their changes.
- Some companies avoid AGPL software as a policy; that audience is not OpenTurnly's focus.
- Without a CLA, the project cannot be relicensed later without contributors' consent.
  That is intentional: the code stays open.
