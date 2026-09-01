# Architecture — Local Docker Open Brain (Qdrant)

## What This Is

The Qdrant variant of [recipes/local-docker](../local-docker/). It replaces PostgreSQL + pgvector with a self-hosted Qdrant instance for vector storage while keeping the same AWS Bedrock integration for embeddings and metadata extraction.

The design is **multi-tenancy-primed**: ACL enforcement is built into every read path now, using a trivially-passing identity in local mode. Stage 2 (hosted deployment) activates real user isolation by swapping one environment variable — no data migration, no schema changes.

---

## Collection Schema

Qdrant collection name: `thoughts`

| Field | Qdrant type | Notes |
|---|---|---|
| `content` | text | Raw thought text |
| `type` | keyword | e.g. `idea`, `decision`, `reference` |
| `topics` | keyword[] | Extracted topic tags |
| `people` | keyword[] | Extracted person names |
| `actions` | keyword[] | Extracted action items |
| `source` | keyword | Originating application or surface |
| `title` | keyword (optional) | Page or document title |
| `url` | keyword (optional) | Source URL |
| `owner_id` | keyword | Identity of the owner; `"local-user"` in local mode |
| `owner_email` | keyword | Owner's email address; empty string in local mode |
| `visibility` | keyword | `"private"` or `"shared"` |
| `shared_with` | keyword[] | List of user IDs this thought is explicitly shared with |
| `created_at` | datetime | ISO 8601 UTC timestamp |

Vector configuration: size **1024**, distance **Cosine** (matching Amazon Titan Text Embeddings V2 output dimensions).

---

## Payload Indexes

Eight payload fields are indexed at collection creation time:

| Field | Index type | Purpose |
|---|---|---|
| `owner_id` | keyword | ACL filter — isolate by owner |
| `visibility` | keyword | ACL filter — find shared thoughts |
| `shared_with` | keyword | ACL filter — explicit sharing list |
| `type` | keyword | `list_thoughts` type filter |
| `source` | keyword | `list_thoughts` source filter |
| `created_at` | datetime | `list_thoughts` date range filter |
| `topics` | keyword | `list_thoughts` / `search_thoughts` topic filter |
| `people` | keyword | `list_thoughts` people filter |

These indexes ensure all ACL and metadata filters are resolved by Qdrant's inverted index rather than a full vector scan. This keeps read latency flat regardless of collection size.

---

## ACL Filter Shape

Every read handler calls `buildAclFilter()` before executing a search or scroll. This is the single enforcement point for access control.

```typescript
// ACL filter composition is the single enforcement point.
// If you add a new read handler, you MUST call buildAclFilter().
{
  must: [
    ...userFilter?.must ?? [],
    {
      should: [
        { key: "owner_id", match: { value: identity.owner_id } },
        { key: "visibility", match: { value: "shared" } }
      ]
    }
  ]
}
```

In local mode (`IDENTITY_MODE=local`), `identity.owner_id` is always `"local-user"`. Since every thought is written with `owner_id: "local-user"`, the first `should` branch matches every record, and the filter trivially passes. This means local operation is functionally identical to having no ACL at all — there is zero behavioral difference for a single user.

In Stage 2, when `IDENTITY_MODE=entra` is set, `identity.owner_id` is derived from the verified JWT. A user can only see their own `private` thoughts, or any thought with `visibility: "shared"`. This boundary is enforced entirely within `buildAclFilter()` — no changes to the tool handlers are needed.

---

## Identity Modes

| Mode | Behavior | How to activate |
|---|---|---|
| `local` | Stamps every request with `owner_id=local-user`, `owner_email=""`. ACL filter trivially passes for all records. | Default; set `IDENTITY_MODE=local` in `.env` |
| `entra` | Validates a Bearer token against Microsoft Entra (Azure AD). Extracts `oid` as `owner_id` and `upn` as `owner_email`. | Set `IDENTITY_MODE=entra` + Entra app config (Stage 2). Currently throws HTTP 501. |

---

## Why Qdrant Over pgvector

| Consideration | Qdrant | pgvector |
|---|---|---|
| Primary purpose | Purpose-built vector database | Vector extension on top of Postgres |
| Payload indexing | Native inverted indexes on any field | Requires separate B-tree/GIN indexes; harder to compose with vector queries |
| ACL filter performance | ACL filter resolved by payload index, not vector scan | Full-table ACL scan unless carefully indexed; degrades at scale |
| Multi-tenant scaling | Designed for filtered, partitioned workloads | Works well single-user; ACL overhead grows with row count |
| HTTP API | First-class, stable REST API — no DB client library needed | Requires `pg` or compatible Postgres client |
| Operational simplicity | Single binary, single data directory | Requires init SQL, schema migrations, connection pooling considerations |

