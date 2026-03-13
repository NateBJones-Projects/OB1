# Build Your Open Brain with an AI Coding Tool

## The Short Version

Point your AI coding tool at this repo and tell it to walk you through the [setup guide](01-getting-started.md). That's it. The guide has every SQL block, every Edge Function, every config step — your AI reads it and helps you execute each one.

This works in Cursor, Claude Code, Codex, Windsurf, OpenClaw, or any AI coding tool that can read files. You don't need to copy-paste from a browser or follow along manually. Let your AI be your pair programmer through the whole build.

## How to Start

1. Clone or open this repo in your AI coding tool
2. Tell it: **"Read `docs/01-getting-started.md` and walk me through building my Open Brain step by step."**
3. Follow along. It'll handle the code parts. You handle the clicking (Supabase dashboard, Slack app settings, OpenRouter signup).

That's the whole workflow. The sections below cover what to watch out for.

## What Your AI Handles Well

- **SQL setup** — Creating tables, functions, indexes, and security policies. Your AI can paste these directly into the Supabase SQL Editor or walk you through it.
- **Edge Function code** — The `ingest-thought` and `open-brain-mcp` functions are fully written in the guide. Your AI reads them and helps you deploy them.
- **CLI commands** — Installing the Supabase CLI, linking your project, deploying functions, setting secrets. Your AI can run these directly if your tool supports terminal access.
- **Debugging** — When something doesn't work, your AI can read Edge Function logs and help diagnose the issue. This is where the AI-assisted path genuinely shines over going solo.

## What You Should Do Manually

Some steps involve clicking through web UIs where your AI can't help directly. These are fast but you need to do them yourself:

- **Creating accounts** — Supabase, OpenRouter, Slack. Sign up in your browser.
- **Supabase dashboard settings** — Enabling the vector extension, copying your Project URL and Secret key, checking Table Editor.
- **Slack app configuration** — Creating the app, setting OAuth scopes, installing to workspace, enabling Event Subscriptions.
- **Connecting AI clients** — Adding the MCP connector in Claude Desktop, ChatGPT, or other clients (Settings menus in each app).

Your AI can tell you exactly what to click and where — it just can't click for you.

## Common Gotchas

### Don't let your AI improvise when it can't read the source

If your AI can't access a file or section, it will make something up rather than tell you it's stuck. This happened during early builds when the guide lived on Substack — collapsed code sections weren't visible to the AI, so it invented its own version of the Edge Function code. The invented version was plausible but wrong.

Now that the full guide lives in this repo, this shouldn't happen — your AI can read everything. But the principle still applies: if your AI is generating setup code from scratch instead of referencing `docs/01-getting-started.md`, stop it and point it back to the file.

### Configuration problems need configuration fixes

When something breaks, your AI's instinct is to rewrite code. Resist this. The Edge Function code in the guide works. Problems are almost always configuration:

- A secret that doesn't match (`supabase secrets list` to check)
- A URL that's missing the access key
- A Slack event subscription that's missing `message.groups`
- A step that got skipped

Check Edge Function logs first (Supabase dashboard → Edge Functions → your function → Logs). Paste the error to your AI and let it diagnose — but don't let it start rewriting the server code unless the logs point to an actual code problem.

### Keep your credential tracker open

The [setup guide](01-getting-started.md) has a credential tracker template near the top. Copy it into a text file before you start. Your AI can remind you to fill it in as you go, but you need to actually save the values somewhere it can reference later. If you skip this, you'll hit Step 7 and realize you don't have your Channel ID from Step 5.

## Tips

- **Go step by step.** Don't ask your AI to "set up the whole thing." Walk through Part 1 (Capture), test it, then do Part 2 (Retrieval). The guide is structured this way for a reason.
- **Test at Step 9.** The guide has a specific test message and expected response. Do it. If capture works, you know your database, Edge Function, and Slack connection are all solid before you move on to MCP.
- **Use Supabase's built-in AI too.** The Supabase dashboard has its own AI assistant (chat icon, bottom-right). It knows Supabase's docs inside out and can help with anything database-specific. Your coding AI handles the big picture; the Supabase AI handles the Supabase details.
- **Read the [FAQ](03-faq.md) when stuck.** It covers the most common issues people hit, including the exact auth error pattern that trips up Claude Desktop and ChatGPT connections.

## After Setup

Once your Open Brain is running, check out the [Extensions learning path](../README.md#extensions--the-learning-path). Same approach works — point your AI at an extension's README and build together.

---

*This guide exists because Matt Hallett built his first Open Brain entirely through Cursor with Claude, and it worked. If you build yours with an AI coding tool, [share how it went](https://discord.gg/Cgh9WJEkeG) in the Discord `#show-and-tell` channel.*
