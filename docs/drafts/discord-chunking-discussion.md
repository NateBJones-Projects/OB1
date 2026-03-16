# Discord Post Draft — Chunking Columns Discussion

Copy/paste the section below into #contributors (or #general):

---

**Should chunking columns be core schema or opt-in?**

We have 3 competing proposals to extend the `thoughts` table right now:

| Proposal | What it adds | PR | Author |
|----------|-------------|-----|--------|
| Chunking | +3 columns (`parent_id`, `chunk_index`, `full_text`) | #27 | Matt |
| Fingerprint dedup | +1 column (`content_fingerprint`) + unique index | #54 | @alanshurafa |
| Full-text search | +1 GIN index on `content` | #53 | @alanshurafa |

If all three merge into the default schema, the "simple 6-column table" from getting-started becomes **10 columns + 5 indexes**.

**Here's the thing:** I dug into how import recipes are actually handling long content, and nobody is using chunking. The pattern that's emerged across 7+ import recipes (mostly @alanshurafa's work, tested at 75K+ thoughts) is:

- Truncate to ~8KB before embedding (model limit)
- Store full content up to 30KB in `content` as-is
- SHA-256 fingerprint for dedup
- GIN index for keyword/full-text search

Matt's ChatGPT importer uses LLM summarization — distilling long conversations into standalone thoughts. Also no chunking.

**Zero of the 10+ import recipes or extensions reference `parent_id`, `chunk_index`, or `full_text`.**

The chunking columns from PR #27 won't break anything — nullable columns with no migration risk. But enshrining them in the default schema signals "this is the way to handle long content" when the community has converged on simpler approaches.

**The question:** Should chunking be part of the default `thoughts` table that every new user creates, or should it be an opt-in primitive (`primitives/rag-chunking/`) that users add via ALTER TABLE when they actually need it?

Arguments either way:
- **For core:** RAG chunking is standard practice, some users will need it eventually, Nate already approved #27
- **For opt-in:** Nobody's using it yet, embedding models handle 8K tokens (~30KB) which covers most personal content, chunking adds retrieval complexity (`match_thoughts` would need changes to reconstruct chunks)

Would love to hear from folks who are actively importing data — @alanshurafa @snapsynapse @konepone @geoff-price — how are you handling long content? Is chunking something you'd want in the default schema or prefer to add when needed?

---

*End of post*
