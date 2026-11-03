import type { Context, Plugin } from "@opencode/plugin/promise/plugin";
import type { SessionInfo } from "@opencode/client";
import { MemoryClient, options } from "./client.js";
import { clip, tail, digest, extractionPrompt, parseCheckpoint, record, renderRecall, unsafe } from "./memory.js";

/** The plugin exports the native V2 shape; SDK imports are type-only. */
export default { id: "ob1.agent-memory", setup } satisfies Plugin;

export async function setup(ctx: Context) {
  if (ctx.options.enabled === false) return;
  const config = options(ctx.options);
  const client = new MemoryClient(config);
  const controller = new AbortController();
  const registrations: { dispose(): Promise<void> }[] = [];
  const cache = new Map<string, { key: string; text: string; expires: number }>();
  const remember = (id: string, key: string, text: string, ttl: number) => {
    if (!cache.has(id) && cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(id, { key, text, expires: Date.now() + ttl });
  };
  const recalling = new Map<string, Promise<string>>();
  const capturing = new Map<string, Promise<void>>();
  const warnings = new Map<string, number>();
  const warn = (operation: string) => {
    if (Date.now() - (warnings.get(operation) ?? 0) > 60_000) {
      // Never log backend responses, prompts, URLs, credentials or model output.
      console.warn(`[ob1.agent-memory] ${operation} failed; normal OpenCode work continues.`);
      warnings.set(operation, Date.now());
    }
  };
  const scope = async (sessionID: string): Promise<SessionInfo | undefined> => {
    const session = await ctx.session.get({ sessionID });
    if (session.parentID || session.location.directory !== ctx.location.directory ||
      session.projectID !== ctx.location.project.id || session.metadata?.ob1Memory === false) return;
    return session;
  };
  const project = (session: SessionInfo) => config.projectId ?? `opencode:${session.projectID}`;
  const identity = (session: SessionInfo) => ({
    workspace_id: config.workspaceId, project_id: project(session), task_id: session.id,
    runtime: { name: "opencode", version: ctx.app.version },
    channel: { kind: "opencode", id: session.id, thread_id: session.id },
  });

  registrations.push(await ctx.session.hook("context", async event => {
    try {
      const session = await scope(event.sessionID);
      if (!session) return;
      const users = event.messages.filter(m => m.role === "user");
      const query = clip(users.at(-1)?.content.filter(p => p.type === "text").map(p => p.text).join("\n") ?? "", 2000);
      if (!query.trim() || unsafe(query)) return;
      const key = digest(JSON.stringify([project(session), users.length, query]));
      const cached = cache.get(session.id);
      let text = cached?.key === key && cached.expires > Date.now() ? cached.text : undefined;
      if (text === undefined) {
        const flightKey = `${session.id}:${key}`;
        let flight = recalling.get(flightKey);
        if (!flight) {
          flight = (async () => {
            const value = await client.post("/recall", {
              schema_version: "openbrain.agent_memory.recall.v1", ...identity(session), query,
              model_intent: { provider: event.model.providerID, model: event.model.id },
              scope: { project_only: true, include_unconfirmed: false, include_stale: false },
              limits: { max_items: config.maxItems, max_tokens: config.maxTokens },
            }, controller.signal);
            const result = renderRecall(value, config.workspaceId, project(session), config.maxItems, config.maxContextBytes);
            remember(session.id, key, result.text, 300_000);
            // Do not falsely equate context injection with actual model use.
            if (result.ignored.length) {
              await client.post(`/recall/${encodeURIComponent(result.requestId)}/usage`, {
                used_memory_ids: [], ignored: result.ignored,
              }, controller.signal).catch(() => warn("usage reporting"));
            }
            return result.text;
          })().catch(() => {
            remember(session.id, key, "", 15_000);
            warn("recall");
            return "";
          });
          recalling.set(flightKey, flight);
        }
        try { text = await flight; } finally { recalling.delete(flightKey); }
      }
      if (text) event.system.push({ type: "text", text });
    } catch {
      warn("recall");
    }
  }));

  const capture = (session: SessionInfo, excerpt: string) => {
    if (!config.autoCapture || !session.model || !excerpt.trim() || unsafe(excerpt)) return Promise.resolve();
    const prior = capturing.get(session.id);
    if (prior) return prior;
    const run = (async () => {
      const scopeKey = digest(JSON.stringify([config.workspaceId, project(session), session.id]));
      const inputHash = digest(excerpt);
      const storageKey = `checkpoint/${scopeKey}`;
      const receipt = record(await ctx.storage.get(storageKey));
      if (receipt.inputHash === inputHash) return;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.captureTimeoutMs)]);
      const generated = await ctx.experimental.generate.text({
        model: session.model,
        prompt: extractionPrompt + JSON.stringify({ conversation_excerpt: clip(excerpt, 12000) }),
      }, { signal });
      const payload = parseCheckpoint(generated.text);
      const current = await scope(session.id);
      if (!current || project(current) !== project(session) || controller.signal.aborted) return;
      if (Object.values(payload).some(items => items.length)) {
        const value = await client.post("/writeback", {
          schema_version: "openbrain.agent_memory.writeback.v1", ...identity(session),
          step_id: inputHash, idempotency_key: `opencode:${scopeKey}:${inputHash}`,
          models_used: [{ provider: session.model!.providerID, model: session.model!.id, role: "checkpoint" }],
          source_refs: [{ kind: "opencode_session", uri: `opencode://session/${session.id}` }],
          memory_payload: payload,
          provenance: { default_status: "generated", confidence: 0.5, requires_review: true },
          visibility: { project: project(session) },
        }, signal);
        const memories = record(value).memories;
        if (!Array.isArray(memories) || !memories.length || record(value).blocked === true) throw new Error("Writeback not accepted");
      }
      // Only successful writes (or a valid empty extraction) advance the watermark.
      await ctx.storage.set(storageKey, { inputHash });
    })().catch(() => warn("checkpoint")).finally(() => capturing.delete(session.id));
    capturing.set(session.id, run);
    return run;
  };

  // Capture before compaction can discard exact details; do not replace its summary.
  registrations.push(await ctx.session.hook("compaction", async event => {
    cache.delete(event.sessionID);
    if (!config.autoCapture) return;
    try {
      const session = await scope(event.sessionID);
      if (!session) return;
      const excerpt = event.messages.filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, text: m.content.filter(p => p.type === "text").map(p => p.text).join("\n") }))
        .filter(m => m.text).slice(-16).map(m => `${m.role}: ${clip(m.text, 2000)}`).join("\n");
      await capture(session, tail(excerpt, 12000));
    } catch { warn("checkpoint"); }
  }));

  const events = (async () => {
    for await (const event of ctx.event.subscribe({
      types: ["session.idle", "session.execution.succeeded", "session.compaction.ended", "session.deleted", "session.moved"], signal: controller.signal,
    })) {
      const id = event.data.sessionID;
      if (event.type !== "session.idle" && event.type !== "session.execution.succeeded") { cache.delete(id); continue; }
      if (!config.autoCapture) continue;
      try {
        const session = await scope(id);
        if (!session || session.outcome !== "succeeded") continue;
        const messages = await ctx.session.context({ sessionID: id });
        const excerpt = messages.flatMap(m => {
          if (m.type === "user") return [`user: ${clip(m.text, 2000)}`];
          if (m.type === "assistant") return m.content.filter(p => p.type === "text").map(p => `assistant: ${clip(p.text, 2000)}`);
          return [];
        }).slice(-16).join("\n");
        await capture(session, tail(excerpt, 12000));
      } catch { warn("checkpoint"); }
    }
  })().catch(() => { if (!controller.signal.aborted) warn("event subscription"); });

  return async () => {
    controller.abort();
    await Promise.all(registrations.map(r => r.dispose()));
    await Promise.allSettled([events, ...recalling.values(), ...capturing.values()]);
    cache.clear();
  };
}
