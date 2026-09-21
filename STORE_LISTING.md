# Chrome Web Store listing notes

## Name

Focus JEV

## Short description

Stay aligned with one focus goal while browsing, using fast page decisions from JEV.

## Single purpose

Focus JEV compares the active page's public metadata with a user-written focus statement and blocks pages that are confidently unrelated.

## Permission justifications

- `storage`: stores JEV connection settings and the active focus locally, and keeps decision caches for the browser session.
- `http://*/*` and `https://*/*`: runs the page guard and reads the active page URL, title, and limited public metadata on pages the user visits. The extension needs broad coverage because focus enforcement applies across browsing destinations. HTTPS access sends the focus statement and active-page metadata to the provider selected by the user for a JEV decision; hosted mode sends it first to the Focus JEV gateway.

## Remote code

No remote code is downloaded or executed. All executable JavaScript ships in the extension package. The Cloudflare/JEV response is treated only as typed decision data.

## Data disclosures

Disclose these categories in the Chrome Web Store Privacy tab:

- authentication information (the selected provider credential or a hosted-service device credential);
- website content (limited public metadata);
- web history (active-page URL and title);
- user-generated content (the focus statement).

The data is used only for the extension's user-facing focus enforcement, is sent over HTTPS to Cloudflare, and is not sold, used for advertising, or transferred for unrelated purposes. Host `PRIVACY.md` at a stable public URL before store submission.

## Release checklist

- Run `npm run check`.
- Run `npm run package` and upload `focus-jev-chrome-*.zip` from `dist/`.
- Verify the ZIP contains `manifest.json` at its root.
- Capture store screenshots at the required dimensions.
- Publish the privacy policy at a stable public URL.
- Complete the Privacy, Distribution, and Test instructions tabs.
- Test install, start, allow, block, back navigation, settings, and session reset in a clean browser profile.
