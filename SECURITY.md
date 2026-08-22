# Security Policy

## Supported version

Security fixes are made against the current source and latest 0.4.x release.
Older development builds may not receive separate fixes.

## Report a vulnerability

Never include session cookies, access credentials, private usage data, or
account-identifying screenshots in a public report.

Use [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for ordinary,
non-sensitive security concerns. If GitHub private vulnerability reporting is
available in the repository's **Security** tab, use it for sensitive reports.
If that feature is unavailable, open a minimal issue requesting a private
contact route without disclosing the vulnerability or sensitive details.

Include the affected version, browser version, expected behavior, actual
behavior, and a minimal reproduction that contains no real credentials.

## Security boundary

AI Limits runs inside the user's Chrome profile and uses optional access to
signed-in provider origins or, for API-key providers, the selected API origin.
It stores normalized usage locally and does not operate a remote backend.
Browser-session credentials are request-local. Successfully validated
ElevenLabs and New API keys are stored separately in chrome.storage.local after
that storage area is restricted to trusted extension contexts. Each key is sent
only to its selected provider API. Every New API instance has its own credential
binding; same-origin instances share only Chrome's browser-global host grant,
not keys, labels, usage, or History. Background command responses and
application state never include saved API keys, and AI Limits does not render
them or copy them into reports, logs, or History.

Cursor Connect or manual Refresh may use `chrome.scripting` to run a bundled
function in the main JavaScript world of one already-open exact-origin Cursor
page, or of one inactive spending tab created for that attempt. Main-world
code can be observed or interfered with by the provider page,
so the returned dashboard JSON is treated as untrusted and must pass the same
extension-context schemas and semantic validation as any provider response.
The function verifies `https://cursor.com`, uses only two fixed `{}`-body POST
requests, and does not inspect rendered content, browser storage, or cookie
values directly. Chrome attaches signed-in Cursor cookies to those same-origin
requests. Scheduled refresh never injects into a Cursor page, and no raw
dashboard JSON is persisted.

Chrome's trusted extension contexts include the background worker and the side
panel. The side-panel code does not request or read the credential record, but
Chrome storage change events can expose local change objects to trusted
extension contexts even when the current listener ignores that record. The
release check verifies that built side-panel assets do not contain the
credential-storage record name, trusted-context setup constant, request header,
or subscription endpoint. This is a code-ownership check, not cryptographic
isolation.

This local boundary is not OS-keychain encryption. Someone with access to the
unlocked Chrome profile, extension DevTools, or local profile files may be able
to inspect saved keys. Per-instance History contains normalized quota,
counter/spend, and balance observations, never credentials or raw responses;
version 0.3.0 graphs quota metrics only. Browser-session provider endpoints are private and
unsupported; ElevenLabs uses a documented endpoint, but provider responses,
authorization behavior, and security flows can still change without notice.
Reports about a provider's own service should be sent to that provider rather
than this project.
