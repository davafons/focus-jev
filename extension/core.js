(function (root) {
  "use strict";

  const BLOCK_THRESHOLD = 0.65;
  const ATTENTION_FEED_THRESHOLD = 0.5;
  const ALLOW_CACHE_MS = 60_000;
  const DECISION_POLICY_VERSION = 4;
  const MODEL = "typesafe/jev";
  const TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
  const HOSTED_API_URL = "https://api.focus-jev.lostcoords.com";

  function normalizeTitle(title) {
    return String(title || "")
      .replace(/^\s*[[(]\d+[\])]\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function pageIdentity(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const disposable = new Set(["fbclid", "gclid", "dclid", "mc_cid", "mc_eid"]);
      if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
        ["t", "start", "time_continue", "feature", "si"].forEach((name) => disposable.add(name));
      }
      for (const name of [...parsed.searchParams.keys()]) {
        if (name.toLowerCase().startsWith("utm_") || disposable.has(name.toLowerCase())) {
          parsed.searchParams.delete(name);
        }
      }
      parsed.searchParams.sort();
      return parsed.href;
    } catch {
      return String(url || "").split("#", 1)[0];
    }
  }

  function cacheKey(sessionId, goal, page) {
    return JSON.stringify({
      version: DECISION_POLICY_VERSION,
      session: String(sessionId || ""),
      goal: String(goal || "").trim().toLowerCase(),
      url: pageIdentity(page?.url),
      title: normalizeTitle(page?.title),
    });
  }

  function normalizeAllowances(value) {
    return { music: Boolean(value?.music) };
  }

  function focusStatement(goal, allowances) {
    const base = String(goal || "").trim().slice(0, 7_200);
    const allowed = normalizeAllowances(allowances);
    if (!allowed.music) return base;
    return `${base}\n\nExplicit allowance: Music and music-video destinations used for listening are permitted during this focus session. This does not permit unrelated browsing, feeds, or entertainment.`;
  }

  function providerMode(settings) {
    const explicit = String(settings?.provider || "").trim().toLowerCase();
    if (["cloudflare", "typesafe", "compatible", "hosted"].includes(explicit)) return explicit;
    return String(settings?.accountId || "").trim() || String(settings?.apiToken || "").trim()
      ? "cloudflare"
      : "hosted";
  }

  function validHttpsUrl(value) {
    try {
      return new URL(String(value || "")).protocol === "https:";
    } catch {
      return false;
    }
  }

  function settingsComplete(settings) {
    const provider = providerMode(settings);
    if (provider === "hosted") return validHttpsUrl(settings?.hostedUrl || HOSTED_API_URL);
    if (provider === "cloudflare") {
      return Boolean(String(settings?.accountId || "").trim() && String(settings?.apiToken || "").trim());
    }
    if (provider === "typesafe") return Boolean(String(settings?.apiToken || "").trim());
    return Boolean(validHttpsUrl(settings?.compatibleUrl) && String(settings?.apiToken || "").trim());
  }

  function pageType(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/$/, "").toLowerCase();

      if (["x.com", "twitter.com"].includes(host)) {
        if (["", "/home", "/explore"].includes(path)) {
          return "Open-ended social-media timeline with algorithmically selected posts";
        }
        if (/\/status\/\d+/.test(path)) return "Individual social-media post and replies";
        if (path === "/search") return "Social-media search results";
      }
      if (["reddit.com", "old.reddit.com"].includes(host)) {
        if (["", "/r/all", "/r/popular"].includes(path)) return "Open-ended community content feed";
        if (/^\/r\/[^/]+\/comments\//.test(path)) return "Individual community discussion";
        if (/^\/r\/[^/]+$/.test(path)) return "Topic-specific community feed";
      }
      if (["instagram.com", "threads.net", "facebook.com", "tiktok.com"].includes(host)
          && ["", "/explore", "/reels", "/watch", "/foryou"].includes(path)) {
        return "Open-ended social-media or recommendation feed";
      }
      if (host === "linkedin.com" && path === "/feed") return "Open-ended professional social-media feed";
      if (["youtube.com", "m.youtube.com"].includes(host) && path === "/watch") return "Individual video page";
      return "Destination page";
    } catch {
      return "Destination page";
    }
  }

  function isAttentionFeed(url) {
    return pageType(url).startsWith("Open-ended");
  }

  function blockThresholdForPage(page) {
    return isAttentionFeed(page?.url) ? ATTENTION_FEED_THRESHOLD : BLOCK_THRESHOLD;
  }

  function isGatewayPage(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/$/, "").toLowerCase();

      if (["youtube.com", "m.youtube.com"].includes(host)) {
        return path === "" || path === "/results";
      }
      if (host === "google.com" || host === "google.co.jp" || host.startsWith("google.")) {
        return ["", "/search", "/webhp"].includes(path);
      }
      if (["duckduckgo.com", "html.duckduckgo.com", "lite.duckduckgo.com"].includes(host)) {
        return ["", "/html", "/lite"].includes(path);
      }
      if (["bing.com", "search.brave.com", "kagi.com", "ecosia.org"].includes(host)) {
        return ["", "/search"].includes(path);
      }
      if (["startpage.com", "search.yahoo.com"].includes(host)) {
        return ["", "/sp/search", "/search"].includes(path);
      }
      return false;
    } catch {
      return false;
    }
  }

  function jevRequest(goal, page, allowances) {
    return {
      state: {
        focus_statement: focusStatement(goal, allowances),
        page: {
          url: pageIdentity(page?.url).slice(0, 2_000),
          title: String(page?.title || "").slice(0, 500),
          type: pageType(page?.url),
          context: String(page?.description || "").slice(0, 3_000),
        },
      },
      questions: {
        should_block: {
          type: "noul",
          instructions: "Should this exact destination be blocked because its apparent subject or purpose is clearly outside the user's complete focus statement? Interpret the user's underlying intent, including explicit constraints, examples, permitted research, tools, and supporting work. Judge semantic purpose rather than keyword overlap. Return a high probability only for clearly unrelated or distracting destinations. Return a low probability for pages that directly advance the focus, provide plausibly useful supporting context, or lack enough page context for a safe block. Open-ended social, news, and recommendation feeds are normally distracting; consider one related only when the focus explicitly calls for browsing that service or feed, or supplied page context shows direct relevance. Search and navigation gateway pages are handled separately.",
        },
      },
    };
  }

  function extractAnswers(response) {
    if (response?.answers) return response.answers;
    if (response?.response?.result?.result?.answers) return response.response.result.result.answers;
    if (response?.result?.answers) return response.result.answers;
    if (response?.result?.result?.answers) return response.result.result.answers;
    return {};
  }

  function probability(value, fallback = 0.5) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }

  function decisionFromAnswers(answers, options = {}) {
    const blockProbability = probability(answers?.should_block?.noul);
    const blockThreshold = probability(options.blockThreshold, BLOCK_THRESHOLD);
    const blocked = blockProbability >= blockThreshold;
    const thresholdPercent = Math.round(blockThreshold * 100);
    const blockPercent = Math.round(blockProbability * 100);
    let reason;
    if (blocked) {
      reason = "This page appears clearly outside the current focus.";
    } else if (blockProbability <= 1 - BLOCK_THRESHOLD) {
      reason = "This page appears related or plausibly useful to the current focus.";
    } else {
      reason = `Block confidence was ${blockPercent}%, below the ${thresholdPercent}% safety threshold.`;
    }

    return {
      action: blocked ? "block" : "allow",
      confidence: blocked ? blockProbability : 1 - blockProbability,
      blockProbability,
      blockThreshold,
      reason,
      relation: blocked ? "off-goal" : "allowed",
      source: "jev",
      interrupt: blocked,
      policyVersion: DECISION_POLICY_VERSION,
    };
  }

  function cacheEntryValid(entry, now = Date.now()) {
    if (!entry?.decision) return false;
    if (entry.decision.policyVersion !== DECISION_POLICY_VERSION) return false;
    if (entry.decision.action === "block") return true;
    return now - Number(entry.cachedAt || 0) < ALLOW_CACHE_MS;
  }

  const api = {
    ALLOW_CACHE_MS,
    ATTENTION_FEED_THRESHOLD,
    BLOCK_THRESHOLD,
    DECISION_POLICY_VERSION,
    MODEL,
    HOSTED_API_URL,
    TYPESAFE_SYSTEMONE_URL,
    blockThresholdForPage,
    cacheEntryValid,
    cacheKey,
    decisionFromAnswers,
    extractAnswers,
    focusStatement,
    isGatewayPage,
    isAttentionFeed,
    jevRequest,
    normalizeTitle,
    normalizeAllowances,
    pageType,
    pageIdentity,
    providerMode,
    settingsComplete,
    validHttpsUrl,
  };

  root.FocusJevCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
