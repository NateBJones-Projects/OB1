# Open Brain FAQ

## Setup and Connection Issues

### "Claude Desktop / ChatGPT gives me an auth error but Claude Code works fine"

This is the single most common issue. The tell is right in the pattern: Claude Code can send custom headers, but Claude Desktop, Claude Web, and ChatGPT can't.

The fix: use the MCP Connection URL with the key embedded as a query parameter (`?key=your-access-key`), not as a custom header. Your URL should look like:

```text
https://your-project-ref.supabase.co/functions/v1/open-brain-mcp?key=your-access-key
```

When adding the connector in Claude Desktop (Settings → Connectors) or ChatGPT (Settings → Apps & Connectors), paste that full URL. Set authentication to "none" — the key is already in the URL.

### "ChatGPT disabled my memory when I added the Open Brain"

This is an OpenAI requirement, not a bug. Enabling Developer Mode (required to add custom MCP connectors) disables ChatGPT's built-in Memory feature. Your Open Brain replaces that functionality — and unlike ChatGPT's memory, it works across every AI client you connect, not just one.

### "How do I migrate my ChatGPT memories/conversations into the Open Brain?"

The Memory Migration prompt in the [companion prompts](02-companion-prompts.md) handles pulling out what your current AI already knows about you. But if you want your full ChatGPT conversation history, you'll need the data export: Settings → Data controls → Export data. You'll get JSON files of every conversation you've had.

From there, use Claude (or whatever AI you prefer) to process those exports — pull out the key insights, decisions, and context that matter, and push them into your Open Brain through the capture tool. It's a one-time migration cost but you end up with everything in a system that works across all your tools instead of being locked inside one.

Fair warning: if you've been a heavy ChatGPT user, the export is A LOT of data. Processing it is a real project, not a quick task. It's worth doing, but set expectations accordingly.

### "ChatGPT doesn't use the Open Brain tools automatically"

ChatGPT is less intuitive than Claude at picking the right MCP tool on its own. Be explicit the first few times: "Use the Open Brain search_thoughts tool to find my notes about [topic]." After it gets the pattern once or twice in a conversation, it usually starts picking them up automatically.

### "ChatGPT says the Open Brain tool is not available"

First check Supabase dashboard → Edge Functions → `open-brain-mcp` → Logs. If you see **zero requests** while ChatGPT is failing, stop debugging keys, URLs, and Edge Function code. ChatGPT never called your server; the problem is the tools exposed to that chat session.

As of May 2026, OpenAI's ChatGPT developer-mode docs are in beta and the plan/model behavior is not perfectly stable. The important implementation detail: ChatGPT treats MCP tools without `readOnlyHint` as write actions. Open Brain now marks `search_thoughts`, `list_thoughts`, `thought_stats`, `search`, and `fetch` as read-only. It marks `capture_thought` as a bounded, non-destructive write action.

After updating your deployed MCP server, redeploy it, then refresh or recreate the ChatGPT app so ChatGPT pulls the new tool metadata. Expected behavior:

- Full MCP-capable chats should expose the four core tools, plus ChatGPT compatibility aliases (`search` and `fetch`).
- Restricted Pro/read-only sessions may expose only read tools and hide or block `capture_thought`.
- If a Pro chat exposes none of the tools, switch that chat to a thinking model, start a fresh chat, and make sure the Open Brain app is selected in Developer Mode.

### "I'm stuck and Claude is rewriting my edge function code to fix the connection"

Pause. The problems are almost never in the code. They're in the configuration: a secret that doesn't match, a URL that's missing the key, a step that got skipped. Letting an AI rewrite working code when the issue is a mismatched environment variable will make things harder to debug, not easier.

Check your Supabase dashboard → Edge Functions → open-brain-mcp → Logs first. That'll tell you what's actually happening.

### "Search isn't working but I can capture recent thoughts"

Good news — that means your database, edge functions, and MCP connection are all fine. The issue is isolated to the search function.

