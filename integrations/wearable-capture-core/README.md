# Wearable Capture Core

> **A reusable engine that turns any always-on wearable into Open Brain thoughts
> — at the granularity of atoms, not one summary per recording.** Write a small
> adapter for your device; the core handles auth, atomic dedup, provenance,
> embedding, and writes. Powers the [Omi](../wearable-omi-capture/) and
> [Limitless](../wearable-limitless-capture/) capture integrations.

---

## What It Does

Always-on wearables (Omi, Limitless, …) record your spoken life and expose it
through a polling API. A single recording can run for an hour and hold many
distinct things — a title, several action items, a long back-and-forth
transcript. Capturing it as **one summary row** loses all of that detail to
search.

`wearable-sync.ts` captures each recording as **atoms** instead: its title, each
action item, each event, each ~60-second transcript chunk — each its own
`thoughts` row, each individually searchable and individually attributed. A
per-device **adapter** supplies only what's unique — how to list records and how
to atomize one — and the core does the rest:

1. **Pull** records since a rolling time window (the adapter makes the call).
2. **Atomize** each record into one or more atoms via the adapter, using the
   device's **own** structured output (title, summary, action items, transcript
   segments) — **no per-item LLM cost**.
3. **Dedup** each atom against the brain on a **salted per-atom fingerprint**,
   so re-runs and overlapping windows are safe and a missed run self-heals on
   the next pass — no local state file.
4. **Attribute** each atom — `self` / `other` / `mixed` / `machine` / `unknown`
   — plus the speakers (`attributed_to`) and, for machine-generated atoms, the
   `generator`.
5. **Embed** the text via OpenRouter (`openai/text-embedding-3-small`) and
   **insert** into `thoughts`.

It never modifies the `thoughts` schema (additive rows only) and never holds a
secret in code (everything from `Deno.env`).

---

## The adapter contract

A wearable adapter implements five members:

```typescript
export interface WearableAdapter<Record = unknown> {
  sourceId: string; // short device id, e.g. "omi" — used for dedup + provenance
  sourceType: string; // brain source_type to tag, e.g. "omi"
  listSince(sinceISO: string): Promise<Record[]>; // pull records at/after a UTC ISO time
  recordId(record: Record): string; // the device's own stable id (idempotency salt)
  recordToAtoms(record: Record): WearableAtom[]; // atomize one record using its own structure, no LLM
}
```

Each `WearableAtom` carries its content and its provenance:

```typescript
export interface WearableAtom {
  atomIndex: number; // stable position within the record (part of the fingerprint salt)
  atomKind: string; // 'title' | 'overview' | 'action_item' | 'event' | 'transcript_chunk' | 'section' | 'memory' | …
  content: string;
  type?: string; // thought type, default "meeting"
  attribution: "self" | "other" | "mixed" | "machine" | "unknown";
  attributedTo?: string[]; // speaker labels / names contributing to this atom
  generator?: string | null; // the device, for machine-generated atoms; null for human speech
  selfPresent?: boolean; // the brain owner is a speaker here (for optional self-linking)
  role?: "author" | "participant" | null;
  createdAt?: string;
  metadata?: Record<string, unknown>; // atom-specific extras (section_label, speakers, …)
}
```

The engine then runs a capture pass:

```typescript
import { runWearableSync } from "../_shared/wearable-sync.ts";
const result = await runWearableSync(myAdapter, { sinceHours: 12 });
// -> { source, pulled, recordsImported, atomsInserted, atomsSkipped, failed, attribution, dryRun }
```

### Idempotency — salted per-atom fingerprint

Each atom's identity is
`sha256(sourceType | provider_event_id | atom_index | content)`. Salting with
the recording's own id **and** the atom's position means two atoms with
identical text still get distinct fingerprints, while a re-run of the same atom
is stable. The fingerprint is stored in `metadata.content_fingerprint` and
deduped with a GIN-indexed JSONB containment query — so the engine works on the
**baseline `thoughts` schema with no migration**. (If you run a schema that adds
a UNIQUE index on the fingerprint, a duplicate insert is also caught and treated
as a skip.)

Dedup is keyed on the device's _own_ record id (plus atom position), which is
stable even when the device re-processes or edits a recording's text later — so
a content-only hash would wrongly duplicate it.

### Provenance — who said what, and what the machine made up

Every atom records an `attribution`:

| attribution | meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `self`      | only the brain owner spoke / authored it                               |
| `other`     | only other named people                                                |
| `mixed`     | the owner and at least one other named person                          |
| `machine`   | the device generated it (a title, a summary, an extracted action item) |
| `unknown`   | speech with no resolvable speaker                                      |

This lets you separate **what you actually said** from **what the device
inferred about you** — e.g. exclude `machine` atoms from "things I said," or
trust a `self` action item over a `machine`-summarized one. (`external` is
reserved for a future cross-source backfill and is never emitted.)

### Optional: linking your own speech to your identity

The core stamps `metadata.self_present: true` (and a `role`) on atoms where you
are a speaker, but it does **not** assume anything about your brain's entity
graph — there's no hardcoded "self" id. If you keep an entities/CRM layer, you
can add a small follow-up step that reads atoms where
`metadata.self_present = true` and links them to your own entity. That step is
per-user and entirely optional; the core's job is to record the attribution, not
to resolve identities.

