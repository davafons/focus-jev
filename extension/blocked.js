const $ = (id) => document.getElementById(id);
let sessionId = "";

function originalIconUrl(decision) {
  const icon = String(decision.favIconUrl || "");
  if (icon && !icon.startsWith("chrome-extension://")) return icon;
  try {
    return new URL("/favicon.ico", decision.url).href;
  } catch {
    return "";
  }
}

function loadDetails() {
  chrome.runtime.sendMessage({ type: "focus-guard-blocked-details" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) return;
    const focus = response.focus || {};
    const decision = response.decision || {};

    if (!focus.active || (sessionId && focus.sessionId !== sessionId)) {
      history.back();
      return;
    }
    sessionId = focus.sessionId || "";
    $("goal").textContent = focus.goal || "Current focus session";
    $("page-title").textContent = decision.title || "This page";
    $("page-url").textContent = decision.url || "";
    const icon = originalIconUrl(decision);
    $("page-icon").src = icon;
    $("page-icon").classList.toggle("hidden", !icon);
    $("confidence").textContent = `${Math.round((Number(decision.confidence) || 0) * 100)}% block confidence`;
  });
}

$("back").addEventListener("click", () => history.back());
loadDetails();
setInterval(loadDetails, 2_000);
