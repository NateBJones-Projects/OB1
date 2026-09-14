# Plaud Import

> Import Plaud AI voice-recorder transcripts and summaries into Open Brain as searchable, tiered, deduplicated thoughts.

## What It Does

Exports your recordings from Plaud to a local folder, then imports each one as **one parent thought** (the Plaud AI summary, backdated to the recording time) plus **N atomic child thoughts** extracted from the transcript by an LLM. Every row carries a sensitivity tier decided by an auditable rule chain, a client-computed `content_fingerprint` for dedup, and the provenance fields required by the [ingestion metadata contract](../../docs/ingestion-metadata-contract.md).

Two scripts:

| Script | Job |
| ------ | --- |
| `export-plaud.mjs` | Drives the official `@plaud-ai/cli` to pull metadata, transcript, and summary for every recording into a local folder. Paced, resumable, defensive about what the CLI returns. |
| `import-plaud.mjs` | Walks that folder, triages sensitivity, atomizes transcripts, embeds, and inserts into `thoughts`. |

Node 18+, ESM, **zero npm dependencies** (built-in `fetch`, `node:crypto`, `node:fs`).

## Why Parent + Atoms

A 45-minute transcript is roughly 6,500 words — past `text-embedding-3-small`'s input limit, and a single vector for ten unrelated topics retrieves badly. One thought per recording loses the detail; raw time-window chunks retrieve filler and cross-talk. So:

- **Parent** = the Plaud summary and action items. Answers "what was that meeting?" and anchors the date. `type` is `meeting` when two or more speakers were detected, otherwise `journal`.
- **Atoms** = self-contained statements pulled from the transcript (decisions, commitments, facts, preferences, action items, open questions), each prefixed `[Plaud: {title} | {date}]` so the date and subject are inside the embedded text.
- **Linkage** without a `thought_edges` table: every atom carries `metadata.atomization.parent_id` (the [atomizer](../atomizer/) recipe's key names) and both rows carry `metadata.plaud.recording_id`.

`--no-llm` falls back to deterministic ~500-word chunks split on speaker turns — no LLM cost, lower retrieval quality.

## Where The Summary Comes From

The parent thought's body is **Plaud's own AI summary, used verbatim**. This recipe
never rewrites a summary Plaud already wrote. It reads `summary.md` (falling back to
`summary.txt` or `note.md`), or the `.md` file in a flat export, or the `## Summary`
section of an Obsidian-plugin note, then splits that document by heading: anything
titled highlights, action items, key points, takeaways, or todo becomes the highlights
block and the rest is the summary.

Some exports carry a transcript with **no summary at all**. Without a fallback the
parent would be its bracketed header line and nothing else — an empty husk that still
gets embedded and still shows up in a graph. So when the summary is missing:

| Situation | What the body becomes | `metadata.plaud.summary_source` |
|---|---|---|
| Plaud wrote a summary | that summary, verbatim | `plaud` |
| No summary, LLM available, full-transcript mode | 3–6 sentences synthesised from the transcript | `synthesized` |
| No summary, `--no-llm`, `summary` triage mode, or the call failed | the opening ~120 words of the transcript, labelled as such | `transcript_excerpt` |
| No summary and no transcript | the recording is skipped entirely | n/a |

Two things worth knowing. A `summary` triage verdict means the transcript must not
reach a model at all, so those recordings always take the excerpt path even when an
LLM is configured — the tier wins over convenience. And synthesising costs one extra
LLM call for each affected recording, counted in `--report` and against `--max-calls`
like any other.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)) with a `thoughts` table
- Node.js 18 or newer
- A Plaud account and the official CLI: `npm i -g @plaud-ai/cli && plaud login`
- An OpenAI **or** OpenRouter key for embeddings (`text-embedding-3-small`)
- One of OpenRouter / Anthropic / Gemini for atomization — or `--provider claude-cli` to use a local `claude` CLI, or `--no-llm` for none
- Recommended: the unique index from [content-fingerprint-dedup](../content-fingerprint-dedup/) — without it the fingerprint is stored but the database will not reject duplicates

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
PLAUD IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:     ____________
  Supabase service key:     ____________
  OpenAI or OpenRouter key: ____________   (embeddings)

ATOMIZATION (pick one)
  OPENROUTER_API_KEY:       ____________
  ANTHROPIC_API_KEY:        ____________
  GEMINI_API_KEY:           ____________

GENERATED DURING SETUP
  Plaud login:              `plaud login` writes ~/.plaud/tokens.json
  Export folder path:       ____________   (keep OUTSIDE any git repo)
  Triage rules file:        triage-rules.json (your copy of the example)
  Tier map:                 plaud-tier-map.csv (produced by the dry run)

