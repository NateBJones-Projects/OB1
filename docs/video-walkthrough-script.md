# Open Brain Setup — Video Walkthrough Script

**Format:** Screen recording with voiceover. Mac only. Claude Desktop demo.
**Tone:** Casual, confident, unhurried. You've done this before and you're showing a friend.
**Note:** Real credentials shown on screen — delete the demo Supabase project before publishing.

---

## INTRO (on camera or over the guide's GitHub page)

> Alright, we're gonna build this thing from scratch. The whole Open Brain setup — database, MCP server, connected to Claude — in one sitting. I already have a Supabase account, but I'm starting with a clean project so you can see every step.
>
> If you're following along, the guide is linked below. I'm on a Mac — if you're on Windows, the guide has a separate section for you. Same steps, just different commands.
>
> First thing — and I cannot stress this enough — download the credential tracker. You're gonna be generating keys and passwords across three different services, and if you don't save them as you go, some of them literally cannot be retrieved. I've made that mistake. Don't be me.

**[ACTION: Click the credential tracker download link. Show it opening in Excel/Numbers. Leave it visible.]**

---

## STEP 1 — Create Your Supabase Project

> Step 1 is just creating a Supabase project. If you already have one, skip ahead. I'm gonna make a fresh one.

**[ACTION: Go to supabase.com, click New Project]**

> I'll call it "open-brain." Generate a database password — and immediately paste it into the credential tracker. Right now. Before you do anything else.

**[ACTION: Generate password, paste into tracker]**

> Pick a region close to you, hit Create, and give it a minute to spin up.
>
> While that's working — grab your project ref. It's in the URL, right here. That random string after "project/" — that's it. Put it in the tracker.

**[ACTION: Copy project ref from URL bar, paste into tracker]**

---

## STEP 2 — Set Up the Database

> Now we set up the actual database. Three SQL commands — copy, paste, run. You don't need to understand what these do right now. If you're curious, the guide explains it, but honestly — just paste and go.

**[ACTION: Navigate to Database → Extensions]**

> First, enable the vector extension. Database, Extensions, search "vector," flip it on.

**[ACTION: Enable pgvector]**

> Now SQL Editor. New query. I'm going to grab the first SQL block from the guide — this creates the thoughts table and the indexes.

**[ACTION: Copy SQL from guide, paste into SQL Editor, click Run. Show "Success."]**

> New query again. This one creates the search function — it's what lets your AI find things by meaning, not just keywords.

**[ACTION: Copy second SQL block, paste, Run]**

> One more. This locks down security so only the service role can access your data.

**[ACTION: Copy third SQL block, paste, Run]**

> Quick sanity check — Table Editor should show a "thoughts" table. There it is. We're good.

**[ACTION: Click Table Editor, show thoughts table]**

---

## STEP 3 — Save Your Connection Details

> Step 3 is just grabbing two things from the Supabase dashboard and putting them in the tracker. Settings, API.

**[ACTION: Navigate to Settings → API]**

> Project URL — copy that. And the Secret key — this used to be called "Service role key," same thing. Click reveal, copy it.

**[ACTION: Copy both into credential tracker]**

> Treat that secret key like a password. Anyone with it owns your data.

---

## STEP 4 — Get an OpenRouter API Key

> OpenRouter is how your brain understands things. It's an AI gateway — one account, one key, access to every model. We use it for embeddings and metadata extraction.

**[ACTION: Go to openrouter.ai, sign up or log in]**

> Go to the keys page, create a new key, call it "open-brain." Copy it into the tracker. Then add five bucks in credits — that'll last you months.

**[ACTION: Create key, copy to tracker, add credits]**

---

## STEP 5 — Create an Access Key

> This one's quick. Your MCP server is going to be a public URL, so we need a key to lock it down. Thirty seconds.

**[ACTION: Open Terminal]**

> Open Terminal and run this one command.

**[ACTION: Type/paste `openssl rand -hex 32`, hit enter]**

> That's your access key. 64 random characters. Copy it, put it in the tracker. You'll need it in a couple of steps.

**[ACTION: Copy output into tracker]**

---

## STEP 6 — Deploy the MCP Server

> This is the big one. But it's actually not that bad — we're going to create a project folder, install the Supabase CLI, download two files, and deploy. That's it.

### 6.1 — Project Folder

> First, make a folder for this project. I'll put mine in my Projects folder. Call it "open-brain."

