# Schema: Hermes Agent Onboarding

![schema](https://img.shields.io/badge/Schema-Identity_Tables-1E88E5?style=for-the-badge)

This schema defines the 10 database tables created by the Hermes Agent Onboarding meta-skill. These tables form the persistent identity layer that allows an AI agent to maintain a consistent, self-aware personality across sessions, model swaps, and provider changes.

## Tables

### Identity Layer (Agent's Self-Knowledge)

| Table | Purpose | Created by |
|-------|---------|------------|
| `identity_faults` | Every mistake the agent makes in its relationship with the user. Each fault has a symptom, root cause, countermeasure, and severity. | Migration 003 |
| `agent_capabilities` | Skills and behaviors the agent has acquired for this user. | Migration 003 |
| `identity_milestones` | Breakthroughs, protocol establishments, and capacity acquisitions in the agent's own development. | Migration 003 |
| `session_checkpoints` | Intentional marks in the agent's representation space: territory, operating_mode, vector_intent, discovery, consolidated_insights. Not logs — identity structure that rehydrates next session. | Migration 002 + 004 |

### User Profile Layer

| Table | Purpose | Created by |
|-------|---------|------------|
| `user_profiles` | Identity, family context, routines, MBTI type. | Migration 001 |
| `user_preferences` | Communication style, autonomy level, schedule preferences. | Migration 001 |
| `user_mbti` | 4 dimensions (E/I, S/N, T/F, J/P), calculated type, per-dimension scores and clarity. | Migration 001 |
| `user_style` | Vocabulary preferences, tone markers, sentence structure observations. | Migration 001 |
| `user_relations` | Key people: partners, family members, clients, mentors. | Migration 001 |
| `user_beliefs` | Values, principles, non-negotiables, philosophical stance. | Migration 001 |

## Security Model

All tables use RLS with `service_role`-only access. This is intentional for single-user setups:

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.<table> FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
```

Since May 2026, Supabase requires explicit GRANT for the Data API:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO service_role;
```

## Relationship Diagram

```
user_profiles (1) ──→ (N) user_preferences
user_profiles (1) ──→ (N) user_mbti
user_profiles (1) ──→ (N) user_style
user_profiles (1) ──→ (N) user_relations
user_profiles (1) ──→ (N) user_beliefs
user_profiles (1) ──→ (N) session_checkpoints
user_profiles (1) ──→ (N) identity_faults
user_profiles (1) ──→ (N) agent_capabilities
user_profiles (1) ──→ (N) identity_milestones
```

## Usage

```bash
# Deploy all migrations
supabase db push --linked

# Verify tables
supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```
