# Chrome Web Store listing notes

## Name

Focus JEV

## Short description

Stay aligned with one focus goal while browsing, using fast page decisions from JEV.

## Single purpose

Focus JEV compares the active page's public metadata with a user-written focus statement and blocks pages that are confidently unrelated.

## Permission justifications

- `storage`: stores JEV connection settings and the active focus locally, and keeps decision caches for the browser session.
- `tabs`: identifies the active tab and displays its title, URL, and favicon alongside the current JEV decision.
- `scripting`: starts the page evaluator in an already-open eligible tab, so a focus session can check the current page without requiring a manual reload.
- `http://*/*` and `https://*/*`: runs the page guard and reads the active page URL, title, and limited public metadata on pages the user visits. The extension needs broad coverage because focus enforcement applies across browsing destinations. HTTPS access sends the focus statement and active-page metadata to the provider selected by the user for a JEV decision; hosted mode sends it first to the Focus JEV gateway.

## Remote code

No remote code is downloaded or executed. All executable JavaScript ships in the extension package. The Cloudflare/JEV response is treated only as typed decision data.

## Data disclosures

Disclose these categories in the Chrome Web Store Privacy tab:

- authentication information (the selected provider credential or a hosted-service device credential);
- website content (limited public metadata);
- web history (active-page URL and title);
- user-generated content (the focus statement).

The data is used only for the extension's user-facing focus enforcement, is sent over HTTPS to Cloudflare, and is not sold, used for advertising, or transferred for unrelated purposes. The public privacy and hosted-service-retention policy is available at `https://github.com/davafons/focus-jev/blob/main/PRIVACY.md`.

## Chrome Web Store form answers

### Privacy

- **Privacy policy URL:** `https://github.com/davafons/focus-jev/blob/main/PRIVACY.md`
- **Data use:** select only the categories listed above. State that each is necessary for the extension's single purpose: comparing the active page against the focus statement.
- **Certification:** data is not sold, not used or transferred for purposes unrelated to the extension, not used to determine creditworthiness or lending purposes, and not used for personalized advertising.

### Distribution

- **Visibility:** Public.
- **Regions:** All regions, unless release support or legal review later requires a narrower selection.

### Test instructions

1. Install the uploaded ZIP and open the Focus JEV toolbar popup.
2. Open **Settings**, choose **Focus JEV hosted service**, and save. No external account is required for the hosted test path.
3. In the popup, enter `Only work and things related to coding an AI`, then choose **Start focus**.
4. Visit a clearly off-goal page such as a music video. Focus JEV should show **Checking** briefly, then replace the page with the blocked screen.
5. On the blocked screen, verify the original page favicon, title, and normalized URL are shown; use **Go back** to return.
6. Reopen the popup. It should display the completed decision for the original page rather than the extension's blocked page. Use the retry icon to request a new decision.
7. Visit a technical article or a relevant coding page and verify it remains allowed. Choose **End** to clear the session.

## Release checklist

- Run `npm run check`.
- Run `npm run package` and upload `focus-jev-chrome-*.zip` from `dist/`.
- Verify the ZIP contains `manifest.json` at its root.
- Capture current-product store screenshots at `1280×800` or `640×400`; do not reuse screenshots that show retired controls.
- Use the published privacy policy URL above.
- Complete the Privacy, Distribution, and Test instructions tabs.
- Test install, start, allow, block, back navigation, settings, and session reset in a clean browser profile.