--------------------------------------
```

## Steps

1. **Back up your brain first.** This import can add thousands of rows. Run the [brain-backup](../brain-backup/) recipe and confirm the dump is non-empty.

   *Done when:* you have a dated dump file you could restore from.

2. **Install and authenticate the Plaud CLI.**

   ```bash
   npm i -g @plaud-ai/cli
   plaud login
   ```

   *Done when:* `plaud files --page 1 --page-size 5` prints your recordings.

3. **Configure credentials.** Copy `.env.example` to `.env.local` in this folder and fill it in. `.env.local` is layered **over** the shell environment — the file wins, so a stale exported `SUPABASE_URL` cannot send this import to the wrong brain.

   *Done when:* `.env.local` exists and is listed in `.gitignore` (it already is).

4. **Export your recordings.**

   ```bash
   node export-plaud.mjs --out ~/plaud-export --dry-run
   node export-plaud.mjs --out ~/plaud-export --limit 5
   node export-plaud.mjs --out ~/plaud-export
   ```

   *Done when:* `~/plaud-export/<id>/` folders exist with `meta.json`, `transcript.txt`, and `summary.md`.

5. **Open two or three transcripts and check for speaker labels.** The official CLI's docs describe its transcript output as "timestamped" and do not promise speaker labels (see [Unverified Plaud behaviour](#unverified-plaud-behaviour)). The importer parses labelled and unlabelled transcripts either way, but without labels every recording looks like a solo memo (`type: journal`) and `metadata.people` will be empty.

   *Done when:* you know whether your export has speaker labels.

6. **Create your triage rules.**

   ```bash
   cp triage-rules.example.json triage-rules.json
   ```

   Replace the EXAMPLE keywords with your own — the names of NDA clients, employers, project code names, family members, health and finance vocabulary. `triage-rules.json` is gitignored; the example file ships with generic placeholders only.

   *Done when:* your own vocabulary is in `triage-rules.json`.

7. **Dry run the whole export.** No writes.

   ```bash
   node import-plaud.mjs ~/plaud-export --dry-run --verbose --report
   ```

   Read `triage-report.md`: every recording should have a tier and the rule that produced it. Anything that should be private and is not, fix in the rules file or in `plaud-tier-map.csv`.

   *Done when:* the tier column looks right for every recording you recognize.

8. **Dry run the splitter on three recordings.** Still no writes; this one calls the LLM.

   ```bash
   node import-plaud.mjs ~/plaud-export --dry-run --llm --limit 3
   ```

   *Done when:* the printed atoms are self-contained statements, not transcript fragments.

9. **Live batch of ten.**

   ```bash
   node import-plaud.mjs ~/plaud-export --limit 10 --tier-map plaud-tier-map.csv --report
   ```

   Verify in SQL:

   ```sql
   select source_type, sensitivity_tier, type, count(*)
     from thoughts where source_type = 'plaud' group by 1,2,3;

   -- must be 0: a NULL fingerprint slips past dedup silently
   select count(*) from thoughts
    where source_type = 'plaud' and content_fingerprint is null;

   -- must be 'object' only
   select jsonb_typeof(metadata), count(*) from thoughts
    where source_type = 'plaud' group by 1;
   ```

   Then ask an MCP-connected AI: *"Use Open Brain search_thoughts to find what we decided about &lt;topic from a recording&gt;."*

   *Done when:* the query returns Plaud atoms and the fingerprint count is 0.

10. **Re-run the same command.** It must insert nothing.

    *Done when:* the output reads `Parents inserted: 0`, `Atoms inserted: 0`.

11. **Full run.**

    ```bash
    node import-plaud.mjs ~/plaud-export --tier-map plaud-tier-map.csv --concurrency 4 --report
    ```

    *Done when:* `import-report.md` shows the expected counts and no failures.

12. **Post-import hygiene.** Run the regex sensitivity backfill from [thought-enrichment](../thought-enrichment/) (`backfill-sensitivity.mjs --dry-run`, then `--apply`) and a [lint-sweep](../lint-sweep/) duplicate check.

    *Done when:* the sweep reports no duplicate groups and no unexpected tier changes.

## Expected Outcome

Each recording produces one parent row and a handful of atom rows, all with `source_type = 'plaud'`, `created_at` backdated to the recording time, and metadata like:

```json
{
  "source": "plaud",
  "source_type": "plaud",
  "source_label": "Plaud voice recorder",
  "source_id": "abc123",
  "source_path": "abc123/transcript.txt",
  "event_at": "2026-05-04T15:00:00.000Z",
  "importer_name": "plaud-import",
  "importer_version": "0.1.0",
  "input_hash": "sha256:...",
  "content_fingerprint": "...",
  "sensitivity_tier": "personal",
  "plaud": { "recording_id": "abc123", "title": "...", "duration_ms": 1380000, "role": "atom" },
  "atomization": { "parent_id": "...", "split_index": 2, "split_total": 9, "provider": "openrouter" },
  "triage": { "rule": "keyword:personal-life", "tier_source": "triage", "label": "therapy", "mode": "full" },
  "provenance": { "method": "llm_extraction", "review_status": "unreviewed" }
}
```

Because `created_at` is backdated, a year of imports will not flood your recent-thoughts view or weekly digest — but the source will also look silent in any 24-hour volume dashboard. That is expected for a backfill.

## Sensitivity Triage

Voice recordings are the most sensitive material most people will ever import: client calls, doctor's appointments, family conversations. The tier is decided **before** anything is embedded or sent to an LLM.

Resolution order, first match wins:

| # | Rule | Result |
| - | ---- | ------ |
| 1 | A row in `--tier-map` CSV for this recording id | Exactly what the CSV says. The only thing allowed to lower a tier — it is a human decision. |
| 2 | `secrets` regex set (SSN, card numbers, bank/account digits, API keys, `password:`) | `restricted` |
| 3 | `confidential-work` keywords | `restricted`, mode `summary` |
| 4 | `personal-life` keywords | `personal` |
| 5 | `personal-signals` regex set (dosages, health measurements, money amounts) | `personal` |
| 6 | `business-as-usual` keywords | `standard` |
| 7 | Nothing matched | **`personal`** — unclassified escalates, never downgrades |

Rules 2-6 are just the entries in `triage-rules.json`, evaluated top to bottom; reorder or replace them freely. Two guarantees are enforced in code rather than in the file:

- **`default_tier` cannot be `standard`.** The loader rejects it, and so does `--default-tier standard`.
- **A `standard` verdict is re-checked** against both regex sets before it is accepted. If you put the business rule first by mistake and a recording contains an SSN, it still comes out `restricted`, tagged `escalation:regex:restricted`.

The tier is written to both the `sensitivity_tier` column and `metadata.sensitivity_tier`, and the rule that fired is written to `metadata.triage.rule`, so a wrong call is one query away from being found and re-tiered:

```sql
select metadata->'triage'->>'rule' as rule, sensitivity_tier, count(*)
  from thoughts where source_type = 'plaud' group by 1,2 order by 3 desc;
