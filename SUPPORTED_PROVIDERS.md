# Supported providers

English | [简体中文](SUPPORTED_PROVIDERS.zh-CN.md)

AI Limits supports twenty provider connections. Each provider is opt-in, and the
extension keeps normalized usage and History in the local Chrome profile.

The provenance tier describes schema evidence, not current availability:
**OBSERVED** means the wire fields are backed by a captured provider payload or
an observed upstream response fixture; **INFERRED** means the shape is derived
from documented or client contracts and still needs live-capture confirmation.

Balance presentation is explicit by provider:

- **Balance-primary** — Mistral, sub2api, DeepSeek, Moonshot, DeepInfra, OpenAI,
  and OpenRouter. A reported zero balance remains visible.
- **Pool-primary** — ChatGPT, Claude, Cursor, Grok, Perplexity, and ElevenLabs.
  A zero auxiliary/extra-credit balance is hidden because the plan or pool is
  the primary signal.
- **No balance metric** — Kimi, New API, LiteLLM, ClawRouter, LLM Proxy,
  Fireworks, and GroqCloud. Their current contracts report quotas or counters.

| Provider | Connection | What AI Limits reads | Provenance | Important nuance |
| --- | --- | --- | --- | --- |
| ChatGPT | Signed-in browser session | Reported message windows and credits | **OBSERVED** | Uses private web-session usage interfaces. The browser may attach ChatGPT cookies; request-local account identifiers are not persisted. |
| Claude | Signed-in browser session | General and model-specific limits plus extra usage when reported | **OBSERVED** | Uses private web-session interfaces. Organization selection is request-local; a provider-supplied display label may be retained. |
| Kimi | Browser session with targeted credential recovery | Subscription total and Kimi Code limits | **OBSERVED** | May read the exact legacy `kimi-auth` cookie or `localStorage.access_token`. Manual Connect or Refresh may briefly open one inactive Kimi tab so Kimi can refresh its own session. Automatic refresh never opens a tab and may defer when no usable session is available. |
| Cursor | Signed-in browser session plus manual page enrichment | Cursor-model and other-model monthly limits, Grok Bot weekly usage, and on-demand/extra-credit data when reported | **OBSERVED** | Base usage refreshes in the background. Connect or manual Refresh can request Grok Bot and extra-credit JSON through one already-open `cursor.com` tab, or by briefly opening one inactive spending tab when none is open. Chrome attaches signed-in Cursor cookies to those fixed same-origin requests, but AI Limits does not inspect cookie values directly. It never activates a Cursor tab and closes only the tab it created. Automatic refresh never opens or injects. Last-good page values stay visible until Grok Bot's weekly reset, and the card explains when they could not be refreshed. |
| Grok | Signed-in browser session | Weekly or monthly usage pool as the subscription limit, with Grok Build and Chat composition when those buckets account for the whole pool, plus the SuperGrok-family plan label | **OBSERVED** | Uses private web-session usage interfaces on `grok.com`. Short-window per-mode rate-limit responses are not rendered. The browser may attach Grok cookies; account identifiers and raw subscription payloads are not persisted. This is consumer Grok, not Cursor's Grok Bot. |
| Mistral | Signed-in browser session | Month-to-date spend, token totals, and available credits | **INFERRED** | Chrome attaches same-origin cookies, but cannot expose the CSRF cookie value needed to construct `X-CSRFTOKEN`; live testing must confirm the service accepts the request without that header. |
| Perplexity | Signed-in browser session | Recurring, purchased, and promotional credit pools plus plan inference | **INFERRED** | Uses a private billing endpoint and Chrome-attached same-origin cookies. Grant expiry and waterfall attribution follow the inferred wire contract. |
| ElevenLabs | User-created API key | Subscription credit and voice-capacity limits | **OBSERVED** | The guide recommends **User → Read**. AI Limits calls the documented subscription endpoint and stores the validated key locally; no browser session is reused. |
| New API | One instance URL, label, and relay key per connection; multiple connections supported | Each key's granted, used, and remaining quota, or absolute usage for an unlimited key | **OBSERVED** | AI Limits calls `/api/status` and the read-only `/api/usage/token/` endpoint. The request is read-only, but each relay key may still be capable of model calls. |
| LiteLLM | One instance URL, label, and virtual key per connection; multiple connections supported | Key spend from `/key/info`, plus a budget quota when the key response includes `max_budget` | **OBSERVED** | AI Limits calls only the read-only `/key/info` endpoint. It does not follow up with `/user/info` or `/team/info`, so team/user budget windows that exist only on those endpoints are omitted. |
| ClawRouter | One instance URL, label, and policy key per connection; multiple connections supported. Defaults to `https://clawrouter.openclaw.ai` | Monthly remaining budget when the policy is metered, otherwise this-month actual cost | **INFERRED** | AI Limits calls the read-only `/v1/usage` endpoint. Micros fields are converted from integer micro-dollars to USD. |
| sub2api | One instance URL, label, and group key per connection; multiple connections supported | Capped-key quota, daily/weekly/monthly subscription windows, wallet balance, and optional 5h/1d/7d rate limits | **INFERRED** | AI Limits calls the read-only `/v1/usage?days=30&timezone=UTC` endpoint. HTTPS is required except for localhost development. |
| LLM Proxy | One instance URL, label, and API key per connection; multiple connections supported | Lowest remaining credential quota percent, or request/token counters when no remaining percent is reported | **OBSERVED** | AI Limits calls the read-only `/v1/quota-stats` endpoint. |
| DeepSeek | User-created API key | Available account balance in the provider-reported currency | **INFERRED** | AI Limits calls the read-only `https://api.deepseek.com/user/balance` endpoint and selects one provider-reported balance row without inventing a conversion. |
| Moonshot | User-created API key | Available international-platform balance in USD | **INFERRED** | AI Limits calls the read-only `https://api.moonshot.ai/v1/users/me/balance` endpoint. This is the Moonshot developer platform, distinct from Kimi Code usage. |
| DeepInfra | User-created API key | Current-month spend against a spending limit, or account balance when no limit is reported | **INFERRED** | AI Limits calls the read-only payment checklist and current-usage endpoints at `api.deepinfra.com`. |
| Fireworks | User-created API key | Rated spend over the last 30 days for a single accessible account | **INFERRED** | AI Limits reads the account list and billing summary at `api.fireworks.ai`. Accounts with zero or multiple selectable account slugs require an account picker and are not supported yet. |
| OpenAI | User-created API key | Organization costs, completion request/token totals, or legacy available credits | **INFERRED** | This is the Platform organization and developer billing API, not the ChatGPT consumer session. Organization usage is tried first. Without a project scope, a failed organization request falls back to legacy credit grants; organization/admin scope may be required. |
| GroqCloud | User-created API key | Five-minute Prometheus request, token, and cache-hit rates | **INFERRED** | Standard Groq keys return 404 on the Prometheus surface and are reported as requiring broader credential scope. |
| OpenRouter | User-created API key | Credit balance and optional API-key budget | **INFERRED** | Reads `/credits` and `/key`; key-budget enrichment appears only when the service reports a usable limit. |

