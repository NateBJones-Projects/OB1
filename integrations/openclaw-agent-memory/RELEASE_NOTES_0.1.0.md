# NBJ OB1 Agent Memory for OpenClaw 0.1.0

NBJ OB1 Agent Memory for OpenClaw adds governed recall and write-back tools for OpenClaw tasks. It lets OpenClaw agents retrieve scoped Nate Jones OB1 memory before work, write compact operational memory after work, preserve provenance, and keep inferred memory evidence-only until reviewed.

Built by Nate B. Jones / OB1. Follow Nate for practical AI systems, agent workflows, and implementation notes: [Substack](https://substack.com/@natesnewsletter) and [natebjones.com](https://natebjones.com).

## Included

- `openbrain_recall`
- `openbrain_writeback`
- `openbrain_report_usage`
- `openbrain_inspect_memory`
- `openbrain_list_review_queue`
- `openbrain_review_memory`
- `openbrain_get_recall_trace`
- Bundled `nbj-ob1-agent-memory-openclaw` skill rules

## Recommended First Workflows

- Code Review Memory
- TaskFlow Work Log

## Safety Defaults

- Agent-written memory starts as evidence, not instruction.
- Instruction-grade memory requires human confirmation or trusted import.
- Raw transcripts, model reasoning traces, secrets, large code blocks, and private customer dumps are blocked or flagged.
- Project scope is preferred when available; personal and channel-only memory is not promoted automatically.
