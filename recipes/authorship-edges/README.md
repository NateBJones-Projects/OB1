# Authorship Edges

> **Tell apart what *you* said from what a *machine* generated — across any source.** A deterministic speaker classifier labels every captured thought `self` / `other` / `mixed` / `machine` / `unknown`, links the ones you spoke to a canonical self-entity via `thought_entities` author edges, and gives you a query layer for "my own words" vs. "the device's summary."

---

## What It Does

Open Brain already has an email correspondent resolver (in the [atomizer recipe](../atomizer/)) that keys people off RFC-2822 `From`/`To`/`Cc` addresses. But spoken and machine-generated capture has no addresses — a wearable transcript chunk is labelled `You` / `Alex` / `Speaker 1`, and a device-generated title or action item has *no* human speaker at all. Nothing in OB1 turns those labels into an authorship edge, and nothing marks a row as machine-generated.

This recipe fills that gap. It is the **spoken / display-name counterpart** to the email resolver:

- A pure, deterministic classifier (`lib/speaker-attribution.mjs`) maps a thought's speaker labels to an attribution — **no LLM**:

  | attribution | meaning |
  |---|---|
  | `self` | only you spoke / authored it |
  | `other` | only other named people |
  | `mixed` | you and at least one other named person |
  | `machine` | a device/model generated it (no human speaker) |
  | `unknown` | speech with only generic `Speaker N` labels |

- A DB helper (`lib/author-edges.mjs`) links every `self` / `mixed` thought to your **self-entity** via `thought_entities(mention_role = 'author' | 'participant')`, so authorship is a first-class graph edge — not just a string in metadata.

- A SQL query layer (`queries.sql`) lets you ask "everything I said" or "machine-generated only," or down-rank machine rows in search.

Nothing here is hardcoded to a person: your self-entity is resolved from config (an id you pass, or a display name the recipe upserts once). It treats `thought_id` as opaque, so it works whether your `thoughts.id` is **UUID or BIGINT**.

---

## Prerequisites

- **Open Brain base setup** (Supabase project with the `thoughts` table).
- **The [entity-extraction schema](../../schemas/entity-extraction/)** installed — this recipe writes to its `public.entities` and `public.thought_entities` tables (it creates no tables and changes no columns; it is purely additive). The minimum it needs:
  - `entities` with `id`, `entity_type`, `canonical_name`, `normalized_name`, `aliases`, `metadata`, and `UNIQUE (entity_type, normalized_name)`.
  - `thought_entities` with `thought_id`, `entity_id`, `mention_role`, `source`, `evidence`, and `UNIQUE (thought_id, entity_id, mention_role)`.
- **Thoughts that carry speaker attribution.** Any capture path that records speaker labels works — e.g. the wearable-capture integrations (proposed alongside this recipe) already stamp `metadata.attribution` and `metadata.attributed_to`.
- **Node.js 18+** (uses the built-in `fetch`; no dependencies to install).

**Cost**: none. This recipe makes no model calls — it is pure classification plus PostgREST writes.

---

## Credentials You'll Need

Put these in `.env.local` at your project root (the scripts also read `process.env`):

| Variable | Required | What it is |
|---|---|---|
| `SUPABASE_URL` *or* `SUPABASE_PROJECT_REF` | yes | Your project URL or ref |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key (writes entities/edges) |
| `OB_SELF_ENTITY_ID` | one of these | Your `entities.id`, if you already have a self-entity |
| `OB_SELF_ENTITY_NAME` | one of these | Your display name — the recipe upserts a self-entity for it (idempotent) |
| `WEARABLE_SELF_LABELS` | optional | Extra speaker labels that are *you* (comma-separated), merged with the built-in `you/me/self` |

> [!WARNING]
> The service-role key is a credential. Keep it in `.env.local` (gitignored) — never in code or commits.

---

## Setup

### 1. Copy this recipe folder

```bash
# From the OB1 repo root:
cp -r recipes/authorship-edges /path/to/your/workspace/authorship-edges
cd /path/to/your/workspace/authorship-edges
```

### 2. Install zero dependencies

Node 18+ only. There is nothing to `npm install`.

### 3. Run the classifier self-test

```bash
node test-attribution.mjs
```

Expected: a list of `ok` lines and `N assertions passed.` This exercises the full attribution matrix (self / other / mixed / machine / unknown) with no database, so if it passes the core logic is sound.

---

## Wiring it into a capture path

Any capture integration that knows a thought's speakers can attribute it as it writes. **Stamp `attribution` into the row you insert** (one atomic write — no read-modify-write race), then link the author edge:

```js
import { classifySpeakers } from "./lib/speaker-attribution.mjs";
import { attributeThought, getSelfEntityId, loadEnv, makeSbClient } from "./lib/author-edges.mjs";

const env = loadEnv();
const sb = makeSbClient({
  supabaseUrl: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
});
const selfEntityId = await getSelfEntityId(sb, {
  id: env.OB_SELF_ENTITY_ID,
  name: env.OB_SELF_ENTITY_NAME, // upserted once (and marked is_self) if no id is given
});

const speakers = ["You", "Alex"];

// 1) Stamp attribution into the thought as you insert it — no patch, no race.
const { attribution } = classifySpeakers(speakers, { selfLabels: env.WEARABLE_SELF_LABELS });
const inserted = await sb.post(
  "thoughts?select=id",
  { content, metadata: { ...meta, attribution, attributed_to: speakers } },
  { Prefer: "return=representation" },
);
const thoughtId = (Array.isArray(inserted) ? inserted[0] : inserted).id;

// 2) Link the self author edge (idempotent). This helper only touches the edge.
await attributeThought(sb, {
  thoughtId,                       // UUID or BIGINT — passed through opaque
  speakers,
  selfEntityId,
  selfLabels: env.WEARABLE_SELF_LABELS,
  source: "omi",
  evidence: { kind: "transcript_chunk" },
});
// -> { attribution: "mixed", selfPresent: true, role: "participant", linked: true }
```

