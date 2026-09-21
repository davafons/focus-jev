const assert = require("node:assert/strict");
const Core = require("../extension/core.js");

assert.equal(Core.normalizeTitle("(12)  AI News - YouTube"), "ai news - youtube");
assert.equal(Core.pageIdentity("https://example.com/story#comments"), "https://example.com/story");
assert.equal(
  Core.pageIdentity("https://www.youtube.com/watch?v=abc&t=93s&feature=share"),
  "https://www.youtube.com/watch?v=abc",
);
assert.notEqual(
  Core.cacheKey("session", "AI news", { url: "https://example.com", title: "AI" }),
  Core.cacheKey("session", "AI news", { url: "https://example.com", title: "Outer Wilds" }),
  "a stale SPA title must not share a decision cache entry",
);

const blocked = Core.decisionFromAnswers({
  should_block: { type: "noul", noul: 0.96 },
});
assert.equal(blocked.action, "block");
assert.equal(blocked.confidence, 0.96);
assert.equal(blocked.blockProbability, 0.96);

const related = Core.decisionFromAnswers({
  should_block: { type: "noul", noul: 0.03 },
});
assert.equal(related.action, "allow");
assert.equal(related.confidence, 0.97);

const uncertain = Core.decisionFromAnswers({
  should_block: { type: "noul", noul: 0.64 },
});
assert.equal(uncertain.action, "allow", "low-confidence results must fail open");
assert.equal(uncertain.confidence, 0.36);
assert.match(uncertain.reason, /64%.*65%/);
assert.equal(Core.decisionFromAnswers({ should_block: { noul: 0.65 } }).action, "block");
assert.equal(
  Core.decisionFromAnswers(
    { should_block: { noul: 0.55 } },
    { blockThreshold: Core.blockThresholdForPage({ url: "https://x.com/home" }) },
  ).action,
  "block",
  "an open-ended attention feed should use the stricter feed policy",
);
assert.equal(Core.decisionFromAnswers({ should_block: { noul: 0.55 } }).action, "allow");
assert.equal(Core.cacheEntryValid({ decision: blocked, cachedAt: 0 }, Date.now()), true);
assert.equal(Core.cacheEntryValid({ decision: related, cachedAt: 0 }, Date.now()), false);
assert.equal(Core.cacheEntryValid({ decision: { ...blocked, policyVersion: 1 }, cachedAt: Date.now() }), false);
assert.equal(Core.settingsComplete({ accountId: "account", apiToken: "token" }), true);
assert.equal(Core.providerMode({ accountId: "account", apiToken: "token" }), "cloudflare");
assert.equal(Core.settingsComplete({ provider: "typesafe", apiToken: "token" }), true);
assert.equal(Core.settingsComplete({ provider: "hosted", hostedUrl: "https://api.example.com" }), true);
assert.equal(Core.settingsComplete({ provider: "hosted", hostedUrl: "http://api.example.com" }), false);
assert.equal(Core.settingsComplete({ provider: "compatible", compatibleUrl: "https://provider.example/v1/systemone", apiToken: "token" }), true);
assert.equal(Core.TYPESAFE_SYSTEMONE_URL, "https://api.typesafe.ai/v1/systemone");
assert.equal(Core.isGatewayPage("https://www.youtube.com/"), true);
assert.equal(Core.isGatewayPage("https://www.youtube.com/results?search_query=jev"), true);
assert.equal(Core.isGatewayPage("https://www.youtube.com/watch?v=abc"), false);
assert.equal(Core.isGatewayPage("https://duckduckgo.com/?q=jev"), true);
assert.equal(Core.isGatewayPage("https://x.com/home"), false);
assert.equal(Core.isGatewayPage("https://x.com/example/status/123"), false);
assert.equal(Core.pageType("https://x.com/home"), "Open-ended social-media timeline with algorithmically selected posts");
assert.equal(Core.isAttentionFeed("https://x.com/home"), true);
assert.equal(Core.blockThresholdForPage({ url: "https://x.com/home" }), 0.5);
assert.equal(Core.blockThresholdForPage({ url: "https://x.com/example/status/123" }), 0.65);
assert.equal(Core.focusStatement("Write a report", { music: false }), "Write a report");
assert.match(Core.focusStatement("Write a report", { music: true }), /Music and music-video destinations/);

const request = Core.jevRequest("Learn more about JEV AI", {
  url: "https://www.youtube.com/watch?v=IHH4EQVenfo",
  title: "Where to Avoid in Japan",
  description: "Travel and entertainment",
});
assert.deepEqual(Object.keys(request.questions), ["should_block"]);
assert.equal(request.questions.should_block.type, "noul");
assert.equal(request.state.focus_statement, "Learn more about JEV AI");
assert.equal(request.state.page.context, "Travel and entertainment");
assert.equal(request.state.page.type, "Individual video page");
assert.match(Core.jevRequest("Write", { url: "https://music.example" }, { music: true }).state.focus_statement, /Explicit allowance/);

console.log("core policy tests passed");
