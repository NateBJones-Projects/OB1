import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchWikiPage, ApiError } from "@/lib/api";
import { requireSessionOrRedirect } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WikiArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();

  let page: Awaited<ReturnType<typeof fetchWikiPage>>;
  try {
    page = await fetchWikiPage(apiKey, Number(id));
  } catch (err) {
    // 404 = no such id; 403 = restricted (shouldn't occur — we fetch with
    // exclude_restricted=false — but guard so it degrades to not-found, not 500).
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  if (page.source_type !== "wiki_entity" && page.source_type !== "wiki_topic") {
    notFound();
  }

  const meta = page.metadata as Record<string, unknown>;
  const title = (meta.wiki_title as string) || (meta.wiki_slug as string) || `#${page.id}`;

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
