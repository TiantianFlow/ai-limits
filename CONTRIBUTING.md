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
- Update `PRIVACY.md` and `docs/store-listing.md` when data access,
  permissions, retention, or provider behavior changes.
- Describe unsupported provider-endpoint assumptions without claiming provider
  affiliation, endorsement, or authorization.

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
