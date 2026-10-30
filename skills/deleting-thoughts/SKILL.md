---
name: deleting-thoughts
description: |
  Use when asked to delete, remove, purge, wipe, or "get rid of" an Open Brain
  thought, or before calling delete_thought (the open-brain-delete-thought
  connector), which HARD-deletes with no undo. Also use when tempted to delete a
  thought that is merely outdated or wrong. To edit or deprecate instead of
  removing, see updating-thoughts.
author: Ezana Azene
version: 1.0.0
---

# Deleting Thoughts

## Overview

`delete_thought` (the `open-brain-delete-thought` connector) performs a **hard
delete** — the row is gone the moment it returns, with no tombstone, no
soft-delete, and no restore. Recovery depends entirely on database backups. The
Open Brain maintainer's stance is **"deprecate and version rather than
delete."** So deletion is a last resort, and every delete must target an id you
verified this session.

**Violating the letter of these rules is violating their spirit.**

## When to Use

Delete only when **both** hold:
- The thought is genuinely disposable — a test/throwaway, an exact duplicate, or
  an accidental capture, **and**
- Editing or tagging it is not good enough.

If the thought is merely outdated, wrong, or superseded, **update it or tag it**
`superseded` instead — see the **updating-thoughts** skill.

## Process

1. **Resolve the id via `search_thoughts` / `list_thoughts`.** `delete_thought`
   takes a UUID; never delete an id you typed from memory.
2. **Show the target and confirm.** Surface the thought's content to the user
   and get explicit confirmation that this specific thought should be removed.
   - **Check for derivatives first.** Before deleting, run `find_derivatives`
     (and/or `related_thoughts`) on the thought. If other thoughts were derived
     from it, deleting orphans their provenance chain — those derivatives lose
     the source they point back to. Prefer deprecating over deleting in that
     case. Tool names may carry a connector prefix; use whatever the environment
     exposes.
3. **Delete only after confirmation.** Call `delete_thought(id)`. It pre-checks
   existence (a clean "not found" if already gone) and returns the prior content
   length as a receipt. Report that receipt to the user.

## This Is Irreversible — No Exceptions

- No undo, no trash, no restore. Backups only.
- Don't batch-delete "to clean up" without confirming **each** id.
- Don't delete when the user said "update", "fix", "archive", or "deprecate" —
  those are updates, not deletes.
- Don't guess a UUID; a wrong guess deletes the wrong memory permanently.

## Red Flags — STOP

- About to call `delete_thought` on an id you did **not** get from a search this
  session.
- Deleting more than one thought from a single vague instruction.
- The user's word was "clean up / tidy / archive / outdated" — not an explicit
  "delete".
- You have not shown the actual content to the user and gotten confirmation.

**All of these mean: pause, search, show the thought, and confirm first.**

## Rationalizations — and Reality

| Excuse | Reality |
|--------|---------|
| "It's obviously junk." | Show it and confirm anyway — "obvious" is exactly where wrong deletes happen. |
| "Faster to delete than to tag." | Speed never justifies an irreversible loss. Tag or deprecate instead. |
| "The user probably meant this one." | Probably ≠ confirmed. Resolve the id and show it. |
| "I'll just re-capture if it was wrong." | Re-capture loses the original metadata, embedding history, and provenance links. |

## Output

A receipt naming the deleted id and its prior content length. Always report it
so there is a record of what was removed.

## Notes

- Connector: `open-brain-delete-thought`, auth via `?key=` or the `x-brain-key`
  header — the same `MCP_ACCESS_KEY` as your core Open Brain connector.
- For recoverable deletes, install the `schemas/thought-audit` table and write
  an audit row before deleting (see the `integrations/delete-thought-mcp`
  README's extension hook).
