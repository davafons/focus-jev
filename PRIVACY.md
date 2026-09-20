# Privacy Policy

Focus Guard has one purpose: compare the active web page with a focus statement and block pages that JEV judges to be off-goal.

## Data handled

When a focus session is active, Focus Guard processes:

- the focus statement you wrote;
- the active page URL and title;
- limited public page metadata, such as a description, main heading, author, content type, and structured JSON-LD metadata;
- your Cloudflare account ID, API token, AI Gateway ID, and optional gateway token.

Focus Guard does not read form fields, cookies, passwords, private messages, page screenshots, or the full page body.

## Where data goes

The focus statement and active-page metadata are sent over HTTPS to Cloudflare's API so the `typesafe/jev` model can return a decision. Cloudflare credentials are sent only to Cloudflare for authentication. The project maintainers do not operate an intermediary server and do not receive this data.

Cloudflare or an AI Gateway configured in your account may retain request logs according to your Cloudflare settings and Cloudflare's policies. Review those settings before use.

## Local storage

Credentials and the current focus are stored in `chrome.storage.local` in your browser profile. Page decisions and counters are stored in `chrome.storage.session` and are cleared when the focus session ends or the browser session is discarded. Focus Guard does not use a system keychain.

## Data use

Focus Guard uses this data only to provide page-alignment decisions, display session status, and avoid duplicate model requests. It does not sell data, show ads, profile users, or use data for unrelated purposes.

## Control and deletion

End the focus session to clear session decisions. Remove credentials in the Settings page or uninstall the extension to remove extension-owned local data through the browser.

## Changes and questions

Material changes will be documented in the repository. For privacy or security questions, open a private security advisory in the GitHub repository rather than posting credentials in a public issue.
