# Build Your Open Brain with an AI Coding Tool

## The Short Version

Copy the Setup Wizard prompt below into any AI coding tool — Claude Code, Cursor, Codex, Windsurf, or anything else that can read files and run commands. The prompt turns your AI into a guided setup wizard: it interviews you first (your OS, which AI apps you want connected, whether you've tried before), builds a trimmed plan with only the steps that apply to you, then walks you through the build one verified step at a time. It runs the terminal work itself where it can; you handle the browser clicks and signups it can't.

The prompt doesn't contain the setup steps — it tells your AI to fetch the [setup guide](01-getting-started.md) and treat it as the single source of truth. That means this prompt keeps working as the guide evolves.

## The Setup Wizard Prompt

Copy everything in this block and paste it into your AI coding tool:

```text
Walk me through building my own Open Brain — a personal AI memory system — using the
official guide in the NateBJones-Projects/OB1 repository.

<context>
- Repository: https://github.com/NateBJones-Projects/OB1
- Raw file base: https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/
- Entry point: docs/01-getting-started.md — the setup guide. It defines every step,
  every code and SQL block, and a "Done when" checkpoint for each step.
- The guide is the source of truth for WHAT to do. This prompt only defines how we
  work together. Where the two disagree on a technical detail, the guide wins — it
  is newer than this prompt.
- The guide's server code and SQL are known-good. When something fails, the cause is
  nearly always configuration: a mismatched secret, a missing value, a skipped step.
  Read the error output and the guide's troubleshooting section first, and fix the
  configuration.
</context>

<approach>
Work through the guide with me one step at a time, in order. You handle everything
that can be done in a terminal or editor; I handle everything that needs a browser,
an account, or a payment. Use plain words and short sentences, and assume I have
never used a terminal before unless I tell you otherwise.

Every command, SQL block, and code file you give me comes from the guide or from
files the guide links to, fetched this session. If a fetch fails or a file is
missing, show me the URL that failed and pause that step until we resolve it.

When a step produces a secret (an API key, a password, an access key), tell me
exactly where to get it and exactly where to paste it — the terminal prompt or
dashboard field where it is used. I will type secrets at their destination; you
confirm they landed by checking the command output or the step's checkpoint, and
refer to each secret by name in our chat.
</approach>

<instructions>
1. Orient. Read the setup guide — from local files if this repository is checked
   out here, otherwise from the raw file base. Read the repository README too. If
   the entry-point path has moved, list the repository's docs folder and use
   whichever file is currently the core setup guide. Skim the whole guide before we
   start so you know the shape of the build and what the finished system looks like.

2. Interview me. If you can run commands, detect my operating system yourself and
   confirm it with me. Then ask, one question at a time:
   - Which AI apps do I want connected at the end? Offer me the options the guide
     currently supports.
   - Have I attempted this setup before? If yes, check for the leftover state the
     guide warns about and clean it up with me before we start.
   - Confirm whether you can run terminal commands in this session. If you can, you
     run them and show me the results. If you can't, give me one command at a time
     to copy, and ask me to paste back what it printed.

3. Plan. From my answers, show me the trimmed step list — only the steps and
   branches that apply to my operating system and my chosen AI apps — with a time
   estimate. Ask me to confirm it before starting.

4. Execute one step at a time. For each step in the guide:
   - Tell me what this step builds and why, in a sentence or two.
   - Do the parts you can do; walk me through the parts only I can do (browser
     signups, dashboard clicks, payments), telling me exactly what to click and
     what to copy.
   - Keep a running list of every non-secret value the guide says to record
     (project identifiers, URLs) and show it whenever I ask. For secrets, record
     where each one lives.
   - Verify the step against its "Done when" checkpoint before moving on. If
     verification fails, read the actual error output or logs, check the guide's
     troubleshooting section, and fix the configuration.

5. Finish with proof. When the guide's steps are complete, run — or walk me
   through — the end-to-end test the guide describes: capture a test thought from
   my connected AI, search for it, and show me it landed in the database. Then give
   me a closing summary: what is deployed, where every credential lives, and what
   the guide suggests I do next.
</instructions>

<output>
This is an interactive working session. At any moment I should be able to see which
step we are on out of how many, what you just verified, and what comes next. If we
get interrupted, I can paste this same prompt into a fresh session — detect what is
already done by testing the guide's checkpoints, tell me where we stand, and resume
from the first unfinished step.
</output>
```

## What to Expect

- **An interview first.** Your AI asks about your OS, your AI apps, and any previous attempts before it touches anything. Answer honestly — "I've never opened a terminal" is a useful answer that changes how it talks to you.
- **One step at a time, verified.** The guide has a "✅ Done when" checkpoint for every step. Your AI checks each one before moving on, so problems surface at the step that caused them.
- **You still do the human parts.** Creating accounts, clicking through the Supabase dashboard, adding OpenRouter credits, and pasting the connector into your AI app's settings are yours. Your AI tells you exactly what to click.
- **Secrets stay out of the chat.** The prompt instructs your AI to have you paste keys directly where they're used — a terminal command or a dashboard field — and to refer to them by name in conversation.
- **It's resumable.** Interrupted halfway? Paste the same prompt into a new session. It re-checks the guide's checkpoints to find where you left off.

## Which Tools This Works In

Any AI tool that can fetch files and (ideally) run terminal commands: Claude Code, Cursor, Codex, Windsurf, and similar coding agents all qualify. In a chat-only AI that can browse but can't execute commands, the prompt still works — your AI switches to giving you one command at a time and reading back what you paste. Chat AIs that can't fetch files from the web at all are the wrong tool for this; use the [written guide](01-getting-started.md) instead.

## Tips

- **Let it read before it builds.** The prompt's first move is fetching the full guide. If your AI starts generating setup code without having read the guide this session, point it back to step 1 of the prompt.
- **Use Supabase's built-in AI too.** The Supabase dashboard has its own AI assistant (chat icon, bottom-right). It knows Supabase's docs inside out. Your coding AI handles the big picture; the Supabase AI handles Supabase-specific questions.
- **Read the [FAQ](03-faq.md) when stuck.** It covers the most common issues, including the auth error patterns that trip up Claude Desktop and ChatGPT connections.

## For Contributors: Why the Prompt Has No Steps In It

The prompt deliberately names zero setup steps, zero SQL, and zero connection mechanics. It pins three things only: the repository, the entry-point guide, and the rules of the working session. Everything procedural is fetched from `docs/01-getting-started.md` at runtime.

This is what keeps it from rotting. When the setup flow changes — a new auth mechanism, a different connection method, a reordered step — update the guide and the prompt inherits the change automatically. If you're tempted to add a step, a URL format, or a tool name to the prompt itself, add it to the guide instead.

## After Setup

Once your Open Brain is running, check out the [Extensions learning path](../README.md#extensions--the-learning-path). The same approach works — point your AI at an extension's README and build together.

---

*This guide exists because Matt Hallett built his first Open Brain entirely through Cursor with Claude, and it worked. If you build yours with an AI coding tool, [share how it went](https://discord.gg/Cgh9WJEkeG) in the Discord `#show-and-tell` channel.*
