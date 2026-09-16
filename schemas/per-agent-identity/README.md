# Per-Agent Identity

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@jeremylahners](https://github.com/jeremylahners)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Adds an optional server-side identity primitive for multi-agent Open Brain deployments.

## What It Does

This schema lets an Open Brain deployment issue opaque memory keys to individual agents without storing the raw keys in the database. The server hashes the presented key with SHA-256, calls a `SECURITY DEFINER` lookup RPC, and uses the returned `canonical_agent_id` as the authenticated agent identity.

The stable `canonical_agent_id` is deliberately separate from each key hash. That means a deployment can rotate or revoke an agent key without losing historical attribution for memories, audit events, or future policy decisions.

## Prerequisites

- Working Open Brain setup from `docs/01-getting-started.md`
- Supabase project with `pgcrypto` available for `gen_random_uuid()`
- Server-side code that can hash a presented agent key before calling the lookup RPC
- Existing `MCP_ACCESS_KEY` or equivalent deployment-level authentication remains in place

## Credential Tracker

```text
PER-AGENT IDENTITY -- CREDENTIAL TRACKER
----------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

AGENT KEYS (raw values are shown once, then stored only in your secret manager)
  Agent label:           ____________
  Raw agent memory key:  ____________
  SHA-256 key hash:      ____________

----------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**.
2. Create a new query and paste the full contents of `schema.sql`.
3. Click **Run** to execute the migration.
4. Open **Table Editor** and confirm two new tables exist: `openbrain_agents` and `agent_memory_keys`.
5. Open **Database > Functions** and confirm `lookup_agent_memory_key` exists.
6. Create one row in `openbrain_agents` for each runtime agent.
7. Generate a high-entropy raw key for each agent in your server or secret manager.
8. Store only the lowercase SHA-256 hash of that raw key in `agent_memory_keys.key_hash`.
9. At request time, keep your normal `MCP_ACCESS_KEY` check, then read `x-agent-memory-key` or an equivalent server-controlled parameter.
10. Hash that raw key with SHA-256 and call `lookup_agent_memory_key(hash)`.
11. Treat the returned `canonical_agent_id` as the authenticated identity for attribution, revocation, and future lane policy.
12. Reject requests where a model- or client-supplied `agent_id` disagrees with the authenticated `canonical_agent_id`.

## Expected Outcome

After running the migration:

- `openbrain_agents` stores stable agent identities.
- `agent_memory_keys` stores only hashed per-agent keys.
- `lookup_agent_memory_key` returns active, non-revoked agent identities and updates `last_used_at`.
- Revoking one agent key does not require rotating the deployment-wide `MCP_ACCESS_KEY`.
- Rotating an agent key does not change the agent's stable `canonical_agent_id`.
- Future memory policy can use the derived identity instead of trusting prompt-provided agent labels.

## Server Integration Pattern

The lookup RPC expects a SHA-256 hash, not the raw key. Keep raw key handling in trusted server code.

```ts
import { createHash } from "node:crypto";

function hashAgentMemoryKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

const rawAgentKey = request.headers.get("x-agent-memory-key");
const keyHash = rawAgentKey ? hashAgentMemoryKey(rawAgentKey) : null;

if (keyHash) {
  const { data, error } = await supabase.rpc("lookup_agent_memory_key", {
    p_key_hash: keyHash,
  });

  if (error) throw error;

  const authenticatedAgent = data?.[0];
  if (!authenticatedAgent) {
    throw new Error("Invalid or revoked agent memory key");
  }

  // Use authenticatedAgent.canonical_agent_id for attribution and policy.
}
```

## Key Rotation

1. Insert a new `agent_memory_keys` row for the same `canonical_agent_id`.
2. Update the agent's secret manager entry to use the new raw key.
3. Verify `lookup_agent_memory_key` returns the same `canonical_agent_id` for the new key.
4. Set the old key row to `active = false` and `revoked_at = now()`.

Historical memories should continue pointing at the stable `canonical_agent_id`, not at the old key hash.

## Compatibility

This schema is optional. Single-user Open Brain deployments can keep using only `MCP_ACCESS_KEY`. Multi-agent deployments can layer per-agent identity on top of the existing deployment-level key without changing the base `thoughts` table.

This schema also pairs naturally with `schemas/agent-memory/`, but it does not require that schema. Agent memory, recall traces, audit events, and private-agent lanes can adopt `canonical_agent_id` in a later integration step.

## Troubleshooting

**Issue: `lookup_agent_memory_key` returns no rows**
Solution: Confirm the server passed a lowercase SHA-256 hash, not the raw key. Also confirm the matching `agent_memory_keys` row has `active = true` and `revoked_at IS NULL`.

**Issue: key rotation appears to create a new agent**
Solution: Insert the new key row with the existing `canonical_agent_id`. Do not create a new `openbrain_agents` row for a key rotation.

**Issue: clients can still spoof `agent_id` in request JSON**
Solution: Treat request payload `agent_id` values as hints only. Server-side policy should use the `canonical_agent_id` returned by `lookup_agent_memory_key` and reject contradictory self-assertions.