Most likely culprits: the vector extension isn't enabled (run `create extension if not exists vector;` in the SQL editor), the embedding generation is failing silently, or the search function deployed with an error.

Quickest diagnosis: Supabase dashboard → Edge Functions → click on the search function → check the Logs tab.

And don't forget the Supabase AI assistant covered in the [setup guide](01-getting-started.md). Paste your edge function code and the error logs right into it — it's surprisingly good at diagnosing Supabase-specific issues since it has direct context on their APIs.

---

## Importing Data

### "Can I import my Gmail into the Open Brain?"

Yes. The [Email History Import](../recipes/email-history-import/) recipe connects to Gmail via OAuth, pulls emails by label and time window, strips noise (signatures, quoted replies, auto-generated messages), and loads each email as a thought with sender, subject, and date metadata. Takes about 30 minutes to set up. You need a Google Cloud project with Gmail API enabled.

### "How do I import my ChatGPT conversations?"

Export your data from ChatGPT (Settings → Data controls → Export data), then use the [ChatGPT Conversation Import](../recipes/chatgpt-conversation-import/) recipe. It processes the JSON export, extracts the meaningful exchanges, and loads them as thoughts. Unlike the manual approach described in the FAQ above, this handles the full export automatically.

### "What other data sources can I import?"

Check [`/recipes`](../recipes/) for the current list. The community is actively building importers for Google Activity (Takeout), Twitter/X archives, Claude conversations, Gemini, and more. Each recipe is a standalone build — pick the ones that match your data.

---

## "How does this work with Obsidian?"

Short answer: it doesn't, and it's not supposed to.

Obsidian is a note-taking app. The Open Brain is a database with vector search. They're not in the same category. You don't need a middleman between your AI and your data — that's the whole point. Your AI talks directly to the database where your thoughts live.

If you have an existing Obsidian vault you want to bring over, the Second Brain Migration prompt in the [companion prompts](02-companion-prompts.md) is built for exactly that. It moves your content INTO the Open Brain. But Obsidian doesn't sit alongside it or on top of it.

### "But I want to edit and organize my content like I did in Obsidian"

In Obsidian, your notes are documents. You write them, organize them, revise them, link them together. You're the librarian and the author.

The Open Brain isn't that. It's a memory layer for your AI. You put thoughts in, your AI pulls the right ones out when they're relevant. You don't need to organize them, file them, or maintain them — the vector search handles retrieval by meaning.

If you need to fix a typo or delete something, Supabase's Table Editor works (dashboard → Table Editor → thoughts). But if you're finding yourself wanting to regularly browse and edit your content, that's Obsidian's workflow, not this one. They solve different problems.

That said — the system is yours to extend. The MCP server currently has a capture tool for writing new thoughts. If you want your AI to be able to revise what's stored, that's one more tool added to the server. You can describe what you want to the Supabase AI assistant and it can help you build it. You built the system, you can extend it.

### "I want the visual editing experience — headings, bullets, drag stuff around, everything visible at once"

That's a fair ask, and you're right — that doesn't exist in the Open Brain right now. The Table Editor in Supabase is functional but it's a database view, not a writing environment.

Here's how to think about it: the Open Brain is the backend. It's where the data lives, where the vectors live, where your AI connects. Obsidian is a frontend. There's nothing stopping you from having both — use the Open Brain as your storage and retrieval layer, and build (or eventually connect) a nicer interface on top of it.

That could be as simple as a lightweight web app that reads from your Supabase tables and lets you browse, edit, and organize visually. It's a real project — not a copy-paste afternoon — but it's totally within reach, especially if you use an AI to help you build it. The database and API are already there. You'd just be putting a face on it.

For now, if that visual editing experience is how you think and work best, keep using Obsidian (or Workflowy) for that. Use the Open Brain for what it's good at: giving your AI access to everything you've captured. They can coexist — just don't expect one to be the other.

---

## Storage, Retrieval, and Architecture

### "How do I store long-form content in the Open Brain?"

