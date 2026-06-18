import Link from "next/link";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { revalidatePath } from "next/cache";
import {
  GenerateAutobiographyButton,
  type GenerateAutobiographyActionState,
} from "@/components/GenerateAutobiographyButton";

export const dynamic = "force-dynamic";

/**
 * Optional dashboard snippet — /wiki index page listing generated
 * articles from `public/data/wiki/*.md` and offering a one-click
 * regenerate via a Next.js Server Action.
 *
 * Adapt paths to match your dashboard layout:
 *   - WIKI_ARTIFACT_DIR: where your sync step lands synthesized markdown
 *     (relative to the Next app root).
 *   - SYNTHESIZE_SCRIPT: path to recipes/wiki-synthesis/scripts/synthesize-wiki.mjs
 *     relative to the script working directory (we use cwd = app's parent
 *     so scripts can read a shared .env.local).
 *   - Add your own auth guard (requireSessionOrRedirect or equivalent)
 *     before surfacing personal content.
 */

const WIKI_ARTIFACT_DIR = join("public", "data", "wiki");
const SYNTHESIZE_SCRIPT = "recipes/wiki-synthesis/scripts/synthesize-wiki.mjs";

interface WikiArticleMeta {
  slug: string;
  title: string;
  type?: string;
  generated_at?: string;
  source_count?: number;
  size_bytes: number;
  excerpt: string;
}

function readArticles(): WikiArticleMeta[] {
  const dir = join(process.cwd(), WIKI_ARTIFACT_DIR);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
    .sort();
  return files.map((f) => parseArticle(join(dir, f), f));
}

function parseArticle(filePath: string, filename: string): WikiArticleMeta {
  const slug = filename.replace(/\.md$/, "");
  const raw = readFileSync(filePath, "utf8");
  const size_bytes = statSync(filePath).size;

  // Minimal YAML frontmatter parse — key: value pairs until closing ---
  const meta: Record<string, string> = {};
  let body = raw;
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*?)\s*$/);
      if (m) meta[m[1]] = m[2];
    }
    body = fmMatch[2];
  }

  const firstPara =
    body
      .replace(/^#.*$/gm, "")
      .replace(/^>.*$/gm, "")
      .trim()
      .split(/\n\s*\n/)[0]
      ?.slice(0, 280) ?? "";

  return {
    slug,
    title: meta.title ?? slug.replace(/-/g, " "),
    type: meta.type,
    generated_at: meta.generated_at,
    source_count: meta.source_count ? Number(meta.source_count) : undefined,
    size_bytes,
    excerpt: firstPara,
  };
}

export default async function WikiIndexPage() {
  // Add your dashboard's auth guard here before surfacing private content.
  // e.g. await requireSessionOrRedirect();
  const articles = readArticles();

  async function generateAutobiographyAction(
    _prev: GenerateAutobiographyActionState,
    formData: FormData,
  ): Promise<GenerateAutobiographyActionState> {
    "use server";
    // Add your dashboard's auth guard here before spawning a subprocess
    // that holds service-role credentials. e.g.
    //   const session = await requireSessionOrRedirect();
    //   if (!session.isAdmin) return { status: "error", message: "unauthorized" };
    const rawYear = String(formData.get("scope_year") ?? "").trim();
    if (rawYear && !/^(19|20)\d{2}$/.test(rawYear)) {
      return { status: "error", message: "Invalid year — expected YYYY." };
    }
    const scopeYear = rawYear;
    const repoRoot = resolve(process.cwd(), "..");
    try {
      await runSynthesizer(repoRoot, scopeYear);
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    revalidatePath("/wiki");
    const slug = scopeYear ? `autobiography-${scopeYear}` : "autobiography";
    return {
      status: "ok",
      message: scopeYear
        ? `Generated autobiography for ${scopeYear}.`
        : "Generated autobiography (all years).",
      slug,
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Wiki</h1>
          <p className="text-text-secondary text-sm">
            LLM-synthesized articles over your thoughts. Raw entries in Open
            Brain, synthesized articles here.
          </p>
        </div>
        {articles.length > 0 && (
          <GenerateAutobiographyButton
            action={generateAutobiographyAction}
            variant="chip"
          />
        )}
      </div>

      {articles.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              No articles yet
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              Generate your first article. The synthesizer runs an LLM over
              your thoughts, one call per year, and writes results to{" "}
              <code className="px-1 py-0.5 text-xs bg-bg-hover rounded">
                output/wiki/
              </code>
              . Wire up your own sync step to mirror that into{" "}
              <code className="px-1 py-0.5 text-xs bg-bg-hover rounded">
                {WIKI_ARTIFACT_DIR}
              </code>
              .
            </p>
          </div>

          <GenerateAutobiographyButton action={generateAutobiographyAction} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {articles.map((a) => (
            <Link
              key={a.slug}
              href={`/wiki/${a.slug}`}
              className="bg-bg-surface border border-border rounded-lg p-4 hover:border-violet/40 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-medium text-text-primary truncate">
                  {a.title}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0">
                  {a.type ?? "wiki"}
                </span>
              </div>
              {a.excerpt && (
                <p className="text-xs text-text-secondary line-clamp-2 leading-snug mb-2">
                  {a.excerpt}
                </p>
              )}
              <div className="flex items-center gap-2 text-[10px] text-text-muted">
                {a.generated_at && (
                  <span>gen {a.generated_at.slice(0, 10)}</span>
                )}
                {a.source_count && (
                  <>
                    <span className="text-text-muted/50">/</span>
                    <span>{a.source_count.toLocaleString()} sources</span>
                  </>
                )}
                <span className="text-text-muted/50">/</span>
                <span>{(a.size_bytes / 1024).toFixed(1)} KB</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Spawn helpers ──────────────────────────────────────────────────────

function runSynthesizer(repoRoot: string, scopeYear: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [SYNTHESIZE_SCRIPT, "--topic", "autobiography"];
    if (scopeYear) args.push("--scope", `year=${scopeYear}`);
    // Pass only the env vars synthesize-wiki.mjs needs. Don't forward
    // the full process.env — that would leak every unrelated host secret
    // (session keys, cloud tokens, etc.) to a long-lived child process.
    // The script also reads .env.local from its cwd, so missing vars can
    // be supplied there.
    const allowlist = [
      "OPEN_BRAIN_URL",
      "OPEN_BRAIN_SERVICE_KEY",
      "LLM_BASE_URL",
      "LLM_API_KEY",
      "LLM_MODEL",
      "SUBJECT_NAME",
      "SOURCE_TYPE_FILTER",
      "WIKI_OUTPUT_DIR",
      "PATH",
      "NODE_PATH",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "SystemRoot",
    ];
    const childEnv: NodeJS.ProcessEnv = {};
    for (const k of allowlist) {
      const v = process.env[k];
      if (typeof v === "string") childEnv[k] = v;
    }
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.stdout.on("data", () => {
      /* Discard stdout — script is chatty. Errors go to stderr. */
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `synthesize-wiki exited ${code}${stderr ? `: ${stderr.slice(-400).trim()}` : ""}`,
          ),
        );
      }
    });
  });
}
