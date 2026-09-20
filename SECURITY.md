# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or open a draft security advisory in this repository. Do not include API tokens, account IDs, browsing history, or other sensitive data in a public issue.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Reports will be acknowledged as soon as practical.

## Credential safety

Focus Guard stores Cloudflare credentials in the browser profile, not in this repository or a system keychain. Use a narrowly scoped token dedicated to this extension. Rotate the token immediately if it is exposed.
