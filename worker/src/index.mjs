const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

function json(request, env, body, status = 200) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  const origin = request.headers.get("origin");
  const extensionOrigin = env.EXTENSION_ID ? `chrome-extension://${env.EXTENSION_ID}` : "";
  if (origin && extensionOrigin && origin === extensionOrigin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, content-type, x-jev-nonce, x-jev-signature, x-jev-timestamp");
    headers.set("vary", "origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function error(request, env, code, status) {
  return json(request, env, { error: code }, status);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlBytes(value) {
  const padded = String(value).replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - String(value).length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sha256Base64(value) {
  return base64Url(await sha256(value));
}

async function hmacBase64(secret, message) {
  const key = await crypto.subtle.importKey("raw", base64UrlBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(left, right);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function sameText(left, right) {
  return sameBytes(encoder.encode(left), encoder.encode(right));
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function currentMonth(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}

function normalizeText(value, maxLength) {
  return String(value || "").replaceAll("\u0000", "").trim().slice(0, maxLength);
}

function normalizeUrl(value) {
  const raw = normalizeText(value, 2_000);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function pageType(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    const path = parsed.pathname.replace(/\/$/u, "").toLowerCase();
    if (["x.com", "twitter.com"].includes(host) && ["", "/home", "/explore"].includes(path)) return "Open-ended social-media timeline with algorithmically selected posts";
    if (["reddit.com", "old.reddit.com"].includes(host) && ["", "/r/all", "/r/popular"].includes(path)) return "Open-ended community content feed";
    if (["instagram.com", "threads.net", "facebook.com", "tiktok.com"].includes(host) && ["", "/explore", "/reels", "/watch", "/foryou"].includes(path)) return "Open-ended social-media or recommendation feed";
    if (host === "linkedin.com" && path === "/feed") return "Open-ended professional social-media feed";
    if (["youtube.com", "m.youtube.com"].includes(host) && path === "/watch") return "Individual video page";
  } catch {
    // Validation has already rejected malformed URLs.
  }
  return "Destination page";
}

function buildJevRequest(focus, page) {
  return {
    state: {
      focus_statement: focus,
      page: {
        url: page.url,
        title: page.title,
        type: pageType(page.url),
        context: page.description,
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

function answersFrom(result) {
  return result?.answers
    || result?.response?.result?.result?.answers
    || result?.result?.answers
    || result?.result?.result?.answers
    || {};
}

function usageFrom(result) {
  return result?.usage
    || result?.response?.result?.result?.usage
    || result?.result?.usage
    || result?.result?.result?.usage;
}

async function upstreamJson(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RangeError("upstream_payload_too_large");
  if (!response.body) throw new Error("upstream_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) throw new RangeError("upstream_payload_too_large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("upstream_failed");
  }
  if (!response.ok || !body?.answers || typeof body.answers !== "object") throw new Error("upstream_failed");
  return body;
}

async function runJev(env, request) {
  const provider = String(env.JEV_PROVIDER || "cloudflare").trim().toLowerCase();
  if (provider === "cloudflare") {
    return env.AI.run("typesafe/jev", request, { gateway: { id: env.AI_GATEWAY_ID } });
  }
  if (provider === "typesafe") {
    if (!env.TYPESAFE_API_KEY) throw new Error("typesafe_not_configured");
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...request, model: String(env.TYPESAFE_MODEL || "jev-latest") }),
    });
    return upstreamJson(response);
  }
  if (provider === "compatible") {
    if (!env.COMPATIBLE_SYSTEMONE_URL || !env.COMPATIBLE_API_KEY) throw new Error("compatible_not_configured");
    const response = await fetch(env.COMPATIBLE_SYSTEMONE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.COMPATIBLE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...request, model: String(env.COMPATIBLE_MODEL || "jev-latest") }),
    });
    return upstreamJson(response);
  }
  throw new Error("unsupported_provider");
}

async function readBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RangeError("payload_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) throw new RangeError("payload_too_large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function parsedBody(request) {
  const raw = await readBody(request);
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    throw new SyntaxError("invalid_json");
  }
}

function deviceToken(request) {
  const match = /^Device ([A-Za-z0-9_-]{20,80})\.([A-Za-z0-9_-]{20,128})$/u.exec(request.headers.get("authorization") || "");
  return match ? { id: match[1], secret: match[2] } : null;
}

async function authenticate(request, env, raw, now) {
  const token = deviceToken(request);
  const timestamp = Number(request.headers.get("x-jev-timestamp"));
  const nonce = request.headers.get("x-jev-nonce") || "";
  const signature = request.headers.get("x-jev-signature") || "";
  if (!token || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce) || !/^[A-Za-z0-9_-]{40,128}$/u.test(signature)) return null;

  const installation = await env.DB.prepare("SELECT id, secret_hash, plan, monthly_limit, status FROM installations WHERE id = ?").bind(token.id).first();
  if (!installation || installation.status !== "active" || !sameText(await sha256Base64(token.secret), installation.secret_hash)) return null;

  const path = new URL(request.url).pathname;
  const bodyHash = await sha256Base64(raw);
  const expected = await hmacBase64(token.secret, `${request.method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`);
  if (!sameText(expected, signature)) return null;

  const nonceHash = await sha256Base64(nonce);
  const result = await env.DB.prepare("INSERT OR IGNORE INTO request_nonces (installation_id, nonce_hash, expires_at) VALUES (?, ?, ?)").bind(token.id, nonceHash, now + NONCE_TTL_MS).run();
  if (Number(result.meta?.changes || 0) !== 1) return null;
  return { installation, token };
}

async function reserveQuota(env, installation, now) {
  const month = currentMonth(now);
  const deviceLimit = integer(installation.monthly_limit, 500, 1, 1_000_000);
  const globalLimit = integer(env.GLOBAL_MONTHLY_LIMIT, 25_000, 1, 100_000_000);
  const deviceResult = await env.DB.prepare(
    "INSERT INTO monthly_usage (installation_id, month, decision_count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(installation_id, month) DO UPDATE SET decision_count = monthly_usage.decision_count + 1, updated_at = excluded.updated_at WHERE monthly_usage.decision_count < ?",
  ).bind(installation.id, month, now, deviceLimit).run();
  if (Number(deviceResult.meta?.changes || 0) !== 1) return { ok: false, scope: "device" };

  const globalResult = await env.DB.prepare(
    "INSERT INTO global_usage (month, decision_count, updated_at) VALUES (?, 1, ?) ON CONFLICT(month) DO UPDATE SET decision_count = global_usage.decision_count + 1, updated_at = excluded.updated_at WHERE global_usage.decision_count < ?",
  ).bind(month, now, globalLimit).run();
  if (Number(globalResult.meta?.changes || 0) !== 1) return { ok: false, scope: "service" };
  return { ok: true };
}

async function usageStatus(env, installation, now) {
  const month = currentMonth(now);
  const row = await env.DB.prepare("SELECT decision_count FROM monthly_usage WHERE installation_id = ? AND month = ?").bind(installation.id, month).first();
  const used = Number(row?.decision_count || 0);
  const limit = integer(installation.monthly_limit, 500, 1, 1_000_000);
  return { plan: installation.plan, month, used, limit, remaining: Math.max(0, limit - used) };
}

async function install(request, env, now) {
  const rate = await env.INSTALL_RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "unknown" });
  if (!rate.success) return error(request, env, "try_again_later", 429);
  let body;
  try {
    ({ value: body } = await parsedBody(request));
  } catch (cause) {
    return error(request, env, cause instanceof RangeError ? "payload_too_large" : "invalid_json", cause instanceof RangeError ? 413 : 400);
  }
  if (typeof body !== "object" || body === null) return error(request, env, "invalid_request", 400);
  const extensionVersion = normalizeText(body.extensionVersion, 40);
  if (!extensionVersion) return error(request, env, "invalid_request", 400);

  const id = crypto.randomUUID();
  const secret = randomBase64Url(32);
  const monthlyLimit = integer(env.FREE_MONTHLY_LIMIT, 500, 1, 1_000_000);
  await env.DB.prepare("INSERT INTO installations (id, secret_hash, plan, monthly_limit, status, created_at, updated_at) VALUES (?, ?, 'free', ?, 'active', ?, ?)").bind(id, await sha256Base64(secret), monthlyLimit, now, now).run();
  return json(request, env, { deviceToken: `${id}.${secret}`, plan: "free", monthlyLimit });
}