`attributeThought` deliberately does **not** write `thoughts.metadata` — stamping happens in your insert (step 1) so two writers never clobber each other's metadata. If your capture path already stamps `attribution` (as the wearable integrations do), skip step 1 and just call `attributeThought` (or run the **backfill** below) to add the edges.

---

## Backfilling existing thoughts

To add author edges to thoughts you've already captured (e.g. a wearable history):

```bash
# Preview — classify and report, write nothing
node backfill-authorship.mjs --self-name "Your Name" --dry-run

# Live run
node backfill-authorship.mjs --self-name "Your Name"

# Scope it
node backfill-authorship.mjs --self-id 1234 --since=2026-06-01 --limit=500
```

It pages over thoughts whose `metadata.attribution` is `self` or `mixed`, links each to your self-entity, and is **idempotent** — existing edges are skipped, so re-runs are safe.

---

## Querying "what I said" vs. "what a machine made"

See [`queries.sql`](./queries.sql). The essentials:

```sql
-- Everything you authored/participated in, via the edge:
SELECT t.* FROM thoughts t
JOIN thought_entities te ON te.thought_id = t.id
WHERE te.entity_id = :self_entity_id AND te.mention_role IN ('author', 'participant');

-- Your own words only (excludes device-generated rows):
SELECT * FROM thoughts WHERE metadata->>'attribution' IN ('self', 'mixed');

-- Machine-generated only:
SELECT * FROM thoughts WHERE metadata->>'attribution' = 'machine';
```

---

## Scope and limitations (read this)

- **Named-other speakers are classified but not resolved to entity rows.** `resolveSpeaker("Alex")` tells you it's a *named* speaker, but this recipe does **not** create or match an `entities` row for them. That is deliberate: display-name → entity resolution (is "Alex" the same person across recordings? the same "Alex" as in your email graph?) is a separate, harder problem — exactly as the atomizer's email resolver explicitly defers multi-address identity resolution. This recipe links the **self** side, which is unambiguous given your configured self-entity, and leaves named-other resolution as a documented extension point.
- **Self detection is label-based.** It recognises the device-generic `you/me/self` plus whatever you add via `WEARABLE_SELF_LABELS`. If your device labels you with your name, add it there. A numbered label like `User 1` is treated as a generic placeholder (→ `unknown`), not as you — add the exact label to `WEARABLE_SELF_LABELS` if that's how your device labels the wearer.
- **Attribution is recorded in two places** — the `thought_entities` edge (structural) and `metadata.attribution` (the per-thought label). Keep both in sync by always going through `attributeThought` or the backfill.

---

## Expected Outcome

After wiring in (or backfilling), every thought you spoke in has a `thought_entities` author edge to your self-entity, and every captured thought carries an `attribution` label. You can now cleanly separate your own words from machine-generated summaries in search and analysis — the substrate for "show me what *I* actually said about X," with device-generated noise filtered out.

---

## Troubleshooting

**`getSelfEntityId: provide { id } or { name }`** — set `OB_SELF_ENTITY_ID` or `OB_SELF_ENTITY_NAME` (or pass `--self-id` / `--self-name`).

**`POST thought_entities: 409` / duplicate** — handled internally as a no-op (the edge already exists); the run continues. Set `AUTHORSHIP_DEBUG=1` to see full PostgREST paths in errors.

**Nothing gets linked (`linked=0`, everything `skipped`)** — your thoughts don't carry `metadata.attribution` of `self` or `mixed`, so there's nothing to attribute to you. Run a capture path that stamps `attribution` (see "Wiring it into a capture path"), then re-run the backfill.

**`relation "thought_entities" does not exist`** — install the [entity-extraction schema](../../schemas/entity-extraction/) first; this recipe consumes its tables.

**Self edges point at the wrong entity** — you have more than one `person` entity for yourself. Pin the right one with `OB_SELF_ENTITY_ID` (canonicalising duplicate self entities is out of scope here).

---

## Tool Surface Area

This recipe **registers no new MCP tools** — it is a set of Node scripts that write `entities` / `thought_entities` rows. If you run it alongside MCP servers that read the graph, manage their surface via the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).

---

## Related

- [Atomizer](../atomizer/) — the email correspondent resolver this complements (addresses → entities); pair them to attribute both written and spoken sources.
- Wearable Capture (proposed alongside this recipe) — stamps the `metadata.attribution` this recipe links into edges.
- [Entity extraction schema](../../schemas/entity-extraction/) — provides the `entities` and `thought_entities` tables.
- [Contributing guide](../../CONTRIBUTING.md) — required reading before submitting changes.