For a single-user local deployment, the difference is imperceptible. The architectural choice pays off in Stage 2, where multi-tenant isolation with thousands of thoughts per user would impose measurable overhead on a pgvector ACL scan.

---

## AWS Credential Handling

The MCP server needs Bedrock access. Credentials are sourced from your host's `~/.aws/credentials` file via a read-only bind mount, then parsed on every Bedrock call. This is deliberate — the alternatives all have failure modes.

**How it works:**
- `docker-compose.yml` bind-mounts `${AWS_HOME}` → `/root/.aws` as `read_only: true`. The container can read your credentials but cannot modify them.
- `server/src/bedrock.ts:readCredentials()` parses the standard INI format manually, picks the section named by `AWS_PROFILE`, and returns `{ accessKeyId, secretAccessKey, sessionToken? }`.
- `makeBedrock()` is called fresh per Bedrock request. No SDK credential caching, no module-level singleton. Every request reads the file again.

**Why not the AWS SDK's built-in `fromIni()` / default credential chain:**
- The SDK chain caches credentials in memory. With SSO or assume-role profiles whose tokens expire on the order of hours, that cache goes stale and you get `ExpiredTokenException` until the container is restarted.
- Reading the file per request makes rotation transparent. Run `aws sso login` on the host and the next Bedrock call from the container picks up the new tokens automatically — no container restart needed.

**What never leaves the container:**
- Credentials go to the AWS Bedrock endpoint (HTTPS) and nowhere else.
- They are never written to logs, captured thoughts, or the Qdrant payload.
- They are never copied into the image — only mounted at runtime.

**Trade-offs we rejected:**
- *Inject `AWS_ACCESS_KEY_ID` etc. via env vars* — breaks when tokens rotate.
- *Mount `~/.aws` writable* — unnecessary privilege; we only need to read.
- *Bake credentials into the image* — never. The image is portable; credentials are per-user.

**Operator notes:**
- If `aws configure list --profile <your-profile>` works on the host, the container will see the same credentials.
- Expired credentials cause the startup health check to fail fast (`process.exit(1)`) so the container won't run with broken AWS access.

---

## Port Layout

| Stack | Service | Port | Protocol |
|---|---|---|---|
| pgvector recipe | MCP server | 3000 | HTTP |
| pgvector recipe | PostgreSQL | 5432 | TCP |
| Qdrant recipe | MCP server | 3100 | HTTP |
| Qdrant recipe | Qdrant (HTTP API) | 6333 | HTTP |
| Qdrant recipe | Qdrant (gRPC API) | 6334 | gRPC |

The two stacks share no ports and can run simultaneously without conflict.

---

## Migration Path

### Stage 1 → Stage 2 (single-user local → multi-user hosted)

1. Deploy the Qdrant stack to a hosted environment (ECS, Fly.io, etc.)
2. Set `IDENTITY_MODE=entra` and configure Entra app registration env vars
3. Done — no data migration required. The ACL fields are already present on every existing thought; they will be filtered correctly once real identities are in play.

### From pgvector recipe → Qdrant recipe

Use the provided migration script to copy existing thoughts from the pgvector Postgres instance into Qdrant. Both stacks must be running during migration.

```bash
# Preview without writing
node scripts/migrate-pgvector-to-qdrant.mjs --dry-run

# Execute migration
node scripts/migrate-pgvector-to-qdrant.mjs
```

The script re-generates embeddings via Bedrock for each thought (Qdrant uses the same embedding model — Titan V2 at 1024 dimensions — so existing vectors could in principle be transferred, but regenerating ensures consistency). It stamps `owner_id=local-user` and `visibility=private` on all migrated records.

---

## Differences from the pgvector Recipe

| Dimension | pgvector recipe | Qdrant recipe |
|---|---|---|
| Vector store | PostgreSQL 16 + pgvector | Qdrant v1.16.3 |
| MCP server port | 3000 | 3100 |
| Database port | 5432 (Postgres) | 6333/6334 (Qdrant HTTP/gRPC) |
| MCP tools | 5 (no sharing) | 6 (adds `share_thought`) |
| `capture_thought` | No visibility param | Adds `visibility` param (`"private"`/`"shared"`) |
| `search_thoughts` | No scope param | Adds `scope` param (`"private"`/`"shared"`/`"all"`) |
| ACL enforcement | None | Built into every read path via `buildAclFilter()` |
| Thought fields | No ownership fields | Adds `owner_id`, `owner_email`, `visibility`, `shared_with` |
| Init SQL | Required (`init-db/01-schema.sql`) | None — Qdrant collection created programmatically on startup |
| Multi-tenant path | Not designed for it | Stage 2: swap `IDENTITY_MODE=entra` |
