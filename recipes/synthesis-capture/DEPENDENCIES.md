# Synthesis Capture — Dependencies & Known Limitations

This recipe has two unresolved couplings to the rest of Open Brain that a
contributor installing against stock `origin/main` should understand before
deploying.

## 1. Sibling recipe: `provenance-chains` (pending)

### What's blocked

The stock `upsert_thought` RPC shipped in
[`docs/01-getting-started.md`](../../docs/01-getting-started.md) reads
**only** `p_payload.metadata` when inserting into `public.thoughts`:

```sql
INSERT INTO thoughts (content, content_fingerprint, metadata)
VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
```

Top-level keys on `p_payload` — including `source_type`,
`derivation_layer`, `derivation_method`, and `derived_from` — are silently
dropped. The sibling `provenance-chains` recipe (branch
`contrib/alanshurafa/provenance-chains`, not yet merged) ships:

1. Three new columns on `public.thoughts`:
   `derivation_layer` (text), `derivation_method` (text), `derived_from` (jsonb).
2. An updated `upsert_thought` RPC that reads and persists those top-level fields.

### Interim mitigation (already applied in this recipe)

Both handlers mirror the provenance fields into
`metadata.provenance.{source_type, derivation_layer, derivation_method, derived_from}`
in addition to passing them at the top level of `p_payload`. This means:

- **On the patched RPC (after `provenance-chains` lands):** top-level fields
  populate their dedicated columns; the metadata mirror is redundant but
  harmless.
- **On the stock RPC (current `main`):** top-level fields are dropped but
  the metadata mirror survives. Consumers can reconstruct provenance by
  reading `metadata->'provenance'`.

Search for `TODO(synthesis-capture)` in `mcp-tool-handler.ts` and
`rest-endpoint.ts` for the exact locations to clean up once the patched
RPC is in place.

### Caveats while `provenance-chains` is unmerged

- The anti-loop check (`source_type = 'synthesis'`) reads the top-level
  column in both handlers. On stock RPC, no synthesis row ever has that
  column populated, so the check will never reject a
  synthesis-of-synthesis. Treat this as a best-effort guard, not a
  guarantee, until the patched RPC is deployed.
- The `derivation_method = 'synthesis'` SQL filter in README "How to
  Verify" will return zero rows on stock RPC. Substitute
  `metadata->'provenance'->>'derivation_method' = 'synthesis'` in the
  meantime.

## 2. Base tools don't expose row IDs

### What's blocked

`capture_synthesis` requires `source_thought_ids: [id, id, id, ...]`. In a
typical MCP session, an AI client discovers those IDs by first calling
`search_thoughts` or `list_thoughts`. The stock versions of those tools
(see `server/index.ts` around lines 113 and 202 on `origin/main`) return
formatted text for human consumption and **never include the raw row IDs
in the tool response**.

The result: a model following the README example ("search my brain, then
capture your summary as a synthesis with provenance") cannot actually
produce the required input list on its own. It either guesses IDs and
fails the existence check, or gives up.

### Workarounds (until a base update lands)

- **Manual ID injection:** the human user pastes IDs into the prompt.
  ExoCortex dashboards, direct SQL, or a custom recipe can surface IDs for
  copy/paste.
- **Custom read tool:** deploy a variant of `search_thoughts` that returns
  structured JSON including `id`, then reference it instead. The
  sibling `panning-for-gold` skill contains one such pattern; this recipe
  does not ship its own.
- **REST path:** the `POST /synthesis` endpoint is unaffected — callers
  pulling IDs from scripts or dashboards already have them.

### TODO

Once the base MCP tools expose IDs (tracked as a follow-up against
`server/index.ts`, no ticket yet), this section can be retired. Until
then, expect to see failures of the form
`parent thoughts not found: ...` when a model tries to invent IDs from
thin air — it's not a recipe bug, it's a base-tool limitation.

---

_Last updated: 2026-04-17_
