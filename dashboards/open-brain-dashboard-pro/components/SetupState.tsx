"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

// Base URL for the schema-folder links on the setup cards. Defaults to the
// alanshurafa/OB1 fork because the optional schemas (crm-core, crm-engagement,
// wiki-pages) haven't landed on upstream main yet — an upstream link would 404
// at the card's primary call-to-action. Override with
// NEXT_PUBLIC_SCHEMA_REPO_BASE if you maintain your own repo/mirror.
// NEXT_PUBLIC_* vars are inlined at build time (static member expression, same
// mechanism as NEXT_PUBLIC_OPTIONAL_NAV in Sidebar.tsx).
const REPO_BASE =
  process.env.NEXT_PUBLIC_SCHEMA_REPO_BASE ||
  "https://github.com/alanshurafa/OB1/tree/main";

interface SurfaceCopy {
  label: string;
  /** Plural-aware noun for the intro sentence: "schema" or "schemas". */
  schemaNoun: string;
  schemaPaths: string[];
  routePrefix: string;
}

// schemaPaths are joined onto REPO_BASE to form the setup-card links. They
// must track the actual folder names in the repo tree — if a schema folder is
// renamed or moved, update these strings or the links 404 silently.
const SURFACES: Record<"crm" | "wiki", SurfaceCopy> = {
  crm: {
    label: "CRM",
    schemaNoun: "schemas",
    schemaPaths: ["schemas/crm-core", "schemas/crm-engagement"],
    routePrefix: "/crm",
  },
  wiki: {
    label: "Wiki",
    schemaNoun: "schema",
    schemaPaths: ["schemas/wiki-pages"],
    routePrefix: "/wiki",
  },
};

/**
 * Setup card shown in place of an optional surface (CRM, Wiki) when the brain
 * hasn't enabled it yet. Explains which schema(s) to apply, where to run them,
 * and links to the schema folder on the public repo (REPO_BASE above). Pairs
 * with a "Re-check now" button that re-probes both optional surfaces and
 * refreshes the page without requiring a sign-out/sign-in cycle.
 */
export function SetupState({ surface }: { surface: "crm" | "wiki" }) {
  const copy = SURFACES[surface];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">{copy.label}</h1>
      </div>
      <div className="bg-bg-surface border border-border rounded-lg p-8 space-y-4 max-w-prose">
        <p className="text-text-secondary text-sm">
          {copy.label} isn&apos;t enabled on this brain yet. It&apos;s an optional layer — apply
          the {copy.schemaNoun} below and it&apos;ll show up here automatically.
        </p>

        <ol className="text-text-secondary text-sm space-y-2 list-decimal list-inside">
          <li>
            Apply{" "}
            {copy.schemaPaths.map((path, i) => (
              <span key={path}>
                {i > 0 ? " and " : ""}
                <a
                  href={`${REPO_BASE}/${path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs px-1 py-0.5 rounded bg-bg-elevated border border-border text-violet hover:text-violet-dim transition-colors"
                >
                  {path}
                </a>
              </span>
            ))}{" "}
            in the Supabase SQL editor for your brain&apos;s project.
          </li>
          <li>
            Make sure your{" "}
            <a
              href={`${REPO_BASE}/integrations/open-brain-rest`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet hover:text-violet-dim transition-colors"
            >
              REST gateway
            </a>{" "}
            is deployed with the <code className="font-mono text-xs px-1 py-0.5 rounded bg-bg-elevated border border-border text-text-primary">{`${copy.routePrefix}/*`}</code>{" "}
            route group exposed — an older gateway build won&apos;t serve these routes even
            after the schema is applied.
          </li>
          <li>Click &quot;Re-check now&quot; below once both steps are done.</li>
        </ol>

        <RecheckButton />
      </div>
    </div>
  );
}

function RecheckButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRecheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/capabilities/recheck", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error || "Re-check failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-check failed");
    } finally {
      setLoading(false);
    }
  }, [router]);

  return (
    <div className="space-y-2">
      <button
        onClick={handleRecheck}
        disabled={loading}
        className="px-4 py-2 text-sm bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {loading ? "Checking…" : "Re-check now"}
      </button>
      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
