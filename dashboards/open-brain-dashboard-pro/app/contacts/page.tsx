import Link from "next/link";
import { fetchCrmContacts, ApiError } from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { FormattedDate } from "@/components/FormattedDate";
import { SetupState } from "@/components/SetupState";

export const dynamic = "force-dynamic";

const TIERS = ["standard", "sensitive", "restricted"];

function TierBadge({ tier }: { tier: string }) {
  const color =
    tier === "restricted"
      ? "text-danger border-danger/30 bg-danger/10"
      : tier === "sensitive"
        ? "text-amber border-amber/30 bg-amber/10"
        : "text-text-muted border-border bg-bg-elevated";
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${color}`}>
      {tier}
    </span>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const excludeRestricted = session.restrictedUnlocked !== true;
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const q = params.q || "";
  const tier = params.privacy_tier || "";

  // If we already know from login (or a re-check) the brain has no CRM
  // surface, short-circuit to the setup state without a doomed fetch.
  // `crmEnabled === false` is the only negative signal we trust; `undefined`
  // (old cookie, pre-dating this field) falls through to the fetch below,
  // whose 404 handling covers the schema-missing case anyway.
  if (session.crmEnabled === false) {
    return <SetupState surface="crm" />;
  }

  let data;
  try {
    data = await fetchCrmContacts(apiKey, {
      page,
      per_page: 25,
      q: q || undefined,
      privacy_tier: tier || undefined,
      exclude_restricted: excludeRestricted,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contacts] upstream", err.status, err.upstreamBody);
      // 404 → the brain doesn't have the crm-core schema/routes. Show the
      // same setup state as the cached-negative case.
      if (err.status === 404) {
        return <SetupState surface="crm" />;
      }
    } else {
      console.error("[contacts]", err);
    }
    const safeMessage = err instanceof ApiError ? err.message : "";
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="text-danger text-sm">Failed to load contacts. {safeMessage}</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.per_page);

  function pageUrl(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (q) sp.set("q", q);
    if (tier) sp.set("privacy_tier", tier);
    return `/contacts?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Contacts</h1>
          <p className="text-text-secondary text-sm">
            {data.total.toLocaleString()} total contacts
          </p>
        </div>
        <Link
          href="/contacts/new"
          className="px-3 py-2 text-sm bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          New contact
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form method="GET" action="/contacts" className="flex-1 min-w-[200px]">
          {tier && <input type="hidden" name="privacy_tier" value={tier} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, org, or email…"
            className="w-full px-4 py-2 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition text-sm"
          />
        </form>
        <div className="flex gap-1.5">
          <Link
            href={q ? `/contacts?q=${encodeURIComponent(q)}` : "/contacts"}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              tier === "" ? "bg-violet-surface text-violet border-violet/20" : "bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover"
            }`}
          >
            All tiers
          </Link>
          {TIERS.map((t) => {
            const sp = new URLSearchParams();
            if (q) sp.set("q", q);
            sp.set("privacy_tier", t);
            return (
              <Link
                key={t}
                href={`/contacts?${sp.toString()}`}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
                  tier === t ? "bg-violet-surface text-violet border-violet/20" : "bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {t}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Organization</th>
              <th className="text-left px-4 py-3 font-medium w-28">Tier</th>
              <th className="text-left px-4 py-3 font-medium w-40">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  No contacts found.
                </td>
              </tr>
            )}
            {data.data.map((contact) => (
              <tr key={contact.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="text-text-primary hover:text-violet transition-colors font-medium"
                  >
                    {contact.display_name}
                  </Link>
                  {contact.job_title && (
                    <span className="text-text-muted text-xs block">{contact.job_title}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {contact.organization_name || <span className="text-text-muted">—</span>}
                </td>
                <td className="px-4 py-3">
                  <TierBadge tier={contact.privacy_tier} />
                </td>
                <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                  <FormattedDate date={contact.updated_at} />
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
