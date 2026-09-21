const $ = (id) => document.getElementById(id);
let sessionId = "";

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
    $("page-icon").src = decision.favIconUrl || "icons/icon-32.png";
    $("confidence").textContent = `${Math.round((Number(decision.confidence) || 0) * 100)}% block confidence`;
  });
}

$("back").addEventListener("click", () => history.back());
loadDetails();
setInterval(loadDetails, 2_000);
