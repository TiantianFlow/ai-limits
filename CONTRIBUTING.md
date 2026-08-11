# Contributing to AI Limits

Thank you for helping improve AI Limits.

## Development setup

Use Node 24 and the pnpm version pinned in `package.json`. From the repository
root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Do not commit `.env` files, session cookies, access credentials, provider
accounts, store credentials, extension IDs, or private usage fixtures. Tests
must use synthetic data.

## Changes

- Keep provider access optional and scoped to the provider the user selects.
- Preserve the local-only data model and never persist session credentials.
- Add or update behavior-based tests before changing runtime behavior.
- Update `PRIVACY.md` and `STORE_LISTING.md` when data access,
  permissions, retention, or provider behavior changes.
- Describe unsupported provider-endpoint assumptions without claiming provider
  affiliation, endorsement, or authorization.

## Adding or changing a provider

- Add stable provider identity, display name, ordering, and optional Chrome
  access to `providers/catalog.ts`. Keep provider endpoints, response schemas,
  and normalization inside that provider's adapter directory.
- Grant exact HTTPS hosts without explicit ports. Wildcard hosts, explicit
  ports, or other overlapping host patterns require a separate
  permission-lifecycle design review before they can enter the catalog.
- Register the adapter in `providers/registry.ts`. Catalog and registry tests
  must prove that initial state, runtime commands, permissions, and UI naming
  include every provider in the same order.
- Emit a `QuotaWindow` only for a bounded allowance that can be represented by
  an honest canonical `usedRatio` from 0 through 1. Keep stable window IDs
  independent from localized or provider-controlled display labels.
- Emit point-in-time absolute or currency-denominated balances as
  `CreditBalance`. Credit balances are intentionally excluded from local
  History; do not invent a denominator merely to create a percentage graph.
- Do not persist access credentials, request-local account identifiers, or raw
  provider responses. A provider with API-key onboarding, OAuth interaction,
  multiple account/workspace scopes, or a second custom recovery flow requires
  an explicit architecture and privacy review before implementation.
- Resolve historical-series identity before supporting account or workspace
  switching. A plan label is presentation text, not a stable account boundary.
- Keep build and ZIP permission allowlists independent from the catalog. They
  are security checks that should fail when provider access expands until the
  new access has been deliberately reviewed.

## Verification

Before opening a pull request, run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:zip
```

The pull request should explain the user-visible change, privacy or permission
impact, test evidence, and any provider compatibility risk.

No public contributor route is active during pre-publication acceptance. Before
publication, the repository owner must enable and verify the planned
`https://github.com/wjcjttl/ai-limits/issues` route. Once verified, use it for
contributor questions, and never post secrets or private account data.
