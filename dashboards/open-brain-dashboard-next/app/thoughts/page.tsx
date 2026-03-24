import Link from "next/link";
import { fetchThoughts } from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { TypeBadge } from "@/components/ThoughtCard";
import { ThoughtsFilter } from "@/components/ThoughtsFilter";
import { FormattedDate } from "@/components/FormattedDate";

export const dynamic = "force-dynamic";

const TYPES = [
  "idea",
  "task",
  "person_note",
  "reference",
  "decision",
  "lesson",
  "meeting",
  "journal",
];

export default async function ThoughtsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const excludeRestricted = session.restrictedUnlocked !== true;
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const type = params.type || "";
  const source_type = params.source_type || "";
  const importance_min = params.importance_min
    ? parseInt(params.importance_min, 10)
    : undefined;

  let data;
  try {
    data = await fetchThoughts(apiKey, {
      page,
      per_page: 25,
      type: type || undefined,
      source_type: source_type || undefined,
      importance_min,
      exclude_restricted: excludeRestricted,
    });
  } catch (err) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Thoughts</h1>
        <p className="text-danger text-sm">
          Failed to load thoughts.{" "}
          {err instanceof Error ? err.message : ""}
        </p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.per_page);

  function pageUrl(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (type) sp.set("type", type);
    if (source_type) sp.set("source_type", source_type);
    if (importance_min) sp.set("importance_min", String(importance_min));
    return `/thoughts?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Thoughts</h1>
        <p className="text-text-secondary text-sm">
          {data.total.toLocaleString()} total thoughts
        </p>
      </div>

      {/* Filters */}
      <ThoughtsFilter
        types={TYPES}
        currentType={type}
        currentSource={source_type}
        currentImportance={importance_min}
      />

      {/* Table */}
      <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Content</th>
              <th className="text-left px-4 py-3 font-medium w-24">Type</th>
              <th className="text-left px-4 py-3 font-medium w-20">Imp.</th>
              <th className="text-left px-4 py-3 font-medium w-40">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.data.map((t) => (
              <tr
                key={t.id}
                className="hover:bg-bg-hover transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/thoughts/${t.id}`}
                    className="text-text-primary hover:text-violet transition-colors"
                  >
                    {t.content.length > 120
                      ? t.content.slice(0, 120) + "..."
                      : t.content}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <TypeBadge type={t.type} />
                </td>
                <td className="px-4 py-3 text-text-muted">{t.importance}</td>
                <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                  <FormattedDate date={t.created_at} />
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
