# Tools, Execution, And Permissions

## Table Of Contents

- What this file is for
- Capability registry
- Execution boundaries
- Tool pool assembly
- Permission tiers
- Approval gates
- Safety rules
- How to evaluate this layer

## What This File Is For

Read this when the harness must call tools, run code, touch files, invoke APIs, or perform actions with different risk levels.

## Capability Registry

Define capabilities as metadata first.

Each capability should have at least:

- name
- responsibility
- input shape
- side-effect profile
- required permission level
- execution owner

The registry should answer “what exists?” without executing anything.

Useful split patterns:

- user-facing actions versus model-facing tools
- read versus write capabilities
- local versus remote capabilities
- stable core tools versus optional extensions

## Execution Boundaries

Separate definition from execution.

The harness should know:

- what a tool is called
- when it is appropriate
- what risk it carries
- how it is executed

Do not collapse all of that into one blob of prompt text.

## Tool Pool Assembly

Load only the tools relevant to the current context.

Filter by:

- task type
- product surface
- current workflow step
- user role or trust level
- environment

Fewer tools usually means:

- better model decisions
- lower token cost
- smaller attack surface

## Permission Tiers

Use explicit trust tiers. A simple pattern:

- always allow: safe reads and inert helpers
- ask first: writes, shell execution, external side effects
- never allow by default: destructive or high-risk actions

Define policy outside the prompt so it can be inspected, tested, and changed safely.

## Approval Gates

Introduce approval at the boundary where side effects become real.

Approval triggers often include:

- file edits
- external API writes
- payments or billing events
- email or message sending
- deletes
- production actions

The system should log:

- what was requested
- why approval was needed
- what the operator approved or denied

## Safety Rules

Treat safety as system design, not as one paragraph in the prompt.

Useful rules:

- deny by category where possible, not just by name
- require structured tool inputs
- validate arguments before execution
- keep audit logs separate from chat history
- prefer dry-run previews for risky actions
- constrain file, network, or environment access when possible

## How To Evaluate This Layer

Test with concrete scenarios:

- safe read should run without friction
- risky write should request approval
- denied capability should never execute
- malformed tool input should fail safely
- irrelevant tools should stay out of the active tool pool
- audit trail should explain what happened without replaying the whole chat

If permissions only exist as “the model probably knows better,” this layer is incomplete.
