# Sensitive Data Redaction

> A standard pre-ingest pass for masking or skipping sensitive strings before external text is embedded or stored in Open Brain.

## What It Is

Sensitive Data Redaction is the baseline safety layer for ingestion contributions. Its job is simple: preserve the useful context of imported text while removing exact strings that create unnecessary risk if they land in embeddings, stored content, logs, exports, or downstream AI retrieval.

This primitive is not a full enterprise DLP system. It is a deterministic, maintainable default for a solo-operator stack. When a contribution imports raw external or user-authored text into Open Brain, it should run this pass before embedding and before database insert.

## Why It Matters

Most imported content is valuable because of its meaning, not because it contains exact credentials or high-risk identifiers. An email that says a client shared a production Stripe key is useful memory. The exact Stripe key is not useful memory. It is a liability.

That distinction is the policy:

- Keep semantic context.
- Remove exact secrets.
- Skip content entirely when the payload is too dangerous to keep, such as private key blocks.

This protects the obvious high-risk cases without turning Open Brain into a sterile archive. Your AI still remembers what happened. It just does not keep live credentials around when a placeholder will do.

## What Must Require This Primitive

Any recipe, integration, or extension that imports, syncs, scrapes, forwards, summarizes, or bulk-captures raw text before storage or embedding must declare this primitive in `metadata.json` and link it in its README.

That includes:

- Email and inbox importers
- Chat export importers
- Social, blog, and document importers
- Automated capture pipelines that ingest raw third-party text

That does not include:

- Dashboards
- Schema-only contributions
- Analytics or metadata backfills that do not ingest new raw text

## How It Works

The primitive ships a canonical `patterns.json` file with deterministic regex rules and two actions:

- `redact`: replace the exact sensitive string with a placeholder such as `[REDACTED_API_KEY]`
- `skip`: reject the content entirely because partial masking is not enough

The intended pipeline is:

1. Normalize and clean imported text.
2. Run sensitive-data redaction.
3. If the content is marked `skip`, do not embed or insert it.
4. If the content is redacted, embed and store the redacted version.
5. Record redaction labels/counts in metadata when helpful.

## Common Patterns

### Redact In Place

Use redaction for API keys, bearer tokens, connection strings with embedded credentials, SSNs, reset links, and other exact strings that create blast radius if retrieved verbatim later.

### Skip Entire Content

Use skip rules for private key blocks and similar payloads where storing a partially masked version still creates too much risk or too little value.

## Step-by-Step Guide

1. Add `"requires_primitives": ["sensitive-data-redaction"]` to the contribution metadata.
2. Link this primitive in the contribution README prerequisites or ingestion section.
3. Apply the policy before embeddings and before database insert.
4. Default the redaction pass to on. If you expose an opt-out flag, make it explicit and clearly marked as not recommended.
5. Log what happened. At minimum, report redacted counts and skipped items so users can sanity-check imports.

## Expected Outcome

An ingestion contribution that uses this primitive keeps the useful meaning of imported content while masking exact secrets. Users can still search and retrieve context, but high-risk strings do not get embedded or stored verbatim by default. A dry run should make it obvious what would be redacted and what would be skipped.

## Troubleshooting

**Issue: The scanner flags a false positive**
Solution: Keep the rule set deterministic and conservative. If a specific importer needs an override flag, expose one explicitly and document the tradeoff.

**Issue: A recipe fails because `patterns.json` is missing**
Solution: The contribution depends on this primitive. Keep the repo structure intact, or copy the `primitives/sensitive-data-redaction/` folder alongside the recipe when running it standalone.

**Issue: Users complain that too much context is removed**
Solution: The rule set should bias toward placeholder replacement, not blanket deletion. If a rule is dropping useful content, change it from `skip` to `redact` or tighten the regex.

## Extensions That Use This

- Future ingestion-focused extensions should use this primitive as their default policy layer.
- Today the policy is already wired into [Email History Import](../../recipes/email-history-import/) and [Obsidian Vault Import](../../recipes/obsidian-vault-import/).

## Further Reading

- [Contributing Guide](../../CONTRIBUTING.md)
- [Email History Import](../../recipes/email-history-import/)
- [Obsidian Vault Import](../../recipes/obsidian-vault-import/)
