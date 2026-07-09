import Link from "next/link";
import { fetchWikiPages, ApiError } from "@/lib/api";
import { requireSessionOrRedirect } from "@/lib/auth";
import type { Thought } from "@/lib/types";

export const dynamic = "force-dynamic";

function title(t: Thought): string {
  const m = (t.metadata ?? {}) as Record<string, unknown>;
  return (m.wiki_title as string) || (m.wiki_slug as string) || `#${t.id}`;
}

function excerpt(t: Thought): string {
  return (t.content ?? "")
    .replace(/^#.*$/gm, "")
    .replace(/^>.*$/gm, "")
    .trim()
    .split(/\n\s*\n/)[0]
    ?.slice(0, 200) ?? "";
}

function Section({ heading, pages }: { heading: string; pages: Thought[] }) {
  if (pages.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">{heading}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {pages.map((p) => (
          <Link
            key={p.id}
            href={`/wiki/${p.id}`}
            className="bg-bg-surface border border-border rounded-lg p-4 hover:border-violet/40 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="font-medium text-text-primary truncate">
                {title(p)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0">
                {((p.metadata ?? {}) as Record<string, unknown>).wiki_type as string ?? "wiki"}
              </span>
            </div>
            {excerpt(p) && (
              <p className="text-xs text-text-secondary line-clamp-2 leading-snug">
                {excerpt(p)}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function WikiIndexPage() {
  const { apiKey } = await requireSessionOrRedirect();

  let topics: Thought[] = [];
  let entities: Thought[] = [];
  let error: string | null = null;
  try {
    const [t, e] = await Promise.all([
      fetchWikiPages(apiKey, "wiki_topic"),
      fetchWikiPages(apiKey, "wiki_entity"),
    ]);
    topics = t;
    entities = e;
  } catch (err) {
    error = err instanceof ApiError ? err.message : "Failed to load wiki pages.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Wiki</h1>
        <p className="text-text-secondary text-sm">
          Compiled understanding layer over your Open Brain. Raw entries stay in
          the database; these pages are regenerable synthesis.
        </p>
      </div>

      {error && (
        <div className="bg-bg-surface border border-border rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {!error && topics.length === 0 && entities.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-text-primary">No wiki pages yet</h2>
          <p className="text-sm text-text-secondary mt-1">
            Compile locally, then publish into your brain:
          </p>
          <pre className="mt-2 text-xs bg-bg-hover rounded p-2 overflow-x-auto">
            node recipes/wiki-compiler/compile-wiki.mjs{"\n"}
            node recipes/wiki-compiler/sync-wiki-to-brain.mjs
          </pre>
        </div>
      ) : (
        <>
          <Section heading="Topics" pages={topics} />
          <Section heading="Entities" pages={entities} />
        </>
      )}
    </div>
  );
}