async function decision(request, env, now) {
  let raw;
  let body;
  try {
    ({ raw, value: body } = await parsedBody(request));
  } catch (cause) {
    return error(request, env, cause instanceof RangeError ? "payload_too_large" : "invalid_json", cause instanceof RangeError ? 413 : 400);
  }
  const authenticated = await authenticate(request, env, raw, now);
  if (!authenticated) return error(request, env, "unauthorized", 401);
  const rate = await env.DECISION_RATE_LIMITER.limit({ key: authenticated.installation.id });
  if (!rate.success) return error(request, env, "rate_limited", 429);
  if (typeof body !== "object" || body === null) return error(request, env, "invalid_request", 400);

  const focus = normalizeText(body.focus, 8_000);
  const page = {
    url: normalizeUrl(body.page?.url),
    title: normalizeText(body.page?.title, 500),
    description: normalizeText(body.page?.description, 3_000),
  };
  if (!focus || !page.url) return error(request, env, "invalid_request", 400);

  const quota = await reserveQuota(env, authenticated.installation, now);
  if (!quota.ok) return error(request, env, quota.scope === "device" ? "monthly_limit_reached" : "service_capacity_reached", 429);

  try {
    const result = await runJev(env, buildJevRequest(focus, page));
    const answers = answersFrom(result);
    if (!Object.keys(answers).length) throw new Error("upstream_missing_answers");
    return json(request, env, { answers, usage: usageFrom(result) });
  } catch (cause) {
    console.error(JSON.stringify({
      event: "jev_unavailable",
      provider: String(env.JEV_PROVIDER || "cloudflare"),
      message: String(cause?.message || "unknown_error").slice(0, 200),
    }));
    return error(request, env, "jev_unavailable", 503);
  }
}

async function status(request, env, now) {
  const raw = "";
  const authenticated = await authenticate(request, env, raw, now);
  if (!authenticated) return error(request, env, "unauthorized", 401);
  return json(request, env, await usageStatus(env, authenticated.installation, now));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    ctx.waitUntil(env.DB.prepare("DELETE FROM request_nonces WHERE expires_at < ?").bind(Date.now()).run());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: json(request, env, {}).headers });
    if (request.method === "GET" && url.pathname === "/health") return json(request, env, { ok: true });
    if (request.method === "POST" && url.pathname === "/v1/install") return install(request, env, Date.now());
    if (request.method === "POST" && url.pathname === "/v1/decision") return decision(request, env, Date.now());
    if (request.method === "GET" && url.pathname === "/v1/status") return status(request, env, Date.now());
    return error(request, env, "not_found", 404);
  },
};
