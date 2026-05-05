import { Suspense } from "react";
import Link from "next/link";
import { decodeCursor, distinctMetadataValues, listThoughts } from "@/lib/db";
import { retrieveTopK } from "@/lib/search";
import { readTheme } from "@/lib/theme";
import { FilterPills } from "@/components/filter-pills";
import { SearchBar } from "@/components/search-bar";
import { SearchResults } from "@/components/search-results";
import { SynthesisAnswer } from "@/components/synthesis-answer";
import { SynthesisFallback } from "@/components/synthesis-fallback";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThoughtCard } from "@/components/thought-card";
import { UndeleteToast } from "@/components/undelete-toast";

type Mode = "ask" | "search";

type SearchParams = Promise<{
  q?: string;
  mode?: string;
  source?: string;
  project?: string;
  cursor?: string;
  deleted?: string;
}>;

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const rawMode = sp.mode;
  const mode: Mode = rawMode === "search" ? "search" : "ask"; // default ask
  const deletedId = sp.deleted?.trim() ?? "";
  const theme = await readTheme();

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="text-2xl font-bold tracking-tight hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label="Home — clear query and filters"
          >
            OTIS
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle initial={theme} />
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* key forces a fresh mount when q/mode changes, so client-side
            state (input value, mode toggle) follows the URL. Without this,
            clicking OTIS clears the URL but the searchbox still shows the
            stale query. */}
        <SearchBar key={`${query}-${mode}`} initialQuery={query} initialMode={mode} />

        {query ? (
          mode === "ask" ? (
            <AskView query={query} />
          ) : (
            <SearchView query={query} />
          )
        ) : (
          <BrowseView sp={sp} />
        )}
      </div>
      {deletedId ? <UndeleteToast id={deletedId} /> : null}
    </main>
  );
}

async function AskView({ query }: { query: string }) {
  // Retrieve top-8 sources at the page level. Pass to both the synthesis
  // component (wrapped in <Suspense> — the slow path) and the card list
  // (renders synchronously alongside).
  let sources;
  try {
    sources = await retrieveTopK(query, 8);
  } catch (err) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Search degraded: {(err as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={<SynthesisFallback />}>
        <SynthesisAnswer q={query} sources={sources} />
      </Suspense>
      <SearchResults
        results={sources}
        query={query}
        anchored
      />
    </div>
  );
}

async function SearchView({ query }: { query: string }) {
  const start = Date.now();
  let sources;
  try {
    sources = await retrieveTopK(query, 30);
  } catch (err) {
    return (
      <SearchResults
        results={[]}
        query={query}
        elapsedMs={Date.now() - start}
        error={(err as Error).message}
      />
    );
  }
  return (
    <SearchResults
      results={sources}
      query={query}
      elapsedMs={Date.now() - start}
    />
  );
}

async function BrowseView({
  sp,
}: {
  sp: { source?: string; project?: string; cursor?: string };
}) {
  const filters = { source: sp.source, project: sp.project };
  const cursor = decodeCursor(sp.cursor);

  const [{ rows, nextCursor }, facets] = await Promise.all([
    listThoughts(filters, cursor),
    distinctMetadataValues(),
  ]);

  const nextHref = nextCursor
    ? `/?${new URLSearchParams({
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.project ? { project: filters.project } : {}),
        cursor: nextCursor,
      }).toString()}`
    : null;

  return (
    <div className="space-y-6">
      <FilterPills facets={facets} active={filters} />

      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No thoughts match these filters.</p>
        ) : (
          rows.map((t) => <ThoughtCard key={t.id} thought={t} />)
        )}
      </div>

      {nextHref ? (
        <div className="pt-2">
          <Link
            href={nextHref}
            className="inline-block rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Older →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
