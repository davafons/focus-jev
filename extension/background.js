// Chrome runs a module-less MV3 service worker; Firefox loads core.js first
// from the generated event-page manifest.
if (typeof importScripts === "function") importScripts("core.js");

const Core = FocusJevCore;
const STATE_KEY = "focusJevState";
const SETTINGS_KEY = "jevSettings";
const CACHE_KEY = "focusJevDecisionCache";
const STATS_KEY = "focusJevStats";
const TAB_PREFIX = "focusJevTabDecision:";
const MAX_CACHE_ENTRIES = 500;
const inFlight = new Map();

function notifyDiagnosticsChanged() {
  if (typeof chrome.runtime.sendMessage !== "function") return;
  Promise.resolve(chrome.runtime.sendMessage({ type: "focus-guard-diagnostics-changed" })).catch(() => {});
}

function tabDecisionKey(tabId) {
  return `${TAB_PREFIX}${tabId}`;
}

function isInternalPage(url) {
  if (typeof chrome.runtime.getURL !== "function") return false;
  return String(url || "").startsWith(chrome.runtime.getURL(""));
}

async function localState() {
  const stored = await chrome.storage.local.get([STATE_KEY, SETTINGS_KEY]);
  return {
    focus: stored[STATE_KEY] || {
      active: false,
      goal: "",
      allowances: { music: false, sns: false, youtube: false },
      sessionId: "",
    },
    settings: stored[SETTINGS_KEY] || {},
  };
}

async function sessionValues() {
  const stored = await chrome.storage.session.get([CACHE_KEY, STATS_KEY]);
  return {
    cache: stored[CACHE_KEY] || {},
    stats: stored[STATS_KEY] || { jevCalls: 0, cacheHits: 0 },
  };
}

async function updateStats(field) {
  const { stats } = await sessionValues();
  stats[field] = Number(stats[field] || 0) + 1;
  await chrome.storage.session.set({ [STATS_KEY]: stats });
  return stats;
}

async function clearSessionDecisions() {
  const all = await chrome.storage.session.get(null);
  const tabKeys = Object.keys(all).filter((key) => key.startsWith(TAB_PREFIX));
  await chrome.storage.session.remove([CACHE_KEY, STATS_KEY, ...tabKeys]);
}

function trimmedCache(cache) {
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([, entry]) => Core.cacheEntryValid(entry))
      .sort(([, left], [, right]) => Number(right.cachedAt || 0) - Number(left.cachedAt || 0))
      .slice(0, MAX_CACHE_ENTRIES),
  );
}

async function senderIsFocused(sender) {
  if (!sender.tab?.active || typeof sender.tab.windowId !== "number") return false;
  try {
    const window = await chrome.windows.get(sender.tab.windowId);
    return Boolean(window.focused);
  } catch {
    return false;
  }
}

async function responseJson(response, provider) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    const message = body?.errors?.[0]?.message || body?.error?.message || body?.error || `${provider} returned ${response.status}`;
    throw new Error(String(message));
  }
  return body;
}

