#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { guideTitle, screenshotDir, walkthroughSections } from "./walkthrough-content.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const outputDir = path.join(import.meta.dirname, "output");
const htmlPath = path.join(outputDir, "OB1-Agent-Dashboard-Walkthrough.html");
const pdfPath = path.join(outputDir, "OB1-Agent-Dashboard-Walkthrough.pdf");
const brandPath = path.join(repoRoot, "docs/assets/agent-memory/brand/ob1-logo.png");
const chromePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(outputDir, { recursive: true });
await writeFile(htmlPath, buildHtml(), "utf8");

try {
  await execFileAsync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--print-to-pdf=${pdfPath}`,
      "--print-to-pdf-no-header",
      pathToFileURL(htmlPath).toString(),
    ],
    { timeout: 15000 }
  );
} catch (error) {
  if (!hasTimedOut(error) || !(await fileExists(pdfPath))) throw error;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      html: htmlPath,
      pdf: pdfPath,
    },
    null,
    2
  )
);

function buildHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(guideTitle)}</title>
  <style>
    @page { size: 16in 9in; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #111511;
      color: #ece5d1;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .page {
      position: relative;
      width: 16in;
      height: 9in;
      overflow: hidden;
      padding: .72in .82in;
      break-after: page;
      background:
        linear-gradient(90deg, rgba(236,229,209,.06) 1px, transparent 1px),
        linear-gradient(rgba(236,229,209,.045) 1px, transparent 1px),
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='132' height='22' viewBox='0 0 132 22'%3E%3Ctext x='0' y='9' fill='%23ece5d1' fill-opacity='.09' font-family='monospace' font-size='5.7' letter-spacing='1.8'%3ENBJ OB1%3C/text%3E%3Ctext x='66' y='20' fill='%23ece5d1' fill-opacity='.06' font-family='monospace' font-size='5.7' letter-spacing='1.8'%3ENBJ OB1%3C/text%3E%3C/svg%3E"),
        linear-gradient(120deg, #161b17, #101310 70%);
      background-size: 96px 96px, 96px 96px, 132px 22px, cover;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: .16in;
      color: #a6c675;
      font-size: .13in;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .brand img {
      width: .44in;
      height: .44in;
      object-fit: contain;
      border: 1px solid rgba(166,198,117,.45);
      padding: .08in;
    }
    .title {
      margin-top: 1.2in;
      max-width: 8.8in;
      font-size: .72in;
      line-height: .95;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: .26in;
      max-width: 7.5in;
      color: rgba(236,229,209,.72);
      font-size: .24in;
      line-height: 1.35;
    }
    .meta {
      position: absolute;
      right: .82in;
      bottom: .68in;
      color: rgba(236,229,209,.55);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .13in;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .grid {
      display: grid;
      grid-template-columns: 9.8in 4.3in;
      gap: .48in;
      align-items: start;
    }
    .shot {
      width: 9.8in;
      height: 5.51in;
      object-fit: cover;
      border: 1px solid rgba(236,229,209,.22);
      box-shadow: 0 .18in .7in rgba(0,0,0,.38);
    }
    .eyebrow {
      color: #a6c675;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .12in;
      font-weight: 700;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      margin: .13in 0 .14in;
      font-size: .46in;
      line-height: 1.02;
      letter-spacing: 0;
    }
    .summary {
      color: rgba(236,229,209,.73);
      font-size: .19in;
      line-height: 1.42;
    }
    .callouts {
      display: grid;
      gap: .14in;
      margin-top: .3in;
      padding: 0;
      list-style: none;
    }
    .callouts li {
      border: 1px solid rgba(236,229,209,.16);
      background: rgba(236,229,209,.045);
      padding: .16in .18in;
      color: rgba(236,229,209,.78);
      font-size: .15in;
      line-height: 1.38;
    }
    .footer {
      position: absolute;
      left: .82in;
      bottom: .38in;
      right: .82in;
      display: flex;
      justify-content: space-between;
      color: rgba(236,229,209,.48);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .1in;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <section class="page">
    <div class="brand">
      <img src="${pathToFileURL(brandPath)}" alt="" />
      <span>Nate B. Jones / OB1</span>
    </div>
    <div class="title">OB1 Agent Dashboard Walkthrough</div>
    <div class="subtitle">A screenshot-first guide to the dashboard surfaces that make agent memory visible, reviewable, and useful for real work.</div>
    <div class="meta">Personal continuity layer / OpenClaw launch demo</div>
  </section>

  ${walkthroughSections.map(renderSection).join("\n")}
</body>
</html>`;
}

function renderSection(section, index) {
  const imagePath = path.join(repoRoot, screenshotDir, `${section.slug}.png`);
  return `<section class="page">
    <div class="grid">
      <img class="shot" src="${pathToFileURL(imagePath)}" alt="${escapeHtml(section.title)} screenshot" />
      <div>
        <div class="eyebrow">${escapeHtml(section.eyebrow)}</div>
        <h1>${escapeHtml(section.title)}</h1>
        <div class="summary">${escapeHtml(section.summary)}</div>
        <ul class="callouts">
          ${section.callouts.map((callout) => `<li>${escapeHtml(callout)}</li>`).join("\n")}
        </ul>
      </div>
    </div>
    <div class="footer">
      <span>NBJ / OB1</span>
      <span>${String(index + 1).padStart(2, "0")} / ${String(walkthroughSections.length).padStart(2, "0")}</span>
    </div>
  </section>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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