**[ACTION: Create folder in Finder]**

> Now I need to get the path so Terminal knows where it is. Right-click the folder, hold Option, "Copy as Pathname."

**[ACTION: Right-click → Option → Copy as Pathname]**

> In Terminal — cd, paste the path.

**[ACTION: `cd /paste/path/here` in Terminal]**

> Everything from here runs from this folder. If you close Terminal and come back, you need to cd back here first.

### 6.2 — Install the CLI

> I've got Homebrew, so this is one command.

**[ACTION: `brew install supabase/tap/supabase`]**

> Verify it installed.

**[ACTION: `supabase --version`]**

> Good.

### 6.3–6.4 — Log In, Init, and Link

> Log in, initialize the project structure, then link to your Supabase project.

**[ACTION: `supabase login` — browser opens, authorize]**

> That opens your browser to authorize. Click allow.

**[ACTION: `supabase init`]**

> Init creates the local project structure.

**[ACTION: `supabase link --project-ref YOUR_REF` — paste actual project ref]**

> And link connects it to your Supabase project. I'm grabbing the project ref from my credential tracker — see why we saved all that?

### 6.5 — Set Your Secrets

> Now we tell Supabase about our keys. Two commands.

**[ACTION: `supabase secrets set MCP_ACCESS_KEY=...` with actual key from tracker]**

> Access key from Step 5.

**[ACTION: `supabase secrets set OPENROUTER_API_KEY=...` with actual key from tracker]**

> OpenRouter key from Step 4. Make sure these match exactly what's in your tracker. If they don't, you'll get weird auth errors later and wonder what went wrong.

### 6.6 — Download the Server Files

> Here's the cool part. We don't write any code. We just download two files from the repo.

**[ACTION: `supabase functions new open-brain-mcp`]**

> Create the function folder.

**[ACTION: First curl command]**

> Download the server code.

**[ACTION: Second curl command]**

> Download the dependencies. Two files, straight from GitHub, landed exactly where they need to be.

### 6.7 — Deploy

> And deploy.

**[ACTION: `supabase functions deploy open-brain-mcp --no-verify-jwt`]**

> That's it. Your MCP server is live. Running on Supabase's infrastructure — no local server, nothing to keep running.
>
> Now I need to build my connection URL. It's my server URL plus the access key. Let me grab both from the tracker...

**[ACTION: Construct the MCP Connection URL, paste into tracker]**

> That URL is everything. One URL, and any AI client that supports MCP can connect to your brain.

---

## STEP 7 — Connect to Claude Desktop

> Last real step. Open Claude Desktop, Settings, Connectors.

**[ACTION: Open Claude Desktop → Settings → Connectors]**

> Add custom connector. Name it "Open Brain." Paste the connection URL — the one with the key at the end.

**[ACTION: Paste MCP Connection URL, click Add]**

> Done. That's the whole setup. Let's test it.

---

## STEP 8 — Use It

> Start a new conversation. Make sure Open Brain is enabled — you can check via the plus button, Connectors.

**[ACTION: New conversation in Claude Desktop, verify connector is on]**

> Let's capture something.

**[ACTION: Type "Remember this: Sarah mentioned she's thinking about leaving her job to start a consulting business"]**

> Watch what happens — it captures the thought, generates an embedding, and extracts metadata automatically. Type, topics, people, action items — all pulled out of that one sentence.

**[ACTION: Show Claude's response with the metadata confirmation]**

> Now let's search for it. I'm not gonna use the exact words.

**[ACTION: Type "What did I capture about career changes?"]**

> It found it. "Career changes" wasn't in the original thought — but the meaning matched. That's semantic search. It searches by meaning, not keywords.

**[ACTION: Show the search result]**

> Let's try one more.

**[ACTION: Type "How many thoughts do I have?"]**

> One thought. We just started. But this is the foundation — every conversation you have with any AI, from any client, can now read and write to this brain.

---

## OUTRO

> That's the whole thing. Two free services, eight steps, no code written. You've got a personal knowledge system with semantic search that works across Claude, ChatGPT, Cursor — anything that supports MCP.
>
> The guide is linked below. There's a companion prompt pack that makes it actually useful — memory migration, capture templates, a weekly review ritual. And there are extensions you can add on top of this — a CRM, a meal planner, a home maintenance tracker — all using the same pattern you just learned.
>
> Link to everything is in the description. See you in there.
