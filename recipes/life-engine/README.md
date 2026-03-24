# 🧠 Life Engine

> One loop. One skill. Claude figures out what matters right now.

A self-improving, time-aware personal assistant that runs in the background via Claude Code's `/loop` command. It checks your calendar, surfaces relevant knowledge from your Open Brain, tracks habits and health check-ins, and delivers proactive briefings via Telegram — adapting to your life over time.

**This isn't a calendar tool. It's not a reminder app. It's a personal AI engine that runs your day and gets better at it every week.**

> [!IMPORTANT]
> **This recipe requires [Claude Code](https://claude.ai/download).** It uses Claude Code-specific features — skills, the `/loop` command, and MCP server connections — that aren't available in other AI coding tools. If you're using a different agent, this one isn't for you (yet).

> [!TIP]
> **You don't have to set this up manually.** This guide is detailed enough that Claude Code can do most of the setup for you. If you'd rather not walk through every step yourself, skip to [Quick Setup with Claude Code](#quick-setup-with-claude-code) — paste one prompt and Claude handles the plugin install, skill file creation, schema setup, and permissions configuration. Come back to the step-by-step sections if you want to understand what it built or customize further.

> [!NOTE]
> **This will not be perfect on day one.** That's by design. Life Engine is built to iterate — your first morning briefing will be rough, your tenth will be dialed in, and by week four the system is suggesting its own improvements based on what you actually use. The value comes from the feedback loop between you and the agent, powered by the structured context your Open Brain provides. Treat the first run as a starting point, not a finished product.

---

## Quick Setup with Claude Code

This guide contains everything Claude Code needs to set up your entire Life Engine — the Telegram channel, skill files, database schema, and permissions config. Instead of walking through 8 steps manually, point Claude Code at this README and let it do the work.

**Before you start**, you'll need:
- Claude Code installed ([claude.ai/download](https://claude.ai/download))
- A working Open Brain setup ([Getting Started Guide](../../docs/01-getting-started.md))
- Google Calendar MCP connected to Claude Code
- [Bun](https://bun.sh/) installed (`brew install oven-sh/bun/bun`)
- A Telegram or Discord account (whichever you want briefings delivered to)

**Tell Claude Code:**

> Read the Life Engine recipe at `~/path-to-ob1/recipes/life-engine/README.md` and set up my Life Engine end to end. I want to use **Telegram** *(or Discord)* as my messaging channel. Walk me through creating a bot if I don't have one yet. Install the channel plugin, configure it with my bot token, create the Life Engine skill file at `~/.claude/skills/life-engine/SKILL.md` using the full skill from `recipes/life-engine/life-engine-skill.md`, run the schema.sql in my Supabase SQL Editor, and configure permissions for unattended operation. Pause and walk me through any steps that need my phone or browser (bot creation, channel pairing). When everything is ready, test it with `/life-engine`.

**What Claude Code will do:**
1. Install and configure the Telegram channel plugin
2. Create the skill file with the full Life Engine prompt
3. Run the database schema in your Supabase project
4. Set up permissions for unattended operation
5. Pause for you to complete Telegram pairing (requires your phone)
6. Run a test cycle to confirm everything works

After setup, exit and relaunch with your channel:

```bash
# Telegram
claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions

# Discord
claude --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions
```

Then start your loop: `/loop 30m /life-engine`

If you want to understand each piece or customize the setup, continue with the step-by-step guide below.

---

## What It Does

You run one command:

```
/loop 30m /life-engine
```

Every 30 minutes, Claude wakes up, checks the time, and decides what you need right now:

| Time | What Happens |
|------|-------------|
| **7:00 AM** | Pulls your calendar, gives you a daily rundown, reminds you about your morning jog |
| **9:30 AM** | You've got a 10am client call — queries your Open Brain for that client's history, past conversations, open items and sends you a briefing |
| **12:00 PM** | No meetings for a bit — sends a quick check-in: "How are you feeling? Quick update and I'll track it" |
| **3:00 PM** | "Your afternoon is clear. Here's what's still on your plate" |
| **6:00 PM** | Day summary: meetings attended, tasks completed, habits tracked |

The key insight: **you don't build all of this on day one.**

You start simple — maybe it just checks your calendar and sends you a Telegram message. That's it. Then Claude starts learning. It notices patterns, suggests additions:

- *"Hey, you keep checking your Open Brain before client calls manually. Want me to add that to the skill?"*
- *"You haven't used the weather check in 2 weeks. Want me to drop it?"*
- *"I notice you have recurring Monday standups. Should I prep a summary of last week's notes every Monday morning?"*

The skill evolves. Claude proposes changes, you approve them, and over time your Life Engine becomes something completely personalized that no one else's looks like.

---

## What You'll Learn

- Using Claude Code's `/loop` command for recurring background tasks
- Using Claude Code's **Channels** for real-time two-way Telegram messaging
- Building time-aware Claude Code skills that adapt behavior based on context
- Connecting multiple MCP integrations into a single cohesive workflow
- Querying your Open Brain for contextual knowledge surfacing
- Delivering proactive outputs via Telegram
- Designing self-improving systems where Claude suggests its own enhancements

---

## Prerequisites

Before starting, you'll need:

| Requirement | Status |
|-------------|--------|
| Working Open Brain setup ([Getting Started Guide](../../docs/01-getting-started.md)) | ☐ |
| Claude Code installed and working ([claude.ai/download](https://claude.ai/download)) | ☐ |
| Google Calendar MCP connected to Claude Code | ☐ |
| Telegram account + Bot created via [@BotFather](https://t.me/BotFather) | ☐ |
| [Bun](https://bun.sh/) installed (`bun --version` to check) | ☐ |
| Supabase project with Open Brain MCP deployed | ☐ |

### Credential Tracker

Copy this and fill it in as you go — you'll reference these values throughout setup.

```
# Open Brain
SUPABASE_PROJECT_URL=
SUPABASE_SERVICE_KEY=
OB1_MCP_URL=

# Telegram
TELEGRAM_BOT_TOKEN=
# (Chat ID is handled automatically via channel pairing — no need to look it up)

# Google Calendar
(Connected via Claude Code MCP settings)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Claude Code                     │
│                                                  │
│  claude --channels plugin:<platform>@...           │
│  /loop 30m /life-engine                          │
│       │                                          │
│       ▼                                          │
│  ┌─────────────┐                                 │
│  │ /life-engine │ ◄── Claude Code Skill          │
│  │   skill      │     (.claude/skills/)          │
│  └──────┬──────┘                                 │
│         │                                        │
│    Checks time                                   │
│    Decides action                                │
│         │                                        │
│    ┌────┼────────────┬──────────────┐            │
│    ▼    ▼            ▼              ▼            │
│  📅    🧠          💬           📊             │
│  Google  Open Brain   Messaging    Life Engine   │
│  Calendar (Supabase   Channel      Tables        │
│  MCP      MCP)       (plugin)      (Supabase)    │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Data flows:**
1. **Calendar → Claude**: What's coming up?
2. **Open Brain → Claude**: What do I know about it?
3. **Claude → You**: Here's what you need (sent via Telegram or Discord channel).
4. **You → Claude**: Replies pushed into the session in real time via channel.
5. **Claude → Life Engine Tables**: Log habits, moods, improvements

---

## Step 1: Connect a Messaging Channel

Life Engine needs a way to talk to you when you're away from the terminal. Claude Code's **Channels** feature provides built-in, two-way messaging — messages push into your session in real time with no custom server required. Pick whichever platform you already use.

> [!NOTE]
> Channels are a **research preview** feature. The `--channels` flag is not yet shown in `--help`, and the plugin syntax may evolve. See the [Channels documentation](https://code.claude.com/docs/en/channels) for the latest details.

**First, install Bun** — all channel plugins require it:

```bash
brew install oven-sh/bun/bun
```

Verify with `bun --version`.

Now pick your platform:

### Option A: Telegram (Recommended)

Telegram is free, fast, works on every phone, and has the simplest bot setup.

**1. Create a Telegram Bot**

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Give it a name (e.g., "My Life Engine")
4. Give it a username (e.g., `my_life_engine_bot`)
5. Copy the **bot token**

**2. Install and Configure the Plugin**

Start a Claude Code session and install the official Telegram plugin:

```
/plugin install telegram@claude-plugins-official
/reload-plugins
```

Then configure it with your bot token:

```
/telegram:configure <YOUR_BOT_TOKEN>
```

This writes your token to `~/.claude/channels/telegram/.env`.

**3. Launch with Channels Enabled**

Exit your session and relaunch with the channel flag:

```bash
claude --channels plugin:telegram@claude-plugins-official
```

**4. Pair Your Telegram Account**

1. DM your bot on Telegram — send it any message (e.g., "hello")
2. The bot replies with a **6-character pairing code**
3. Back in Claude Code, approve the pairing:
   ```
   /telegram:access pair <code>
   ```
4. Lock down access so only your account can reach the session:
   ```
   /telegram:access policy allowlist
   ```

✅ **Checkpoint:** Send a test message to your bot on Telegram. Claude Code should receive it in the terminal and can reply back through the channel.

### Option B: Discord

If you prefer Discord or already have a server, the setup is similar but requires a few extra steps in the Discord Developer Portal.

**1. Create a Discord Bot**

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**
2. In the **Bot** section, create a username, then click **Reset Token** and copy the token
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**

**2. Invite the Bot to Your Server**

1. Go to **OAuth2 > URL Generator**
2. Select the `bot` scope and enable these permissions:
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Attach Files
   - Add Reactions
3. Open the generated URL to add the bot to your server

**3. Install and Configure the Plugin**

```
/plugin install discord@claude-plugins-official
/reload-plugins
/discord:configure <YOUR_BOT_TOKEN>
```

**4. Launch with Channels Enabled**

Exit your session and relaunch:

```bash
claude --channels plugin:discord@claude-plugins-official
```

**5. Pair Your Discord Account**

1. DM your bot on Discord — if it doesn't respond, make sure Claude Code is running with `--channels` from the previous step
2. The bot replies with a **pairing code**
3. Back in Claude Code:
   ```
   /discord:access pair <code>
   /discord:access policy allowlist
   ```

✅ **Checkpoint:** Send a test message to your bot on Discord. Claude Code should receive it in the terminal and can reply back through the channel.

### Channel Tools (Same for Both Platforms)

After setup, the same three tools are available regardless of platform:

| Tool | Purpose |
|------|---------|
| `reply` | Send text or files to a chat. Supports `text`, `chat_id`, optional `files` (array of absolute paths, max 50MB each), and `reply_to` (message ID). Auto-chunks long text. Images send as photos with preview. |
| `react` | Add emoji reaction to a message. |
| `edit_message` | Edit a previously sent bot message. Good for "working…" → result updates. |

<details>
<summary>Option C: Custom Telegram Bridge (for older Claude Code versions)</summary>

If your Claude Code version doesn't support `--channels`, you can use a lightweight bridge server instead.

**1. Create a Telegram Bot** — same as Option A above.

**2. Get Your Chat ID**

1. Message your new bot (send anything — "hello")
2. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Find `"chat":{"id":XXXXXXX}` in the response
4. Copy the **chat ID**

**3. Set Up the Bridge Server**

```bash
mkdir ~/life-engine-telegram && cd ~/life-engine-telegram
```

Create `bridge.js`:

```javascript
// Minimal Telegram bridge for Claude Code MCP
import { Telegraf } from 'telegraf';
import express from 'express';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

let unreadMessages = [];

bot.on('text', (ctx) => {
  unreadMessages.push({
    text: ctx.message.text,
    from: ctx.message.from.first_name,
    timestamp: new Date().toISOString()
  });
});

app.get('/messages', (req, res) => {
  res.json(unreadMessages.length === 0
    ? { status: 'no_messages', messages: [] }
    : { status: 'unread', messages: unreadMessages });
});

app.post('/messages/read', (req, res) => {
  const count = unreadMessages.length;
  unreadMessages = [];
  res.json({ markedAsRead: count });
});

app.post('/reply', (req, res) => {
  bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, req.body.message, {
    parse_mode: 'Markdown'
  });
  res.json({ sent: true });
});

app.listen(3456, () => console.log('Telegram bridge running on :3456'));
bot.launch();
```

Create `package.json`:

```json
{
  "name": "life-engine-telegram",
  "type": "module",
  "dependencies": {
    "telegraf": "^4.16.0",
    "express": "^4.18.0"
  }
}
```

Install and run:

```bash
npm install
TELEGRAM_BOT_TOKEN="your_token" TELEGRAM_CHAT_ID="your_chat_id" node bridge.js
```

For persistent operation, use `pm2` or create a `launchd` service (macOS).

**4. Register as an MCP Server**

```bash
claude mcp add telegram-bridge --transport http --url http://localhost:3456
```

**5. Add Telegram Polling**

With the custom bridge, you also need a companion skill to poll for incoming messages. Create `.claude/skills/check-telegram/SKILL.md`:

```markdown
# /check-telegram — Poll for Telegram Messages

Check for new Telegram messages from the user.

1. Use the Telegram MCP tools to check for unread messages.
2. If there are NO unread messages, say "No new messages." and stop.
3. If there ARE unread messages:
   a. Read and understand what the user is asking for
   b. Mark the messages as read
   c. Take action on the request
   d. Send your response back via Telegram
   e. Keep responses concise and mobile-friendly
```

Then run it on a separate loop: `/loop 1m /check-telegram`

</details>

---

## Step 2: Connect Google Calendar

Google Calendar MCP gives Claude Code read access to your calendar events.

### 2.1 Enable Google Calendar MCP

If you're using Claude Code with the Google Calendar MCP integration:

1. Run `/mcp` in Claude Code
2. Connect Google Calendar from the available integrations
3. Authorize with your Google account

### 2.2 Verify Calendar Access

Ask Claude Code:

```
What's on my calendar for today?
```

It should list your events using the `gcal_list_events` tool.

✅ **Checkpoint:** Claude Code can see your calendar events.

---

## Step 3: Connect Your Open Brain

Your Open Brain is already deployed as a remote MCP server from the Getting Started guide.

### 3.1 Add Open Brain MCP to Claude Code

If not already connected:

```bash
claude mcp add open-brain --transport http --url "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_ACCESS_KEY"
```

### 3.2 Verify Open Brain Access

Ask Claude Code:

```
Search my Open Brain for anything related to "meetings" or "clients"
```

It should query your thoughts using semantic search.

✅ **Checkpoint:** Claude Code can search your Open Brain.

---

## Step 4: Create the Life Engine Schema

The Life Engine needs its own tables to track habits, moods, check-ins, and skill evolution. This extends your Open Brain — it doesn't replace it.

### 4.1 Run the Schema

Run the included [`schema.sql`](schema.sql) file in your Supabase SQL Editor. It contains the full schema with CHECK constraints, table comments, GRANT statements for `service_role`, performance indexes, and an auto-update trigger.

✅ **Checkpoint:** Run the verification query at the bottom of `schema.sql` — you should see 5 tables (`life_engine_habits`, `life_engine_habit_log`, `life_engine_checkins`, `life_engine_briefings`, `life_engine_evolution`).

---

## Step 5: Build the Life Engine Skill

This is the core — a Claude Code skill that runs on every loop iteration.

### 5.1 Create the Skill File

Create `.claude/skills/life-engine/SKILL.md` in your home directory (or project directory):

```markdown
# /life-engine — Proactive Personal Assistant

You are a time-aware personal assistant running on a recurring loop.
Every time this skill fires, determine what the user needs RIGHT NOW
based on the current time, their calendar, and their Open Brain.

## Core Behavior

1. **Time check** — What time is it? What time window am I in?
2. **Duplicate check** — Did I already send something this cycle/today?
3. **Decide** — Based on the time window, what should I be doing?
4. **External pull** — Grab live data from integrations (calendar, etc.)
5. **Internal enrich** — Search Open Brain for context on what you found.
   You can't enrich what you haven't seen yet — always external before internal.
6. **Deliver via Telegram** — only if worth it. Silence > noise.
7. **Log what you did** so the next cycle knows what's been covered

## Time Windows

### Early Morning (6 AM - 8 AM)
- Pull today's calendar events
- Count meetings, identify first event
- Check for active habits (morning jog, meditation, etc.)
- Send a **morning briefing** via Telegram:
  - "Good morning! Here's your day..."
  - List key events with times
  - Habit reminders
  - Weather note if relevant

### Pre-Meeting (15-45 min before any calendar event)
- Identify the upcoming meeting
- Extract attendee names, meeting title, description
- Search Open Brain for relevant context on attendees/topics
- Send a **meeting prep briefing** via Telegram:
  - Who you're meeting with
  - What Open Brain knows about them
  - Any recent interactions or notes
  - Suggested talking points

### Midday (11 AM - 1 PM)
- If no imminent meetings, send a **check-in prompt**:
  - "Quick check-in: How are you feeling? Reply with a quick update"
  - Log responses to life_engine_checkins table
- Review afternoon calendar

### Afternoon (2 PM - 5 PM)
- Pre-meeting prep (same as above) for afternoon events
- If calendar is clear, review pending tasks or follow-ups
- Surface any Open Brain thoughts tagged as action items

### Evening (5 PM - 7 PM)
- Send a **day summary** via Telegram:
  - Meetings attended
  - Habits completed today
  - Any check-in data logged
  - Preview of tomorrow's calendar

### Off Hours (7 PM - 6 AM)
- Do nothing. Respect quiet hours.
- Exception: urgent calendar events in the next hour

## Rules

- **Never send the same briefing twice** — check life_engine_briefings
  before sending. If you already sent a morning briefing today, skip it.
- **Be concise** — the user reads on their phone. Use bullet points.
- **When in doubt, do nothing** — silence is better than noise.
- **Respect check-in responses** — if the user replies on Telegram,
  log it to the appropriate table.
- **Suggest improvements** — every 7 days, review your briefing log
  and suggest one addition or removal to make the skill more useful.
  Send the suggestion via Telegram and wait for approval before changing.

## Available Tools

Use these MCP tools:
- `gcal_list_events` — Get calendar events for a date range
- `gcal_get_event` — Get details on a specific event
- Open Brain semantic search — Find relevant knowledge
- `reply` — Send text or files via Telegram channel
- `react` — Acknowledge messages with emoji reactions
- `edit_message` — Update a previously sent message
- Supabase execute_sql — Query/insert Life Engine tables

## Self-Improvement Protocol

Every 7 days (check life_engine_evolution for last suggestion date):

1. Review the past week's briefing log
2. Identify patterns:
   - Which briefings did the user respond to? (high value)
   - Which briefings got no response? (low value / noise)
   - Did the user manually ask Claude for something repeatedly?
     (candidate for automation)
3. Propose ONE change via Telegram:
   - "I noticed you always check your OB1 before client calls.
     Want me to add automatic client prep briefings?"
   - "You haven't responded to the midday check-ins in 2 weeks.
     Should I drop those?"
4. Wait for user approval
5. Log the change to life_engine_evolution (approved: true/false)
6. If approved, update your behavior accordingly

## Message Format

Use this format for Telegram messages:

Morning briefing:
☀️ **Good morning!**
📅 You have [N] events today
• [Time] — [Event name]
• [Time] — [Event name]
🏃 Habit reminder: [habit name]

Pre-meeting:
📋 **Prep: [Meeting name] in [N] min**
👥 With: [attendees]
🧠 From your brain: [relevant OB1 context]
💡 Suggested: [talking points]

Check-in:
💬 **Quick check-in**
How are you feeling? Reply with a quick update
and I'll log it.

Evening summary:
🌙 **Day wrap-up**
📅 [N] meetings today
✅ Habits: [completed] / [total]
📊 Mood: [if logged]
📅 Tomorrow: [first event]
```

✅ **Checkpoint:** The skill file exists in `.claude/skills/`.

> **Note:** In the previous version of this recipe, a separate `/check-telegram` polling skill was required to read incoming messages. With Channels, that's no longer needed — Telegram messages are pushed directly into your Claude Code session in real time. Claude reads and responds to them inline.

---

## Step 6: Configure Permissions for Unattended Operation

Life Engine runs autonomously via `/loop`. If Claude encounters a tool it doesn't have permission to use, **the session pauses silently** until you approve it at the terminal. Nothing happens — no briefings, no check-ins, no Telegram responses — until you're back at the keyboard.

> [!WARNING]
> **This is the most common reason a Life Engine "stops working."** You walk away, Claude hits one permission prompt, and everything freezes. Configure permissions before starting your first loop.

### 6.1 Choose Your Approach

| Approach | Best For | Risk Level |
|----------|----------|------------|
| **`--dangerously-skip-permissions`** | Always-on setups on a dedicated, trusted machine | High — bypasses ALL checks |
| **`--permission-mode auto`** | A middle ground — automatic but with some guardrails | Medium |
| **`--allowedTools` (CLI flag)** | Fine-grained — approve only the tools Life Engine needs | Low — scoped |
| **`settings.json` allowlist** | Same as above, but persisted in config instead of CLI | Low — scoped + persistent |

### 6.2 Option A: Skip Permissions (Simplest for Dedicated Machines)

For a machine you fully trust (e.g., a Mac Mini running Life Engine in a persistent terminal):

```bash
# Use whichever channel you set up in Step 1
claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions
claude --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions
```

> [!CAUTION]
> This means Claude can run any tool, any bash command, write any file — without asking. Only use this on a machine and in an environment you fully trust.

### 6.3 Option B: Auto Permission Mode

A less extreme alternative. Claude can take actions automatically but still respects certain guardrails:

```bash
claude --channels plugin:telegram@claude-plugins-official --permission-mode auto
```

(Swap `telegram` for `discord` if using Discord.)

### 6.4 Option C: Allowlisted Tools (Most Precise)

Pre-approve only the specific tools Life Engine uses. You can pass them on the CLI:

```bash
claude --channels plugin:telegram@claude-plugins-official \
  --allowedTools "Bash Read Write Edit \
    mcp__plugin_telegram_telegram__reply \
    mcp__plugin_telegram_telegram__react \
    mcp__plugin_telegram_telegram__edit_message \
    mcp__google-calendar__gcal_list_events \
    mcp__google-calendar__gcal_get_event \
    mcp__open-brain__* \
    mcp__supabase__*"
```

Or persist them in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_telegram_telegram__reply",
      "mcp__plugin_telegram_telegram__react",
      "mcp__plugin_telegram_telegram__edit_message",
      "mcp__google-calendar__gcal_list_events",
      "mcp__google-calendar__gcal_get_event",
      "mcp__open-brain__*",
      "mcp__supabase__*"
    ]
  }
}
```

> **Note:** The exact tool names depend on how you named your MCP servers. Run `/mcp` in Claude Code to see your server names, then match them here. The `__*` wildcard approves all tools from that server.

If you're using the [Dynamic Loop Timing](#dynamic-loop-timing) feature from the skill, also add `CronCreate` and `CronDelete`.

### 6.5 Test Before You Walk Away

1. Start Claude Code with your chosen permission strategy
2. Run `/life-engine` manually
3. Watch for any permission prompts — if you see one, add that tool to your allowlist
4. Repeat until the skill runs clean with no prompts
5. Only then start the loop and step away

✅ **Checkpoint:** `/life-engine` completes a full cycle (calendar check → briefing → log) with zero permission prompts.

---

## Step 7: Start Simple — Your First Loop

**Don't activate everything at once.** Start with just calendar + Telegram.

### 7.1 Start Claude Code with Channels and Permissions

```bash
# Telegram
claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions

# Discord
claude --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions
```

Or swap `--dangerously-skip-permissions` for your preferred permission strategy from Step 6.

### 7.2 Test the Skill Manually

In your session, run:

```
/life-engine
```

Claude should check the time, look at your calendar, and send you a Telegram message. If it's morning, you'll get a daily briefing. If there's a meeting coming up, you'll get a prep brief.

### 7.3 Start the Loop

Once you've confirmed it works:

```
/loop 30m /life-engine
```

That's it. Claude will now check in every 30 minutes and decide if you need anything. When you reply on Telegram, the channel pushes your message directly into the session — Claude reads and responds inline, no separate polling loop needed.

> **Note:** Loop jobs and channels are session-only — they stop when Claude Code exits. For persistent operation, keep a Claude Code session running on a dedicated machine or persistent terminal, or restart when you begin your day.

✅ **Checkpoint:** You're receiving proactive Telegram messages from Claude based on your calendar, and your Telegram replies reach Claude in real time.

---

## Step 8: Grow It Over Time

This is where Life Engine becomes unique to you. Here's the progression:

### Week 1: Calendar + Telegram (Start Here)
- Morning briefing with today's events
- Pre-meeting prep from Open Brain
- That's it. Keep it simple.

### Week 2: Add Habits
Tell Claude:
> "Add a morning jog habit to my Life Engine. Remind me at 7am and ask me to confirm when I'm done."

Claude will:
1. Insert a record into `life_engine_habits`
2. Start including it in morning briefings
3. Log completions when you reply

### Week 3: Add Check-ins
Tell Claude:
> "Add a midday mood check-in. Just ask me how I'm feeling and log it."

Claude will:
1. Start sending a midday prompt
2. Log your responses to `life_engine_checkins`
3. Include mood trends in evening summaries

### Week 4: First Self-Improvement Cycle
After 7 days of data, Claude reviews its own performance:
- Which messages did you respond to?
- Which ones did you ignore?
- What did you ask for manually that could be automated?

It sends you a suggestion via Telegram. You approve or reject. The skill evolves.

### Beyond: It's Yours
Over weeks and months, your Life Engine accumulates:
- A log of every briefing it sent
- Your habit completion streaks
- Your mood and energy patterns
- A history of its own evolution

No two Life Engines look the same. Yours adapts to your schedule, your habits, your communication style, and your needs.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Life Engine stopped responding** | Most likely blocked on a permission prompt. Check the terminal — if you see a prompt waiting, approve it and configure permissions per Step 6 |
| **Loop stops firing** | Loops are session-only. If Claude Code exits, restart with the full launch command and `/loop 30m /life-engine` |
| **No Telegram messages received** | Verify you started with `--channels plugin:telegram@claude-plugins-official` and completed pairing. Run `/plugin list` to confirm the plugin is installed |
| **Telegram replies not reaching Claude** | Channels only push while the session is open. Verify pairing completed (`/telegram:access pair`) and policy is set (`/telegram:access policy allowlist`) |
| **`--channels` flag not recognized** | Update Claude Code to the latest version. The flag is in research preview and not shown in `--help` — but it works |
| **Bun not found** | Install via `brew install oven-sh/bun/bun` or `curl -fsSL https://bun.sh/install \| bash` |
| **Plugin not loading** | Check `~/.claude/channels/telegram/.env` exists with your bot token. Try `/reload-plugins` in the session |
| **Calendar not showing events** | Run `/mcp` and verify Google Calendar is connected |
| **Open Brain returns nothing** | Test with: *"Search my Open Brain for [topic]"* — you may need more captured thoughts |
| **Duplicate briefings** | The skill checks `life_engine_briefings` before sending. If duplicates occur, verify Supabase connection |
| **Claude suggests too many changes** | The self-improvement protocol limits to 1 suggestion per 7 days. Adjust in the skill if needed |

---

## Going Further

### Video Briefings with Remotion
Instead of text, render a short video summary using [Remotion](https://www.remotion.dev/). Claude can generate a Remotion composition from the briefing data and send the rendered video via the Telegram channel's `reply` tool (which supports file attachments up to 50MB).

### Multi-Person Households
Combine with the [Family Calendar Extension](../../extensions/family-calendar/) to track multiple family members' schedules and send briefings relevant to the whole household.

### Professional CRM Integration
Combine with the [Professional CRM Extension](../../extensions/professional-crm/) to automatically pull contact history and opportunity status into pre-meeting briefings.

### Voice Briefings
Use ElevenLabs or another TTS API to convert briefings to audio. Send voice messages via Telegram instead of text — perfect for when you're driving.

---

## How It Works (Technical)

### The Loop

Claude Code's `/loop` command creates a cron job that fires a skill at a set interval. Each firing is a fresh invocation within the same session context, meaning Claude retains conversation history across firings.

```
/loop 30m /life-engine
```

This creates a `*/30 * * * *` cron entry that triggers the `/life-engine` skill every 30 minutes. The loop handles the **proactive** side — Claude wakes up on a schedule and decides what you need.

### The Channel

The messaging channel handles the **reactive** side — two-way communication. When Claude sends a briefing, it goes out through the channel using the `reply` tool. When you reply on Telegram or Discord, the message is pushed directly into the Claude Code session in real time as a `<channel>` event. No polling, no bridge server.

```bash
claude --channels plugin:telegram@claude-plugins-official
# or
claude --channels plugin:discord@claude-plugins-official
```

The `--channels` flag enables the chosen plugin for the session. Events only arrive while the session is open. Both plugins expose the same three tools: `reply` (send text or files), `react` (add emoji reactions), and `edit_message` (update a previously sent message).

### The Skill

The skill file (`.claude/skills/life-engine/SKILL.md`) is a prompt that Claude follows when the skill is invoked. It contains:
- **Behavioral rules** — what to do at different times of day
- **Tool instructions** — which MCP tools to use and how
- **Output formatting** — how to structure Telegram messages
- **Self-improvement protocol** — how and when to suggest changes

### The MCP Layer

Claude Code communicates with external services through MCP (Model Context Protocol) servers:
- **Google Calendar MCP** — reads calendar events
- **Open Brain MCP** — searches your knowledge base
- **Messaging Channel** — sends and receives messages via Telegram or Discord plugin (`reply`, `react`, `edit_message`)
- **Supabase MCP** — reads/writes Life Engine tables

All of these are configured in Claude Code's MCP settings and available to the skill automatically.

### The Self-Improvement Loop

```
Week N:
  Claude runs Life Engine daily
  Logs every briefing to life_engine_briefings
  Tracks user responses

Week N+1:
  Claude reviews past 7 days
  Identifies high-value vs low-value behaviors
  Proposes ONE change
  User approves/rejects via Telegram
  Change logged to life_engine_evolution
  Skill behavior updates

Week N+2:
  Repeat with updated behavior
```

Over time, this creates a feedback loop where the system continuously refines itself based on actual usage patterns.

---

## Expected Outcome

After setup, you'll have:

- ✅ A Claude Code session running `/loop 30m /life-engine`
- ✅ Proactive morning briefings on your phone via Telegram
- ✅ Automatic meeting prep with context from your Open Brain
- ✅ Habit tracking with reminders and completion logging
- ✅ Mood and health check-ins logged to your database
- ✅ Evening day summaries with habit and mood trends
- ✅ A self-improving system that suggests its own enhancements weekly

**You started with a calendar check. You end up with an AI that knows your life.**

---

## Next Steps

- Add more habits and track streaks over time
- Connect additional Open Brain extensions for richer context
- Experiment with different loop intervals (15m for busy days, 1h for relaxed days)
- Build a [dashboard](../../dashboards/) to visualize your habit and mood data
- Share your Life Engine configuration with the community

---

<details>
<summary>📋 Full Credential Reference</summary>

| Service | Value | Where It's Used |
|---------|-------|----------------|
| Supabase Project URL | `https://xxx.supabase.co` | Open Brain MCP, Life Engine tables |
| Supabase Service Key | `eyJ...` | Database access |
| OB1 MCP URL | `https://xxx.supabase.co/functions/v1/open-brain-mcp?key=xxx` | Knowledge search |
| Telegram Bot Token | `123456:ABC...` | Telegram channel plugin |
| Google Calendar | (OAuth via Claude Code) | Calendar events |

</details>
