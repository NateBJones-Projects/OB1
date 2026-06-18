import Link from "next/link";
import { fetchRecallTrace } from "@/lib/agent-memory";
import { requireSessionOrRedirect } from "@/lib/auth";
import { PolicyBadges } from "@/components/AgentMemoryBadges";
import { FormattedDate } from "@/components/FormattedDate";

export const dynamic = "force-dynamic";

export default async function RecallTracePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const params = await searchParams;
  const requestId = params.request_id || "";

  let data = null;
  let error: string | null = null;
  if (requestId) {
    try {
      data = await fetchRecallTrace(apiKey, requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load recall trace";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
        <Link
          href="/agent-memory"
          className="text-sm text-text-muted hover:text-violet transition-colors"
        >
          Back to Agent Memory
        </Link>
        <p className="ob1-section-label mt-4">Retrieval Debugging</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Recall Trace</h1>
        </div>
        <p className="max-w-md text-sm text-text-secondary md:text-right">
          Debug what an agent asked for, what OB1 returned, and what the agent used.
        </p>
      </div>

      <form className="flex flex-col gap-2 md:flex-row" action="/agent-memory/traces">
        <input
          name="request_id"
          defaultValue={requestId}
          placeholder="Recall request id"
          className="ob1-glass-panel min-w-0 flex-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-violet"
        />
        <button className="border border-violet/35 bg-violet-surface px-4 py-2 text-sm font-medium text-violet hover:bg-violet/15 transition-colors">
          Load trace
        </button>
      </form>

      {error && <p className="text-danger text-sm">{error}</p>}

      {!requestId && (
        <div className="ob1-glass-panel p-6 text-sm text-text-secondary">
          Waiting for a recall request id from an OpenClaw run, API smoke harness, or Agent Memory API response.
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <section className="ob1-frost-panel p-5">
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-text-muted">
              <span className="font-mono">{data.trace.request_id}</span>
              {data.trace.runtime_name && <span>{data.trace.runtime_name}</span>}
              {data.trace.project_id && <span>{data.trace.project_id}</span>}
              <span>
                <FormattedDate date={data.trace.created_at} />
              </span>
            </div>
            <h2 className="text-lg font-medium">{data.trace.query}</h2>
          </section>

          <div className="ob1-glass-panel overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-3 text-left font-medium w-16">Rank</th>
                  <th className="px-4 py-3 text-left font-medium">Memory</th>
                  <th className="px-4 py-3 text-left font-medium w-36">Score</th>
                  <th className="px-4 py-3 text-left font-medium w-44">Policy</th>
                  <th className="px-4 py-3 text-left font-medium w-28">Use</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.items.map((item) => (
                  <tr key={item.id} className="ob1-memory-row align-top">
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {item.rank}
                    </td>
                    <td className="px-4 py-3">
                      {item.agent_memories ? (
                        <Link
                          href={`/agent-memory/${item.memory_id}`}
                          className="font-medium text-text-primary hover:text-violet"
                        >
                          {item.agent_memories.summary}
                        </Link>
                      ) : (
                        <span className="font-mono text-text-muted">{item.memory_id}</span>
                      )}
                      {item.agent_memories?.content && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
                          {item.agent_memories.content}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      <p>Similarity {formatScore(item.similarity)}</p>
                      <p>Rank {formatScore(item.ranking_score)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <PolicyBadges
                        policy={{
                          can_use_as_instruction: Boolean(
                            item.use_policy_snapshot.can_use_as_instruction
                          ),
                          can_use_as_evidence: Boolean(
                            item.use_policy_snapshot.can_use_as_evidence
                          ),
                          requires_user_confirmation: Boolean(
                            item.use_policy_snapshot.requires_user_confirmation
                          ),
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {item.used === true ? (
                        <span className="text-success">used</span>
                      ) : item.used === false ? (
                        <span className="text-text-muted">
                          ignored{item.ignored_reason ? `: ${item.ignored_reason}` : ""}
                        </span>
                      ) : (
                        <span className="text-warning">unreported</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ob1-glass-panel p-5">
            <h2 className="ob1-section-label mb-3">Request Payload</h2>
            <pre className="max-h-[360px] overflow-auto border border-border-subtle bg-black/20 p-3 text-xs leading-5 text-text-secondary">
              {JSON.stringify(data.trace.request_payload, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}

function formatScore(value: number | null) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(3);
}
