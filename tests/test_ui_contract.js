const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extension = path.join(__dirname, "..", "extension");

function assertScriptIdsExist(pageName) {
  const html = fs.readFileSync(path.join(extension, `${pageName}.html`), "utf8");
  const script = fs.readFileSync(path.join(extension, `${pageName}.js`), "utf8");
  const ids = [...script.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${pageName}.html must provide #${id}`);
  }
}

assertScriptIdsExist("popup");
assertScriptIdsExist("options");
assertScriptIdsExist("blocked");

const popup = fs.readFileSync(path.join(extension, "popup.html"), "utf8");
assert.doesNotMatch(popup, />Current focus</i);
assert.doesNotMatch(popup, />Current page</i);
assert.doesNotMatch(popup, /<h1[^>]*>Focus Guard/i);
assert.match(popup, /<textarea[^>]+rows="5"[^>]+maxlength="8000"/);
assert.match(popup, /id="allow-music"/);
assert.doesNotMatch(popup, /id="allow-sns"/);
assert.doesNotMatch(popup, /id="allow-youtube"/);
assert.match(popup, /privacy\.html/);
assert.match(popup, /limited page metadata are sent to your selected provider/);
assert.match(popup, /without storing URLs, titles, page metadata, or decisions/);
assert.match(popup, /selected provider/);

const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));
const packageJSON = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
assert.equal(manifest.version, packageJSON.version, "package and extension versions must stay aligned");
for (const icon of Object.values(manifest.icons || {})) {
  assert.equal(fs.existsSync(path.join(extension, icon)), true, `missing manifest icon ${icon}`);
}
assert.equal(fs.existsSync(path.join(extension, "privacy.html")), true, "missing extension privacy page");

console.log("UI contract tests passed");
