# Recipes

https://github.com/user-attachments/assets/9454662f-2648-4928-8723-f7d52e94e9b8

Recipes are step-by-step builds that add a new capability to your Open Brain. Follow the README in the recipe folder, run the code, and verify the result before moving on. Some recipes depend on canonical skill packs in [`skills/`](../skills/); those recipes should install the skill first, then use the recipe for workflow and composition.

## Start Here: Import Data

If you are new to OB1 and want to get files, exports, notes, or history into your brain, start with this flow:

1. Finish the base [Open Brain setup](../docs/01-getting-started.md). You need a working `thoughts` table, Supabase credentials, and an OpenRouter key for most importers.
2. Pick the matching importer from the table below.
3. Open that recipe's README and fill in its credential tracker.
4. Configure credentials locally with environment variables or a local `.env` file. Do not commit credentials, exports, sync logs, or raw archives.
5. Run the recipe's dry run first.
6. Run a small live batch, usually `--limit 5`, `--limit 10`, or `--limit 20`.
7. Verify the new rows in Supabase or by searching with an MCP-connected AI.
8. Run the full import only after the dry run and small batch look right.

Most importers write rows into the same `thoughts` table used by the core MCP server. Re-running a recipe is usually safe because importers keep a local sync log and/or write content fingerprints, but read the specific recipe README before deleting sync logs or forcing a re-import.

## Which Importer Should I Use?

| Source | Use This Recipe | First Command To Look For |
| ------ | --------------- | ------------------------- |
| ChatGPT data export zip or extracted folder | [ChatGPT Conversation Import](chatgpt-conversation-import/) | `python import-chatgpt.py path/to/export.zip --dry-run --limit 10` |
| Obsidian vault or markdown knowledge folder | [Obsidian Vault Import](obsidian-vault-import/) | `python import-obsidian.py /path/to/vault --dry-run --verbose` |
| Gmail history through Gmail API | [Email History Import](email-history-import/) | `deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --dry-run --limit=5` |
| Google Takeout My Activity | [Google Activity Import](google-activity-import/) | `node import-google-activity.mjs "/path/to/Takeout/My Activity" --dry-run --limit 5` |
| Readwise highlight history | [Readwise Import](readwise-import/) | `python import-readwise.py --dry-run --limit 50 --verbose` |
| X/Twitter archive | [X/Twitter Import](x-twitter-import/) | `node import-x-twitter.mjs /path/to/twitter-export --dry-run` |
| Instagram archive | [Instagram Import](instagram-import/) | Read the recipe README, then run its dry-run command before importing. |
| Grok/xAI conversation export | [Grok Export Import](grok-export-import/) | Read the recipe README, then run its dry-run command before importing. |
| Perplexity export `.xlsx` | [Perplexity Conversation Import](perplexity-conversation-import/) | `python import-perplexity.py path/to/export.xlsx --dry-run --limit 5` |
| Blogger or journal Atom XML export | [Journals/Blogger Import](journals-blogger-import/) | Read the recipe README, then run its dry-run command before importing. |
| Large PDFs, DOCX, PPTX, XLSX, CSV, or mixed folders | [Heavy File Ingestion skill](../skills/heavy-file-ingestion/) | Convert first, inspect the generated artifact/index, then import the clean text with an appropriate recipe or future ingest path. |

## Verify An Import

After a small batch or full import, check at least one of these:

- Supabase Table Editor: open `thoughts` and filter by the recipe's `metadata.source` or `source_type`.
- MCP search: ask an MCP-connected AI to search for a topic you know was in the imported source.
- Recipe output: review inserted/skipped counts, sync-log notes, and any generated report.
- Embeddings: imported rows should normally have a populated `embedding` unless the recipe explicitly supports a no-embedding mode.

Good verification questions are specific:

```text
Use Open Brain search_thoughts to find notes from my ChatGPT export about database migrations.
Use Open Brain search_thoughts to find Obsidian notes about my home maintenance plan.
```

## Safety Rules

- Never commit `.env`, `.env.local`, service-role keys, OAuth tokens, downloaded archives, raw exports, or importer sync logs that contain personal data.
- Use the Supabase secret/service-role key only for local import scripts that need to write directly to your database.
- Keep dry runs read-only. If a dry run reports unexpected files, skipped secrets, or too many extracted thoughts, stop and adjust flags before importing.
- For large imports, prefer batches. A successful batch is easier to inspect and cheaper to recover from than a full import with bad settings.
- Treat imported memories as evidence by default. Instruction-grade memory should come from human confirmation or a trusted import path.

## Other Recipes

| Recipe | What It Does |
| ------ | ------------ |
| [Bring Your Own Context](bring-your-own-context/) | Portable context workflow that packages extraction prompts, profile generation, and remote MCP deployment into one entrypoint |
| [Daily Digest](daily-digest/) | Automated summary of recent thoughts via email or Slack |
| [Wiki Compiler](wiki-compiler/) | Compiles graph-backed entity pages and topic synthesis into a regenerable wiki layer you can run on demand or on a schedule |
| [Work Operating Model Activation](work-operating-model-activation/) | Interview-driven workflow that stores how you actually work and generates agent-ready operating files |
| [World Model Diagnostic Activation](world-model-diagnostic-activation/) | Lightweight activation path for a 20-minute world-model diagnostic that uses the base OB1 connector and a direct-paste fallback |
| [Research-to-Decision Workflow](research-to-decision-workflow/) | Compose canonical skills into operator and investor paths for analysis, synthesis, meetings, and decision documents |
| [NBJ OB1 Agent Memory for OpenClaw](openclaw-agent-memory/) | Canonical recipe for using OB1 Agent Memory as the governed continuity layer for OpenClaw workflows |
| [OpenClaw Code Review Memory](openclaw-code-review-memory/) | Flagship workflow for compounding repo-specific review lessons, maintainer corrections, and false positives |
| [OpenClaw TaskFlow Work Log](openclaw-taskflow-work-log/) | Durable handoff recipe for long-running OpenClaw TaskFlows across agents, models, and channels |

Agent Memory recipes should be paired with
[Safe Agent Memory and Provenance](../docs/safe-agent-memory-provenance.md)
before enabling write-back in shared workspaces.

## Contributing

Recipes are open for community contributions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