```

**Modes.** A rule (or a tier-map row) can set a per-recording mode:

| Mode | Behaviour |
| ---- | --------- |
| `full` | Parent + transcript atoms. The default. |
| `summary` | Parent only. The transcript is never sent to an LLM and never stored as thoughts. The parent is marked `enriched = true` so a later enrichment pass skips it too. Default for `restricted`; change with `--client-mode`. |
| `skip` | Nothing is imported. |

Note the privacy reality: embedding sends text to OpenAI or OpenRouter, and atomization sends it to your chosen provider (Plaud's own cloud AI has already seen all of it). `summary` minimizes that footprint; `skip` eliminates it.

## Flags

### `export-plaud.mjs`

| Flag | Description |
| ---- | ----------- |
| `--out <dir>` | Destination folder (required). Keep it outside any git repo. |
| `--limit N` | Stop after N recordings (0 = all). |
| `--since YYYY-MM-DD` / `--until` | Date window. Entries with no date in the listing are kept, with a warning. |
| `--delay-ms N` | Pause between CLI calls. Default 400. |
| `--retries N` | Retries per call, exponential backoff. Default 3. |
| `--page-size N` / `--max-pages N` | Listing pagination. Defaults 100 / 50. |
| `--plaud-bin <path>` | Path to the CLI (or `$PLAUD_BIN`). Default `plaud`. |
| `--force` | Re-download recordings already complete on disk. |
| `--dry-run` | Enumerate ids only. No per-recording calls, no writes. |
| `--verbose` | Print every CLI invocation. |

### `import-plaud.mjs`

| Flag | Description |
| ---- | ----------- |
| `--dry-run` | No writes. Produces `triage-report.md` and `plaud-tier-map.csv`. |
| `--limit N` | Import at most N recordings. |
| `--since YYYY-MM-DD` / `--until` | Date window on the recording time. |
| `--llm [provider]` | Run the splitter. In `--dry-run` it prints atoms without writing. The optional value sets the provider. |
| `--no-llm` | Deterministic ~500-word speaker-turn chunks. No LLM cost. |
| `--provider <name>` | `openrouter` \| `anthropic` \| `gemini` \| `claude-cli`. |
| `--model <name>` | Model override. Defaults: `google/gemini-2.5-flash` (OpenRouter), `claude-haiku-4-5` (Anthropic), `gemini-2.5-flash` (Gemini). |
| `--max-calls N` | Hard ceiling on LLM calls. Default 1000, `0` = unlimited. |
| `--concurrency N` | Recordings in flight. Clamped to 4. Default 1. |
| `--rules <file>` | Triage rules JSON. Default `triage-rules.json`, falling back to the example file. |
| `--tier-map <file.csv>` | `recording_id,tier,mode` — overrides every rule. |
| `--client-mode <mode>` | Mode for restricted recordings: `summary` (default) \| `full` \| `skip`. |
| `--default-tier <tier>` | Tier for unclassified recordings. Default `personal`; `standard` is refused. |
| `--speakers <file.json>` | `{"<recording_id>": {"Speaker 1": "Alex"}, "_default": {...}}` name map. |
| `--no-embed` | Insert without embeddings. |
| `--store-recordings` | Also write full transcripts to a `plaud_recordings` side table (`schema-optional.sql`). Off by default. |
| `--no-secret-scan` | Disable the secret scanner. Not recommended. |
| `--purge <recording_id>` | Delete every thought for one recording, then exit. |
| `--reimport` | Ignore the sync log and purge each recording before re-importing it. |
| `--reset-sync-log` | Delete the local sync log. No database changes. |
| `--state-dir <dir>` | Where the sync log and reports are written. Default: this folder. |
| `--report` | Write `import-report.md`. |
| `--verbose` | Per-recording progress. |
| `--help` | Usage. Works with no credentials set. |

## Deduplication

Three layers, so a re-run is always safe:

1. **Sync log** — `plaud-sync-log.json` keyed by recording id plus `input_hash` of the raw transcript and summary. Unchanged recordings are skipped before any API call. Checkpointed after every recording, so an interrupted run resumes.
2. **Fingerprint** — every row gets a client-computed `content_fingerprint`: lowercase, collapse whitespace, trim, SHA-256. This is byte-identical to OB1's `set_content_fingerprint()` trigger, so brains with and without the trigger agree. The importer checks the fingerprint before embedding (so a re-run with a lost sync log costs nothing) and still treats a `409` on insert as a duplicate.
3. **Recording purge** — `--purge <id>` / `--reimport` deletes by `metadata.plaud.recording_id`. You need this when re-importing with a different model or prompt: LLM atoms are non-deterministic, so layer 2 will not recognize the old ones.

Rollback for the whole import:

```sql
delete from thoughts
 where source_type = 'plaud'
   and metadata->>'importer_name' = 'plaud-import';
