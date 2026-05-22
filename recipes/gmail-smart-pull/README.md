# Gmail Smart Pull

<!-- markdownlint-disable MD013 -->

> Pull emails from Gmail into an Open Brain pack with local sensitivity routing, engagement filtering, contact-based relationship tiers, and LLM atomization of long messages.

This recipe complements [`recipes/email-history-import/`](../email-history-import/). Where `email-history-import` is a one-email-one-thought onboarding path, `gmail-smart-pull` is for users who already have enough email to need careful filtering, routing, and splitting before ingest.

## What It Does

1. Fetches emails from the Gmail API (read-only scope) by label and time window.
2. Strips quoted replies, signatures, and auto-generated noise.
3. Applies an **engagement filter**: only threads where you've sent at least one message are kept. Override labels (e.g. `STARRED`, `IMPORTANT`) bypass the filter so you don't lose inbound-only items you explicitly flagged.
4. Classifies each message against a **relationship tier** (`contact` / `known` / `unknown`) using a contacts cache file.
5. Runs a **local sensitivity detector** over each message body. Output tiers: `standard`, `personal`, `restricted`.
6. **Atomizes** long messages (default: >= 150 words) via an LLM so each atomic idea becomes its own thought.
7. Captures **RFC 2822 threading headers** (`Message-ID`, `In-Reply-To`, `References`) so replies-to edges can be built offline by a follow-up job.
8. Parses **structured correspondents** (From/To/Cc into `{ name, email }` arrays) once at pull time so a downstream entity-resolver can upsert them as first-class entities without re-splitting headers.
9. Emits a **pack file** (JSON) that your Open Brain ingest pipeline can read.

The recipe does **not** ingest into Supabase itself. It produces a pack that a downstream importer consumes. That separation keeps this recipe portable across Open Brain deployments with different ingest paths.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+ (tested on 20 and 22)
- Google Cloud project with the Gmail API enabled and an OAuth 2.0 Desktop-app client
- One LLM provider for atomization: Anthropic API key OR OpenRouter API key
- (Optional, recommended) A companion ingest pipeline that can read the pack format described in [Expected Outcome](#expected-outcome) below — the pack is designed to flow into a fingerprint-dedup + sensitivity-gate pipeline. See [content-fingerprint-dedup primitive](../../primitives/content-fingerprint-dedup/) for the dedup convention.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
GMAIL SMART PULL -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:                ____________
  OpenRouter or Anthropic key:____________

GENERATED DURING SETUP
  Google Cloud Project ID:    ____________
  Gmail OAuth Client ID:      ____________.apps.googleusercontent.com
  Gmail OAuth Client Secret:  ____________
  Gmail account (login hint): ____________@____________
  Contacts cache file path:   ____________

--------------------------------------
```

> [!NOTE]
> This recipe does **not** need your Supabase service-role key. The puller emits a pack file; only your downstream ingest pipeline needs the service-role key, and it should read it from environment variables or a secret manager — never from a plaintext tracker.

## Steps

### 1. Create the Gmail OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create (or select) a project.
3. Enable the Gmail API: <https://console.cloud.google.com/apis/library/gmail.googleapis.com>.
4. Configure the OAuth consent screen. User type "External" is fine for personal use — add your own Google account as a test user so you don't have to submit the app for verification.
5. Credentials → Create Credentials → OAuth client ID → **Application type: Desktop app** → name it (e.g. "Open Brain Gmail Smart Pull") → Create.
6. Copy the client id and client secret; you'll set them as env vars below.

> [!IMPORTANT]
> The OAuth client must be type **Desktop app**. The recipe runs a local HTTP server on `http://localhost:3847/callback` to catch the redirect; web-app clients won't work.

### 2. Set environment variables

```bash
# Required
export GMAIL_OAUTH_CLIENT_ID="<your-desktop-app-client-id>"
export GMAIL_OAUTH_CLIENT_SECRET="<your-client-secret>"

# Recommended: prefill the consent screen with the account you want to pull
export GMAIL_LOGIN_HINT="you@yourdomain.com"

# One LLM provider for atomization
export ANTHROPIC_API_KEY="sk-ant-..."
# OR
export OPENROUTER_API_KEY="sk-or-v1-..."
```

On Windows, set them with `setx` or in your shell profile. The recipe never reads OAuth credentials from disk unless you explicitly choose the `credentials.json` fallback.

### 3. First-run authorization

From the recipe folder:

```bash
cd recipes/gmail-smart-pull
node scripts/pull-gmail.mjs --list-labels
```

A browser window opens to Google's consent screen. Grant Gmail **read-only** access (that's the only scope the script requests). After authorizing you're redirected to `http://localhost:3847/callback` where the script catches the code and writes `scripts/pull-gmail/token.json` (gitignored). Expected output: your Gmail labels. That proves auth works.

