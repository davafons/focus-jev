const assert = require("node:assert/strict");

let replacedWith = "";
let evaluatedPage = null;
const media = {
  paused: false,
  muted: false,
  src: "https://example.com/video.mp4",
  pause() { this.paused = true; },
  removeAttribute() {},
  load() {},
};

global.location = {
  href: "https://www.youtube.com/watch?v=off-topic",
  replace(url) { replacedWith = url; },
};
global.history = { back() {} };
global.window = {
  stopCalled: false,
  stop() { this.stopCalled = true; },
  addEventListener() {},
};
global.document = {
  title: "Unrelated entertainment - YouTube",
  readyState: "complete",
  visibilityState: "visible",
  querySelector(selector) {
    if (selector === "main h1, article h1, h1") return { textContent: "Where to Avoid in Japan" };
    return null;
  },
  querySelectorAll(selector) {
    if (selector === "audio, video") return [media];
    if (selector === 'script[type="application/ld+json"]') {
      return [{ textContent: JSON.stringify({
        "@type": "VideoObject",
        name: "Where to Avoid in Japan",
        description: "Travel podcast episode",
        genre: "Travel & Events",
        author: { name: "Abroad In Japan Podcast" },
      }) }];
    }
    return [];
  },
  addEventListener() {},
};
global.setInterval = () => 0;
global.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://focus-guard/${path}`,
    onMessage: { addListener() {} },
    sendMessage: (message, callback) => {
      evaluatedPage = message.page;
      callback({ ok: true, decision: { action: "block", interrupt: true } });
    },
  },
};

require("../extension/guard.js");

assert.equal(media.paused, true, "blocking must pause playing media");
assert.equal(media.muted, true, "blocking must mute playing media");
assert.equal(media.src, "", "blocking must detach the media source");
assert.equal(window.stopCalled, true, "blocking must stop the original document");
assert.equal(replacedWith, "chrome-extension://focus-guard/blocked.html");
assert.match(evaluatedPage.description, /Travel podcast episode/);
assert.match(evaluatedPage.description, /Travel & Events/);
assert.match(evaluatedPage.description, /Abroad In Japan Podcast/);

console.log("full-page guard tests passed");