async function fetchCloudflare(settings, request, timeoutMs) {
  const accountId = encodeURIComponent(String(settings.accountId).trim());
  const gatewayId = String(settings.gatewayId || "jev-local").trim();
  const headers = {
    "Authorization": `Bearer ${String(settings.apiToken).trim()}`,
    "Content-Type": "application/json",
    "cf-aig-gateway-id": gatewayId,
  };
  if (String(settings.gatewayToken || "").trim()) {
    headers["cf-aig-authorization"] = `Bearer ${String(settings.gatewayToken).trim()}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
      {
        method: "POST",
        credentials: "omit",
        headers,
        body: JSON.stringify({ model: Core.MODEL, input: request }),
        signal: controller.signal,
      },
    );
    return responseJson(response, "Cloudflare");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTypeSafe(settings, request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(Core.TYPESAFE_SYSTEMONE_URL, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Authorization": `Bearer ${String(settings.apiToken).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, model: String(settings.typesafeModel || "jev-latest").trim() }),
      signal: controller.signal,
    });
    return responseJson(response, "TypeSafe");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCompatible(settings, request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(settings.compatibleUrl).trim(), {
      method: "POST",
      credentials: "omit",
      headers: {
        "Authorization": `Bearer ${String(settings.apiToken).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, model: String(settings.compatibleModel || "jev-latest").trim() }),
      signal: controller.signal,
    });
    return responseJson(response, "Provider");
  } finally {
    clearTimeout(timer);
  }
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlBytes(value) {
  const text = String(value || "");
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - text.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function digestBase64(text) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function hostedSettings(settings) {
  if (String(settings.deviceToken || "").trim()) return settings;
  const baseUrl = String(settings.hostedUrl || Core.HOSTED_API_URL).trim().replace(/\/$/u, "");
  const response = await fetch(`${baseUrl}/v1/install`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version }),
  });
  const body = await responseJson(response, "Hosted service");
  if (!String(body.deviceToken || "").trim()) throw new Error("Hosted service did not issue a device credential.");
  const updated = { ...settings, deviceToken: body.deviceToken };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

async function signedHostedRequest(settings, path, method, body, timeoutMs) {
  const configured = await hostedSettings(settings);
  const match = /^([A-Za-z0-9_-]{20,80})\.([A-Za-z0-9_-]{20,128})$/u.exec(String(configured.deviceToken || ""));
  if (!match) throw new Error("Hosted service device credential is invalid. Save Settings to register again.");
  const baseUrl = String(configured.hostedUrl || Core.HOSTED_API_URL).trim().replace(/\/$/u, "");
  const endpoint = new URL(`${baseUrl}${path}`);
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const canonical = `${method}\n${endpoint.pathname}\n${timestamp}\n${nonce}\n${await digestBase64(body)}`;
  const key = await crypto.subtle.importKey("raw", base64UrlBytes(match[2]), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint.href, {
      method,
      credentials: "omit",
      headers: {
        "Authorization": `Device ${configured.deviceToken}`,
        "X-JEV-Nonce": nonce,
        "X-JEV-Signature": signature,
        "X-JEV-Timestamp": timestamp,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
      signal: controller.signal,
    });
    return responseJson(response, "Hosted service");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHosted(settings, request, timeoutMs) {
  const body = JSON.stringify({
    focus: request.state.focus_statement,
    page: {
      url: request.state.page.url,
      title: request.state.page.title,
      description: request.state.page.context,
    },
  });
  return signedHostedRequest(settings, "/v1/decision", "POST", body, timeoutMs);
}

async function hostedUsage(settings) {
  return signedHostedRequest(settings, "/v1/status", "GET", "", 5_000);
}

async function fetchJev(settings, request, timeoutMs = 10_000) {
  switch (Core.providerMode(settings)) {
    case "cloudflare": return fetchCloudflare(settings, request, timeoutMs);
    case "typesafe": return fetchTypeSafe(settings, request, timeoutMs);
    case "compatible": return fetchCompatible(settings, request, timeoutMs);
    case "hosted": return fetchHosted(settings, request, timeoutMs);
    default: throw new Error("Choose a supported JEV provider in Settings.");
  }
}

async function evaluatePage(focus, settings, page) {
  const focusStatement = Core.focusStatement(focus.goal, focus.allowances);
  const key = Core.cacheKey(focus.sessionId, focusStatement, page);
  const { cache } = await sessionValues();
  if (Core.cacheEntryValid(cache[key])) {
    await updateStats("cacheHits");
    return { ...cache[key].decision, source: `${cache[key].decision.source}-cache`, cacheHit: true };
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const work = (async () => {
    await updateStats("jevCalls");
    try {
      const response = await fetchJev(settings, Core.jevRequest(focus.goal, page, focus.allowances));
      const decision = {
        ...Core.decisionFromAnswers(Core.extractAnswers(response), {
          blockThreshold: Core.blockThresholdForPage(page),
        }),
        cacheHit: false,
      };
      const latest = (await sessionValues()).cache;
      latest[key] = { decision, cachedAt: Date.now() };
      await chrome.storage.session.set({ [CACHE_KEY]: trimmedCache(latest) });
      return decision;
    } catch (error) {
      return {
        action: "allow",
        confidence: 0,
        relation: "unknown",
        reason: `JEV is unavailable, so this page was allowed. ${error?.message || ""}`.trim(),
        source: "error",
        interrupt: false,
        cacheHit: false,
      };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, work);
  return work;
}

async function decideForPage(message, sender) {
  const { focus, settings } = await localState();
  if (!focus.active) {
    return { action: "allow", reason: "No focus session is active.", source: "inactive", interrupt: false };
  }
  if (!(await senderIsFocused(sender))) {
    return { action: "allow", reason: "Background tabs are checked when focused.", source: "background-tab", interrupt: false };
  }
  if (!Core.settingsComplete(settings)) {
    return { action: "allow", reason: "Configure a JEV provider in Settings to enable decisions.", source: "setup-required", interrupt: false };
  }

  const page = {
    url: String(message.page?.url || sender.tab?.url || ""),
    title: String(message.page?.title || sender.tab?.title || ""),
    description: String(message.page?.description || ""),
  };
  const decision = Core.isGatewayPage(page.url)
    ? {
      action: "allow",
      confidence: 1,
      relation: "gateway",
      reason: "Search and navigation pages stay available.",
      source: "gateway",
      interrupt: false,
      cacheHit: false,
    }
    : await evaluatePage(focus, settings, page);
  const stored = {
    ...decision,
    url: page.url,
    title: page.title,
    goal: focus.goal,
    sessionId: focus.sessionId,
    evaluatedAt: Date.now(),
  };
  if (typeof sender.tab?.id === "number") {
    await chrome.storage.session.set({ [tabDecisionKey(sender.tab.id)]: stored });
  }
  notifyDiagnosticsChanged();
  return stored;
}

function decisionMatchesTab(decision, tab) {
  return Boolean(
    decision && tab
    && Core.pageIdentity(decision.url) === Core.pageIdentity(tab.url)
    && Core.normalizeTitle(decision.title) === Core.normalizeTitle(tab.title)
  );
}

async function diagnostics() {
  const [{ focus, settings }, tabs, session] = await Promise.all([
    localState(),
    chrome.tabs.query({ active: true, currentWindow: true }),
    sessionValues(),
  ]);
  const tab = tabs[0] || null;
  const internal = isInternalPage(tab?.url);
  let decision = null;
  if (!internal && typeof tab?.id === "number") {
    const stored = await chrome.storage.session.get(tabDecisionKey(tab.id));
    decision = stored[tabDecisionKey(tab.id)] || null;
    if (decision && !decisionMatchesTab(decision, tab)) decision = null;
  }
  return {
    focus,
    configured: Core.settingsComplete(settings),
    provider: Core.providerMode(settings),
    tab: tab ? {
      id: tab.id,
      url: tab.url || "",
      title: tab.title || "",
      favIconUrl: tab.favIconUrl || "",
      internal,
    } : null,
    decision,
    stats: session.stats,
    cacheEntries: Object.values(session.cache).filter((entry) => Core.cacheEntryValid(entry)).length,
  };
}

async function blockedDetails(sender) {
  const { focus } = await localState();
  let decision = null;
  if (typeof sender.tab?.id === "number") {
    const stored = await chrome.storage.session.get(tabDecisionKey(sender.tab.id));
    decision = stored[tabDecisionKey(sender.tab.id)] || null;
  }
  return { focus, decision };
}

async function notifyTabs(type, extra = {}) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => (
    typeof tab.id === "number" ? chrome.tabs.sendMessage(tab.id, { type, ...extra }) : null
  )));
}

async function startFocus(goal, allowances) {
  const cleaned = String(goal || "").trim().slice(0, 8_000);
  if (!cleaned) throw new Error("Write what you want to focus on first.");
  const { settings } = await localState();
  if (!Core.settingsComplete(settings)) throw new Error("Configure a JEV provider in Settings first.");
  const focus = {
    active: true,
    goal: cleaned,
    allowances: Core.normalizeAllowances(allowances),
    sessionId: crypto.randomUUID(),
    startedAt: Date.now(),
  };
  await chrome.storage.local.set({ [STATE_KEY]: focus });
  await clearSessionDecisions();
  await notifyTabs("focus-guard-check-now", { force: true });
  notifyDiagnosticsChanged();
  return focus;
}

async function stopFocus() {
  const { focus } = await localState();
  const stopped = { ...focus, active: false, sessionId: "" };
  await chrome.storage.local.set({ [STATE_KEY]: stopped });
  await clearSessionDecisions();
  await notifyTabs("focus-guard-hide");
  notifyDiagnosticsChanged();
  return stopped;
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(tabDecisionKey(tabId)));
chrome.runtime.onInstalled.addListener(async () => {
  await clearSessionDecisions();
  const { settings } = await localState();
  if (!Core.settingsComplete(settings)) await chrome.runtime.openOptionsPage();
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await chrome.tabs.sendMessage(tabId, { type: "focus-guard-check-now" }).catch(() => {});
  notifyDiagnosticsChanged();
});
chrome.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
  if (changeInfo.status || changeInfo.url || changeInfo.title) notifyDiagnosticsChanged();
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const tabs = await chrome.tabs.query({ active: true, windowId });
  if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: "focus-guard-check-now" }).catch(() => {});
  notifyDiagnosticsChanged();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let task;
  switch (message?.type) {
    case "focus-guard-decide":
      task = decideForPage(message, sender).then((decision) => ({ ok: true, decision }));
      break;
    case "focus-guard-diagnostics":
      task = diagnostics().then((value) => ({ ok: true, diagnostics: value }));
      break;
    case "focus-guard-blocked-details":
      task = blockedDetails(sender).then((value) => ({ ok: true, ...value }));
      break;
    case "focus-guard-start":
      task = startFocus(message.goal, message.allowances).then((focus) => ({ ok: true, focus }));
      break;
    case "focus-guard-stop":
      task = stopFocus().then((focus) => ({ ok: true, focus }));
      break;
    case "focus-guard-check-now":
      task = chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) return { ok: false };
        const [{ focus }, { cache }] = await Promise.all([localState(), sessionValues()]);
        if (focus.active) {
          delete cache[Core.cacheKey(focus.sessionId, Core.focusStatement(focus.goal, focus.allowances), tab)];
          await chrome.storage.session.set({ [CACHE_KEY]: cache });
        }
        await chrome.storage.session.remove(tabDecisionKey(tab.id));
        await chrome.tabs.sendMessage(tab.id, { type: "focus-guard-check-now", force: true });
        return { ok: true };
      });
      break;
    case "focus-guard-save-settings":
      task = Promise.resolve().then(() => {
        const settings = message.settings || {};
        if (!Core.settingsComplete(settings)) throw new Error("Complete the selected provider settings first.");
        return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      })
        .then(() => notifyTabs("focus-guard-check-now", { force: true }))
        .then(() => ({ ok: true }));
      break;
    case "focus-guard-get-settings":
      task = localState().then(({ settings }) => ({ ok: true, settings }));
      break;
    case "focus-guard-hosted-usage":
      task = localState().then(({ settings }) => {
        if (Core.providerMode(settings) !== "hosted") return { ok: true, usage: null };
        return hostedUsage(settings).then((usage) => ({ ok: true, usage }));
      });
      break;
    case "focus-guard-test-jev":
      task = (async () => {
        const settings = message.settings || {};
        if (!Core.settingsComplete(settings)) throw new Error("Complete the selected provider settings first.");
        const response = await fetchJev(settings, Core.jevRequest(
          "Verify that JEV can evaluate whether a setup page supports configuring Focus Guard.",
          { url: "https://example.com/focus-guard-setup", title: "Focus Guard setup", description: "Extension configuration" },
        ));
        if (!Object.keys(Core.extractAnswers(response)).length) throw new Error("JEV returned no typed answers.");
        return { ok: true };
      })();
      break;
    default:
      return false;
  }
  task.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || "Something went wrong." }));
  return true;
});
