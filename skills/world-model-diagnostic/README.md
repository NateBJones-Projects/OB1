# World Model Readiness Diagnostic

> Reusable skill that interviews a company about signal, information flow, and judgment, then maps it to the right world-model paradigm with an explicit boundary-layer audit.

## What It Does

This skill runs a lightweight, conversation-first diagnostic in about 20 minutes.

It asks where the company's highest-fidelity signal lives, how decisions actually
get made, where editorial judgment still sits in people, and which information
flows should be treated as `act on this` versus `interpret this first`.

The output is not a fake-precise readiness score. It returns:

- paradigm fit
- boundary-layer status
- top simulated-judgment exposures
- first/second/third build sequence
- clear labels for `Firm finding`, `Inference`, and `Open question`

If Open Brain search/capture tools are present, the skill also persists the
intake, boundary audit, and final assessment back into OB1 so the diagnostic can
compound over time.

## Supported Clients

- Claude
- ChatGPT
- Codex
- Cursor
- Any client that supports reusable skills, reusable prompts, or direct prompt paste

## Prerequisites

- Optional but recommended: working Open Brain setup with `search_thoughts` and `capture_thought` available ([guide](../../docs/01-getting-started.md))
- Optional but recommended: the paired [World Model Diagnostic Activation recipe](../../recipes/world-model-diagnostic-activation/)
- AI client that supports reusable skills/prompts, or a plain chat window for the direct-paste prompt

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into your client's reusable-instructions location.
2. Reload or restart the client.
3. If you want persistence, verify the client can also see your base Open Brain `search_thoughts` and `capture_thought` tools.

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/world-model-diagnostic
cp skills/world-model-diagnostic/SKILL.md ~/.claude/skills/world-model-diagnostic/SKILL.md
```

## Trigger Conditions

- "Run the World Model Diagnostic on my company"
- "Which world-model architecture fits us?"
- "Audit our boundary layer"
- "Where are we most exposed to simulated judgment?"
- "Tell me what to build first for a world model"

## Direct-Paste Prompt

Use this if you want the same workflow in a plain Claude or ChatGPT chat:

```text
Use the World Model Diagnostic. Interview me for about 20 minutes to assess whether my company is ready for a world model. Ask about company size, industry, business model, the top 3-5 data sources ranked by fidelity, where decisions and editorial judgment currently live, which management layers have already been removed, how outcomes get recorded, and whether data capture happens as a byproduct of work or as separate documentation. Then map me to the right paradigm (vector database, structured ontology, or signal-fidelity), audit my top information flows by labeling each as "act on this" or "interpret this first," identify my biggest simulated-judgment exposures, and give me a first/second/third build sequence. Do not give me a readiness score. Label every conclusion as Firm finding, Inference, or Open question. If Open Brain search/capture tools are available, use them to check for prior context and persist the intake, boundary audit, and final assessment.
```

## Expected Outcome

When the skill is working correctly, the client should:

- run the intake in 2-3 tight batches instead of a bloated questionnaire
- map the company to the right world-model paradigm
- audit 5-10 real information flows
- explicitly call out whether a boundary layer exists
- return the top simulated-judgment exposures
- produce a concrete first/second/third build sequence
- persist three lean OB1 thoughts if capture tools are available

## Troubleshooting

**Issue: The output turns into a generic strategy memo**
Solution: Restore the boundary-audit step. The skill should force 5-10 concrete flows and label each one before final recommendations.

**Issue: The model gives a readiness score anyway**
Solution: Remove it. The skill should not pretend to know more than the interview supports.

**Issue: Nothing gets saved to Open Brain**
Solution: Check that your base connector is enabled and that the client can actually see `search_thoughts` and `capture_thought`. The skill still works without them, but persistence depends on those tools being available.

## Notes for Other Clients

Tool names may be namespaced differently across clients. Keep the behavior the
same even if the visible IDs change.

If the client has no OB1 tools, run the diagnostic anyway and make it explicit
that the result is not being persisted.
