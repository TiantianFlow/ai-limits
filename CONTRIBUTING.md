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
- Preserve the local-only data model and never persist browser-session
  credentials.
- Add or update behavior-based tests before changing runtime behavior.
- Update `PRIVACY.md` and the Chrome Web Store listing packs
  (`store-assets/chrome-web-store/listing-en.md` and
  `listing-zh_CN.md`) when data access, permissions, retention, or
  provider behavior changes.
- Describe unsupported provider-endpoint assumptions without claiming provider
  affiliation, endorsement, or authorization.

## Adding or changing a provider

Every provider is one `ProviderPackage`, registered exhaustively in
`providers/registry.ts`. The package owns cardinality, nonsecret configuration
normalization, exact permission requirements, and collection. Public
presentation stays separate in the presentation catalog. Generic browser-session
and API-key connection drivers remain central and are selected from the
package's credential and configuration metadata. Central orchestration,
storage, permission ownership, connection lifecycles, and History stay
provider-agnostic; adding a provider must not require a provider-kind branch in
those central modules.

A package must define and own:

- a stable `ProviderKind` and `single` or `multiple` cardinality;
- credential and configuration metadata that select the central generic
  connection driver;
- strict normalization of all nonsecret instance configuration;
- exact Chrome origins and API permissions derived from that normalized
  configuration;
- provider-specific validation or recovery needed by its collection path, and
  its collection behavior; and
- adapter normalization into metrics with stable IDs.

User-facing names, descriptions, and connection guidance belong in the
separate public presentation catalog, not in `ProviderPackage`. The central
generic drivers own credential-vault and browser-session connection
lifecycles; a package declares the metadata and behavior those drivers use.

Keep provider endpoints, response schemas, and response normalization inside
the provider directory. Grant exact HTTPS hosts without explicit ports.
Wildcard hosts, explicit ports, overlapping patterns, OAuth interaction, new
account/workspace switching, or a custom recovery flow requires an explicit
permission, identity, and privacy review.

Metric meaning must be explicit:

- `quota` is a bounded allowance with an honest canonical `usedRatio` from 0
  through 1 and may include absolute used/limit values and cycle timing;
- `counter` is cumulative `consumed` or `spent` usage with a value and unit;
  an optional limit does not turn it into a quota; and
- `balance` is a remaining amount with a value and unit; do not invent a
  denominator or reinterpret it as consumption.

Stable metric IDs identify History series within one provider instance. Keep
them independent from localized or provider-controlled labels. Successful
quota, counter/spend, and balance observations may be retained; History graphs
select quota metrics only.

Do not persist browser-session credentials, request-local account identifiers,
or raw provider responses. A reviewed API-key package keeps one key per instance
in the dedicated trusted-context credential vault, outside application state
and History, and binds it to the matching configuration revision. Same-origin
instances may share a Chrome grant but must never share credentials or state.

Provider work must add or update behavior tests at every owned boundary:

- adapter schema and normalization tests, including malformed responses and
  exact quota/counter/balance semantics;
- package tests for cardinality, config acceptance/rejection, exact permission
  derivation, credential mode, driver behavior, and collection delegation;
- exhaustive registry/catalog tests;
- History retention and quota-graph selection tests for each new metric shape;
- permission ownership, connect/replace/reject/disconnect, restart, and
  instance-isolation tests appropriate to the connection mode;
- released-state migration tests when a durable schema changes; and
- publication, privacy, built-bundle, store-asset, and ZIP allowlist tests when
  access, data handling, copy, or packaging changes.

Keep build and ZIP permission allowlists independent from package definitions.
They are release security gates and must fail on any access expansion until the
new surface is deliberately reviewed.

## Verification

Before opening a pull request, run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:zip
```

The pull request should explain the user-visible change, privacy or permission
impact, test evidence, and any provider compatibility risk.

Use [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for
contributor questions. Never post secrets or private account data.
