# Security Policy

## Supported version

Security fixes are made against the current source and latest 0.1.x release.
Older development builds may not receive separate fixes.

## Report a vulnerability

Never include session cookies, access credentials, private usage data, or
account-identifying screenshots in a public report.

For a non-sensitive security concern, open a
[GitHub Issue](https://github.com/wjcjttl/ai-limits/issues). If a report would
expose sensitive details, first check whether the repository's **Security** tab
offers private vulnerability reporting. If it does not, open a minimal issue
requesting a private contact route without disclosing the vulnerability.

Include the affected version, browser version, expected behavior, actual
behavior, and a minimal reproduction that contains no real credentials.

## Security boundary

AI Limits runs inside the user's Chrome profile and uses optional access to
signed-in provider origins. It stores normalized usage locally and does not
operate a remote backend. Provider endpoints are private and unsupported, so a
provider response or security flow can change without notice. Reports about a
provider's own service should be sent to that provider rather than this
project.
