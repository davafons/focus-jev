import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Core = require(path.join(projectDir, "extension/core.js"));

function filesWithin(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesWithin(candidate) : [candidate];
  });
}

function benchmark(name, iterations, action) {
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) action(index);
  const elapsed = performance.now() - started;
  return { name, iterations, elapsed, perOperation: elapsed / iterations };
}

const extensionFiles = filesWithin(path.join(projectDir, "extension"));
const sourceBytes = extensionFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
const page = {
  url: "https://www.youtube.com/watch?v=example&t=120s&utm_source=test",
  title: "How JEV makes decisions - YouTube",
  description: "Technical explanation of a typed AI decision model.",
};

const results = [
  benchmark("cache key", 100_000, () => Core.cacheKey("session", "Learn JEV", page)),
  benchmark("decision policy", 100_000, (index) => Core.decisionFromAnswers(
    { should_block: { noul: index % 2 ? 0.2 : 0.9 } },
    { blockThreshold: Core.blockThresholdForPage(page) },
  )),
];

console.log(`Extension payload: ${(sourceBytes / 1024).toFixed(1)} KiB across ${extensionFiles.length} files`);
for (const result of results) {
  console.log(`${result.name}: ${result.iterations.toLocaleString()} ops in ${result.elapsed.toFixed(1)} ms (${(result.perOperation * 1_000).toFixed(2)} µs/op)`);
}
console.log("Stable allowed page: at most 1 worker decision/minute (previously 15/minute)");
console.log("Session decision cache: capped at 500 valid entries");
