// ✅ Tiny TTL cache with tag-based invalidation.
//
// Lives at module scope inside the edge function isolate. Persists across
// requests as long as the worker stays warm (typically minutes to hours).
// Tags let writes surgically invalidate related reads — e.g. capture_thought
// invalidates "thoughts" and the next thought_stats call refreshes.

type Entry<T> = { value: T; expires: number; tags: Set<string> };

const store = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached<T>(
  key: string,
  value: T,
  ttlMs: number,
  tags: string[] = [],
): void {
  store.set(key, {
    value,
    expires: Date.now() + ttlMs,
    tags: new Set(tags),
  });
}

export function invalidate(tag: string): number {
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.tags.has(tag)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

// Example usage in a tool:
//
//   import { getCached, setCached, invalidate } from "../lib/cache.ts";
//
//   server.registerTool("thought_stats", {...}, async () => {
//     const cached = getCached<string>("stats:global");
//     if (cached) return { content: [{ type: "text", text: cached }] };
//     // ... fetch + format ...
//     setCached("stats:global", text, 5 * 60 * 1000, ["thoughts"]);
//     return { content: [{ type: "text", text }] };
//   });
//
//   server.registerTool("capture_thought", {...}, async ({ content }) => {
//     // ... insert ...
//     invalidate("thoughts"); // ← stats cache refreshes on next call
//     return { content: [{ type: "text", text: "Captured" }] };
//   });
