const assert = require("node:assert/strict");

let now = 1_000_000;
let intervalCallback;
let messageListener;
let decisionRequests = 0;

Date.now = () => now;
global.location = {
  href: "https://example.com/article",
  replace() {},
};
global.window = { stop() {}, addEventListener() {} };
global.document = {
  title: "A useful article",
  readyState: "complete",
  visibilityState: "visible",
  documentElement: {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};
global.setInterval = (callback) => {
  intervalCallback = callback;
  return 1;
};
global.chrome = {
  runtime: {
    lastError: null,
    getURL: (path) => `chrome-extension://focus-guard/${path}`,
    onMessage: { addListener(listener) { messageListener = listener; } },
    sendMessage: (_message, callback) => {
      decisionRequests += 1;
      callback({
        ok: true,
        decision: { action: "allow", source: "jev", interrupt: false },
      });
    },
  },
};

require("../extension/guard.js");

assert.equal(decisionRequests, 1, "the initial visible page should be evaluated once");
now += 30_000;
intervalCallback();
assert.equal(decisionRequests, 1, "an unchanged allowed page must not wake the worker every interval");
now += 31_000;
intervalCallback();
assert.equal(decisionRequests, 2, "an allowed page should be reconsidered after its one-minute TTL");
now += 1_000;
messageListener({ type: "focus-guard-check-now", force: true });
assert.equal(decisionRequests, 3, "a manual check must bypass the content-side TTL");

console.log("guard efficiency tests passed");
