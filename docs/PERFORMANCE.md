# Performance profile

Profiled on 20 September 2026 with Node.js 26 on Apple Silicon. Run `npm run profile` to reproduce the local CPU and payload measurements.

## Current baseline

- Extension payload: 64.3 KiB across 18 files before ZIP compression.
- Cache-key normalization: 100,000 operations in 334.6 ms (3.35 µs per operation).
- Decision policy: 100,000 operations in 37.4 ms (0.37 µs per operation).
- Session cache: capped at 500 valid entries.

JEV network latency dominates local decision work by several orders of magnitude. Local policy and cache-key processing are not meaningful bottlenecks.

## Worker activity

The original content script sent a decision request every four seconds while a page remained visible: up to 15 service-worker messages per minute for one unchanged tab. The current guard records the page signature and decision TTL:

- unchanged allowed page: at most one worker decision per minute;
- unchanged gateway or inactive page: no periodic worker decision;
- page URL or title change: immediate event-driven check;
- network or setup error: retry after ten seconds;
- manual **Check again**: immediate forced check;
- low-frequency safety pass: every 30 seconds, without messaging the worker when the decision is still fresh.

The unchanged allowed-page path therefore reduces worker decision messages by about 93% while preserving the one-minute freshness rule.

## Remaining release profiling

Before a public store launch, measure these in a clean browser profile:

- end-to-end JEV latency at p50 and p95 across at least 100 real page transitions;
- service-worker wakeups and storage writes during a one-hour mixed browsing session;
- cache hit rate and cache size across realistic focus sessions;
- memory and CPU in Chromium's extension task manager;
- behavior on low-power hardware and unreliable networks.

Do not collect real browsing data centrally for this profiling. Keep measurements local or use synthetic fixtures.
