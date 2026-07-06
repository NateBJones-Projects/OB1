import Link from "next/link";
import { fetchWikiPages, ApiError } from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { FormattedDate } from "@/components/FormattedDate";
import { NewPageForm } from "./NewPageForm";
import type { WikiPageKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: WikiPageKind[] = ["topic", "entity", "autobiography", "custom"];

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded border border-border bg-bg-elevated text-text-muted capitalize">
      {kind}
    </span>
  );
}

// Shared inline empty-state shown when the wiki schema/routes are absent. Kept
// deliberately minimal and self-contained: a later PR replaces this with a
// shared setup-state component, so there is nothing here to migrate but one <p>.
function WikiNotInstalled() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Wiki</h1>
      </div>
      <div className="bg-bg-surface border border-border rounded-lg p-8">
        <p className="text-text-secondary text-sm max-w-prose">
          Wiki schema not installed — apply <code className="font-mono text-xs px-1 py-0.5 rounded bg-bg-elevated border border-border text-text-primary">schemas/wiki-pages</code>{" "}
          to your brain and deploy the <code className="font-mono text-xs px-1 py-0.5 rounded bg-bg-elevated border border-border text-text-primary">/wiki</code>{" "}
          gateway routes to enable persistent wiki pages. See the repo README for the setup steps.
        </p>
      </div>
    </div>
  );
}

export default async function WikiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const rawKind = params.page_kind || "";
  const kind = (KINDS as string[]).includes(rawKind) ? rawKind : "";

  // If we already know from login the brain has no wiki surface, short-circuit to
  // the empty-state without a doomed fetch. `wikiEnabled === false` is the only
  // negative signal we trust; `undefined` (old cookie) falls through to the fetch,
  // whose 404 handling covers the schema-missing case anyway.
  if (session.wikiEnabled === false) {
    return <WikiNotInstalled />;
  }

  let data;
  try {
    data = await fetchWikiPages(apiKey, {
      page,
      per_page: 25,
      page_kind: kind || undefined,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki] upstream", err.status, err.upstreamBody);
      // 404 → the brain doesn't have the wiki schema/routes. Show the same
      // inline empty-state as the cached-negative case.
      if (err.status === 404) {
        return <WikiNotInstalled />;
      }
    } else {
      console.error("[wiki]", err);
    }
    const safeMessage = err instanceof ApiError ? err.message : "";
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Wiki</h1>
        <p className="text-danger text-sm">Failed to load wiki pages. {safeMessage}</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.per_page);

  function pageUrl(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (kind) sp.set("page_kind", kind);
    return `/wiki?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Wiki</h1>
          <p className="text-text-secondary text-sm">
            {data.total.toLocaleString()} {data.total === 1 ? "page" : "pages"}
          </p>
        </div>
        <NewPageForm />
      </div>

      {/* Kind filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/wiki"
          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            kind === ""
              ? "bg-violet-surface text-violet border-violet/20"
              : "bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover"
          }`}
        >
          All
        </Link>
        {KINDS.map((k) => (
          <Link
            key={k}
            href={`/wiki?page_kind=${k}`}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
              kind === k
                ? "bg-violet-surface text-violet border-violet/20"
                : "bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {k}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium w-32">Kind</th>
              <th className="text-left px-4 py-3 font-medium w-24">Sections</th>
              <th className="text-left px-4 py-3 font-medium w-40">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  No wiki pages yet.
                </td>
              </tr>
            )}
            {data.data.map((wikiPage) => (
              <tr key={wikiPage.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/wiki/${encodeURIComponent(wikiPage.slug)}`}
                    className="text-text-primary hover:text-violet transition-colors font-medium"
                  >
                    {wikiPage.title}
                  </Link>
                  <span className="text-text-muted text-xs block font-mono">{wikiPage.slug}</span>
                </td>
                <td className="px-4 py-3">
                  <KindBadge kind={wikiPage.page_kind} />
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {wikiPage.section_count}
                </td>
                <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                  <FormattedDate date={wikiPage.updated_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageUrl(page - 1)}
                className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageUrl(page + 1)}
                className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