Two separate questions that keep getting mixed together.

Can Postgres store long content? Yeah. It's a database. A 4,000 word article is just a text column. No issues there.

The real question is about retrieval. When you embed a short thought — "Sarah wants to start consulting" — the vector representation is tight. It means one thing. Search finds it reliably. When you embed a 4,000 word article as a single vector, you're compressing dozens of ideas into one point in vector space. Search quality drops because the embedding is trying to represent too much at once.

The fix is chunking. Break long content into sections, embed each chunk separately, keep metadata tying them back to the parent document. The Open Brain is using pgvector, which means your vectors live in Postgres alongside regular relational data. You can create a parent document table, a chunks table with the embeddings, and now you've got hybrid querying natively. Filter on structured metadata first (content type, date, tags, source) using normal Postgres indexes, then do vector similarity search within that filtered set. Two query strategies in one operation.

You don't need a different tool. It's the same pgvector setup, same database. You're just being smarter about what unit of text you embed and using the relational side of Postgres to maintain the relationships.

### "How do you prevent memory from getting noisy and poisoning context?"

"Store more and more" isn't the right framing for what the Open Brain does. It's a capture tool. What goes in is up to you.

The real answer is less about forgetting and more about siloing. Different contexts need different memory. Your coding thoughts shouldn't be polluting your creative writing context. Your work stuff shouldn't be bleeding into personal projects. The retrieval layer — what gets pulled and when — matters way more than the storage layer.

ChatGPT's built-in memory has this exact problem: it's one flat pool with no separation. Everything influences everything. That's not a memory problem, that's an architecture problem.

### "I want to store everything — Obsidian vault, health data, GTD, email, calendar. What's the right strategy?"

The core question with any vector-based system is: what's the right unit of embedding? Every row gets turned into a single vector, and that vector needs to represent one retrievable idea. Too granular and you get noise. Too broad and the vector tries to represent too many concepts at once and search gets fuzzy.

For text-based stuff, one idea per entry is the right instinct. Zettelkasten-style atomic notes are a near-perfect fit for vector search — each one represents a single concept, the embedding is tight, retrieval is precise. Longer documents should be chunked into meaningful sections.

For structured data like health/sleep stats — one entry per night, not one per month. A month of sleep data in one entry means asking "how did I sleep last Tuesday" forces retrieval of an entire month. One entry per night gives clean retrieval.

Same principle everywhere: calendar events — one per event. Emails — one per email or per thread. Tasks — one per task.

Don't worry about row count. Postgres handles millions of rows, pgvector's HNSW index keeps search fast regardless of scale, and at $0.02 per million tokens the embedding costs are basically free even at scale.

The key thing to get right is metadata. Every source type should tag itself (`source: "garmin"`, `source: "obsidian"`, `source: "calendar"`) so you can filter retrieval by context. "What's in my calendar this week" shouldn't have to wade through your sleep data.

### "Search seems sub-par — I have to coax Claude to find things"

Here's how to diagnose it yourself:

First, check your row count. Supabase dashboard → Table Editor → thoughts. If you're under 20-30 entries, the system just doesn't have enough data points for semantic search to work well. It's not broken, it's sparse. The more you put in, the better retrieval gets.

Second, test search directly. Ask your AI to search for something you KNOW is in there — use words that are close to what you actually typed when you captured it. If that works but vaguer queries don't, the system is fine, it just needs more content for the semantic matching to have enough to work with.

Third, check your edge function logs. Supabase dashboard → Edge Functions → open-brain-mcp → Logs. If search is erroring out silently, you'll see it there.

Fourth, if search finds a thought when listing recent entries but NOT through semantic search, that's a useful clue. It means the data is there and retrievable, but the embedding or similarity matching isn't connecting your query to that entry. This usually improves as you add more content — semantic search gets sharper with more data points to compare against.

And remember — the Supabase AI assistant in your dashboard can help you debug this stuff. Paste in what you're seeing and it'll walk you through it.

