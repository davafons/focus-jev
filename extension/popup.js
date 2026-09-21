const $ = (id) => document.getElementById(id);
let diagnostics = null;
let requestedCheckFor = "";
let usageLoadedFor = "";
let draftInitialized = false;

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { ok: false, error: "No response from Focus Guard." });
      }
    });
  });
}

function showMessage(text, error = false) {
  $("message").textContent = text || "";
  $("message").classList.toggle("error", error);
}

function elapsedLabel(startedAt) {
  const elapsed = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just started";
  if (minutes === 1) return "1 min elapsed";
  return `${minutes} min elapsed`;
}

function render(value) {
  diagnostics = value;
  const { focus, configured, tab, decision, stats, cacheEntries } = value;
  $("start-view").classList.toggle("hidden", focus.active);
  $("active-view").classList.toggle("hidden", !focus.active);
  $("setup-note").classList.toggle("hidden", configured);
  $("start").disabled = !configured;
  $("elapsed-label").textContent = focus.active ? elapsedLabel(focus.startedAt) : "";
  $("session-header").classList.toggle("hidden", !focus.active);
  $("status-line").classList.toggle("hidden", !focus.active);
  $("stop").classList.toggle("hidden", !focus.active);
  if (!focus.active && !draftInitialized) {
    $("goal").value = focus.goal || "";
    $("allow-music").checked = Boolean(focus.allowances?.music);
    $("allow-sns").checked = Boolean(focus.allowances?.sns);
    $("allow-youtube").checked = Boolean(focus.allowances?.youtube);
    draftInitialized = true;
  }
  $("active-goal").textContent = focus.goal || "";
  $("active-allowances").textContent = [
    focus.allowances?.music && "Music allowed",
    focus.allowances?.sns && "SNS allowed",
    focus.allowances?.youtube && "YouTube allowed",
  ].filter(Boolean).join(" · ");

  $("page-title").textContent = tab?.title || "No page selected";
  $("page-url").textContent = tab?.url || "";
  $("page-icon").src = tab?.favIconUrl || "icons/icon-32.png";
  const badge = $("decision-badge");
  const action = decision?.action || "neutral";
  badge.className = `badge ${action}`;
  badge.textContent = decision
    ? (decision.action === "block" ? "Blocked" : "Allowed")
    : (focus.active ? "Checking" : "Not checked");
  $("decision-reason").textContent = decision?.reason
    || (focus.active ? "Evaluating this page…" : "Start a focus session to evaluate pages.");
  $("decision-meta").classList.toggle("hidden", !decision);
  if (decision) {
    const score = Number(decision.confidence);
    $("confidence").textContent = Number.isFinite(score) && decision.source !== "error"
      ? `${Math.round(score * 100)}% ${decision.action === "block" ? "block" : "allow"} confidence`
      : "No confidence score";
    $("source").textContent = decision.cacheHit || String(decision.source).endsWith("-cache")
      ? "Cached"
      : (decision.source === "gateway" ? "Gateway" : (decision.source === "error" ? "Unavailable" : "Live"));
    requestedCheckFor = "";
  }
  const liveChecks = Number(stats?.jevCalls || 0);
  const cachedChecks = Number(stats?.cacheHits || cacheEntries || 0);
  $("activity-count").textContent = focus.active
    ? `${liveChecks} live · ${cachedChecks} cached`
    : "";
  $("recheck").classList.toggle("hidden", !focus.active || !decision);
}

async function refreshUsage(value) {
  const key = `${value.provider || ""}:${value.configured ? "configured" : "not-configured"}`;
  if (usageLoadedFor === key) return;
  usageLoadedFor = key;
  $("usage-count").textContent = "";
  if (!value.configured || value.provider !== "hosted") return;
  const response = await send({ type: "focus-guard-hosted-usage" });
  const remaining = Number(response?.usage?.remaining);
  if (response?.ok && Number.isFinite(remaining)) {
    $("usage-count").textContent = `${remaining} hosted decisions left this month`;
  }
}

async function refresh() {
  const response = await send({ type: "focus-guard-diagnostics" });
  if (!response.ok) {
    showMessage(response.error || "Focus Guard could not load.", true);
    return;
  }
  showMessage("");
  render(response.diagnostics);
  refreshUsage(response.diagnostics);
  const pendingKey = `${response.diagnostics.focus.sessionId || ""}:${response.diagnostics.tab?.id || ""}:${response.diagnostics.tab?.url || ""}`;
  if (
    response.diagnostics.focus.active
    && !response.diagnostics.decision
    && response.diagnostics.tab?.id
    && requestedCheckFor !== pendingKey
  ) {
    requestedCheckFor = pendingKey;
    chrome.tabs.sendMessage(response.diagnostics.tab.id, { type: "focus-guard-check-now" }).catch(() => {});
  }
}

$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  showMessage("Starting…");
  const response = await send({
    type: "focus-guard-start",
    goal: $("goal").value,
    allowances: {
      music: $("allow-music").checked,
      sns: $("allow-sns").checked,
      youtube: $("allow-youtube").checked,
    },
  });
  if (!response.ok) {
    await refresh();
    showMessage(response.error || "Could not start focus.", true);
    return;
  }
  await refresh();
});

$("stop").addEventListener("click", async () => {
  $("stop").disabled = true;
  await send({ type: "focus-guard-stop" });
  $("stop").disabled = false;
  await refresh();
});

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("recheck").addEventListener("click", async () => {
  showMessage("Checking this page…");
  await send({ type: "focus-guard-check-now" });
  setTimeout(refresh, 700);
});

refresh();
setInterval(refresh, 5_000);
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status || changeInfo.url || changeInfo.title) refresh();
});
chrome.storage.onChanged.addListener(refresh);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "focus-guard-diagnostics-changed") refresh();
});
