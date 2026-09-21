(() => {
  if (globalThis.__focusGuardLoaded) return;
  globalThis.__focusGuardLoaded = true;

  const ALLOW_RECHECK_MS = 60_000;
  const ERROR_RETRY_MS = 10_000;
  const MAX_CONTEXT_CHARS = 3_000;
  const MAX_CONTEXT_FIELD_CHARS = 900;
  const CONTEXT_SETTLE_MS = 700;
  const MAX_INITIAL_CONTEXT_WAIT_MS = 2_500;
  let checking = false;
  let blocked = false;
  let pendingForce = false;
  let observedPage = pageIdentity(location.href);
  let titleAtNavigation = document.title;
  let navigationStartedAt = 0;
  let settleTimer = null;
  let lastBaseSignature = "";
  let lastFullSignature = "";
  let lastDecision = null;
  let lastCheckedAt = 0;
  let initialContextReady = false;
  let initialContextStartedAt = Date.now();
  let initialContextTimer = null;

  function pageIdentity(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.href;
    } catch {
      return String(url || "").split("#", 1)[0];
    }
  }

  function pageDescription() {
    const details = [];
    const seen = new Set();
    const mediaCues = new Set();
    const add = (label, value) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (!text || seen.has(text.toLowerCase())) return;
      seen.add(text.toLowerCase());
      details.push(`${label}: ${text.slice(0, MAX_CONTEXT_FIELD_CHARS)}`);
      if (/\b(bgm|ost|soundtrack|music|audio|playlist|mix|ambient|lofi|asmr|karaoke|dj|radio)\b/iu.test(text)) {
        mediaCues.add("audio or music terminology");
      }
      if (/\b\d+\s*(?:min(?:ute)?s?|hours?|hrs?)\b|\d+\s*(?:分|時間)\s*(?:耐久|long)/u.test(text)) {
        mediaCues.add("long-duration media");
      }
    };
    const addPerson = (label, value) => {
      const people = Array.isArray(value) ? value : [value];
      add(label, people.map((person) => (
        typeof person === "string" ? person : person?.name
      )).filter(Boolean).join(", "));
    };
    const inspectStructuredData = (value) => {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item["@graph"])) inspectStructuredData(item["@graph"]);
        add("Content type", Array.isArray(item["@type"]) ? item["@type"].join(", ") : item["@type"]);
        add("Content name", item.name || item.headline);
        add("Content description", item.description);
        add("Genre", Array.isArray(item.genre) ? item.genre.join(", ") : item.genre);
        add("Duration", item.duration);
        add("Language", item.inLanguage);
        add("Section", item.articleSection);
        add("Keywords", Array.isArray(item.keywords) ? item.keywords.join(", ") : item.keywords);
        addPerson("Author", item.author);
        addPerson("Publisher", item.publisher);
      }
    };

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { inspectStructuredData(JSON.parse(script.textContent || "null")); } catch { /* invalid metadata */ }
    }
    add("Page heading", document.querySelector("main h1, article h1, h1")?.textContent);
    add("Open Graph title", document.querySelector('meta[property="og:title"]')?.content);
    add("Open Graph description", document.querySelector('meta[property="og:description"]')?.content);
    add("Open Graph type", document.querySelector('meta[property="og:type"]')?.content);
    add("Social title", document.querySelector('meta[name="twitter:title"]')?.content);
    add("Page description", document.querySelector('meta[name="description"]')?.content);
    add("Social description", document.querySelector('meta[name="twitter:description"]')?.content);
    add("Site", document.querySelector('meta[property="og:site_name"]')?.content);
    add("Author or publisher", document.querySelector(
      'meta[name="author"], meta[property="article:author"], meta[itemprop="author"]',
    )?.content || document.querySelector(
      '[rel="author"], [itemprop="author"], [itemprop="creator"], [itemprop="publisher"]',
    )?.textContent);
    add("Content summary", document.querySelector('meta[itemprop="description"]')?.content
      || document.querySelector('[itemprop="description"]')?.textContent);
    add("Duration", document.querySelector('meta[itemprop="duration"], meta[property="og:video:duration"]')?.content);
    if (mediaCues.size) add("Media cues", [...mediaCues].join(", "));
    const content = document.querySelector('main, article, [role="main"], [itemprop="articleBody"]')?.innerText
      || document.body?.innerText;
    if (content) add("Visible page text", content.slice(0, 1_500));
    return details.join("\n").slice(0, MAX_CONTEXT_CHARS);
  }

  function pageIconUrl() {
    const icon = document.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i]')?.href;
    if (icon) return icon;
    try {
      return new URL("/favicon.ico", location.href).href;
    } catch {
      return "";
    }
  }

  function scheduleInitialContextCheck() {
    if (initialContextReady || lastDecision || checking) return;
    clearTimeout(initialContextTimer);
    const elapsed = Date.now() - initialContextStartedAt;
    const delay = Math.min(CONTEXT_SETTLE_MS, Math.max(0, MAX_INITIAL_CONTEXT_WAIT_MS - elapsed));
    initialContextTimer = setTimeout(() => {
      initialContextReady = true;
      check();
    }, delay);
  }

  function waitForInitialContext() {
    if (initialContextReady || lastDecision) return false;
    // Content-script tests and browser-restricted documents may not expose a body.
    if (!document.body) {
      initialContextReady = true;
      return false;
    }
    scheduleInitialContextCheck();
    return true;
  }

  function stopPageMedia() {
    for (const media of document.querySelectorAll("audio, video")) {
      try {
        media.pause();
        media.muted = true;
        media.removeAttribute("autoplay");
        media.src = "";
        media.load();
      } catch {
        // Navigation below still tears down the entire document.
      }
    }
    try { window.stop(); } catch { /* best effort */ }
  }

  function replaceWithBlockedPage() {
    if (blocked) return;
    blocked = true;
    stopPageMedia();
    location.replace(chrome.runtime.getURL("blocked.html"));
  }

  function waitForSettledNavigation(force) {
    const currentPage = pageIdentity(location.href);
    if (currentPage !== observedPage) {
      observedPage = currentPage;
      titleAtNavigation = document.title;
      navigationStartedAt = Date.now();
    }
    if (force) {
      navigationStartedAt = 0;
      return false;
    }
    if (!navigationStartedAt) return false;
    const age = Date.now() - navigationStartedAt;
    if (age >= 2_500 || (age >= 500 && document.title !== titleAtNavigation)) {
      navigationStartedAt = 0;
      return false;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => check(force), Math.min(250, 2_500 - age));
    return true;
  }

  function decisionTTL(decision) {
    if (!decision) return 0;
    if (decision.source === "error" || decision.source === "setup-required") return ERROR_RETRY_MS;
    if (decision.source === "background-tab") return 0;
    if (decision.source === "gateway" || decision.source === "inactive") return Infinity;
    return decision.action === "allow" ? ALLOW_RECHECK_MS : Infinity;
  }

  function check(force = false) {
    if (blocked || document.visibilityState === "hidden") return;
    if (checking) {
      pendingForce ||= force;
      return;
    }
    if (!document.title && document.readyState === "loading") return;
    if (waitForInitialContext()) return;
    if (waitForSettledNavigation(force)) return;
    const requestedURL = location.href;
    const baseSignature = `${pageIdentity(requestedURL)}\n${document.title}`;
    const age = Date.now() - lastCheckedAt;
    if (!force && baseSignature === lastBaseSignature && age < decisionTTL(lastDecision)) return;
    const description = pageDescription();
    const fullSignature = `${baseSignature}\n${description}`;
    if (!force && fullSignature === lastFullSignature && age < decisionTTL(lastDecision)) return;
    checking = true;
    chrome.runtime.sendMessage(
      {
        type: "focus-guard-decide",
        page: {
          url: requestedURL,
          title: document.title,
          favIconUrl: pageIconUrl(),
          description,
        },
      },
      (response) => {
        checking = false;
        if (chrome.runtime.lastError || !response?.ok) {
          if (pendingForce) {
            pendingForce = false;
            setTimeout(() => check(true), ERROR_RETRY_MS);
          }
          return;
        }
        if (pageIdentity(requestedURL) !== pageIdentity(location.href)) {
          setTimeout(() => check(true), 0);
          return;
        }
        lastBaseSignature = baseSignature;
        lastFullSignature = fullSignature;
        lastDecision = response.decision || null;
        lastCheckedAt = Date.now();
        if (response.decision?.action === "block" && response.decision?.interrupt) {
          replaceWithBlockedPage();
          return;
        }
        if (pendingForce) {
          pendingForce = false;
          setTimeout(() => check(true), 0);
        }
      },
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "focus-guard-check-now") check(Boolean(message.force));
  });

  check();
  setInterval(check, 30_000);
  document.addEventListener("visibilitychange", () => check());
  window.addEventListener("focus", () => check());
  window.addEventListener("pageshow", () => check());
  window.addEventListener("popstate", () => check());
  document.addEventListener("yt-navigate-finish", () => check());
  document.addEventListener("yt-page-data-updated", () => check());
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (!initialContextReady && !lastDecision) scheduleInitialContextCheck();
    }).observe(document.querySelector('main, article, [role="main"], [itemprop="articleBody"]') || document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
})();
