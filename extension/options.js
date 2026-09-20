const $ = (id) => document.getElementById(id);

function values() {
  return {
    accountId: $("account-id").value.trim(),
    apiToken: $("api-token").value.trim(),
    gatewayId: $("gateway-id").value.trim() || "jev-local",
    gatewayToken: $("gateway-token").value.trim(),
  };
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => {
    resolve(chrome.runtime.lastError
      ? { ok: false, error: chrome.runtime.lastError.message }
      : response);
  }));
}

function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}

async function load() {
  $("version").textContent = `Focus Guard ${chrome.runtime.getManifest().version}`;
  const response = await send({ type: "focus-guard-get-settings" });
  if (!response?.ok) return message(response?.error || "Could not load settings.", true);
  const settings = response.settings || {};
  $("account-id").value = settings.accountId || "";
  $("api-token").value = settings.apiToken || "";
  $("gateway-id").value = settings.gatewayId || "jev-local";
  $("gateway-token").value = settings.gatewayToken || "";
}

$("save").addEventListener("click", async () => {
  const settings = values();
  if (!settings.accountId || !settings.apiToken) return message("Account ID and API token are required.", true);
  const response = await send({ type: "focus-guard-save-settings", settings });
  message(response?.ok ? "Settings saved." : (response?.error || "Could not save settings."), !response?.ok);
});

$("test").addEventListener("click", async () => {
  const settings = values();
  $("test").disabled = true;
  message("Checking JEV…");
  const response = await send({ type: "focus-guard-test-jev", settings });
  $("test").disabled = false;
  message(response?.ok ? "JEV is connected." : (response?.error || "JEV connection failed."), !response?.ok);
});

load();
