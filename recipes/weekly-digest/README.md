# Weekly Digest

> Scheduled importance-ranked synthesis of the past week's thoughts, delivered to Telegram (or stdout, or a file).

## What It Does

A weekly ritual that reads your brain back to you. Once a week, this script queries the last N days of `public.thoughts`, ranks them by importance, synthesizes them with an LLM (Claude Opus 4.7 by default), and delivers a short, sectioned digest — **Wins, Key decisions, Open loops, Themes** — to your Telegram chat.

This is a "consumption format" companion to your capture habit. Captures alone pile up; a digest is the rhythm that turns the pile into something you actually revisit. Think of it as your weekly standup with yourself, written by the brain you fed it.

## How It Works

1. **Query** `public.thoughts` for the last `--window` days (default 7) via PostgREST.
2. **Filter** by `sensitivity_tier` — restricted is always excluded; personal is excluded by default (opt in with `--include-personal`).
3. **Paginate** the full window so a busy capture day can't push earlier high-signal thoughts out of the sample. Capped at 400 thoughts per run.
4. **Rank** by importance (highest first, recency as tiebreaker). Importance is read from `metadata.importance` on each thought — stock OB1 `public.thoughts` has no top-level `importance` column, so capture pipelines that score importance should stash the value under `metadata.importance`. Thoughts without a score fall to `0`. If fewer than 10 thoughts clear the `--min-importance` threshold, the script logs a widening notice and falls back to the top 60 by importance + recency so a quiet week still produces something worth reading. (On a brain that doesn't score importance, pass `--min-importance=0`.)
5. **Synthesize** via Claude (Anthropic API direct, or OpenRouter as fallback). The system prompt asks for a Telegram-formatted digest under 1500 characters with fixed sections.
6. **Deliver** to Telegram (default), stdout, or a local markdown file under `./digests/YYYY-MM-DD.md`.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+ (uses the native `fetch` API)
- An LLM credential — **one** of:
  - `ANTHROPIC_API_KEY` (preferred — direct Anthropic API)
  - `OPENROUTER_API_KEY` (fallback — routes through OpenRouter)
- **Optional:** a Telegram bot for delivery. If you don't have one, use `--output=stdout` or `--output=file` and skip the Telegram setup entirely.
- **Required for the out-of-the-box safety guarantee:** a `sensitivity_tier TEXT` column on `public.thoughts`. No official Open Brain primitive ships this yet; if you haven't added the column, either install your own migration or wait for the sensitivity-tiers primitive to land upstream. On stock OB1, the recipe **fails closed** — it refuses to run and tells you how to proceed (see the Sensitivity section below). If you explicitly accept the data-leakage risk, pass `--no-sensitivity-filter` to run unfiltered.

> [!WARNING]
> This recipe uses your Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY`). That key **bypasses Row Level Security entirely** — the script can read every row in `public.thoughts` regardless of your RLS policies. On an install without `sensitivity_tier` (or with it misconfigured), that means every capture in the window is eligible to be shipped to the LLM provider and your Telegram chat. Treat those two endpoints as extensions of your brain's trust boundary, and do not run this recipe against a brain that holds material you don't want exfiltrated unless the sensitivity tagging is in place.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
WEEKLY DIGEST -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN (SUPABASE) SETUP
  SUPABASE_URL:                ____________   (your-project-ref.supabase.co)
  SUPABASE_SERVICE_ROLE_KEY:   ____________

LLM (pick one)
  Anthropic API key:           ____________
  OpenRouter API key:          ____________

TELEGRAM DELIVERY (optional)
  Bot token (from @BotFather): ____________
  Chat ID (your DM with bot):  ____________

--------------------------------------
```

## Installation

1. Copy `weekly-digest.mjs` somewhere runnable (e.g., `~/scripts/weekly-digest.mjs` or inside an automation folder).
2. Export the required env vars for your shell, a `.env.local` file, or your scheduler's secret store. The script does not load `.env` files directly — keep it simple and let your runner (cron, systemd, GitHub Actions, `dotenv-cli`) handle that.

```bash
export SUPABASE_URL="https://your-project-ref.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export ANTHROPIC_API_KEY="sk-ant-..."          # or OPENROUTER_API_KEY
export TELEGRAM_BOT_TOKEN="123456:..."         # optional
export TELEGRAM_CHAT_ID="987654321"            # optional
```

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` match the rest of the `recipes/` tree so you can share a single `.env.local` across recipes. `OPEN_BRAIN_URL` and `OPEN_BRAIN_SERVICE_KEY` are accepted as legacy aliases for back-compat but emit a one-time deprecation warning.

3. Smoke test it with `--dry-run` first so nothing ships anywhere:

```bash
node weekly-digest.mjs --dry-run --output=stdout --window=7
```

You should see a `───── DIGEST ─────` block printed to stdout.

## Usage

```bash
# Full defaults: 7-day window, Opus 4.7, delivered to Telegram
node weekly-digest.mjs

# Print to console only
node weekly-digest.mjs --output=stdout

# Write to ./digests/YYYY-MM-DD.md (creates ./digests/ if needed)
node weekly-digest.mjs --output=file

# Two weeks of context
node weekly-digest.mjs --window=14

# Cheap run on Haiku
node weekly-digest.mjs --model=haiku

# Lower importance threshold for a quieter week
node weekly-digest.mjs --min-importance=3

# Opt in to personal thoughts
node weekly-digest.mjs --include-personal
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--window=<days>` | `7` | How many days back to look |
| `--min-importance=<n>` | `4` | Threshold for the primary pool (widens if too few thoughts clear it) |
| `--model=<id\|alias>` | `claude-opus-4-7` | Model id, or one of the aliases `opus`, `sonnet`, `haiku` |
| `--output=<mode>` | `telegram` | `telegram`, `stdout`, or `file` |
| `--include-personal` | off | Also include `sensitivity_tier=personal` thoughts |
| `--dry-run` | off | Synthesize + print, deliver nothing |
| `-h`, `--help` | — | Show help and exit |

### Getting a Telegram chat ID

1. Create a bot with [@BotFather](https://t.me/BotFather) → save the HTTP token.
2. Send any message to your new bot.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser; find `"chat":{"id": 12345}` — that number is your `TELEGRAM_CHAT_ID`.

If you already have a Telegram bot wired to Open Brain for capture (e.g., via a `telegram-capture` integration), you can reuse that same bot for delivery — this digest just pushes messages outbound, so it doesn't care whether the bot also accepts inbound captures.

## Sensitivity

This recipe expects a `sensitivity_tier TEXT` column on `public.thoughts` with values like `standard`, `personal`, and `restricted`. No official Open Brain primitive ships this today; once a `sensitivity-tiers` primitive lands upstream you can install it, or you can add the column via your own migration in the meantime. The digest honors the signal:

- **`restricted`** — never included. These are thoughts you've explicitly flagged as off-limits; a synthesis pass that surfaces them to a Telegram chat defeats the purpose of the tier.
- **`personal`** — excluded by default. Your week probably contains private material (health, relationships, finances) that you'd rather not summarize over an unencrypted wire to a third-party API. Pass `--include-personal` when you want the fuller picture — e.g., a private file output you keep locally.
- **`standard`** (or null) — always included.

**Fail-closed behavior on stock OB1:** if the `sensitivity_tier` column is not present (e.g., a vanilla Open Brain install), the recipe **refuses to run** and prints instructions. It does not silently fall back to an unfiltered query, because that would violate the guarantee below. To override this safety net — at your own risk — pass `--no-sensitivity-filter`; the script will print a loud warning and send every row in the window to the LLM and delivery target.

> [!IMPORTANT]
> Filtering happens at the PostgREST query level, not after the fact. When the `sensitivity_tier` column exists and `--no-sensitivity-filter` is NOT set, restricted thoughts never leave the database, so they can never reach the LLM. The only way restricted/personal rows can reach the LLM is if (a) the column is missing and you passed `--no-sensitivity-filter`, or (b) you misconfigured the column values.

## Scheduling

### Linux / macOS cron

Run weekly on Sunday at 8am local time:

```cron
0 8 * * 0 cd /path/to/recipe && /usr/bin/node weekly-digest.mjs >> ~/logs/weekly-digest.log 2>&1
```

Make sure the crontab either inherits your env vars or sources them, e.g.:

```cron
0 8 * * 0 . "$HOME/.weekly-digest.env" && /usr/bin/node /path/to/weekly-digest.mjs
```

### Windows Task Scheduler

Create a new basic task:

- **Trigger:** Weekly, Sunday, 8:00 AM
- **Action:** Start a program
- **Program:** `node.exe` (full path, e.g. `C:\Program Files\nodejs\node.exe`)
- **Arguments:** `C:\path\to\weekly-digest.mjs`
- **Start in:** `C:\path\to\` (the folder containing the script)
- **Environment variables:** set them in the "Actions → Edit → Environment" dialog, or wrap the command in a `.cmd` that exports them first.

### GitHub Actions

```yaml
name: Weekly Digest

on:
  schedule:
    - cron: "0 13 * * 0" # Sundays 1pm UTC
  workflow_dispatch: {}

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run digest
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: node recipes/weekly-digest/weekly-digest.mjs
```

Store the five env vars as GitHub Actions secrets. The service key should be repo-level, not org-wide.

## Cost Notes

A single run sends up to 80 thoughts (each trimmed to 280 chars) plus metadata to the synthesizer. Rough token math:

| Model | ~Input tokens / 80 thoughts | ~Output tokens | ~Cost / run | ~Cost / year (weekly) |
|-------|------------------------------|----------------|-------------|------------------------|
| `claude-opus-4-7` | ~8k | ~800 | ~$0.18 | **~$9** |
| `claude-sonnet-4-6` | ~8k | ~800 | ~$0.03 | ~$1.60 |
| `claude-haiku-4-5` | ~8k | ~800 | ~$0.008 | ~$0.40 |

Opus is the default for a reason: in side-by-side runs it produces the kind of observation that makes a weekly ritual worth opening ("rescue impulse rooted in discomfort with being seen as unkind") versus Haiku's filler ("automation pays"). At roughly $9/year for Opus vs $0.40/year for Haiku, the Opus premium is small enough that most people will want it for the weekly cadence. Bulk or daily cadence changes that math — use `--model=haiku` there.

Telegram posts are free. File output is free. PostgREST reads are free (your Supabase plan).

## Expected Outcome

Running `node weekly-digest.mjs --dry-run --output=stdout` against a brain with recent captures should print something like:

```
[weekly-digest] window=7d min_importance=4 model=claude-opus-4-7 output=stdout include_personal=false
[weekly-digest] fetched 142 thoughts from window
[weekly-digest] ranked pool: 37 thoughts
[weekly-digest] synthesized 1247 chars
───── DIGEST ─────
Weekly Digest — Apr 11 – Apr 17

Wins
- Shipped smart-ingest edge function with full review gate
- Telegram capture integration merged upstream
- ...

Key decisions
- ...

Open loops
- ...

Themes
- ...
───── END ─────
[weekly-digest] --dry-run set; skipping delivery
```

With `--output=telegram`, the digest arrives as one (or two, if long) messages in your configured chat. With `--output=file`, a markdown file lands in `./digests/YYYY-MM-DD.md` with YAML frontmatter suitable for Obsidian or any file-based notes tool.

## Troubleshooting

**Issue: `Missing SUPABASE_URL env var`**
Solution: Export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` before running. (`OPEN_BRAIN_URL` / `OPEN_BRAIN_SERVICE_KEY` also work as legacy aliases but print a deprecation warning.) The script does not auto-load `.env` files — wrap the call in `dotenv-cli` (`npx dotenv -e .env.local -- node weekly-digest.mjs`) or let your scheduler inject the env.

**Issue: `FATAL: sensitivity_tier column not found on public.thoughts`**
Solution: Your Open Brain install doesn't have a `sensitivity_tier` column on `public.thoughts`. The recipe fails closed rather than silently leak restricted thoughts to the LLM and Telegram. Options: (a) add the column via your own migration (or install the sensitivity-tiers primitive once it ships) and re-run; (b) if you understand the risk and your brain contains nothing sensitive, pass `--no-sensitivity-filter` to run unfiltered — the script will print a loud warning and proceed.

**Issue: `thoughts fetch failed: 401`**
Solution: `SUPABASE_SERVICE_ROLE_KEY` is wrong or expired. This must be the **service_role** key (not the anon key), because the recipe needs to read rows regardless of RLS policies. Double-check in Supabase → Project Settings → API.

**Issue: `Telegram sendMessage failed: 400 chat not found`**
Solution: `TELEGRAM_CHAT_ID` is wrong, or you haven't messaged the bot yet. Send any message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates` — the numeric `chat.id` is what you want.

**Issue: `no thoughts in window; nothing to digest`**
Solution: Either the window really is empty, or your service key can't see the rows. Run the same date filter manually in SQL — `SELECT COUNT(*) FROM thoughts WHERE created_at >= NOW() - INTERVAL '7 days';` — to confirm which it is.

**Issue: Digest feels thin or generic**
Solution: Lower `--min-importance` (try `3`), widen `--window` (try `14`), or switch to `--model=opus` (the default — but confirm `DIGEST_MODEL` env var isn't overriding it). Haiku generates structurally similar output but with noticeably less insight per bullet.