## New API connection modes

AI Limits implements the ordinary-user relay-key mode supported by the
[New API project](https://github.com/QuantumNous/new-api):

- multiple independently configured New API instances;
- one normalized base URL, optional label, and relay key per instance;
- capped-key quota or unlimited-key absolute usage; and
- manual and automatic background refresh after connection.

New API supports multiple independent instances. Each configured instance has
its own normalized base URL, label, relay key, usage, History, refresh state,
replacement, rejection, and deletion lifecycle. Same-origin instances share
only Chrome's browser-global origin grant; credentials, labels, usage state,
and History remain independent.

New API also exposes account wallet, subscription, usage-history, and admin
APIs. AI Limits does **not** use those APIs yet, does not ask for a management
personal access token, and does not read admin data or other relay keys.

### Accepted New API URLs

Paste the site homepage, dashboard URL, or a familiar API URL. AI Limits
normalizes known suffixes before validating the instance. For example, all of
these point to the same root:

```text
https://new-api.example.com
https://new-api.example.com/console
https://new-api.example.com/v1
https://new-api.example.com/v1/messages
https://new-api.example.com/api/usage/token/
```

Subpath deployments are preserved: `https://example.com/new-api/v1/messages`
becomes `https://example.com/new-api`. Query strings and fragments are
discarded. HTTPS is required except for `http://localhost` and
`http://127.0.0.1` development instances.

The manifest declares optional dynamic-host capability because New API can be
self-hosted anywhere. Chrome is asked for only the exact normalized instance
origin when you submit the onboarding form. Disconnecting one same-origin
instance preserves that shared grant while another active instance owns it;
disconnecting the final owner removes the grant best-effort after local data is
deleted. External grant removal marks every affected instance as requiring
permission but retains nonsecret configuration, normalized usage, refresh
status, and History until reconnect or explicit disconnect/delete.

Successful quota, counter/spend, and balance observations are retained per
instance under the common 48-hour raw, hourly compaction, 30-day, and 1,024
observation policy. History graphs quota metrics only. History contains no
credential or raw provider response.

## Compatibility boundary

ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, and Perplexity depend on private
provider interfaces that may change without notice. The API-key providers use
documented or reverse-engineered HTTP endpoints, but their response and
authorization behavior can also change. AI Limits rejects malformed or
contradictory usage rather than inventing a percentage, reset, or pace signal.

See [Privacy](PRIVACY.md) for credential storage, request destinations, and
deletion behavior.
