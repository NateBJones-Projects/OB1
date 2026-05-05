import { notFound } from "next/navigation";
import { getNeighbors, getThought } from "@/lib/db";
import { readTheme } from "@/lib/theme";
import { BackLink } from "@/components/back-link";
import { ConnectedPanel } from "@/components/connected-panel";
import { DeleteButton } from "@/components/delete-button";
import { EditableContent } from "@/components/editable-content";
import { ThemeToggle } from "@/components/theme-toggle";

type Params = Promise<{ id: string }>;

export default async function ThoughtDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const theme = await readTheme();

  const [thought, neighbors] = await Promise.all([
    getThought(id),
    getNeighbors(id, 5).catch(() => []),
  ]);

  if (!thought) notFound();

  const md = thought.metadata ?? {};
  const source = typeof md.source === "string" ? md.source : null;
  const projectKey = source ? `${source}_project` : null;
  const project =
    projectKey && typeof md[projectKey] === "string" ? (md[projectKey] as string) : null;
  const titleKey = source ? `${source}_conversation_title` : null;
  const title =
    titleKey && typeof md[titleKey] === "string" ? (md[titleKey] as string) : null;

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <header className="flex items-center justify-between">
          <BackLink>← Browse</BackLink>
          <div className="flex items-center gap-3">
            <DeleteButton id={thought.id} />
            <span className="text-xs text-zinc-500">
              {new Date(thought.created_at).toLocaleString()}
            </span>
            <ThemeToggle initial={theme} />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <article className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {source ? (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {source}
                </span>
              ) : null}
              {project ? (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {project}
                </span>
              ) : null}
            </div>
            {title ? <h1 className="text-xl font-medium">{title}</h1> : null}
            <EditableContent id={thought.id} initialContent={thought.content} />

            <details className="rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Metadata
              </summary>
              <pre className="px-3 py-2 text-xs text-zinc-500 overflow-x-auto">
                {JSON.stringify(thought.metadata, null, 2)}
              </pre>
            </details>
          </article>

          <ConnectedPanel neighbors={neighbors} />
        </div>
      </div>
    </main>
  );
}
