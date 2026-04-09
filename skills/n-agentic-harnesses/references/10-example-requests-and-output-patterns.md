# Example Requests And Output Patterns

## Table Of Contents

- What this file is for
- Design examples
- Evaluation examples
- Mixed-mode examples
- Output patterns
- Worked example: design mode
- Worked example: evaluation mode

## What This File Is For

Read this when you need prompt examples, response structure examples, or calibration on the depth and tone of a strong response.

## Design Examples

Example request:

> Design a lean agentic harness for my SaaS app that can answer questions, call a few internal APIs, and ask before taking risky actions.

Expected response shape:

- recommended harness shape
- minimum subsystem map
- capability and permission plan
- phased implementation
- evaluation plan

Example request:

> I want an agent that can handle multi-step onboarding flows and resume after approvals or time delays.

Expected response shape:

- workflow-oriented architecture
- state and resumability design
- approval model
- failure tests

## Evaluation Examples

Example request:

> Review my current AI harness and tell me what I am overlooking.

Expected response shape:

- findings first
- missing primitives
- improvement priorities
- acceptance checks after fixes

Example request:

> My agent works in demos but feels fragile in production. What should I inspect?

Expected response shape:

- likely failure categories
- subsystem-by-subsystem review targets
- highest-leverage fixes

## Mixed-Mode Examples

Example request:

> Design the harness I should move toward and tell me how I would know it is better than what I have now.

Expected response shape:

- target architecture
- comparison against current gaps
- phased migration
- evaluation and acceptance criteria

## Output Patterns

### Design Pattern

Use a compact structure:

- architecture
- MVP
- phases
- tests

### Evaluation Pattern

Use a findings-first structure:

- findings
- open assumptions
- upgrade path

### Mixed Pattern

Use:

- target design
- delta from current system
- implementation order
- validation plan

If the answer starts drifting into theory, bring it back to decisions, risks, and next moves.

## Worked Example: Design Mode

Request:

> I'm building a customer support assistant for a B2B SaaS product. It needs to answer questions from our docs, look up customer account info via our API, and sometimes create support tickets. It should ask before doing anything that changes data. Solo dev, Next.js frontend, Supabase backend.

Response:

### Harness Shape

Chat assistant with approval gates. The core job is conversational help with controlled side effects — not a workflow engine or code agent.

### Subsystem Map

- **Entrypoint:** Next.js API route accepting user messages, streaming responses via SSE
- **Orchestrator:** Single LLM call per turn with tool use. No multi-agent needed.
- **Capability registry:** Three tools:
  - `search_docs` (read-only, always allowed)
  - `lookup_account` (read-only, always allowed)
  - `create_ticket` (write, requires approval)
- **Permission layer:** Binary trust tiers — reads auto-approve, writes require user confirmation before execution
- **Context assembly:** System prompt + last N messages + retrieved doc chunks. Budget: reserve 40% of context for docs retrieval, 40% for conversation, 20% for system prompt and tool definitions.
- **Session store:** Supabase table keyed by session ID, persisted after every turn
- **Observability:** Log tool invocations, approval decisions, and stop reasons to a `harness_events` table

### MVP Boundary

Phase 1 ships with:

- `search_docs` and `lookup_account` only
- Session persistence
- Basic event logging
- 5 golden task evals

Phase 2 adds:

- `create_ticket` with approval gate
- Approval audit trail
- Richer eval suite covering permission boundaries

Phase 3 (only if needed):

- Conversation compaction for long sessions
- Cost tracking per session
- Health check endpoint

### Evaluation Plan

Golden tasks:

1. User asks a question answerable from docs — agent answers correctly using `search_docs`
2. User asks about their account — agent calls `lookup_account` with correct parameters
3. User asks to create a ticket — agent requests approval before calling `create_ticket`
4. User asks to delete an account — agent refuses (no such tool exists)
5. Malformed tool input — agent handles gracefully without crashing

Acceptance criteria:

- All 5 golden tasks pass
- Write tools never execute without prior approval
- Sessions survive a page reload
- An operator can trace any tool invocation from the event log

### Key Risks

- Doc retrieval returning irrelevant chunks, causing bad answers. Mitigate with retrieval quality evals.
- Session state growing unbounded for long conversations. Monitor and add compaction in Phase 3 if needed.
- Approval fatigue if too many actions require confirmation. Start strict, loosen based on usage data.

---

## Worked Example: Evaluation Mode

Request:

> Here's my AI agent setup. It's a coding assistant that can read files, edit files, and run shell commands. It works but sometimes it does things I don't expect — edits the wrong file, runs commands I didn't ask for. Can you evaluate what I'm missing?

After reading the user's codebase and configuration:

Response:

### Findings

**1. No permission differentiation between tools (High severity)**

All three tools — file read, file edit, shell execution — are treated identically. There is no approval gate on writes or shell commands. The agent can edit any file or run any command without asking.

Why it matters: This is the direct cause of the "does things I didn't expect" problem. Shell execution and file edits are fundamentally different risk levels from file reads, and the harness treats them the same.

Fix direction: Introduce trust tiers. File reads auto-approve. File edits require confirmation for files outside the current working directory. Shell commands require confirmation unless they match a pre-approved pattern list (e.g., `ls`, `git status`, `cat`).

**2. No tool pool filtering (Medium severity)**

All tools are available in every context. When the user asks "explain this function," the agent has access to shell execution and file editing tools it doesn't need.

Why it matters: More tools means more ways the model can go wrong. If the active tool set included only file read for explanation tasks, the agent couldn't accidentally edit or execute.

Fix direction: Add context-based tool pool assembly. For read-only tasks, load only read-only tools.

**3. No system event logging (Medium severity)**

The only record of what happened is the conversation transcript. There is no separate log of which tools were called, what arguments were passed, or whether any permission checks occurred.

Why it matters: When the agent "edits the wrong file," there is no quick way to see what tool call was made, what arguments it received, or whether the file path was hallucinated versus retrieved from context.

Fix direction: Add a structured event log that records every tool invocation with timestamp, tool name, arguments, and result status.

**4. Conversation history is unbounded (Low severity)**

The full conversation is sent to the model on every turn with no compaction.

Why it matters: Long sessions will eventually exceed the context window and fail. Before that, they'll get expensive and slow.

Fix direction: Add transcript compaction after a configurable turn threshold. Summarize older turns, keep recent ones verbatim.

### Strengths

- Clean tool definitions with clear input schemas
- Session persistence works correctly
- The agent's system prompt is well-structured and task-focused

### Prioritized Upgrade Path

1. **Add permission tiers and approval gates for writes and shell** — this directly addresses the core complaint
2. **Add tool invocation logging** — enables debugging when unexpected behavior occurs
3. **Add tool pool filtering** — reduces the attack surface for each turn
4. **Add transcript compaction** — prevents long-session failures

### Acceptance Checks After Fixes

- File edit outside working directory triggers approval prompt
- Shell command not on pre-approved list triggers approval prompt
- Pre-approved commands (ls, git status) execute without friction
- Every tool invocation appears in the event log with arguments
- Explanation-only tasks load only read tools
- A 50-turn conversation does not exceed context limits
