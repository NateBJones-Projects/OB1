import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchWikiPageBySlug, ApiError } from "@/lib/api";
import { requireSessionOrRedirect } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WikiArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const { slug } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) notFound();

  let page: Awaited<ReturnType<typeof fetchWikiPageBySlug>>;
  try {
    page = await fetchWikiPageBySlug(apiKey, slug);
  } catch (err) {
    // 403 = restricted (shouldn't occur — browse fetches with exclude_restricted=false);
    // degrade to not-found rather than surfacing a 500.
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  if (!page) notFound();

  const meta = (page.metadata ?? {}) as Record<string, unknown>;
  const title = (meta.wiki_title as string) || (meta.wiki_slug as string) || slug;

  return (
    <article className="space-y-6">
      <div>
        <Link href="/wiki" className="text-xs text-violet hover:underline">
          Wiki
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-text-muted">
          {typeof meta.wiki_type === "string" && (
            <span className="uppercase tracking-wide">{meta.wiki_type}</span>
          )}
          {typeof meta.generated_at === "string" && (
            <>
              <span className="text-text-muted/50">/</span>
              <span>generated {meta.generated_at.slice(0, 10)}</span>
            </>
          )}
        </div>
      </div>

      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-p:leading-relaxed prose-a:text-violet prose-strong:text-text-primary prose-blockquote:border-violet/40 prose-blockquote:text-text-secondary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown>
      </div>
    </article>
  );
}