```

…then delete `plaud-sync-log.json`.

## Cost

Embeddings are fixed to `text-embedding-3-small` — never change this. Vectors from different embedding models are not comparable, so importing with a different model would make these rows rank against nothing in a corpus embedded with everything else.

Rough order of magnitude for **300 recordings of ~45 minutes** (~2.6M transcript tokens, ~12 atoms each, ~3,900 thoughts). Prices move; check your provider's current rates.

| Step | Volume | Cost |
| ---- | ------ | ---- |
| Embeddings (3,900 thoughts ≈ 1.1M tokens) | 1.1M tokens @ ~$0.02/1M | **~$0.02** |
| Atomization, flash/haiku-class model | ~2.9M in / ~0.75M out | **~$5-$7** |
| Atomization with `--no-llm` | — | **$0** |
| Total | | **~$5-$7** |

Time: roughly 45-60 s per recording sequentially, so ~4 h for 300; about 1-1.5 h at `--concurrency 4`. The export step is ~15-30 min unattended. `--report` prints the real token usage from the provider, so run ten first and extrapolate from measured numbers rather than from this table.

## Unverified Plaud behaviour

This recipe was written against Plaud's published CLI documentation, not against a live account. The following are **assumptions**, and each one is worth ten seconds of your own checking:

| Claim | Status | How to check |
| ----- | ------ | ------------ |
| `plaud transcript <id>` includes speaker labels | Unverified. The CLI docs say only "timestamped"; the Plaud MCP docs do mention labels for `get_transcript`. | Open an exported `transcript.txt`. |
| `plaud files` prints JSON on stdout and pages with `--page` / `--page-size` | Unverified. Docs say "clean JSON/text to stdout". | Run it. If the shape differs, `export-plaud.mjs` fails with a message naming the keys it expected; adjust `LISTING_KEYS`. |
| Rate limits and plan gating on the CLI | Undocumented. The community Obsidian plugin reports being rate-limited by Plaud's private endpoints. | Start at `--delay-ms 400`; the exporter backs off on failures. |
| Folders/tags exposed by the CLI (for folder-based triage) | Not in the docs. The importer reads `tags`/`folder`/`labels` from metadata if they appear, and otherwise relies on keyword triage. | Inspect an exported `meta.json`. |
| Plaud's web "bulk export" mechanics | Documented as existing, flow unverified. | Irrelevant if the CLI works. |
| Zapier can replay history | Almost certainly not — its triggers fire on new transcripts. | Irrelevant for a backfill. |

If the official CLI does not work for you, the importer also reads two other layouts: the unofficial `plaud` CLI's `files export --formats txt,json,md` output (its JSON carries real `trans_result[].speaker` labels), and the markdown written by the community Plaud-to-Obsidian plugin. Point `import-plaud.mjs` at either folder and it auto-detects.

Once the backfill is done, the official Plaud **MCP** server is a better fit than this recipe for ongoing capture of new recordings.

## Testing Without A Plaud Account

Everything except Plaud itself can be exercised offline:

```bash
node test/run-tests.mjs                    # 21 offline checks: triage, parsing, fingerprints
node import-plaud.mjs fixtures --dry-run --report   # 4 fake recordings, three layouts

