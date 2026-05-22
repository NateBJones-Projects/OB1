# Build Your Open Brain

This is the core of Open Brain — the foundation everything else builds on. Once this is running, you'll have a personal knowledge system that any AI can read from and write to. Every extension, recipe, and integration in this repo starts here.

> **Prefer video?** Watch the [Open Brain Startup Guide](https://vimeo.com/1174979042/f883f6489a) (~27 min) for a full video walkthrough of this setup process. Follow along with the video or use this written guide — they cover the same steps.

About 30 minutes. Zero coding experience. Two services:

- **[Supabase](https://supabase.com)** — Your database (free tier)
- **[OpenRouter](https://openrouter.ai)** — Your AI gateway (~$5 in credits, lasts months)

---

## 📋 Credential Tracker

You're going to generate API keys, passwords, and IDs across three different services. You'll need them at specific steps later — sometimes minutes after you create them, sometimes much later. Don't trust your memory.

> [!CAUTION]
> 🛑🛑🛑 **STOP. Download this before you do anything else.** 🛑🛑🛑
>
> ### 📥 [Download the Credential Tracker (.xlsx)](https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/docs/open-brain-credential-tracker.xlsx)
>
> This spreadsheet is your lifeline for the entire setup. Every API key, password, and URL you generate goes here. Some of these credentials **cannot be retrieved once you leave the page** — if you don't save them immediately, you'll have to start over.
>
> Open it now. Keep it open. Fill it in as you go.
>
> 🛑🛑🛑 **Do not skip this.** 🛑🛑🛑

---

![Step 1](https://img.shields.io/badge/Step_1-Create_Your_Supabase_Project-E53935?style=for-the-badge)

Supabase is your database. It stores your thoughts as raw text, vector embeddings, and structured metadata. It also gives you a REST API automatically.

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login is fastest)
2. Click **New Project** in the dashboard
3. Pick your organization (default is fine)
4. Set Project name: `open-brain` (or whatever you want)
5. Generate a strong Database password — paste into credential tracker NOW
6. Pick the Region closest to you
7. Click **Create new project** and wait 1–2 minutes

> [!IMPORTANT]
> Grab your **Project ref** — it's the random string in your dashboard URL: `supabase.com/dashboard/project/THIS_PART`. Paste it into the tracker.

✅ **Done when:** You have your **Project ref** and **Database password** saved in your credential tracker.

---

![Step 2](https://img.shields.io/badge/Step_2-Set_Up_the_Database-F4511E?style=for-the-badge)

Four SQL commands, pasted one at a time. This creates your storage table, your search function, your security policy, and the permissions your server needs to read and write data.

![2.1](https://img.shields.io/badge/2.1-Enable_the_Vector_Extension-555?style=for-the-badge&labelColor=F4511E)

In the left sidebar: **Database → Extensions** → search for "vector" → flip **pgvector ON**.

![2.2](https://img.shields.io/badge/2.2-Create_the_Thoughts_Table-555?style=for-the-badge&labelColor=F4511E)

In the left sidebar: **SQL Editor → New query** → paste and Run:

<details>
<summary>📋 <strong>SQL: Thoughts table + indexes</strong> (click to expand)</summary>

```sql
-- Create the thoughts table
create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast vector similarity search
create index on thoughts
  using hnsw (embedding vector_cosine_ops);

-- Index for filtering by metadata fields
create index on thoughts using gin (metadata);

-- Index for date range queries
create index on thoughts (created_at desc);

-- Auto-update the updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();
```

</details>

![2.3](https://img.shields.io/badge/2.3-Create_the_Search_Function-555?style=for-the-badge&labelColor=F4511E)

New query → paste and Run:

<details>
<summary>📋 <strong>SQL: Semantic search function</strong> (click to expand)</summary>

```sql
create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

</details>

![2.4](https://img.shields.io/badge/2.4-Lock_Down_Security-555?style=for-the-badge&labelColor=F4511E)

One more new query:

<details>
<summary>📋 <strong>SQL: Row Level Security</strong> (click to expand)</summary>

```sql
alter table thoughts enable row level security;

create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
```

</details>

![2.5](https://img.shields.io/badge/2.5-Grant_Table_Permissions-555?style=for-the-badge&labelColor=F4511E)

New query → paste and Run:

<details>
<summary>📋 <strong>SQL: Grant service_role access</strong> (click to expand)</summary>

```sql
-- Allow the service_role to read and write thoughts
grant select, insert, update, delete on table public.thoughts to service_role;
```

</details>

> [!IMPORTANT]
> This step is required. Supabase no longer grants full table permissions to `service_role` by default on new projects. Without this, your MCP server will return "permission denied for table thoughts" when trying to capture or search.

![2.6](https://img.shields.io/badge/2.6-Add_Deduplication-555?style=for-the-badge&labelColor=F4511E)

New query → paste and Run:

<details>
<summary>📋 <strong>SQL: Content fingerprint column + upsert function</strong> (click to expand)</summary>

```sql
-- Add fingerprint column for deduplication
ALTER TABLE thoughts ADD COLUMN content_fingerprint TEXT;

-- Unique index so duplicate content is detected
CREATE UNIQUE INDEX idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- Upsert function: inserts new thoughts, merges metadata on duplicates
CREATE OR REPLACE FUNCTION upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO thoughts (content, content_fingerprint, metadata)
  VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

</details>

> This prevents duplicate thoughts from cluttering your database. When you capture the same thought twice, it merges the metadata instead of creating a second row.

![2.7](https://img.shields.io/badge/2.7-Verify-555?style=for-the-badge&labelColor=F4511E)

✅ **Done when:** Table Editor shows the `thoughts` table with columns: id, content, embedding, metadata, content_fingerprint, created_at, updated_at. Database → Functions shows `match_thoughts` and `upsert_thought`.

---

![Step 3](https://img.shields.io/badge/Step_3-Save_Your_Connection_Details-FB8C00?style=for-the-badge)

In the left sidebar: **Settings** (gear icon) → **API Keys**.

You'll land on the **"Publishable and secret API keys"** tab. Copy these into your credential tracker:

- 🔖 **Project URL** — Shown at the top of the page under "Project URL"
- 🔖 **Secret key** — Scroll down to the **"Secret keys"** section on the same page. You'll see a `default` key. Click the copy button to copy it. (You can also click **"+ New secret key"** to create a dedicated one named `open-brain` — this makes it easier to revoke later without affecting other services, but using the default is fine too.)

> [!WARNING]
> Treat the Secret key like a password. Anyone with it has full access to your data. The "Publishable key" at the top of the page is safe to expose publicly — you don't need it for this setup.
>
> You may also see a **"Legacy anon, service_role API keys"** tab — those are the old-style JWT keys. You don't need them. Everything in this guide uses the new key format.

✅ **Done when:** Your credential tracker has both **Project URL** and **Secret key** filled in.

---

![Step 4](https://img.shields.io/badge/Step_4-Get_an_OpenRouter_API_Key-43A047?style=for-the-badge)

OpenRouter is a universal AI API gateway — one account gives you access to every major model. We're using it for embeddings and lightweight LLM metadata extraction.

Why OpenRouter instead of OpenAI directly? One account, one key, one billing relationship — and it future-proofs you for Claude, Gemini, or any other model later.

1. Go to [openrouter.ai](https://openrouter.ai) and sign up
2. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
3. Click **Create Key**, name it `open-brain`
4. Copy the key into your credential tracker immediately
5. Add $5 in credits under Credits (lasts months)

✅ **Done when:** Your credential tracker has the **OpenRouter API key** filled in.

---

![Step 5](https://img.shields.io/badge/Step_5-Create_an_Access_Key-00897B?style=for-the-badge)

Your MCP server will be a public URL. The Supabase project ref in that URL is random enough that nobody will stumble onto it, but let's close the gap entirely. You'll generate a simple access key that the server checks on every request. Takes 30 seconds.

> [!TIP]
> **New to the terminal?** The "terminal" is the text-based command line on your computer. On Mac, open the app called **Terminal** (search for it in Spotlight). On Windows, open **PowerShell**. Everything below gets typed there, not in your browser.

In your terminal, generate a random key:

🟩 **Mac/Linux** — open Terminal and run:

```bash
openssl rand -hex 32
```

🟦 **Windows** — open PowerShell and run:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Copy the output — it'll look something like `a3f8b2c1d4e5...` (64 characters). Paste it into your credential tracker under MCP Access Key. You'll set this as a Supabase secret in the next step (after installing the CLI).

> [!WARNING]
> Copy and paste the command for **your operating system only**. The Mac command won't work on Windows and vice versa.
>
> [!IMPORTANT]
> This is your **one access key for all of Open Brain** — core setup and every extension you add later. Save it somewhere permanent. Never generate a new one unless you want to replace it for ALL deployed functions.

✅ **Done when:** Your credential tracker has the **MCP Access Key** filled in.

---

![Step 6](https://img.shields.io/badge/Step_6-Deploy_the_MCP_Server-1E88E5?style=for-the-badge)

One Edge Function. Four core MCP tools: semantic search, browse recent thoughts, stats, and capture. It also exposes read-only `search` and `fetch` aliases for ChatGPT compatibility. Full-MCP-capable AI clients can read and write to your brain; restricted ChatGPT sessions can still use the standard read-only search/fetch path.

> [!WARNING]
> **Tried this before and starting over?** If you have a `supabase/` folder in your home directory from a previous attempt, delete it first — it will silently hijack your setup. Run `rm -rf ~/supabase` (Mac/Linux) or `Remove-Item -Recurse ~\supabase` (Windows) to clean it out.

**Pick your operating system and follow the steps inside:**

<details>
<summary>🟩 <strong>Step 6 — Mac / Linux</strong> (click to expand)</summary>

![6.1](https://img.shields.io/badge/6.1-Create_a_Project_Folder-555?style=for-the-badge&labelColor=1E88E5)

You need a folder on your computer for this project. The Supabase CLI will put your server files here, and you'll deploy from this folder.

1. **Create a new folder** wherever you keep projects — your Documents folder, a Projects folder, wherever makes sense to you. Name it something like `open-brain`.

2. **Copy the folder's path** — right-click the folder in Finder, hold the **Option** key, and click **Copy "open-brain" as Pathname**.

3. **Navigate to it in your terminal** — open **Terminal** (search Spotlight) and paste the path after `cd`:

```bash
cd /paste/your/path/here
```

Confirm you're in the right place:

```bash
pwd
```

This should print the path to your `open-brain` folder. If it shows your home directory (`/Users/yourname`) or anything else — you're in the wrong place. Re-do the `cd` command.

> [!IMPORTANT]
> From this point on, every terminal command should be run from this folder. If you close your terminal and come back later, `cd` into this folder again.

![6.2](https://img.shields.io/badge/6.2-Install_the_Supabase_CLI-555?style=for-the-badge&labelColor=1E88E5)

**With Homebrew:**

```bash
brew install supabase/tap/supabase
```

<details>
<summary>🍺 <strong>Don't have Homebrew?</strong> (click to expand)</summary>

Homebrew is the standard package manager for Mac. If you've never installed it, paste this into your terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts — it may ask for your Mac password. Once it finishes, close and reopen your terminal, then come back to the `brew install` command above.

</details>

**Without Homebrew:**

`npm install -g supabase` is not supported. If you want a global `supabase` command, install the standalone CLI from the [official Supabase CLI guide](https://supabase.com/docs/guides/local-development/cli/getting-started). Otherwise, run every command below with `npx supabase ...`.

Verify it worked:

```bash
supabase --version
```

> [!NOTE]
> If you're using `npx` instead of a global `supabase` binary, run `npx supabase --version` here and prefix the rest of the commands in this section the same way.

![6.3](https://img.shields.io/badge/6.3-Log_In-555?style=for-the-badge&labelColor=1E88E5)

This connects your local terminal to your Supabase account so the CLI can deploy to your project. It'll open your browser to authenticate — just follow the prompts and come back here when it says "You are now logged in."

```bash
supabase login
```

![6.4](https://img.shields.io/badge/6.4-Initialize_and_Link-555?style=for-the-badge&labelColor=1E88E5)

Set up the Supabase project structure in your folder:

```bash
supabase init
```

You should now see a `supabase/` folder inside your project folder. Verify:

```bash
ls supabase/
```

> [!CAUTION]
> ❌ If `ls supabase/` shows "No such file or directory," you're not in your project folder. Run `pwd` to check, then `cd` to the right place and try `supabase init` again.

Link it to your Supabase project — replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1):

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

![6.5](https://img.shields.io/badge/6.5-Set_Your_Secrets-555?style=for-the-badge&labelColor=1E88E5)

Set your access key from Step 5:

```bash
supabase secrets set MCP_ACCESS_KEY=your-access-key-from-step-5
```

Set your OpenRouter key from Step 4:

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key-here
```

> [!NOTE]
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside Edge Functions — you don't need to set them.
>
> Optional: if you have an Open Brain dashboard or another stable page for viewing individual thoughts, set `OPEN_BRAIN_CITATION_BASE_URL` to that base URL. ChatGPT's `search`/`fetch` compatibility tools use it when returning citation URLs.

<!-- -->

> [!CAUTION]
> Make sure the access key you set here **exactly matches** what you saved in your credential tracker. If they don't match, you'll get 401 errors when connecting your AI.
>
> **If you ever rotate your OpenRouter key:** you must re-run the `supabase secrets set` command above with the new key, AND update any local `.env` files that reference it. The edge function reads from Supabase secrets at runtime — updating the key on openrouter.ai alone won't propagate here. See the [FAQ on key rotation](03-faq.md#api-key-rotation) for the full checklist.

### Create the Function

![6.6](https://img.shields.io/badge/6.6-Download_the_Server_Files-555?style=for-the-badge&labelColor=1E88E5)

Three commands, run them one at a time in order:

**1. Create the function folder:**

```bash
supabase functions new open-brain-mcp
```

**2. Download the server code:**

```bash
curl -o supabase/functions/open-brain-mcp/index.ts https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/index.ts
```

**3. Download the dependencies file:**

```bash
curl -o supabase/functions/open-brain-mcp/deno.json https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/deno.json
```

> [!WARNING]
> ❌ **`No such file or directory`** on command 2 or 3 — you skipped command 1. Run it first, then retry.

Verify the download worked — this should print the first line of the server code, **not** "Hello from Functions":

```bash
head -1 supabase/functions/open-brain-mcp/index.ts
```

> [!CAUTION]
> ❌ If you see `console.log("Hello from Functions!")` — the download didn't overwrite the starter file. Delete the folder, re-create it, and retry the curl commands.
>
> ✅ If you see `import "jsr:@supabase/functions-js/edge-runtime.d.ts";` — you're good.

![6.7](https://img.shields.io/badge/6.7-Deploy-555?style=for-the-badge&labelColor=1E88E5)

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

> [!IMPORTANT]
> Check the first line of the deploy output — it should say `Using workdir` followed by **your project folder path**. If it shows your home directory instead, your supabase project structure is in the wrong place. Go back to Step 6.1 and start over from a clean folder.

Your MCP server is now live at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp
```

Replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1). Paste the full URL into your credential tracker as the MCP Server URL.

Now build your **MCP Connection URL** by adding your access key to the end:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=your-access-key-from-step-5
```

Paste this into your credential tracker as the MCP Connection URL. This is what you'll give to AI clients that support remote MCP — one URL, no extra config.

> [!TIP]
> If you've been filling in your credential tracker as you go, the **MCP Server URL** and **MCP Connection URL** are already auto-generated for you in the Step 6 section of the spreadsheet. Just verify they match.

✅ **Done when:** You have both the **MCP Server URL** and **MCP Connection URL** in your credential tracker, and `supabase functions list` shows `open-brain-mcp` as `ACTIVE`.

</details>

<details>
<summary>🟦 <strong>Step 6 — Windows</strong> (click to expand)</summary>

![6.1](https://img.shields.io/badge/6.1-Create_a_Project_Folder-555?style=for-the-badge&labelColor=1E88E5)

You need a folder on your computer for this project. The Supabase CLI will put your server files here, and you'll deploy from this folder.

1. **Create a new folder** wherever you keep projects — your Documents folder, a Projects folder, wherever makes sense to you. Name it something like `open-brain`.

2. **Copy the folder's path** — open the folder in File Explorer, click the address bar at the top, and copy the path that appears.

3. **Navigate to it in your terminal** — open **PowerShell** and paste the path after `cd`:

```powershell
cd "C:\paste\your\path\here"
```

Confirm you're in the right place:

```powershell
Get-Location
```

This should print the path to your `open-brain` folder. If it shows your home directory (`C:\Users\yourname`) or anything else — you're in the wrong place. Re-do the `cd` command.

> [!IMPORTANT]
> From this point on, every terminal command should be run from this folder. If you close PowerShell and come back later, `cd` into this folder again.

![6.2](https://img.shields.io/badge/6.2-Install_the_Supabase_CLI-555?style=for-the-badge&labelColor=1E88E5)

If you don't have Scoop yet, install it first ([recommended by Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started)):

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```

Then add the Supabase bucket:

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
```

Then install Supabase:

```powershell
scoop install supabase
```

Verify it worked:

```powershell
supabase --version
```

![6.3](https://img.shields.io/badge/6.3-Log_In-555?style=for-the-badge&labelColor=1E88E5)

This connects your local terminal to your Supabase account so the CLI can deploy to your project. It'll open your browser to authenticate — just follow the prompts and come back here when it says "You are now logged in."

```powershell
supabase login
```

![6.4](https://img.shields.io/badge/6.4-Initialize_and_Link-555?style=for-the-badge&labelColor=1E88E5)

Set up the Supabase project structure in your folder:

```powershell
supabase init
```

You should now see a `supabase\` folder inside your project folder. Verify:

```powershell
dir supabase\
```

> [!CAUTION]
> ❌ If `dir supabase\` shows an error, you're not in your project folder. Run `Get-Location` to check, then `cd` to the right place and try `supabase init` again.

Link it to your Supabase project — replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1):

```powershell
supabase link --project-ref YOUR_PROJECT_REF
```

![6.5](https://img.shields.io/badge/6.5-Set_Your_Secrets-555?style=for-the-badge&labelColor=1E88E5)

Set your access key from Step 5:

```powershell
supabase secrets set MCP_ACCESS_KEY=your-access-key-from-step-5
```

Set your OpenRouter key from Step 4:

```powershell
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key-here
```

> [!NOTE]
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside Edge Functions — you don't need to set them.
>
> Optional: if you have an Open Brain dashboard or another stable page for viewing individual thoughts, set `OPEN_BRAIN_CITATION_BASE_URL` to that base URL. ChatGPT's `search`/`fetch` compatibility tools use it when returning citation URLs.

<!-- -->

> [!CAUTION]
> Make sure the access key you set here **exactly matches** what you saved in your credential tracker. If they don't match, you'll get 401 errors when connecting your AI.

![6.6](https://img.shields.io/badge/6.6-Download_the_Server_Files-555?style=for-the-badge&labelColor=1E88E5)

Three commands, run them one at a time in order:

**1. Create the function folder:**

```powershell
supabase functions new open-brain-mcp
```

**2. Download the server code:**

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/index.ts -OutFile supabase\functions\open-brain-mcp\index.ts
```

**3. Download the dependencies file:**

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/deno.json -OutFile supabase\functions\open-brain-mcp\deno.json
```

> [!WARNING]
> ❌ **`No such file or directory`** on command 2 or 3 — you skipped command 1. Run it first, then retry.

Verify the download worked — this should print the first line of the server code, **not** "Hello from Functions":

```powershell
Get-Content supabase\functions\open-brain-mcp\index.ts -Head 1
```

> [!CAUTION]
> ❌ If you see `console.log("Hello from Functions!")` — the download didn't overwrite the starter file. Delete the folder, re-create it, and retry the download commands.
> ✅ If you see `import "jsr:@supabase/functions-js/edge-runtime.d.ts";` — you're good.

![6.7](https://img.shields.io/badge/6.7-Deploy-555?style=for-the-badge&labelColor=1E88E5)

```powershell
supabase functions deploy open-brain-mcp --no-verify-jwt
```

> [!IMPORTANT]
> Check the first line of the deploy output — it should say `Using workdir` followed by **your project folder path**. If it shows your home directory instead, your supabase project structure is in the wrong place. Go back to Step 6.1 and start over from a clean folder.

Your MCP server is now live at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp
```

Replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1). Paste the full URL into your credential tracker as the MCP Server URL.

Now build your **MCP Connection URL** by adding your access key to the end:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=your-access-key-from-step-5
```

Paste this into your credential tracker as the MCP Connection URL. This is what you'll give to AI clients that support remote MCP — one URL, no extra config.

> [!TIP]
> If you've been filling in your credential tracker as you go, the **MCP Server URL** and **MCP Connection URL** are already auto-generated for you in the Step 6 section of the spreadsheet. Just verify they match.

✅ **Done when:** You have both the **MCP Server URL** and **MCP Connection URL** in your credential tracker, and `supabase functions list` shows `open-brain-mcp` as `ACTIVE`.

</details>

---

![Step 7](https://img.shields.io/badge/Step_7-Connect_to_Your_AI-5C6BC0?style=for-the-badge)

You need your MCP Connection URL from the credential tracker — the one with `?key=` at the end.

> [!TIP]
> Your credential tracker spreadsheet has a **Step 7** section with ready-to-copy values for each AI client — including the full terminal command for Claude Code. If you've been filling it in, just copy from there.

Pick your AI client below:

<details>
<summary>🤖 <strong>7.1 — Claude Desktop</strong></summary>

> [!NOTE]
> These steps are for Anthropic's official Claude Desktop app on macOS and Windows. Linux/community ports vary and aren't officially covered by this Connectors UI flow. No JSON config files. No Node.js. No terminal. This is the simplest connection method.

1. Open Claude Desktop → **Settings** → **Connectors**
2. Click **Add custom connector**
3. Name: `Open Brain`
4. Remote MCP server URL: paste your **MCP Connection URL** (the one ending in `?key=your-access-key`)
5. Click **Add**

That's it. Start a new conversation, and Claude will have access to your Open Brain tools. You can enable or disable it per conversation via the "+" button → Connectors.

</details>

<details>
<summary>🤖 <strong>7.2 — ChatGPT</strong></summary>

> [!WARNING]
> Requires a paid ChatGPT plan (Plus, Pro, Business, Enterprise, or Edu). Works on the web at [chatgpt.com](https://chatgpt.com) only — not available on mobile.
>
> ChatGPT's custom MCP support is still beta, plan-sensitive, and sometimes model-sensitive. As of May 2026, OpenAI's docs list Developer Mode for Plus, Pro, Business, Enterprise, and Edu, while workspace app publishing and action controls are documented mainly for Business, Enterprise, and Edu. In practice, some Pro model variants expose fewer custom tools than thinking models.

**Enable Developer Mode (one-time setup):**

1. Go to [chatgpt.com](https://chatgpt.com) → click your profile icon → **Settings**
2. Navigate to **Apps & Connectors** → **Advanced settings**
3. Toggle **Developer mode** ON

> [!CAUTION]
> Enabling Developer Mode disables ChatGPT's built-in Memory feature. Yes, that's ironic for a brain tool. Your Open Brain replaces that functionality anyway — and it works across every AI, not just ChatGPT.

**Add the connector:**

1. In Settings → **Apps & Connectors**, click **Create**
2. Name: `Open Brain`
3. Description: `Personal knowledge base with semantic search` (or whatever you want — this is just for your reference)
4. MCP endpoint URL: paste your **MCP Connection URL** (the one ending in `?key=your-access-key`)
5. Authentication: select **No Authentication** (your access key is embedded in the URL)
6. Click **Create**

> [!TIP]
> ChatGPT is less intuitive than Claude at picking the right MCP tool automatically. If it doesn't use your brain on its own, be explicit: "Use the Open Brain search_thoughts tool to find my notes about project planning." After it gets the pattern once or twice in a conversation, it usually picks up the habit.
>
> If ChatGPT says an Open Brain tool is unavailable and your Supabase Edge Function logs show zero requests, the connector did not reach your server. Refresh or recreate the ChatGPT app, start a fresh chat, select the Open Brain app in Developer Mode, and try a thinking model. On restricted Pro sessions, expect read tools, especially `search` and `fetch`, to be more reliable than the write tool (`capture_thought`).

</details>

<details>
<summary>🤖 <strong>7.3 — Claude Code</strong></summary>

One command:

```bash
claude mcp add --transport http open-brain \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp \
  --header "x-brain-key: your-access-key-from-step-5"
```

</details>

<details>
<summary>🤖 <strong>7.4 — OpenAI Codex</strong></summary>

Codex uses `mcp-remote` to bridge to remote MCP servers. Add the following to your `~/.codex/config.toml`:

```toml
[mcp_servers.open-brain]
command = "npx"
args = [
  "-y",
  "mcp-remote",
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=your-access-key-from-step-5"
]
startup_timeout_sec = 30
```

> [!CAUTION]
> The `startup_timeout_sec = 30` line is required. Without it, Codex times out after 10 seconds because `mcp-remote` needs longer to establish the connection to the remote Supabase edge function. If you see `MCP client for open-brain timed out after 10 seconds`, add or increase this value.

Restart Codex and the four Open Brain tools should be available immediately.

</details>

<details>
<summary>🤖 <strong>7.5 — Other Clients (Cursor, VS Code Copilot, Windsurf)</strong></summary>

Every MCP client handles remote servers slightly differently. The server accepts your access key two ways — pick whichever your client supports:

**Option A: URL with key (easiest).** If your client has a field for a remote MCP server URL, paste the full MCP Connection URL including `?key=your-access-key`. This works for any client that supports remote MCP without requiring headers.

**Option B: supergateway bridge (recommended).** If your client only supports local stdio servers (configured via a JSON config file), use `supergateway` to bridge to the remote server. This requires Node.js installed.

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--streamableHttp",
        "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=your-access-key-from-step-5"
      ]
    }
  }
}
```

**Option C: mcp-remote bridge (alternative).** `mcp-remote` also works but performs OAuth discovery on startup, which can cause timeouts with Supabase Edge Function URLs. If you use it, set a generous startup timeout (30+ seconds) in clients that support it.

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp",
        "--header",
        "x-brain-key:${BRAIN_KEY}"
      ],
      "env": {
        "BRAIN_KEY": "your-access-key-from-step-5"
      }
    }
  }
}
```

> [!NOTE]
> No space after the colon in `x-brain-key:${BRAIN_KEY}`. Some clients have a bug where spaces inside args get mangled.

</details>

✅ **Done when:** You can start a conversation in your AI client and it has access to Open Brain tools (`search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`). ChatGPT may also show `search` and `fetch` compatibility tools.

---

![Step 8](https://img.shields.io/badge/Step_8-Use_It-8E24AA?style=for-the-badge)

Ask your AI naturally. It picks the right tool automatically:

| Prompt | Tool Used |
| ------ | --------- |
| "Save this: decided to move the launch to March 15 because of the QA blockers" | 🔖 Capture thought |
| "Remember that Marcus wants to move to the platform team" | 🔖 Capture thought |
| "What did I capture about career changes?" | 🔗 Semantic search |
| "What did I capture this week?" | 🔗 Browse recent |
| "How many thoughts do I have?" | 🔗 Stats overview |
| "Find my notes about the API redesign" | 🔗 Semantic search |
| "Show me my recent ideas" | 🔗 Browse + filter |
| "Who do I mention most?" | 🔗 Stats |

Start by capturing a test thought. In your connected AI, say:

```text
Remember this: Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Wait a few seconds. Your AI should confirm the capture and show you the extracted metadata (type, topics, people, action items). Then open Supabase dashboard → Table Editor → thoughts. You should see one row with your message, an embedding, and metadata.

Now try searching:

```text
What did I capture about Sarah?
```

Your AI should retrieve the thought you just saved.

> [!TIP]
> The capture tool works from any MCP-connected AI — Claude Desktop, ChatGPT, Claude Code, Cursor. Wherever you're working, you can save a thought without switching apps.

✅ **Done when:** You've captured a test thought and successfully searched for it.

---

<details>
<summary>❓ <strong>Troubleshooting</strong></summary>

> [!TIP]
> If the specific suggestions below don't solve your issue, the Supabase AI assistant (chat icon, bottom-right of your dashboard) can help diagnose problems with anything Supabase-related. Paste the error message and tell it what step you're on.

**❌ Claude Desktop tools don't appear**

On the official macOS/Windows Claude Desktop app, make sure you added the connector in Settings → Connectors. Verify the connector is enabled for your conversation — click the "+" button at the bottom of the chat, then Connectors, and check that Open Brain is toggled on. If the connector was added but tools still don't show, try removing and re-adding it with the same URL. If you're using a Linux/community port, its connector behavior can differ and isn't covered by this guide.

**❌ ChatGPT doesn't use the Open Brain tools**

First, confirm Developer Mode is enabled (Settings → Apps & Connectors → Advanced settings). Without it, ChatGPT only exposes limited MCP functionality that won't cover Open Brain's full toolset. Next, check that the connector is active for your current conversation — look for it in the tools/apps panel. If it's connected but ChatGPT ignores it, be direct: "Use the Open Brain search_thoughts tool to search for [topic]." ChatGPT often needs explicit tool references the first few times before it starts picking them up automatically.

**❌ ChatGPT says an Open Brain tool is unavailable**

Check Supabase dashboard → Edge Functions → `open-brain-mcp` → Logs. If no request appears when ChatGPT fails, your server is not the problem. ChatGPT did not expose that tool to the current chat. Redeploy the current MCP server, refresh or recreate the ChatGPT app so it pulls updated tool metadata, start a fresh chat, and try a thinking model. On Pro, the read-only `search`/`fetch` compatibility tools may work where `capture_thought` is hidden or blocked because full MCP/write access is plan-dependent.

**❌ "Permission denied for table thoughts"**

Your `service_role` doesn't have table-level permissions. This happens on newer Supabase projects where CRUD grants are no longer automatic. Go back to Step 2.5 and run the `GRANT` SQL, then retry.

**❌ Getting 401 errors**

The access key doesn't match what's stored in Supabase secrets. Double-check that the `?key=` value in your URL matches your MCP Access Key exactly. If you're using the header approach (Claude Code or mcp-remote), the header must be `x-brain-key` (lowercase, with the dash).

**❌ Search returns no results**

Make sure you've captured at least one thought first (see Step 8). Try asking the AI to "search with threshold 0.3" for a wider net. If that still returns nothing, check the Edge Function logs in the Supabase dashboard for errors.

**❌ Tools work but responses are slow**

First search on a cold function takes a few seconds — the Edge Function is waking up. Subsequent calls are faster. If it's consistently slow, check your Supabase project region — pick the one closest to you.

**❌ Capture tool saves but metadata is wrong**

The metadata extraction is best-effort — the LLM is making its best guess with limited context. The embedding is what powers semantic search, and that works regardless of how the metadata gets classified. If you consistently want a specific classification, use the capture templates from the prompt kit to give the LLM clearer signals.

</details>

<details>
<summary>🔍 <strong>How It Works Under the Hood</strong></summary>

**When you capture from any AI via MCP:** your AI client sends the text to the `capture_thought` tool → the MCP server generates an embedding (1536-dimensional vector of meaning) AND extracts metadata via LLM in parallel → both get stored as a single row in Supabase → confirmation returned to your AI.

**When you search your brain:** your AI client sends the query to the MCP Edge Function → the function generates an embedding of your question → Supabase matches it against every stored thought by vector similarity → results come back ranked by meaning, not keywords.

The embedding is what makes retrieval powerful. "Sarah's thinking about leaving" and "What did I note about career changes?" match semantically even though they share zero keywords. The metadata is a bonus layer for structured filtering on top.

### Swapping Models Later

Because you're using OpenRouter, you can swap models by editing the model strings in the Edge Function code and redeploying. Browse available models at [openrouter.ai/models](https://openrouter.ai/models). Just make sure embedding dimensions match (1536 for the current setup).

</details>

<details>
<summary>➕ <strong>Optional: Add Capture Sources</strong></summary>

Your MCP server handles both reading and writing. But if you want a quick-capture channel outside your AI tools:

- **[Slack Capture](../integrations/slack-capture/)** — Type thoughts in a Slack channel, automatically embedded and stored
- More integrations in [`/integrations`](../integrations/)

</details>

<details>
<summary>🎉 <strong>What You Just Built — And What You Can Build Next</strong></summary>

You just used two free services, some copy-pasted code, and a built-in AI assistant to build a personal knowledge system with semantic search, an open write protocol, and an open read protocol. No CS degree. No local servers. No monthly SaaS fee.

Here's the thing worth noticing: that Supabase AI assistant that helped you through the setup? It has access to all of Supabase's documentation, understands your project structure, and can help you build on top of what you've created. That's not a one-time trick for getting unstuck during setup. That's a permanent building partner.

Want to add a new capture source? Ask it how to create another Edge Function. Want to add a new field to your thoughts table? Ask it to help you write the SQL migration. Want to understand how to add authentication so you can share your brain with a teammate? It knows the docs better than you ever will.

You just built AI infrastructure using AI. That pattern doesn't stop here.

Got stuck or want to share what you've built? Join the [Open Brain Discord](https://discord.gg/Cgh9WJEkeG) — there's a `#help` channel for troubleshooting and a `#show-and-tell` channel for showing off.

</details>

---

## ➡️ Your Next Step

Your Open Brain is live. Now make it work for you. The **[Companion Prompts](02-companion-prompts.md)** cover the full lifecycle from here:

- ✅ **Memory Migration** — Pull everything your AI already knows about you into your brain so every tool starts with context instead of zero
- ✅ **Second Brain Migration** — Bring your existing notes from Notion, Obsidian, or any other system into your Open Brain without starting over
- ✅ **Open Brain Spark** — Personalized use case discovery based on your actual workflow, not generic examples
- ✅ **Quick Capture Templates** — Five patterns optimized for clean metadata extraction so your brain tags and retrieves accurately
- ✅ **The Weekly Review** — A Friday ritual that surfaces themes, forgotten action items, and connections you missed

Start with the Memory Migration. If you have an existing second brain, run the Second Brain Migration next. Then use the Spark to figure out what to capture going forward. The templates build the daily habit. The weekly review closes the loop.

### Then start importing your data

The companion prompts pull out what your AI already knows. **Recipes** go further — they connect directly to your existing services and bulk-import real data.

| Recipe | What It Does | Time |
| ------ | ------------ | ---- |
| [Email History Import](../recipes/email-history-import/) | Pull your Gmail archive into searchable thoughts | 30 min |
| [ChatGPT Conversation Import](../recipes/chatgpt-conversation-import/) | Ingest your full ChatGPT data export | 30 min |

Browse all recipes in [`/recipes`](../recipes/).

---

*Built by Nate B. Jones — companion to "Your Second Brain Is Closed. Your AI Can't Use It. Here's the Fix."*
