# Weekly Signal Diff

> Standalone skill pack for turning a week's worth of market noise into a
> personalized structural diff.

## What It Does

This skill runs a weekly scan across a suggested universe of categories and
companies, then reweights the analysis using what Open Brain already knows
about the user. It produces a `diff, not digest`: what changed, why it
matters, and what to watch next.

The default starter universe is AI-first because that is where the original
use case came from, but the logic is universal. You can swap the categories and
companies for any fast-moving market and keep the same structural-diff process.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom
  instructions

## Prerequisites

- Working Open Brain setup if you want memory search and capture
  ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- One of:
  - live web access in the client
  - a user-provided weekly source set
- Optional upgrade for automated live-search runs: OpenRouter access to the
  Perplexity Sonar family
  ([OpenRouter model page](https://openrouter.ai/perplexity/sonar/api))

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into your client's reusable-instructions
   location.
2. Keep the [`references/`](./references/) folder alongside it if you want the
   starter universe and live-search notes available to the client.
3. Restart or reload the client so it picks up the skill.
4. Test it with a prompt like:
   `Run my weekly signal diff on AI infrastructure and tell me what changed this week that matters for a solo builder.`
5. Optional: wire it into your weekly automation. If OpenRouter is available,
   use the Perplexity Sonar family for the retrieval pass and keep the final
   digest structure consistent every week.

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/weekly-signal-diff/references
cp skills/weekly-signal-diff/SKILL.md ~/.claude/skills/weekly-signal-diff/SKILL.md
cp -R skills/weekly-signal-diff/references ~/.claude/skills/weekly-signal-diff/references
```

If your client does not support native skill folders, paste the contents of
[`SKILL.md`](./SKILL.md) into that client's reusable prompt or project-rules
feature and keep the reference files nearby.

## Trigger Conditions

- "Run my weekly signal diff"
- "What changed this week that matters to me?"
- "Track AI this week"
- "Turn this week's news into structural shifts"
- "Give me the signal, not the headlines"
- Weekly automated digests or review rituals

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a coverage note explaining what was scanned
- 3-7 structural shifts instead of a long news list
- user-specific implications pulled from Open Brain memory
- a watchlist for next week
- optional capture of the weekly digest back into Open Brain

## Troubleshooting

**Issue: The output reads like a news summary**
Solution: Keep the structural questions intact. The skill should filter for
constraint shifts, leverage shifts, broken assumptions, and exposed
dependencies.

**Issue: The final diff feels generic**
Solution: Check that the client actually searched Open Brain first. This skill
gets sharper when it can pull active projects, recurring interests, and prior
digests before ranking the week's news.

**Issue: The scan fixates on the default 30-company list**
Solution: Treat the starter universe as a bootstrap layer. Replace or re-rank
the suggested companies and categories using the user's actual focus areas.

**Issue: The live-search results are shallow or stale**
Solution: If OpenRouter is available, upgrade the retrieval pass to a
Perplexity Sonar search model and constrain domains or freshness when needed.
See [references/live-search-upgrade.md](./references/live-search-upgrade.md).

## Notes for Other Clients

This skill is portable because the logic is procedural. Any client that can
load reusable instructions and access either Open Brain or a weekly source set
can run it. If the client has no live search, feed it a source packet and ask
for the same structural-diff output.