# End-to-end against a local mock of PostgREST + the embeddings API:
node test/mock-openbrain.mjs --port 8787 &
SUPABASE_URL=http://127.0.0.1:8787 SUPABASE_SERVICE_ROLE_KEY=mock \
OPENAI_API_KEY=mock EMBEDDING_BASE_URL=http://127.0.0.1:8787/v1 \
  node import-plaud.mjs fixtures --no-llm --verbose
curl -s http://127.0.0.1:8787/__stats | head -c 300
```

`fixtures/` holds four fictional recordings covering the directory layout, the flat unofficial-CLI layout, the Obsidian-plugin markdown layout, and one recording that trips a sensitivity rule. `test/fake-plaud-cli.mjs` stands in for `@plaud-ai/cli` so `export-plaud.mjs` can be run end to end (`--plaud-bin`), including its failure modes via `FAKE_PLAUD_BROKEN=listing|meta|empty`.

## Troubleshooting

**Issue: `Could not run "plaud"`**
Solution: `npm i -g @plaud-ai/cli`, then `plaud login`. If it is installed somewhere unusual, pass `--plaud-bin /path/to/plaud`.

**Issue: `plaud files returned a JSON object with no recognizable list of recordings`**
Solution: your CLI version wraps the listing in a key the exporter does not know. The error names the keys it saw — add yours to `LISTING_KEYS` in `export-plaud.mjs` and open an issue with the shape.

**Issue: every recording imports as `journal` and `metadata.people` is empty**
Solution: your transcripts have no speaker labels. Check step 5. Either re-export with labels, or accept solo-memo typing; `--speakers` can map `Speaker 1` to real names once labels exist.

**Issue: everything lands on `personal`**
Solution: that is the deliberate default for unclassified material. Put your own vocabulary in `triage-rules.json` — the shipped example is generic placeholders — then re-run the dry run and read `triage-report.md`.

**Issue: `No LLM provider available`**
Solution: set `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` in `.env.local`, or pass `--no-llm` for deterministic chunking, or `--provider claude-cli` to use a local `claude` CLI (which will refuse to run nested inside a Claude Code session — use a plain terminal).

**Issue: `--max-calls 1000 reached`**
Solution: the spend guard did its job. Raise it deliberately (`--max-calls 5000`) or work through the export in batches with `--limit`.

**Issue: re-running inserts duplicates**
Solution: you are missing the unique index on `content_fingerprint`. Install [content-fingerprint-dedup](../content-fingerprint-dedup/). Without it the fingerprint is stored but nothing rejects a duplicate, and only the local sync log protects you.

**Issue: a recording was tiered wrong and is already imported**
Solution: `node import-plaud.mjs <export> --purge <recording_id>`, fix the rule or add a `--tier-map` row, then re-import that recording. `metadata.triage.rule` tells you which rule made the wrong call.

**Issue: after running the enrichment recipe, `source_type` is no longer `plaud`**
Solution: known interaction — that recipe overwrites `source_type` with its own guess. Restore it from the metadata mirror this importer writes:

```sql
update thoughts set source_type = metadata->>'source'
 where metadata ? 'source' and source_type is distinct from metadata->>'source';
```
