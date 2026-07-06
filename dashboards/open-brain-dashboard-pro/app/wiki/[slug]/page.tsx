import Link from "next/link";
import { fetchWikiPage, ApiError } from "@/lib/api";
import { requireSessionOrRedirect } from "@/lib/auth";
import { FormattedDate } from "@/components/FormattedDate";
import { WikiSectionPanel } from "./WikiSectionPanel";
import { AddSectionForm } from "./AddSectionForm";
import { ArchivePageButton } from "./ArchivePageButton";
import { RegenerateProfileButton } from "./RegenerateProfileButton";

export const dynamic = "force-dynamic";

export default async function WikiPageDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const { slug } = await params;

  let data;
  try {
    data = await fetchWikiPage(apiKey, slug);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/page] upstream", err.status, err.upstreamBody);
      if (err.status === 404) {
        return (
          <div className="space-y-4">
            <Link href="/wiki" className="text-sm text-text-muted hover:text-violet transition-colors">
              ← Wiki
            </Link>
            <p className="text-text-secondary">Page not found.</p>
          </div>
        );
      }
    } else {
      console.error("[wiki/page]", err);
    }
    return (
      <div className="space-y-4">
        <Link href="/wiki" className="text-sm text-text-muted hover:text-violet transition-colors">
          ← Wiki
        </Link>
        <p className="text-danger text-sm">Failed to load page.</p>
      </div>
    );
  }

  const { page, sections } = data;
  const archived = page.status === "archived";
  // Sections come back in display_order per the contract; sort defensively so a
  // gateway that returns them unordered still renders predictably (tie-break on
  // created_at so the order is stable).
  const orderedSections = [...sections].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.created_at.localeCompare(b.created_at);
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/wiki" className="text-sm text-text-muted hover:text-violet transition-colors">
          ← Wiki
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold break-words">{page.title}</h1>
              <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg-elevated text-text-muted capitalize">
                {page.page_kind}
              </span>
              {archived && (
                <span className="text-xs px-2 py-0.5 rounded border border-amber/30 bg-amber/10 text-amber">
                  archived
                </span>
              )}
            </div>
            <p className="text-text-muted text-xs mt-1 font-mono">{page.slug}</p>
          </div>
          <div className="flex items-start gap-2">
            {/* The user-profile page is built by the wiki-profile consolidation
                worker; give it a one-click regenerate. Other slugs have no
                backing generator, so the button only renders here. */}
            {page.slug === "user-profile" && <RegenerateProfileButton />}
            {!archived && <ArchivePageButton slug={page.slug} />}
          </div>
        </div>
      </div>

      {archived && (
        <div className="bg-bg-surface border border-amber/30 rounded-lg px-4 py-3">
          <p className="text-text-secondary text-sm">
            This page is archived — hidden from the wiki list, but its sections stay editable by slug.
          </p>
        </div>
      )}

      {/* Sections */}
      {orderedSections.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-lg p-8 text-center">
          <p className="text-text-muted text-sm">This page has no sections yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orderedSections.map((section) => (
            <WikiSectionPanel
              key={section.id}
              slug={page.slug}
              section={section}
            />
          ))}
        </div>
      )}

      {/* Add section — allowed on archived pages too: the gateway permits
          section writes regardless of page status (wiki_write_section parity). */}
      <div>
        <AddSectionForm slug={page.slug} />
      </div>

      <p className="text-text-muted text-xs">
        Created <FormattedDate date={page.created_at} /> · Updated{" "}
        <FormattedDate date={page.updated_at} />
      </p>
    </div>
  );
}