---

## Perspective and Philosophy

### "What did I actually accomplish by setting this up?"

Think about what you just did. You stood up a PostgreSQL database in the cloud. You wrote database migrations. You deployed serverless edge functions. You configured API secrets and environment variables. You didn't just connect to an MCP server — you built one from scratch and deployed it to production.

A few years ago that's a junior backend engineer's first month. If you did it in a few hours with zero prior experience, the guide helped — but the guide doesn't click the buttons for you. That was you.

### "I already customized it based on my own workflow needs"

That's the whole point of the Open Brain. It's a foundation, not a finished product. The fact that you're looking at your own needs and extending the primitive means you get it.

### "The agent's experience of pulling from the Open Brain felt like 'remembering' vs 'reading someone else's notes'"

This is a precise description of what vector retrieval does differently from file reads. When an agent reads a file, it's processing someone else's organized structure. When it pulls from vector search, the retrieval is associative — finding what's relevant to the current context by meaning, not by where it was filed. That IS closer to how recall works.

---

## API Key Rotation

### "I rotated my OpenRouter API key and now nothing works"

When you generate a new key on openrouter.ai/keys, the old key is revoked immediately. But your Open Brain uses that key in multiple places — and updating it in one spot doesn't update the others. Everything downstream of the old key breaks silently.

**Places your OpenRouter key lives (update ALL of them):**

1. **Supabase Edge Function secrets** — This is the most common one to miss. Your MCP server reads the key from here at runtime.

   ```bash
   supabase secrets set OPENROUTER_API_KEY=sk-or-v1-your-new-key
   ```

2. **Local `.env` files** — Any recipes or integrations you run locally (e.g., `recipes/chatgpt-conversation-import/.env`). Open each one and replace the old key value.

3. **CI/CD or deployment configs** — If you've set the key in any deployment pipeline, update it there too.

**How to verify the new key works:**

```bash
curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer sk-or-v1-your-new-key"
```

If you get a JSON list of models back, the key is valid. If you get a 401, the key is wrong or not yet active.

**Tip:** After rotating a key, test your Open Brain immediately — capture a test thought and search for it. Don't wait days to discover it's broken.

---

## Rate Limits and API Issues

### "My suite of agents keeps hitting per-minute rate limits"

If you've built custom agents on top of the Open Brain (or alongside it), rate limit issues with your AI provider are outside the scope of this guide. The Open Brain is a single MCP server, not a multi-agent system.

That said: check your usage tier in your provider's console, make sure your agents aren't all using Opus/Sonnet for tasks that Haiku could handle, and stagger requests rather than firing everything simultaneously.

---

## Quick Reference: Before You Ask for Help

1. **Did you follow the guide step by step?** Most issues trace back to a skipped or modified step.
2. **Check Edge Function logs.** Supabase dashboard → Edge Functions → your function → Logs. This tells you what's actually breaking.
3. **Is your URL format correct?** Should be: `https://your-ref.supabase.co/functions/v1/open-brain-mcp?key=your-key`
4. **Use the Supabase AI assistant.** Paste your error and it can help diagnose Supabase-specific issues.
5. **Don't let AI rewrite your server code** unless you understand what it's changing. Configuration problems need configuration fixes.

---

## Tips from the Community

### Export your debugging sessions

At the end of a session where you've built something or solved a problem, ask whatever AI you're working with: "Please export a summary of what we did, why we did it, and frame it in a way that will help other people solve the same problem." Then share it in the chat. Everyone benefits.

### Post problems publicly, not in DMs

If you run into a blocker, post it in the Substack chat thread — not in someone's DMs. Other people are hitting the same issues and the answers help everyone.

---

*This FAQ is based on real community questions from the Substack chat and YouTube comments. If you run into something not covered here, [open an issue](https://github.com/NateBJones-Projects/OB1/issues) or post in the [Substack community](https://natesnewsletter.substack.com/) so everyone benefits from the answer.*