If the browser doesn't open, copy the URL the script prints and paste it manually.

### 4. Dry-run the puller

```bash
node scripts/pull-gmail.mjs --labels=STARRED --window=30d --limit=5 --dry-run
```

`--dry-run` fetches and parses but writes nothing — safe for previewing. You'll see the pack stats and a sample record on stdout.

### 5. Real run — emit a pack

```bash
node scripts/pull-gmail.mjs --labels=STARRED --window=30d --limit=5
```

This writes:

- Pack file → `data/local-export/gmail/runs/<ISO-timestamp>.json`
- Append-only state logs → `data/gmail-state/{fetched,extracted,errors}.jsonl`

Incremental reruns read `fetched.jsonl` to skip already-seen Gmail IDs.

### 6. (Optional) Install the migrations

```bash
cd recipes/gmail-smart-pull
psql "$SUPABASE_DB_URL" -f sql/001_merge_thought_metadata.sql
psql "$SUPABASE_DB_URL" -f sql/002_entities_canonical_email.sql
```

The first adds a helper RPC for targeted metadata backfills. The second adds `canonical_email` to an existing `public.entities` table so the structured correspondents the pack carries can be upserted as first-class entities by a later job. Both migrations are idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`) and do not drop or rename existing columns.

> [!NOTE]
> The second migration assumes a `public.entities` table already exists. If your deployment doesn't have one yet, pair this recipe with an entities-schema contribution under `schemas/` first.

### 7. Feed the pack into your ingest pipeline

The pack file is the handoff. Your ingest pipeline (whatever it is — a `supabase-js` script, an Edge Function, a batch job) reads the pack and performs fingerprint dedup, sensitivity-gated routing, optional enrichment, and `upsert` into the `thoughts` table. See [Expected Outcome](#expected-outcome) for the pack schema.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--window=<24h\|7d\|30d\|90d\|1y\|all>` | `24h` | Time window relative to now |
| `--after=YYYY/MM/DD` | — | Absolute start date (combines with `--before`; overrides `--window`) |
| `--before=YYYY/MM/DD` | — | Absolute end date |
| `--labels=LABEL1,LABEL2` | `SENT` | Comma-separated Gmail labels (case-insensitive; system labels like `STARRED` and user label IDs from `--list-labels` both work) |
| `--limit=N` | `50` | Max emails to process |
| `--dry-run` | off | Preview without writing anything |
| `--list-labels` | off | List all Gmail labels and exit |
| `--login-hint=EMAIL` | from env | Prefill the OAuth consent screen |
| `--engaged-only` | on | Only ingest threads where you've replied |
| `--include-unengaged` | off | Disable the engagement filter |
| `--refresh-engagement` | off | Force full-history re-sweep of engaged threads |
| `--override-labels=LABEL1,LABEL2` | `STARRED,IMPORTANT` | Labels that bypass the engagement filter |
| `--no-atomize` | off | Skip LLM atomization entirely |
| `--atomize-min-words=N` | `150` | Only atomize messages >= N words |
| `--atomize-provider=P` | `anthropic` | `anthropic` \| `openrouter` \| `claude-cli` \| `codex` |
| `--skip-contacts-refresh` | off | Silence the "contacts cache missing/stale" warning |

## Sensitivity routing

Every message body is scanned locally against two pattern sets in [`scripts/lib/sensitivity.mjs`](./scripts/lib/sensitivity.mjs):

- **restricted** — structured secrets (SSN, passport, bank routing, API keys, passwords, credit cards).
- **personal** — PII signals (email addresses, phone numbers, health/financial vocabulary).
- **standard** — everything else.

The pack record carries `sensitivity: <tier>` and `sensitiveReasons: [...]`. **The pack does not enforce a routing policy on its own** — your ingest pipeline decides what to do with each tier. Common patterns:

- **Block restricted entirely.** Simplest, safest. The atom is discarded.
- **Two-store routing.** Restricted atoms go to a separate Supabase project (or an access-limited schema / local SQLite) that your agents cannot query by default. Standard and personal atoms flow into the main thoughts pool.
- **Tag-and-store.** Everything lands in one store but `sensitivity` is indexed so queries can filter.

