#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { screenshotDir, walkthroughSections } from "./walkthrough-content.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const publicDir = path.join(import.meta.dirname, "public");
const screenshotOut = path.join(publicDir, "screenshots");
const audioOut = path.join(publicDir, "audio");
const brandOut = path.join(publicDir, "brand");
const diagramsOut = path.join(publicDir, "diagrams");
const promoOut = path.join(publicDir, "promo");

await mkdir(screenshotOut, { recursive: true });
await mkdir(audioOut, { recursive: true });
await mkdir(brandOut, { recursive: true });
await mkdir(diagramsOut, { recursive: true });
await mkdir(promoOut, { recursive: true });

for (const section of walkthroughSections) {
  await copyFile(
    path.join(repoRoot, screenshotDir, `${section.slug}.png`),
    path.join(screenshotOut, `${section.slug}.png`)
  );
}

await copyFile(
  path.join(import.meta.dirname, "output/audio/voiceover.mp3"),
  path.join(audioOut, "voiceover.mp3")
);

await copyFile(
  path.join(repoRoot, "docs/assets/agent-memory/brand/ob1-logo.png"),
  path.join(brandOut, "ob1-logo.png")
);

await copyFile(
  path.join(repoRoot, "docs/assets/agent-memory/brand/ob1-beanie-mark-green.png"),
  path.join(brandOut, "ob1-beanie-mark-green.png")
);

const diagrams = [
  "continuity-layer",
  "agent-memory-loop",
  "recall-lifecycle",
  "writeback-lifecycle",
  "trust-ladder",
  "review-queue-flow",
  "recall-trace-debug",
  "code-review-workflow",
  "taskflow-work-log-handoff",
  "openclaw-plugin-skill-distribution",
];

for (const diagram of diagrams) {
  await copyFile(
    path.join(repoRoot, "docs/assets/agent-memory/video", `${diagram}.png`),
    path.join(diagramsOut, `${diagram}.png`)
  );
}

await copyFile(
  path.join(repoRoot, "docs/assets/agent-memory/promotional/final/nbj-ob1-agent-memory-hero-16x9.png"),
  path.join(promoOut, "nbj-ob1-agent-memory-hero-16x9.png")
);

console.log(JSON.stringify({ ok: true, public_dir: publicDir }, null, 2));
