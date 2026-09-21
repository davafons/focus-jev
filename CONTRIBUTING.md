# Contributing

Focus JEV intentionally stays small: one focus statement, one JEV decision, and one block screen. Changes should preserve that single-purpose experience.

## Development

1. Use Node.js 20 or newer.
2. Run `npm run check` before submitting a change.
3. Load `extension/` as an unpacked Chromium extension for manual testing.
4. Never commit Cloudflare credentials, browser profiles, packaged ZIPs, or captured browsing data.

Keep policy changes covered by deterministic tests. When changing the JEV question or thresholds, also validate representative related, unrelated, ambiguous, gateway, and attention-feed cases.
