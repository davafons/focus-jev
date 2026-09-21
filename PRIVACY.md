# Privacy Policy

Focus Guard has one purpose: compare the active web page with a focus statement and block pages that JEV judges to be off-goal.

## Data handled

When a focus session is active, Focus Guard processes:

- the focus statement you wrote;
- the active page URL and title;
- limited public page metadata, such as a description, main heading, author, content type, and structured JSON-LD metadata;
- the selected provider configuration: a Cloudflare account ID/API token and optional AI Gateway token, a TypeSafe API key, a compatible-provider bearer key, or a hosted-service device credential.

Focus Guard does not read form fields, cookies, passwords, private messages, page screenshots, or the full page body.

## Where data goes

In bring-your-own-key mode, the focus statement and active-page metadata are sent over HTTPS directly to the provider you choose so JEV can return a decision. The extension sends credentials only to that selected provider for authentication.

In hosted-service mode, the same limited decision input is sent to the Focus Guard gateway, which validates a revocable device credential, applies quota and abuse controls, and forwards a fixed JEV request to its configured provider. The production Worker has invocation logging disabled and does not retain focus statements, URLs, titles, descriptions, request bodies, or provider keys in its application logs. It can technically process the plaintext request in transit; hosted mode is therefore not equivalent to the direct/BYOK privacy path.

Your selected provider may retain request logs according to its settings and policies. Review those settings before use. The hosted service's retention and operational logging policy will be published at a stable LOST COORDS URL before public release.

## Local storage

Credentials and the current focus are stored in `chrome.storage.local` in your browser profile. Page decisions and counters are stored in `chrome.storage.session` and are cleared when the focus session ends or the browser session is discarded. Provider requests use `credentials: "omit"`; the extension neither reads nor sends website cookies. Focus Guard does not use a system keychain.

## Data use

Focus Guard uses this data only to provide page-alignment decisions, display session status, and avoid duplicate model requests. It does not sell data, show ads, profile users, or use data for unrelated purposes.

## Control and deletion

End the focus session to clear session decisions. Remove credentials in the Settings page or uninstall the extension to remove extension-owned local data through the browser. Removing a hosted device credential only removes it locally; a future hosted account page will provide server-side device revocation.

## Changes and questions

Material changes will be documented in the repository. For privacy or security questions, open a private security advisory in the GitHub repository rather than posting credentials in a public issue.
