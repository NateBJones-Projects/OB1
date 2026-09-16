#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { screenshotDir, walkthroughSections } from "./walkthrough-content.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const outDir = path.join(repoRoot, screenshotDir);
const baseUrl = process.env.OB1_DASHBOARD_BASE_URL || "http://127.0.0.1:3020";
const apiKey = process.env.OB1_DASHBOARD_DEMO_KEY || "local-screenshot-key";
const chromePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});

const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

await login(page);

const captured = [];
for (const section of walkthroughSections) {
  const url = new URL(section.path, baseUrl).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByText(section.waitFor, { exact: false }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const file = path.join(outDir, `${section.slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  captured.push(file);
}

await browser.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      screenshot_dir: outDir,
      captured: captured.map((file) => path.relative(repoRoot, file)),
    },
    null,
    2
  )
);

async function login(page) {
  await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/login")) return;
  await page.getByLabel("OB1 Access Key").fill(apiKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}