> [!CAUTION]
> OB1's default deployment is cloud-first (remote Edge Functions + Supabase). "Restricted stays local" is not automatic — you have to wire it up. If you intend to treat restricted content as off-cloud, write the policy into your ingest pipeline before you run this recipe on a large mailbox.

The patterns are intentionally conservative. If you find false positives (e.g., a specific API-key pattern matches your own account IDs), fork `sensitivity.mjs` and tune the two arrays to taste.

## Engagement filter

On the first real run the script does one Gmail search (`from:me`, paginated) to build a set of thread IDs where you've sent at least one message. That set is cached at `ENGAGED_THREADS_PATH` (default: `data/gmail-state/engaged-threads.json`) and refreshed incrementally (default: `newer_than:<days-stale>d`) on subsequent runs.

Why the filter exists: unengaged threads are almost always noise — marketing, auto-notifications, one-way senders. Mailbox providers treat replies as the #1 engagement signal, and this recipe leans on that prior. Override labels like `STARRED` and `IMPORTANT` bypass the filter so you don't lose inbound-only items you've manually flagged as important.

To disable: `--include-unengaged`.
To rebuild from scratch: `--refresh-engagement`.

## Relationship tier

Each atom is tagged with `context.relationship_tier ∈ {contact, known, unknown}`:

