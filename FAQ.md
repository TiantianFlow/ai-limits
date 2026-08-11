# AI Limits FAQ

English | [简体中文](FAQ.zh-CN.md)

## Does History update after manual refresh, automatic refresh, or both?

Both. A successful **Connect**, provider **Refresh**, header refresh button, or
scheduled automatic refresh adds one normalized quota observation containing
the quota windows returned by that provider.

Failed, deferred, skipped, superseded, or malformed refreshes do not add a
history observation. They also do not insert a zero or copy the last value
forward.

## Does automatic refresh require the side panel to stay open?

No. AI Limits uses a Chrome alarm and its Manifest V3 background service worker,
so closing the side panel does not stop scheduled refreshes. When you reopen the
panel, it reads the latest data from local extension storage.

## What must be true for automatic refresh to run?

- **Automatic refresh** must remain enabled in **Settings**.
- At least one provider must remain connected. AI Limits removes the alarm when
  no providers are connected.
- Chrome must still have that provider's optional permission.
- The provider's signed-in browser session must still be usable.
- Chrome must be running and able to run background extensions.

The alarm runs approximately every 15 minutes. Chrome scheduling, device sleep,
provider backoff, and network conditions can delay a refresh, so this is not an
exact sampling interval.

## What happens while Chrome is closed or the computer is asleep?

AI Limits cannot refresh while Chrome is fully closed or the device is asleep.
Chrome may deliver a delayed alarm after it resumes. AI Limits also checks and
recreates its refresh alarm when the extension worker or Chrome starts, but it
does not reconstruct observations for intervals that were missed.

## If manual refresh works, should automatic refresh also work?

Usually for ChatGPT, Claude, and Cursor, as long as their permission and browser
session remain valid. However, manual refresh bypasses scheduled backoff, while
automatic refresh respects it. Kimi manual refresh may additionally perform
interactive session recovery. A manual success therefore cannot guarantee every
later scheduled refresh.

Kimi has an additional limitation described below.

## Why can Kimi refresh manually but not automatically?

Kimi's scheduled refresh deliberately never opens a tab. It can use the legacy
Kimi cookie or read an `access_token` from an already-open Kimi page. If neither
is available, automatic refresh defers until a later refresh, preserves the last
good data, and adds no history observation.

A manual **Connect** or **Refresh** is interactive and may briefly open an
inactive Kimi homepage tab to let Kimi refresh its own session. This difference
means manual Kimi refresh can work when scheduled refresh cannot.

## Does automatic refresh open provider tabs?

No. Scheduled refresh is non-interactive and never creates provider tabs. Only
an interactive Kimi **Connect** or **Refresh** may briefly create an inactive
Kimi tab for session recovery.

## What does History store, and for how long?

History stores successful normalized quota observations only. It does not store
credit-balance history, raw provider responses, credentials, or reconstructed
provider history. Failed, deferred, skipped, or malformed refreshes do not add
History observations; AI Limits separately stores only the latest sanitized
refresh status.

Observations are retained locally for up to 30 days, subject to a
1,024-observation safety cap for each provider. Within that cap, observations
from the newest 48 hours stay at collection resolution; older retained history
keeps the latest observation in each UTC hour. Disconnecting a provider,
revoking its permission, or deleting all local data removes its history.

## Why does the graph say it needs another successful refresh?

A line needs at least two observations for the selected quota window. On upgrade,
AI Limits may preserve the current valid snapshot as the first observation at
its original fetch time. One more successful refresh that includes the selected
quota window gives the graph a second point.

## Why are there gaps or separate segments in a graph?

AI Limits does not draw a continuous line across a missing quota window, a gap
longer than 90 minutes, or a changed reset boundary. This avoids presenting a
provider reset or a failed refresh as consumption. A window that disappears
from the provider's current response is not selectable until it returns.

## Does switching between Used and Left change stored History?

No. AI Limits stores one canonical used ratio. **Used** displays that ratio;
**Left** displays its complement. The preference changes presentation only, not
the stored observation.

## What should I do before switching provider accounts?

Disconnect that provider in AI Limits before changing accounts. History is
scoped to the provider and quota-window identifier, not a persistent provider
account identifier. Disconnecting clears the old provider history and prevents
same-plan accounts from being combined.

For data handling details, see [Privacy](PRIVACY.md). To report a problem, use
[GitHub Issues](https://github.com/wjcjttl/ai-limits/issues) without including
cookies, credentials, private usage data, or other secrets.
