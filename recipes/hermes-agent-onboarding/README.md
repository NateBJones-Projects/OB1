# Hermes Agent Onboarding

![Stage 0](https://img.shields.io/badge/Stage_0-Agent_Identity-1E88E5?style=for-the-badge)
![Stage 1](https://img.shields.io/badge/Stage_1-User_Profile-43A047?style=for-the-badge)
![Stage 2](https://img.shields.io/badge/Stage_2-Work_Model-FB8C00?style=for-the-badge)
![Stage 3](https://img.shields.io/badge/Stage_3-Financial-8E24AA?style=for-the-badge)
![Stage 4](https://img.shields.io/badge/Stage_4-Domain_Ontology-C62828?style=for-the-badge)
![Stage 5](https://img.shields.io/badge/Stage_5-Calibration-00838F?style=for-the-badge)

A generative 6-stage meta-skill that transforms a blank AI agent into a customized ecosystem — not for "a firmware engineer," but for **your** work. Writers, teachers, chefs, designers, and engineers all get different tools, different data structures, and different communication styles.

## What It Does

This recipe installs a complete onboarding system into your agent. After running it, your agent:

- **Knows who you are** — name, role, preferences, MBTI type, communication style
- **Remembers its own mistakes** — every identity fault is logged with a countermeasure
- **Understands your work** — operating rhythms, recurring decisions, friction points
- **Knows your finances** — bank CSV import, goals × personality profile
- **Builds your domain ontology** — interview → discover terms → generate tables + MCPs
- **Behaves calibrated** — per-user SOUL.md, verified behavior

All data is stored in Supabase and loaded at every session start. The agent builds a persistent relational identity that survives model swaps, provider changes, and software updates.

## Prerequisites

- A working [Supabase](https://supabase.com/) project (free tier works)
- [Supabase CLI](https://supabase.com/docs/guides/cli) linked to your project (`supabase link --project-ref <ref>`)
- An AI agent tool that supports skills/SKILL.md files (Hermes Agent, Claude Code, Codex CLI, Cursor, etc.)
- Node.js 18+ (for Edge Functions, if you proceed to Stage 4)
- Python 3 (for MBTI scoring and CSV importer tools)

> [!IMPORTANT]
> If you don't have an agent yet, start with [Hermes Agent](https://hermes-agent.nousresearch.com/docs) — it has native skill loading, MCP support, and session persistence.

## How to Use

This recipe has two layers:

**Layer 1 — Skills (10 folders):** Copy the `skills/` folders to your agent's skill directory. Each is a standalone behavior you can load individually.

**Layer 2 — Recipe (this folder):** Database migrations + step-by-step setup instructions below. Run through the stages one at a time.

---

![Step 1](https://img.shields.io/badge/Step_1-Apply_Database_Migrations-1E88E5?style=for-the-badge)

The onboarding needs 10 database tables. Copy the migration SQL files to your Supabase project's `migrations/` folder and push.

<details>
<summary>📋 <strong>SQL: Identity infrastructure tables</strong> (click to expand)</summary>

```sql
-- Run these in order from migrations/ folder
-- 001: User infrastructure (user_profiles, user_preferences, user_mbti, user_style, user_relations, user_beliefs)
-- 002: Session checkpoints (session_checkpoints)
-- 003: Service role grants (required by Supabase since May 2026)
-- 004: Checkpoint working directory field
```

</details>

![1.1](https://img.shields.io/badge/1.1-Deploy_Migrations-555?style=for-the-badge&labelColor=1E88E5)

```bash
# Copy migrations to your project
cp -r migrations/ ~/my-supabase-project/supabase/migrations/

# Deploy
cd ~/my-supabase-project
supabase db push --linked
```

✅ **Done when:** All 10 tables appear in your Supabase dashboard's Table Editor.

---

![Step 2](https://img.shields.io/badge/Step_2-Install_Skills-43A047?style=for-the-badge)

Copy the 10 skill folders to your agent's skills directory. The exact path depends on your tool:

- **Hermes Agent:** `~/.hermes/skills/` or `~/.hermes/profiles/<name>/skills/`
- **Claude Code:** `~/.claude/skills/`
- **Codex CLI:** `~/.codex/skills/`

```bash
# Example for Hermes Agent
SKILLS_DIR="$HOME/.hermes/skills"
cp -r skills/* "$SKILLS_DIR/"
```

Each skill folder has a `SKILL.md` and `metadata.json`. The loader order matters:

| Load order | Skill | Stage |
|------------|-------|-------|
| 1 | `supabase-startup-protocol` | 0 |
| 2 | `identity-self-audit` | 0 |
| 3 | `identity-cqrs` | 0 |
| 4 | `context-bridge` | 0 |
| 5 | `checkpoint-workflow` | 0 |
| 6 | `agent-onboarding` | 0–5 |
| 7 | `mbti-guru-hermes` | 1C |
| 8 | `stage-3-financial` | 3 |
| 9 | `stage-4-system-ontologist` | 4 |
| 10 | `stage-5-agent-calibration` | 5 |

✅ **Done when:** `your-agent --skills agent-onboarding` loads without errors.

---

![Step 3](https://img.shields.io/badge/Step_3-Run_the_Onboarding-FB8C00?style=for-the-badge)

Start the onboarding by loading the orchestrator skill:

```bash
your-agent --skills agent-onboarding
```

The agent will greet you and begin Stage 0. Follow the conversation — the agent asks questions one at a time, listens to your answers, and builds your profile progressively.

### Stage Timeline

| Stage | What happens | Approx. time |
|-------|------------|-------------|
| **0 — Agent Identity** | Agent explains identity layer, starts tracking faults | 5 min |
| **1 — User Profile** | Name, role, preferences, MBTI test (choose version: 10-35 min), biography | 20-50 min |
| **2 — Work Model** | Operating rhythms, recurring decisions, dependencies, friction | 15-30 min |
| **3 — Financial** | Optional CSV analysis, MBTI × finance profile, goals | 15-30 min |
| **4 — Domain Ontology** | Deep interview → discover entities → generate tables + MCPs | 30-90 min |
| **5 — Calibration** | SOUL.md generation, wrapper config, verification | 10-15 min |

> [!TIP]
> You can pause after any stage. Next time you load `agent-onboarding`, it detects your progress and resumes where you left off.

---

![Step 4](https://img.shields.io/badge/Step_4-GRANT_Service_Role-8E24AA?style=for-the-badge)

> [!CAUTION]
> Since May 2026, Supabase no longer auto-grants CRUD permissions to `service_role` on new tables. Every table created by Stage 4 needs explicit GRANT.

<details>
<summary>📋 <strong>SQL: Grant service_role to new tables</strong></summary>

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<your_new_table> TO service_role;
```

</details>

To check which tables are missing GRANTs:

<details>
<summary>📋 <strong>SQL: Find tables without service_role GRANT</strong></summary>

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema='public'
EXCEPT
SELECT DISTINCT table_name FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee='service_role';
```

</details>

✅ **Done when:** All MCP tools return data instead of "permission denied."

---

## Expected Outcome

After completing all 6 stages:

1. **Session startup** automatically loads identity data from Supabase
2. **Every mistake** is logged in `identity_faults` with a countermeasure
3. **Agent behavior** adjusts based on your preferences, MBTI, and past faults
4. **Domain structures** (tables, MCPs) answer questions that previously required digging through folders
5. **Session checkpoints** preserve context across sessions
6. **`user_profiles.onboarding_completed`** is set to `true`

### Verification Questions

Ask your agent:

- "What's my MBTI type?"
- "What's the last identity fault you registered?"
- "Show me my financial goals"
- "What domain tables did we build?"
- "What's my next pending checkpoint?"

If the agent answers from data (not from conversation memory), onboarding is complete.

---

## Troubleshooting

### "Permission denied for table" in MCP tools

**Cause:** Supabase no longer auto-grants `service_role`. The migration `20260531090000_service_role_grants.sql` handles the base tables, but Stage 4 tables need their own GRANT.

**Fix:** Run the diagnostic SQL above and GRANT for each missing table.

### MBTI test is too long

The test offers 4 versions. If the user chose Professional (200q) and wants to stop:

1. Score what you have so far
2. Register with `source='partial'`
3. Offer to complete later

### Agent doesn't load skills

**Check:** The `--skills` flag needs a comma-separated list of skill names (folder names), not paths.

```bash
# Correct
your-agent --skills agent-onboarding

# Wrong
your-agent --skills skills/agent-onboarding/SKILL.md
```

### Stage 4 generates tables but MCP tools return 401

**Cause:** Edge Function deployed without `--no-verify-jwt`.

**Fix:**
```bash
supabase functions deploy <function-name> --no-verify-jwt
```

### Checkpoint fields are empty

**Cause:** The 5 identity fields (territory, operating_mode, vector_intent, discovery, consolidated_insights) are required. Without them, the checkpoint is a log entry, not identity data.

**Fix:** Always fill all 5 fields when saving a checkpoint.

---

## Cross-Extension Integration

This recipe integrates with any OB1 extension that uses Supabase, because all identity data lives in shared `public` schema tables:

- **Extension 1 (Professional CRM):** Agent knows user's professional network
- **Extension 2 (Household):** Agent knows family context
- **Extension 4 (Calendar):** Agent knows user's schedule and rhythms
- **Extension 5 (Meal Planning):** Agent knows dietary preferences from user_profiles

The identity tables (user_profiles, user_preferences, user_mbti) are the hub that other extensions connect to via `user_id` foreign keys.

---

## MCP Tool Audit

If you proceed to Stage 4 and create domain MCP tools, link to the [MCP Tool Audit & Optimization Guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/05-tool-audit.md) to manage your tool surface area.

---

## Supported Clients

| Client | Skill loading | MCP support | Notes |
|--------|---------------|-------------|-------|
| Hermes Agent | Native (`--skills`) | Native | Best experience |
| Claude Code | `~/.claude/skills/` | Via config | Test first |
| Codex CLI | `~/.codex/skills/` | Partial | Needs config |
| Cursor | Manual config | Via MCP | Partial support |

---

## License

MIT — free to use, adapt, distribute. See the main repository [LICENSE](../LICENSE) for details.

Built by **Djair Guilherme** ([github.com/djairjr](https://github.com/djairjr)).
Based on [NateBJones/OB1](https://github.com/NateBJones-Projects/OB1) — the Edge Function + MCP pattern that made this possible.