---

## Prerequisites

- A working Open Brain setup (Supabase project with the `thoughts` table and
  pgvector).
- An [OpenRouter](https://openrouter.ai) API key (for embeddings).
- Supabase CLI installed and logged in.

**Cost**: OpenRouter embeddings only (no per-item LLM classification — adapters
reuse the device's own summaries and structure). Roughly **$0.05–0.20/month**
for typical personal volume (higher than a summary-only capture because each
recording now yields several atoms, but still embeddings-only).

---

## Credential Tracker

| Credential                  | Where it comes from                              | Value  |
| --------------------------- | ------------------------------------------------ | ------ |
| `OPENROUTER_API_KEY`        | [openrouter.ai/keys](https://openrouter.ai/keys) |        |
| `SUPABASE_URL`              | Auto-injected by Supabase                        | (skip) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase                        | (skip) |

> [!WARNING]
> API keys are credentials. Set them with `supabase secrets set` — never paste
> them into code, commits, or screenshots.

---

## Steps

### Step 1 — Add the shared engine to your Supabase project

From the root of your Supabase project, create the shared module that every
wearable adapter imports:

```bash
mkdir -p supabase/functions/_shared
```

Copy [`wearable-sync.ts`](./wearable-sync.ts) from this folder to
`supabase/functions/_shared/wearable-sync.ts`.

✅ **Done when:** `supabase/functions/_shared/wearable-sync.ts` exists and
`deno check supabase/functions/_shared/wearable-sync.ts` is clean.

---

### Step 2 — Set the embedding key

```bash
supabase secrets set OPENROUTER_API_KEY="sk-or-v1-your-openrouter-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Supabase runtime, so you don't set those yourself.

✅ **Done when:** `supabase secrets list` shows `OPENROUTER_API_KEY`.

---

### Step 3 — Add a device adapter

This package is the engine only — it captures nothing on its own. Add at least
one device:

- **[Omi](../wearable-omi-capture/)** — Omi pendant conversations.
- **[Limitless](../wearable-limitless-capture/)** — Limitless Pendant lifelogs.

…or write your own adapter for any polling wearable by implementing the
five-method `WearableAdapter` interface above.

✅ **Done when:** a device adapter function is deployed and writing atoms (see
its README).

---

## Expected Outcome

With the core in place and one or more adapters deployed, each wearable's new
records become several `thoughts` rows — one per atom — embedded, deduplicated
on a salted per-atom fingerprint, and tagged with `metadata.source` /
`metadata.wearable_source` / `metadata.attribution` / `metadata.attributed_to`
for retrieval and provenance. The same engine serves every device, so adding the
next wearable is a small adapter, not a new pipeline.

A capture pass returns a tally, e.g.:

```json
{
  "source": "omi",
  "pulled": 6,
  "recordsImported": 4,
  "atomsInserted": 37,
  "atomsSkipped": 12,
  "failed": 0,
  "attribution": { "machine": 9, "self": 14, "mixed": 11, "unknown": 3 },
  "dryRun": false
}
```

---

## Troubleshooting

**`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required`** — these are
injected automatically inside a deployed edge function; if you see this you're
running outside the Supabase runtime. Provide them via env, or pass a pre-built
`client` in `SyncOptions` (handy for tests).

**Atoms insert but `embedding` is null** — `OPENROUTER_API_KEY` isn't set, so
the engine inserts without an embedding (by design — a later embedding backfill
can fill it). Set the key to embed at capture time.

**Duplicate rows for the same recording** — confirm your adapter's `recordId()`
returns the device's _stable_ id (not a content hash) and that `atomIndex` is
stable across runs. Dedup is keyed on
`sourceType | provider_event_id | atom_index | content`; if any of those drift
per run, dedup can't catch it.

**A device that rate-limits (HTTP 429)** — use the exported `fetchWithRetry()`
helper for your device API calls. It honors `Retry-After`, backs off with a cap,
and retries a few times before returning the 429 response for you to handle (the
Omi and Limitless adapters do this).

---

## Tool Surface Area

This integration **registers no new MCP tools**. It is a capture-only path: a
shared engine that per-device adapter edge functions call to write rows into the
existing `thoughts` table. As you add more capture and query integrations, see
the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) to keep
your tool surface lean.

| Component          | Type                            | What it does                                                                                        |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `wearable-sync.ts` | Shared Deno module (`_shared/`) | Atomizes via an adapter, dedups per atom, attributes, embeds (OpenRouter), inserts into `thoughts`. |
| `thoughts` table   | Existing Open Brain primitive   | No schema changes — additive rows only.                                                             |

**External services called:** `openrouter.ai/api/v1` (embeddings). Device APIs
are called by the adapters, not the core.

---

## Related

- [Omi Wearable Capture](../wearable-omi-capture/) — adapter for the Omi
  pendant.
- [Limitless Wearable Capture](../wearable-limitless-capture/) — adapter for the
  Limitless Pendant.
- [Smart Ingest](../smart-ingest/) — LLM extraction + dedup for raw documents
  (heavier path).
- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) — manage
  your tool surface as you add integrations.
- [Contributing guide](../../CONTRIBUTING.md) — required reading before
  submitting changes.
