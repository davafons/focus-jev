const $ = (id) => document.getElementById(id);
const DEFAULT_HOSTED_URL = "https://api.focus-jev.lostcoords.com";
let savedHostedUrl = "";
let savedDeviceToken = "";

function values() {
  const provider = $("provider").value;
  const hostedUrl = $("hosted-url").value.trim();
  return {
    provider,
    hostedUrl,
    deviceToken: provider === "hosted" && hostedUrl === savedHostedUrl ? savedDeviceToken : "",
    accountId: $("account-id").value.trim(),
    apiToken: provider === "typesafe" ? $("typesafe-api-token").value.trim()
      : (provider === "compatible" ? $("compatible-api-token").value.trim() : $("api-token").value.trim()),
    gatewayId: $("gateway-id").value.trim() || "jev-local",
    gatewayToken: $("gateway-token").value.trim(),
    typesafeModel: $("typesafe-model").value.trim() || "jev-latest",
    compatibleUrl: $("compatible-url").value.trim(),
    compatibleModel: $("compatible-model").value.trim() || "jev-latest",
  };
}

function updateProviderFields() {
  const provider = $("provider").value;
  $("hosted-fields").hidden = provider !== "hosted";
  $("cloudflare-fields").hidden = provider !== "cloudflare";
  $("typesafe-fields").hidden = provider !== "typesafe";
  $("compatible-fields").hidden = provider !== "compatible";
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
  $("version").textContent = `Focus JEV ${chrome.runtime.getManifest().version}`;
  const response = await send({ type: "focus-guard-get-settings" });
  if (!response?.ok) return message(response?.error || "Could not load settings.", true);
  const settings = response.settings || {};
  const provider = settings.provider || ((settings.accountId || settings.apiToken) ? "cloudflare" : "hosted");
  $("provider").value = provider;
  $("hosted-url").value = settings.hostedUrl || DEFAULT_HOSTED_URL;
  savedHostedUrl = settings.hostedUrl || DEFAULT_HOSTED_URL;
  savedDeviceToken = settings.deviceToken || "";
  $("account-id").value = provider === "cloudflare" ? (settings.accountId || "") : "";
  $("api-token").value = provider === "cloudflare" ? (settings.apiToken || "") : "";
  $("gateway-id").value = settings.gatewayId || "jev-local";
  $("gateway-token").value = settings.gatewayToken || "";
  $("typesafe-api-token").value = provider === "typesafe" ? (settings.apiToken || "") : "";
  $("typesafe-model").value = settings.typesafeModel || "jev-latest";
  $("compatible-url").value = settings.compatibleUrl || "";
  $("compatible-api-token").value = provider === "compatible" ? (settings.apiToken || "") : "";
  $("compatible-model").value = settings.compatibleModel || "jev-latest";
  updateProviderFields();
}

$("save").addEventListener("click", async () => {
  const settings = values();
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
$("provider").addEventListener("change", updateProviderFields);
