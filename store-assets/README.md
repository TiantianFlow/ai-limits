# Chrome Web Store artwork

These assets are generated from AI Limits' production `Cockpit` component,
production side-panel CSS, and `createFixtureState(now)`. The surrounding copy
and browser frame exist only to present that real interface at Chrome Web Store
sizes.

## Inventory and upload order

### English Chrome Web Store assets

1. `chrome-web-store/screenshot-overview-1280x800.png` — primary product
   overview screenshot, 1280×800.
2. `chrome-web-store/screenshot-pacing-1280x800.png` — quota, timing, and pace
   screenshot, 1280×800.
3. `chrome-web-store/screenshot-history-1280x800.png` — dedicated local quota
   History screen, 1280×800.
4. `chrome-web-store/screenshot-privacy-1280x800.png` — Settings and local-data
   controls screenshot, 1280×800.
5. `chrome-web-store/small-promo-440x280.png` — small promotional tile,
   440×280.

Upload the four screenshots in the listed order. Upload the final file to the
Chrome Web Store's small promotional tile slot.

### Simplified Chinese project media

1. `chrome-web-store/zh_CN/screenshot-overview-1280x800.png` — localized
   project overview, 1280×800.
2. `chrome-web-store/zh_CN/screenshot-pacing-1280x800.png` — localized quota,
   timing, and pace overview, 1280×800.
3. `chrome-web-store/zh_CN/screenshot-history-1280x800.png` — localized project
   media with the dedicated production History screen, 1280×800.
4. `chrome-web-store/zh_CN/screenshot-privacy-1280x800.png` — localized privacy
   and local-data overview, 1280×800.

These four images are for the Simplified Chinese GitHub README and social
media. Their dimensions and content are suitable for future localized Chrome
Web Store screenshots, but they are not part of the current store submission.
Chrome Web Store promotional tiles are not localized, so there is no separate
Chinese promotional tile.

### GitHub repository artwork

`github/social-preview-1280x640.png` is the repository's deterministic social
preview. It combines concise product copy with the same fixture-only production
Cockpit used by the Store artwork. Upload it through the repository's
**Settings → General → Social preview** control; it is not a Chrome Web Store
asset.

The surrounding project copy is in Simplified Chinese, while the embedded
production extension UI remains in English. After runtime localization is
implemented, regenerate these assets so both the surrounding copy and embedded
UI are Chinese.

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
fresh browser context without a user profile. The `locale=zh_CN` preview option
localizes only the surrounding project copy; it intentionally leaves the
production extension UI in English. The pacing image aligns the complete Kimi
and Cursor cards below the real sticky side-panel header at production scale.
The History image follows the real ChatGPT quota action into the dedicated
History screen and verifies that its chart and current-cycle surface fit inside
the panel frame. The privacy image opens the real Settings view through its real
button, then verifies that the nonpersonal **Demo relay A** and **Demo relay B**
New API instance rows and their per-instance actions both fit inside the panel
frame. The overview provider line lists all six supported providers.

Never generate store artwork from a browser profile, extension storage,
provider website, network credential, or live provider response. Representative
fixture data is the only permitted source for these images.
