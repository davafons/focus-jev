import assert from "node:assert/strict";
import worker from "../worker/src/index.mjs";

const installations = new Map();
const nonces = new Set();
const deviceUsage = new Map();
const globalUsage = new Map();

function database() {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.startsWith("SELECT id, secret_hash")) return installations.get(values[0]) || null;
              if (sql.startsWith("SELECT decision_count FROM monthly_usage")) return { decision_count: deviceUsage.get(`${values[0]}:${values[1]}`) || 0 };
              throw new Error(`Unexpected first query: ${sql}`);
            },
            async run() {
              if (sql.startsWith("INSERT INTO installations")) {
                const [id, secretHash, monthlyLimit, createdAt, updatedAt] = values;
                installations.set(id, { id, secret_hash: secretHash, plan: "free", monthly_limit: monthlyLimit, status: "active", created_at: createdAt, updated_at: updatedAt });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT OR IGNORE INTO request_nonces")) {
                const key = `${values[0]}:${values[1]}`;
                if (nonces.has(key)) return { meta: { changes: 0 } };
                nonces.add(key);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO monthly_usage")) {
                const key = `${values[0]}:${values[1]}`;
                const used = deviceUsage.get(key) || 0;
                if (used >= values[3]) return { meta: { changes: 0 } };
                deviceUsage.set(key, used + 1);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO global_usage")) {
                const key = values[0];
                const used = globalUsage.get(key) || 0;
                if (used >= values[2]) return { meta: { changes: 0 } };
                globalUsage.set(key, used + 1);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM request_nonces")) return { meta: { changes: 0 } };
              throw new Error(`Unexpected run query: ${sql}`);
            },
          };
        },
      };
    },
  };
}

const env = {
  DB: database(),
  AI: { run: async (model, input) => {
    assert.equal(model, "typesafe/jev");
    assert.equal(input.questions.should_block.type, "noul");
    return { response: { result: { result: { answers: { should_block: { type: "noul", noul: 0.12 } }, usage: { input_tokens: 32, output_tokens: 4 } } } } };
  } },
  DECISION_RATE_LIMITER: { limit: async () => ({ success: true }) },
  INSTALL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  JEV_PROVIDER: "cloudflare", AI_GATEWAY_ID: "focus-jev", FREE_MONTHLY_LIMIT: "1", GLOBAL_MONTHLY_LIMIT: "10", EXTENSION_ID: "",
};
const context = { waitUntil: () => {} };

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function base64UrlBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
async function sha256(text) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}
async function signedDecision(token, body, nonce) {
  const [, secret] = token.split(".");
  const timestamp = String(Date.now());
  const canonical = `POST\n/v1/decision\n${timestamp}\n${nonce}\n${await sha256(body)}`;
  const key = await crypto.subtle.importKey("raw", base64UrlBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))));
  return new Request("https://api.example.test/v1/decision", { method: "POST", headers: { authorization: `Device ${token}`, "content-type": "application/json", "x-jev-nonce": nonce, "x-jev-signature": signature, "x-jev-timestamp": timestamp }, body });
}

const installation = await worker.fetch(new Request("https://api.example.test/v1/install", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.10" }, body: JSON.stringify({ extensionVersion: "1.4.0" }) }), env, context);
assert.equal(installation.status, 200);
const { deviceToken } = await installation.json();
assert.match(deviceToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

const body = JSON.stringify({ focus: "Finish my writing", page: { url: "https://example.com/article", title: "Article", description: "Draft" } });
const first = await worker.fetch(await signedDecision(deviceToken, body, "aaaaaaaaaaaaaaaaaaaaaaaa"), env, context);
assert.equal(first.status, 200);
assert.equal((await first.json()).answers.should_block.noul, 0.12);

const replay = await worker.fetch(await signedDecision(deviceToken, body, "aaaaaaaaaaaaaaaaaaaaaaaa"), env, context);
assert.equal(replay.status, 401, "a nonce must not be accepted twice");

const limited = await worker.fetch(await signedDecision(deviceToken, body, "bbbbbbbbbbbbbbbbbbbbbbbb"), env, context);
assert.equal(limited.status, 429, "the per-installation monthly quota must be authoritative");

console.log("hosted gateway tests passed");
