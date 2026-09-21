const assert = require("node:assert/strict");

let messageListener;
let windowFocused = true;
let fetchCalls = 0;
let lastFetch = null;
const local = new Map();
const session = new Map();
const activeTab = { id: 7, active: true, windowId: 2, url: "https://example.com/game", title: "A game" };

function storageArea(store) {
  return {
    get: async (keys) => {
      if (keys === null) return Object.fromEntries(store);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
    },
    set: async (values) => Object.entries(values).forEach(([key, value]) => store.set(key, value)),
    remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => store.delete(key)),
  };
}

global.importScripts = () => { global.FocusJevCore = require("../extension/core.js"); };
global.chrome = {
  storage: { local: storageArea(local), session: storageArea(session) },
  tabs: {
    query: async () => [activeTab], sendMessage: async () => {},
    onRemoved: { addListener: () => {} }, onActivated: { addListener: () => {} },
  },
  windows: {
    WINDOW_ID_NONE: -1, get: async () => ({ focused: windowFocused }),
    onFocusChanged: { addListener: () => {} },
  },
  runtime: {
    onMessage: { addListener: (listener) => { messageListener = listener; } },
    onInstalled: { addListener: () => {} },
    openOptionsPage: async () => {},
    getManifest: () => ({ version: "1.4.0" }),
  },
};

global.fetch = async (url, options) => {
  fetchCalls += 1;
  lastFetch = { url, options };
  const request = JSON.parse(options.body).input;
  const probability = request.state.page.title === "A game"
    ? 0.96
    : (request.state.page.title === "Home / X" ? 0.55 : 0.03);
  return {
    ok: true,
    json: async () => ({
      success: true,
      result: { answers: {
        should_block: { type: "noul", noul: probability },
      } },
    }),
  };
};

require("../extension/background.js");

function send(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const open = messageListener(message, sender, resolve);
    if (!open) reject(new Error("message channel closed"));
    setTimeout(() => reject(new Error("message timed out")), 1000);
  });
}

(async () => {
  const settings = { accountId: "account", apiToken: "token", gatewayId: "jev-local" };
  assert.equal((await send({ type: "focus-guard-save-settings", settings })).ok, true);
  const started = await send({ type: "focus-guard-start", goal: "Research current AI news", allowances: { music: true } });
  assert.equal(started.ok, true);
  assert.equal(started.focus.allowances.music, true);

  const sender = { tab: activeTab };
  activeTab.url = "https://www.youtube.com/results?search_query=ai";
  activeTab.title = "ai - YouTube";
  const gateway = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "Search results" },
  }, sender);
  assert.equal(gateway.decision.action, "allow");
  assert.equal(gateway.decision.source, "gateway");
  assert.equal(fetchCalls, 0, "gateway pages must not spend a JEV call");

  activeTab.url = "https://example.com/game";
  activeTab.title = "A game";
  const first = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "Entertainment" },
  }, sender);
  assert.equal(first.decision.action, "block");
  assert.equal(fetchCalls, 1);
  const details = await send({ type: "focus-guard-blocked-details" }, sender);
  assert.equal(details.decision.action, "block");
  assert.equal(details.focus.active, true);
  assert.equal(lastFetch.url, "https://api.cloudflare.com/client/v4/accounts/account/ai/run");
  assert.equal(lastFetch.options.headers.Authorization, "Bearer token");
  assert.equal(lastFetch.options.headers["cf-aig-gateway-id"], "jev-local");
  assert.equal(JSON.parse(lastFetch.options.body).model, "typesafe/jev");
  assert.equal(JSON.parse(lastFetch.options.body).input.questions.should_block.type, "noul");
  assert.match(JSON.parse(lastFetch.options.body).input.state.focus_statement, /Explicit allowance/);

  const cached = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "Entertainment" },
  }, sender);
  assert.equal(cached.decision.action, "block");
  assert.equal(cached.decision.cacheHit, true);
  assert.equal(fetchCalls, 1, "a cached page must not call JEV twice");

  assert.equal((await send({ type: "focus-guard-check-now" })).ok, true);
  const rechecked = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "Entertainment" },
  }, sender);
  assert.equal(rechecked.decision.action, "block");
  assert.equal(fetchCalls, 2, "a manual recheck must bypass the cached decision");

  activeTab.title = "Latest AI model news";
  const changed = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "AI reporting" },
  }, sender);
  assert.equal(changed.decision.action, "allow");
  assert.equal(fetchCalls, 3, "a materially changed title must get a fresh decision");

  activeTab.url = "https://x.com/home";
  activeTab.title = "Home / X";
  const attentionFeed = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "" },
  }, sender);
  assert.equal(attentionFeed.decision.action, "block");
  assert.equal(attentionFeed.decision.blockProbability, 0.55);
  assert.equal(attentionFeed.decision.blockThreshold, 0.5);
  assert.equal(fetchCalls, 4);

  global.fetch = async (url, options) => {
    fetchCalls += 1;
    lastFetch = { url, options };
    return { ok: true, json: async () => ({ answers: { should_block: { type: "noul", noul: 0.03 } } }) };
  };
  const typesafe = await send({
    type: "focus-guard-test-jev",
    settings: { provider: "typesafe", apiToken: "typesafe-key", typesafeModel: "jev-latest" },
  });
  assert.equal(typesafe.ok, true);
  assert.equal(lastFetch.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(lastFetch.options.headers.Authorization, "Bearer typesafe-key");
  assert.equal(JSON.parse(lastFetch.options.body).model, "jev-latest");

  let hostedDecisionRequest;
  global.fetch = async (url, options) => {
    fetchCalls += 1;
    lastFetch = { url, options };
    if (url === "https://hosted.example/v1/install") {
      return { ok: true, json: async () => ({ deviceToken: "abcdefghijklmnopqrstuvwx.abcdefghijklmnopqrstuvwxyz012345" }) };
    }
    hostedDecisionRequest = { url, options };
    return { ok: true, json: async () => ({ answers: { should_block: { type: "noul", noul: 0.03 } } }) };
  };
  const hosted = await send({
    type: "focus-guard-test-jev",
    settings: { provider: "hosted", hostedUrl: "https://hosted.example" },
  });
  assert.equal(hosted.ok, true);
  assert.equal(hostedDecisionRequest.url, "https://hosted.example/v1/decision");
  assert.match(hostedDecisionRequest.options.headers.Authorization, /^Device /u);
  assert.match(hostedDecisionRequest.options.headers["X-JEV-Signature"], /^[A-Za-z0-9_-]+$/u);

  const callsBeforeBackground = fetchCalls;
  windowFocused = false;
  const background = await send({
    type: "focus-guard-decide",
    page: { url: "https://example.com/other", title: "Other" },
  }, sender);
  assert.equal(background.decision.source, "background-tab");
  assert.equal(fetchCalls, callsBeforeBackground, "background tabs must not spend a provider call");

  windowFocused = true;
  global.fetch = async () => { throw new Error("network down"); };
  activeTab.title = "A third page";
  const failedOpen = await send({
    type: "focus-guard-decide",
    page: { url: activeTab.url, title: activeTab.title, description: "Unknown" },
  }, sender);
  assert.equal(failedOpen.decision.action, "allow");
  assert.equal(failedOpen.decision.source, "error");

  assert.equal((await send({ type: "focus-guard-stop" })).ok, true);
  const diagnostics = await send({ type: "focus-guard-diagnostics" });
  assert.equal(diagnostics.diagnostics.focus.active, false);
  console.log("extension background integration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
