#!/usr/bin/env node

import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { screenshotDir, walkthroughSections } from "./walkthrough-content.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const outDir = path.join(repoRoot, screenshotDir);
const baseUrl = process.env.OB1_DASHBOARD_BASE_URL || "http://127.0.0.1:3020";
const chromePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(outDir, { recursive: true });

const captured = [];
for (const section of walkthroughSections) {
  const file = path.join(outDir, `${section.slug}.png`);
  const url = new URL(section.path, baseUrl).toString();
  const userDataDir = await mkdtemp(path.join(tmpdir(), `ob1-walkthrough-${section.slug}-`));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-features=Translate,BackForwardCache",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--run-all-compositor-stages-before-draw",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1920,1080",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=3000",
    `--screenshot=${file}`,
    url,
  ];
  try {
    await execFileAsync(chromePath, args, { timeout: 10000 });
  } catch (error) {
    if (!hasTimedOut(error) || !(await fileExists(file))) throw error;
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
  captured.push(path.relative(repoRoot, file));
}

console.log(JSON.stringify({ ok: true, screenshot_dir: outDir, captured }, null, 2));

function hasTimedOut(error) {
  return error && (error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT");
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
