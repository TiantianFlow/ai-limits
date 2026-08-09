# Chrome Web Store artwork

These assets are generated from AI Limits' production `Cockpit` component,
production side-panel CSS, and `createFixtureState(now)`. The surrounding copy
and browser frame exist only to present that real interface at Chrome Web Store
sizes.

## Inventory and upload order

1. `chrome-web-store/screenshot-overview-1280x800.png` — primary product
   overview screenshot, 1280×800.
2. `chrome-web-store/screenshot-pacing-1280x800.png` — quota, timing, and pace
   screenshot, 1280×800.
3. `chrome-web-store/screenshot-privacy-1280x800.png` — Settings and local-data
   controls screenshot, 1280×800.
4. `chrome-web-store/small-promo-440x280.png` — small promotional tile,
   440×280.

Upload the three screenshots in the listed order. Upload the final file to the
Chrome Web Store's small promotional tile slot.

## Regenerate and verify

Use Node 24 and the Corepack-managed pnpm version pinned in `package.json`:

```bash
pnpm assets:store
pnpm verify:store-assets
```

The capture script uses the standard macOS Google Chrome executable. To use a
different local Chrome executable, set its path for the command:

```bash
AI_LIMITS_CHROME_PATH=/absolute/path/to/chrome pnpm assets:store
```

The preview uses the fixed instant `2026-08-09T14:00:00.000Z`, forces light
mode, `en-US`, `America/Toronto`, and a device scale factor of 1, and creates a
fresh browser context without a user profile. The pacing image scrolls only the
side-panel frame. The privacy image opens the real Settings view through its
real button.

Never generate store artwork from a browser profile, extension storage,
provider website, network credential, or live provider response. Representative
fixture data is the only permitted source for these images.
