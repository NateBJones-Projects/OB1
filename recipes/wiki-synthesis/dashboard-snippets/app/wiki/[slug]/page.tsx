import Link from "next/link";
import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const dynamic = "force-dynamic";

/**
 * Optional dashboard snippet — renders a single synthesized article
 * from `public/data/wiki/<slug>.md`. Strips YAML frontmatter, renders
 * the markdown body with react-markdown + remark-gfm.
 *
 * Add your dashboard's auth guard before surfacing personal content.
 */
export default async function WikiArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Add your dashboard's auth guard here.
  // e.g. await requireSessionOrRedirect();
  const { slug } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) notFound();

  const filePath = join(process.cwd(), "public", "data", "wiki", `${slug}.md`);
  if (!existsSync(filePath)) notFound();

  const raw = readFileSync(filePath, "utf8");
  const { meta, body } = splitFrontmatter(raw);

  return (
    <article className="space-y-6">
      <div>
        <Link href="/wiki" className="text-xs text-violet hover:underline">
          Wiki
        </Link>
        <h1 className="text-2xl font-semibold mt-1">
          {meta.title ?? slug.replace(/-/g, " ")}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-text-muted">
          {meta.type && (
            <span className="uppercase tracking-wide">{meta.type}</span>
          )}
          {meta.generated_at && (
            <>
              <span className="text-text-muted/50">/</span>
              <span>generated {meta.generated_at.slice(0, 10)}</span>
            </>
          )}
          {meta.source_count && (
            <>
              <span className="text-text-muted/50">/</span>
              <span>{Number(meta.source_count).toLocaleString()} sources</span>
            </>
          )}
          {meta.dry_run === "true" && (
            <>
              <span className="text-text-muted/50">/</span>
              <span className="text-amber-400">dry-run</span>
            </>
          )}
        </div>
      </div>

      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-p:leading-relaxed prose-a:text-violet prose-strong:text-text-primary prose-blockquote:border-violet/40 prose-blockquote:text-text-secondary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    </article>
  );
}

function splitFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const p = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*?)\s*$/);
    if (p) meta[p[1]] = p[2];
  }
  return { meta, body: m[2] };
}