- **contact** — at least one From/To/Cc address appears in your contacts cache.
- **known** — the thread is engaged (you've replied) but no cache hit.
- **unknown** — neither engaged nor a contact.

This is **metadata, not a gate** — routing is still sensitivity-based. A downstream retrieval layer can use tiers for ranking ("prefer atoms from contacts") or filtering ("only show me Q4 commitments from known senders").

**Producing the contacts cache.** This recipe does not ship a contacts-export step because different deployments have different authoritative sources. The format you need is:

```json
{
  "generated_at": "2026-04-21T12:00:00Z",
  "unique_email_addresses": 342,
  "contacts": {
    "alice@example.com": { "name": "Alice Smith" },
    "bob@example.com":   { "name": "Bob Jones" }
  }
}
```

Three common sources:

1. **Companion CRM recipe.** If you run a CRM-style schema with person tiers (e.g. a future `schemas/crm-person-tiers/` contribution), write a small script that selects contacts from that table into the JSON above. See [Dependencies](#dependencies) below.
2. **Google Contacts API.** Use your existing OAuth client with the `contacts.readonly` scope and dump to JSON.
3. **vCard export.** Export your address book to vCard and convert with any off-the-shelf vcard→json tool.

Point the script at your file with:

```bash
export CONTACTS_CACHE_PATH="/path/to/contacts.json"
```

The recipe warns (not errors) when the cache is missing or older than 7 days, so you can start without it and add it later.

## Email correspondents as first-class entities

Every pack record includes a structured correspondents block:

```json
"gmail": {
  "correspondents": {
    "author":     [{ "name": "Alice Smith", "email": "alice@example.com" }],
    "recipients": [{ "name": null,          "email": "bob@example.com" }],
    "cc":         [{ "name": "Carol",       "email": "carol@example.com" }]
  }
}
```

The parsing happens once at pull time (RFC 2822–aware; handles quoted commas and display-name variants). A downstream job can walk these arrays and upsert each unique email as a row in `public.entities` keyed by `canonical_email`, then create `thought_entities` edges with `mention_role ∈ {author, recipient, cc}`.

The accompanying migration [`002_entities_canonical_email.sql`](./sql/002_entities_canonical_email.sql) adds the `canonical_email` column + indexes needed for that upsert path. It is idempotent and does not modify the core `thoughts` table.

Writing the upsert job itself is out of scope for this recipe — the shape of an `entities` table varies across Open Brain deployments. The pack gives you clean, pre-parsed inputs so the job is ~50 lines of Supabase-client code.

## Atomization

Long emails often bundle several distinct ideas (decisions, questions, commitments, context). Storing the whole message as one embedding-addressable thought hurts retrieval. The recipe's atomizer runs an LLM over any message >= `--atomize-min-words` (default 150) and splits it into a JSON array of atomic thoughts. Each atom becomes its own pack record with `memoryId = gmail:<id>#atom:<index>`. Short emails skip atomization and remain one record.

**Provider selection.** The default is `anthropic` (direct Messages API). OpenRouter works as a drop-in alternative. CLI providers (`claude-cli`, `codex`) are for environments where you're already running a CLI session and want to reuse its compute — they're opt-in. The CLI providers pipe the prompt via **stdin** rather than the `-p` argument because on Windows `shell:true` mangles multi-line prompts and the LLM silently receives a truncated input.

**Failure handling.** If atomization fails for a specific message (timeout, non-JSON response, API error), the message falls back to a single whole-message record and the run continues. You never lose data to an atomizer hiccup.

## Expected Outcome

After a successful run you should see:

- A pack file at `data/local-export/gmail/runs/<ISO-timestamp>.json`. Top-level shape:

  ```json
  {
    "version": 2,
    "source_type": "gmail_export",
    "run_id": "2026-04-21T12-00-00-000Z",
    "generated_at": "2026-04-21T12:00:00Z",
    "stats": {
      "messages_found": 47,
      "messages_processed": 23,
      "emails_atomized": 6,
      "atomize_failures": 0,
      "skip_reasons": { "no_engagement": 15, "auto_generated": 9, "too_short": 0 }
    },
    "safe_memories": [ /* atomic thought records */ ],
    "personal_memories": []
  }
  ```

- Each record in `safe_memories` has `memoryId`, `text`, `fingerprint` (SHA-256), `sensitivity`, `sensitiveReasons`, and a `context` block with source provenance, relationship tier, and structured correspondents.
- Append-only state logs grow: `data/gmail-state/fetched.jsonl` + `extracted.jsonl` + `errors.jsonl`.
- Re-running the same command produces **no duplicate fetches** (already-seen Gmail IDs are skipped) and the pack's `stats.already_fetched` reflects that.

## Dependencies

- **Content fingerprint dedup.** The pack's `fingerprint` field follows the convention documented in [primitives/content-fingerprint-dedup](../../primitives/content-fingerprint-dedup/). Your ingest pipeline should use this for idempotency.
- **Optional: CRM person tiers.** If you run a `schemas/crm-person-tiers/` style schema, the contacts cache can be generated from it. This recipe does not depend on that schema being present — it's a performance enhancement, not a requirement.
- **Optional: atomization fixes for the wider import pipeline.** The atomizer in `scripts/lib/atomize-text.mjs` includes two fixes that surfaced during real-world use: (1) multi-line prompts now pipe via stdin instead of the `-p` command-line flag (fixes silent truncation on Windows `shell:true`), and (2) a `codex` provider for running under Codex orchestration without crossing streams with Claude. If you run a separate re-atomization batch job elsewhere, consider adopting the same patterns — see [`scripts/lib/atomize-text.mjs`](./scripts/lib/atomize-text.mjs) for the reference implementation.

## Troubleshooting

**`No credentials` / `Missing Gmail OAuth credentials`**
Set `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET` before running. See [Step 1](#1-create-the-gmail-oauth-client).

**`Port 3847 in use`**
Another process holds the OAuth callback port. Kill that process, or set `GMAIL_CALLBACK_PORT=3848` (remember to register the new redirect URI in Google Cloud Console if you pick a different port).

**`Token refresh failed: invalid_grant`**
Refresh token expired or was revoked. Delete `scripts/pull-gmail/token.json` and re-run to trigger a fresh browser flow.

**Most emails are skipped**
Expected. The engagement filter, auto-generated noise filter, and 10-word minimum are aggressive by design. Run with `--include-unengaged` to see what's being filtered, or inspect `data/gmail-state/extracted.jsonl` for per-message skip reasons.

**Atomization always fails with `no JSON array found`**
Usually an LLM budget issue or prompt-mangling. With `--atomize-provider=anthropic`, check `ANTHROPIC_API_KEY` is set and has credit. With `--atomize-provider=claude-cli`, make sure you're running from a standalone terminal, not nested inside a Claude Code session. Set `--no-atomize` to confirm the rest of the pipeline works without the LLM hop.

**`Cache stale but --skip-contacts-refresh — using old cache`**
The contacts cache file is older than 7 days. Regenerate it from whatever source you used in [Relationship tier](#relationship-tier), or accept the stale cache for this run.

**Want the ingest pipeline too**
The pack format is designed to flow into a fingerprint-dedup + sensitivity-gate + `upsert_thought` path. If you don't already have one, start with the simpler one-thought-per-email path in [`recipes/email-history-import/`](../email-history-import/) and layer the sensitivity + atomization logic from this recipe on top once that baseline works.
