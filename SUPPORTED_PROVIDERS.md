# Supported providers

English | [简体中文](SUPPORTED_PROVIDERS.zh-CN.md)

AI Limits supports six provider connections. Each provider is opt-in, and the
extension keeps normalized usage and History in the local Chrome profile.

| Provider | Connection | What AI Limits reads | Important nuance |
| --- | --- | --- | --- |
| ChatGPT | Signed-in browser session | Reported message windows and credits | Uses private web-session usage interfaces. The browser may attach ChatGPT cookies; request-local account identifiers are not persisted. |
| Claude | Signed-in browser session | General and model-specific limits plus extra usage when reported | Uses private web-session interfaces. Organization selection is request-local; a provider-supplied display label may be retained. |
| Kimi | Browser session with targeted credential recovery | Subscription total and Kimi Code limits | May read the exact legacy `kimi-auth` cookie or `localStorage.access_token`. Manual Connect or Refresh may briefly open one inactive Kimi tab so Kimi can refresh its own session. Automatic refresh never opens a tab and may defer when no usable session is available. |
| Cursor | Signed-in browser session | Cursor-model and other-model monthly limits plus on-demand spend when reported | Uses private web-session interfaces. Separate monthly model pools are kept separate when the provider reports them. |
| ElevenLabs | User-created API key | Subscription credit and voice-capacity limits | The guide recommends **User → Read**. AI Limits calls the documented subscription endpoint and stores the validated key locally; no browser session is reused. |
| New API | Instance URL plus one relay key | The selected key's granted, used, and remaining quota, or absolute usage for an unlimited key | AI Limits calls `/api/status` and the read-only `/api/usage/token/` endpoint. The request is read-only, but the relay key itself may still be capable of model calls. |

## New API connection modes

AI Limits currently implements the smallest ordinary-user mode supported by
the [New API project](https://github.com/QuantumNous/new-api):

- one New API instance;
- one relay key for that instance;
- capped-key quota or unlimited-key absolute usage; and
- manual and automatic background refresh after connection.

New API also exposes account wallet, subscription, usage-history, and admin
APIs. AI Limits does **not** use those APIs yet, does not ask for a management
personal access token, does not read admin data, and does not support multiple
New API instances in one profile.

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
origin when you submit the onboarding form.

## Compatibility boundary

ChatGPT, Claude, Kimi, and Cursor depend on private provider interfaces that may
change without notice. ElevenLabs and New API use documented endpoints, but
their response and authorization behavior can also change. AI Limits rejects
malformed or contradictory usage rather than inventing a percentage, reset, or
pace signal.

See [Privacy](PRIVACY.md) for credential storage, request destinations, and
deletion behavior.
