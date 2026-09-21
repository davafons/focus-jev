#!/usr/bin/env node
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectDir = resolve(import.meta.dirname, "..");
const stagingDir = await mkdtemp(join(tmpdir(), "focus-jev-firefox-"));
const sourceDir = join(stagingDir, "extension");
const outputDir = join(projectDir, "dist");

try {
  await cp(join(projectDir, "extension"), sourceDir, { recursive: true });
  const manifestPath = join(sourceDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.background = {
    scripts: ["core.js", "background.js"],
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: "focus-jev@lostcoords.com",
      strict_min_version: "126.0",
      data_collection_permissions: {
        required: ["authenticationInfo", "browsingActivity", "websiteContent"],
      },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(outputDir, { recursive: true });
  const releaseFilename = `focus_jev-firefox-${manifest.version}.zip`;
  await rm(join(outputDir, releaseFilename), { force: true });
  const lint = spawnSync("npx", ["web-ext", "lint", "--source-dir", sourceDir], { cwd: projectDir, stdio: "inherit" });
  if (lint.status !== 0) process.exitCode = lint.status || 1;
  if (process.exitCode) process.exit();
  const build = spawnSync("npx", ["web-ext", "build", "--source-dir", sourceDir, "--artifacts-dir", outputDir, "--filename", releaseFilename, "--overwrite-dest"], { cwd: projectDir, stdio: "inherit" });
  if (build.status !== 0) process.exitCode = build.status || 1;
} finally {
  await rm(stagingDir, { recursive: true, force: true });
}
