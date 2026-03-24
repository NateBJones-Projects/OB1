# 🎬 Life Engine — Video Briefings Add-On

> Your daily briefing, but as a 30-second animated video on your phone.

An add-on for [Life Engine](../life-engine/) that replaces (or supplements) text Telegram messages with short, animated video briefings — complete with AI voiceover, synced subtitles, and animated data cards. Built with [Remotion](https://www.remotion.dev/) and [ElevenLabs](https://elevenlabs.io/).

> [!IMPORTANT]
> **Built for [Claude Code](https://claude.ai/download), but not exclusive to it.** The Life Engine core requires Claude Code (it depends on `/loop` and skills), but this video add-on — the Remotion rendering, ElevenLabs TTS, and pipeline scripting — can be driven by any capable AI coding agent. ChatGPT handles Remotion well; other agents may work too. If you're adapting this to a different tool, the architecture and components in this guide give you everything you need.

> [!NOTE]
> **Expect iteration.** Your first rendered video will have timing issues, subtitle drift, or a voiceover script that sounds stilted. That's normal. Each render gives you feedback — adjust the VO script guidelines, tweak the subtitle chunking, tune the ElevenLabs voice settings. The structured data flowing from your Open Brain means the *content* improves automatically as your knowledge base grows. The *presentation* improves as you and your agent dial in the rendering pipeline together.

---

## What It Does

Instead of receiving a text message like this:

```
☀️ Good morning!
📅 3 events today:
• 9:00 AM — Standup
• 11:00 AM — Client call with Dave
• 2:00 PM — Design review
🏃 Habits: Morning jog — not yet today
```

You receive a **30-second animated video** on Telegram with:

- 🎙️ AI voiceover narrating your day (ElevenLabs TTS)
- 📊 Animated cards sliding in for each event, task, and habit
- 📝 Synced subtitles so you can watch without sound
- 🎵 Optional ambient background music
- 📱 Vertical format (9:16) optimized for phone viewing

The video is rendered on your machine by Remotion, then sent to your Telegram via the channel's `reply` tool.

---

## Prerequisites

| Requirement | Status |
|-------------|--------|
| [Life Engine](../life-engine/) set up and running | ☐ |
| Node.js 18+ and pnpm installed | ☐ |
| FFmpeg installed (`brew install ffmpeg`) | ☐ |
| ElevenLabs API key ([elevenlabs.io](https://elevenlabs.io)) | ☐ |
| ~2GB disk space for Remotion renders | ☐ |

### Credential Tracker

```
# ElevenLabs
ELEVENLABS_API_KEY=

# Telegram
# (Reuse from Life Engine setup — the channel plugin's `reply` tool handles video delivery)

# Voice Selection
ELEVENLABS_VOICE_ID=         # See Voice Options below
```

### Voice Options

Browse the [ElevenLabs Voice Library](https://elevenlabs.io/voice-library) to find a voice that fits your style. Here are two examples to give you an idea of what works well:

| Voice | Style | Best For |
|-------|-------|----------|
| A bright, energetic voice | Playful, upbeat | Morning briefings |
| A warm, smooth voice | Trustworthy, calm | Professional meeting prep |

Pick one to start. You can switch later or use different voices for different briefing types. Copy the voice ID from your ElevenLabs dashboard into the credential tracker above.

---

## Architecture

```
Life Engine Loop fires
        │
        ▼
  Gather briefing data
  (calendar, OB1, habits)
        │
        ▼
  Generate VO script
        │
        ▼
  ┌─────────────────────┐
  │   ElevenLabs API    │
  │   TTS + Timestamps  │◄── Voice + word-level timing
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Write data.json    │◄── Events, tasks, habits, subtitles
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │   Remotion Render   │◄── React components + animation
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  FFmpeg Normalize   │◄── -14 LUFS audio normalization
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Telegram Channel   │◄── Send video via `reply` tool
  │  reply(files: [...])│     (max 50MB per file)
  └─────────────────────┘
```

**Render time:** ~60-90 seconds for a 30-second video on Apple Silicon. The full pipeline (TTS → render → normalize → send) takes about 2-3 minutes.

---

## Quick Setup with Claude Code

This guide contains everything Claude Code needs to scaffold the entire project for you — the data contract, every component, the pipeline scripts, and the Remotion config. Instead of manually creating 10+ files, point Claude Code at this README and let it do the work:

**1. Install prerequisites:**

```bash
brew install ffmpeg
```

**2. Tell Claude Code:**

> Read the Life Engine Video Briefings README at `~/path-to-ob1/recipes/life-engine-video/README.md` and set up the full Remotion project in `~/life-engine-video`. Create all the components, scenes, shared modules, pipeline scripts, and config files described in the guide. Use the data contract as the TypeScript interface and include placeholder `briefing.json` data so I can preview immediately.

**3. Verify it worked:**

```bash
cd ~/life-engine-video && pnpm exec remotion preview
```

You should see the Briefing composition in Remotion Studio. From there, skip ahead to [Step 4: Connect to Life Engine](#step-4-connect-to-life-engine) to wire it into your loop.

If you prefer to build it manually step-by-step, continue below.

---

## Step 1: Set Up the Remotion Project

### 1.1 Create the Project

```bash
mkdir ~/life-engine-video && cd ~/life-engine-video
pnpm create video@latest --template blank
```

Or if you prefer manual setup:

```bash
mkdir ~/life-engine-video && cd ~/life-engine-video
pnpm init
pnpm add remotion @remotion/cli @remotion/player react react-dom
pnpm add -D @types/react typescript
pnpm add lucide-react
```

### 1.2 Project Structure

```
life-engine-video/
├── src/
│   ├── index.ts              # Remotion entry
│   ├── Root.tsx               # Composition registry
│   ├── BriefingVideo.tsx      # Main composition
│   ├── scenes/
│   │   ├── TitleScene.tsx     # "Good Morning" opener
│   │   ├── CalendarScene.tsx  # Today's events
│   │   ├── HabitsScene.tsx    # Habit reminders
│   │   ├── PrepScene.tsx      # Meeting prep from OB1
│   │   ├── SummaryScene.tsx   # Evening wrap-up
│   │   └── ClosingScene.tsx   # Sign-off
│   ├── shared/
│   │   ├── SubtitleBar.tsx    # Synced subtitle overlay
│   │   ├── ProgressBar.tsx    # Playback progress bar
│   │   ├── TaskCard.tsx       # Animated event/task card
│   │   ├── SectionHeader.tsx  # Section title with icon
│   │   └── Background.tsx     # Animated gradient background
│   └── data/
│       └── briefing.json      # Generated per-render by Claude
├── public/
│   ├── voice.mp3              # Generated per-render by ElevenLabs
│   └── music.mp3              # Optional ambient track
├── scripts/
│   ├── generate-briefing.sh   # Full pipeline script
│   └── normalize-audio.sh     # FFmpeg LUFS normalization
├── package.json
└── tsconfig.json
```

✅ **Checkpoint:** `pnpm exec remotion preview` opens the Remotion studio.

---

## Step 2: Build the Video Components

### 2.1 The Data Contract

Every render is driven by a single `briefing.json` file that Claude generates. This is the contract between Claude and Remotion:

```typescript
// src/types.ts
export interface BriefingData {
  type: 'morning' | 'pre_meeting' | 'evening' | 'checkin';
  date: string;           // "Wednesday, March 18"
  greeting: string;       // "Good morning!" | "Day wrap-up"

  // Calendar events
  events: Array<{
    time: string;         // "9:00 AM"
    title: string;        // "Standup"
    subtitle?: string;    // "With engineering team"
    color: string;        // "#3b82f6"
  }>;

  // Habits
  habits: Array<{
    name: string;         // "Morning jog"
    completed: boolean;
    streak?: number;      // days
  }>;

  // Meeting prep (pre_meeting type only)
  prep?: {
    meetingTitle: string;
    attendees: string[];
    obContext: string[];   // relevant OB1 thoughts
    talkingPoints: string[];
  };

  // Evening summary (evening type only)
  summary?: {
    meetingsAttended: number;
    habitsCompleted: number;
    habitsTotal: number;
    mood?: string;
    tomorrowFirst?: string;
  };

  // Voiceover
  voiceover: {
    script: string;             // full VO text
    audioFile: string;          // path to generated MP3
    subtitles: Array<{
      text: string;             // 5-7 word phrase
      start: number;            // seconds
      end: number;              // seconds
    }>;
  };

  // Styling
  theme: {
    background: string;         // "#fafafa" light | "#0a0a0f" dark
    accent: string;             // primary accent color
    mode: 'light' | 'dark';
  };
}
```

### 2.2 Shared Components

These components are reusable across all briefing types. They handle animation, layout, and visual consistency.

<details>
<summary>📄 src/shared/SubtitleBar.tsx</summary>

```tsx
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

export const SubtitleBar: React.FC<{
  subtitles: SubtitleCue[];
  color?: string;
  bottom?: number;
  fontSize?: number;
}> = ({ subtitles, color = "rgba(99,102,241,0.88)", bottom = 180, fontSize = 38 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeSec = frame / fps;

  let currentCue = subtitles.find(
    (c) => timeSec >= c.start && timeSec <= c.end
  );
  let isActive = !!currentCue;

  if (!currentCue) {
    const past = subtitles.filter((c) => c.end <= timeSec);
    currentCue = past.length > 0 ? past[past.length - 1] : undefined;
  }

  if (!currentCue) return null;

  return (
    <div style={{
      position: "absolute", bottom, left: 0, right: 0, zIndex: 50,
      background: color, padding: "20px 40px",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        color: "#fff", fontSize, fontWeight: 600, textAlign: "center",
        lineHeight: 1.35, opacity: isActive ? 1 : 0.5,
        fontFamily: "Inter, system-ui, sans-serif",
      }}>
        {currentCue.text}
      </div>
    </div>
  );
};
```
</details>

<details>
<summary>📄 src/shared/ProgressBar.tsx</summary>

```tsx
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, zIndex: 100,
      width: `${(frame / durationInFrames) * 100}%`, height: 6,
      background: "linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6)",
    }} />
  );
};
```
</details>

<details>
<summary>📄 src/shared/TaskCard.tsx</summary>

```tsx
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

export const TaskCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  color: string;
  delay: number;
}> = ({ icon, title, subtitle, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay, fps,
    config: { stiffness: 200, damping: 20 },
  });

  return (
    <div style={{
      transform: `translateX(${interpolate(s, [0, 1], [80, 0])}px)`,
      opacity: s, display: "flex", alignItems: "center", gap: 24,
      padding: "24px 32px", marginBottom: 16, borderRadius: 20,
      background: "rgba(255,255,255,0.9)",
      boxShadow: `0 2px 16px rgba(0,0,0,0.06), inset 0 0 0 2px ${color}22`,
      borderLeft: `5px solid ${color}`,
    }}>
      <div style={{ color, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{
          fontSize: 34, fontWeight: 600, color: "rgba(0,0,0,0.85)",
          lineHeight: 1.3, fontFamily: "Inter, system-ui, sans-serif",
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: 26, color: "rgba(0,0,0,0.5)", marginTop: 4,
            fontFamily: "Inter, system-ui, sans-serif",
          }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
};
```
</details>

<details>
<summary>📄 src/shared/SectionHeader.tsx</summary>

```tsx
import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";

export const SectionHeader: React.FC<{
  icon: React.ReactNode;
  label: string;
  count?: number;
  color: string;
  delay: number;
}> = ({ icon, label, count, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay, fps,
    config: { stiffness: 250, damping: 22 },
  });

  return (
    <div style={{
      transform: `scale(${s})`, opacity: s,
      display: "flex", alignItems: "center", gap: 18,
      marginBottom: 24, marginTop: 12,
    }}>
      <div style={{ color }}>{icon}</div>
      <div style={{
        fontSize: 42, fontWeight: 700, color,
        fontFamily: "Inter, system-ui, sans-serif",
      }}>{label}</div>
      {count !== undefined && (
        <div style={{
          background: color, color: "#fff", borderRadius: 30,
          padding: "4px 18px", fontSize: 30, fontWeight: 700,
          fontFamily: "Inter, system-ui, sans-serif",
        }}>{count}</div>
      )}
    </div>
  );
};
```
</details>

### 2.3 Scene Components

Each briefing type is composed of scenes. Scenes are Remotion `<Sequence>` blocks with their own duration and animations. The composition assembles them based on the briefing data.

> **Key pattern:** Scenes are data-driven. The same `CalendarScene` component renders 2 events or 6 events — the layout adapts. Scene durations are calculated from the voiceover timestamps, not hardcoded.

<details>
<summary>📄 src/scenes/TitleScene.tsx (example)</summary>

```tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { Sun, Moon } from "lucide-react";

export const TitleScene: React.FC<{
  greeting: string;
  date: string;
  type: 'morning' | 'evening' | 'pre_meeting' | 'checkin';
}> = ({ greeting, date, type }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { stiffness: 120, damping: 22 } });
  const pulse = 1 + Math.sin(frame / 20) * 0.02;

  const Icon = type === 'evening' ? Moon : Sun;
  const iconColor = type === 'evening' ? '#a78bfa' : '#f59e0b';

  return (
    <AbsoluteFill style={{
      justifyContent: "center", alignItems: "center",
      flexDirection: "column", gap: 30,
    }}>
      <div style={{ transform: `scale(${s})`, opacity: s }}>
        <Icon size={120} color={iconColor} strokeWidth={1.5} />
      </div>
      <div style={{
        transform: `scale(${s * pulse})`, opacity: s,
        fontSize: 80, fontWeight: 800, color: "rgba(0,0,0,0.85)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}>{greeting}</div>
      <div style={{
        transform: `scale(${s})`, opacity: s,
        fontSize: 56, fontWeight: 500, color: "rgba(0,0,0,0.5)",
        fontFamily: "Inter, system-ui, sans-serif", marginTop: -10,
      }}>{date}</div>
    </AbsoluteFill>
  );
};
```
</details>

### 2.4 Main Composition

The `BriefingVideo` composition reads `briefing.json`, calculates scene durations from voiceover timestamps, and assembles the appropriate scenes.

```tsx
// src/BriefingVideo.tsx (simplified structure)
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import briefingData from "./data/briefing.json";
import { SubtitleBar } from "./shared/SubtitleBar";
import { ProgressBar } from "./shared/ProgressBar";
import { TitleScene } from "./scenes/TitleScene";
import { CalendarScene } from "./scenes/CalendarScene";
// ... other scene imports

const FPS = 30;

export const BriefingVideo: React.FC = () => {
  const data = briefingData as BriefingData;

  // Calculate total duration from voiceover
  const lastCue = data.voiceover.subtitles[data.voiceover.subtitles.length - 1];
  const totalDuration = Math.ceil((lastCue.end + 1) * FPS);

  // Scene durations derived from VO timing (not hardcoded)
  // Claude calculates these when generating briefing.json

  return (
    <AbsoluteFill style={{
      background: data.theme.background,
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      {/* Scenes assembled based on briefing type */}
      <Sequence from={0} durationInFrames={Math.round(2 * FPS)}>
        <TitleScene
          greeting={data.greeting}
          date={data.date}
          type={data.type}
        />
      </Sequence>

      {data.events.length > 0 && (
        <Sequence from={Math.round(2 * FPS)} durationInFrames={Math.round(data.events.length * 3 * FPS)}>
          <CalendarScene events={data.events} />
        </Sequence>
      )}

      {/* ... additional scenes based on data.type */}

      <SubtitleBar subtitles={data.voiceover.subtitles} />
      <ProgressBar />
      <Audio src={staticFile("voice.mp3")} />
      {/* Optional music */}
      <Audio src={staticFile("music.mp3")} volume={0.12} />
    </AbsoluteFill>
  );
};
```

### 2.5 Register the Composition

```tsx
// src/Root.tsx
import { Composition } from "remotion";
import { BriefingVideo } from "./BriefingVideo";
import briefingData from "./data/briefing.json";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  // Duration from VO data
  const lastCue = briefingData.voiceover?.subtitles?.slice(-1)[0];
  const duration = lastCue ? Math.ceil((lastCue.end + 2) * FPS) : 30 * FPS;

  return (
    <Composition
      id="Briefing"
      component={BriefingVideo}
      durationInFrames={duration}
      fps={FPS}
      width={1080}
      height={1920}
    />
  );
};
```

✅ **Checkpoint:** Remotion studio shows the Briefing composition with placeholder data.

---

## Step 3: Set Up the Rendering Pipeline

### 3.1 ElevenLabs TTS with Timestamps

The voiceover is generated using ElevenLabs' `/with-timestamps` endpoint, which returns both audio and character-level timing data. Claude uses this to build synced subtitles.

**API call pattern:**

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps

{
  "text": "Good morning! You have 3 events today...",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.55,
    "similarity_boost": 0.75,
    "style": 0.15,
    "speed": 1.0,
    "use_speaker_boost": true
  }
}
```

**Response includes:**
- `audio_base64` — the full audio as base64 MP3
- `alignment.characters` — every character with start/end times in seconds

**Claude converts character timestamps to word-level subtitle cues** by grouping characters between spaces, then chunking into 5-7 word phrases for readable subtitles.

### 3.2 Audio Normalization

After rendering, normalize audio to broadcast standard:

```bash
#!/bin/bash
# scripts/normalize-audio.sh
INPUT="$1"
OUTPUT="${INPUT%.mp4}-normalized.mp4"
ffmpeg -y -i "$INPUT" -af loudnorm=I=-14:TP=-1.5:LRA=11 \
  -c:v copy "$OUTPUT" 2>/dev/null
echo "Normalized: $OUTPUT"
```

### 3.3 Full Pipeline Script

This script orchestrates the entire flow — Claude calls this to generate and send a video briefing:

```bash
#!/bin/bash
# scripts/generate-briefing.sh
# Called by Claude with: bash scripts/generate-briefing.sh

PROJECT_DIR="$HOME/life-engine-video"
cd "$PROJECT_DIR"

echo "1/3 — Rendering video..."
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
  pnpm exec remotion render src/index.ts Briefing \
  out/briefing.mp4 --codec h264 --crf 23 --scale 1

echo "2/3 — Normalizing audio..."
bash scripts/normalize-audio.sh out/briefing.mp4

echo "3/3 — Done! Video ready for delivery."
# Delivery handled by Claude via the Telegram channel's `reply` tool:
#   reply(chat_id=..., text="📹 Your briefing is ready", files=["/path/to/out/briefing-normalized.mp4"])
# The `reply` tool supports file attachments (images, videos, documents) up to 50MB each.
```

✅ **Checkpoint:** Running the pipeline script manually produces a normalized video file. Claude then delivers it via `reply(files=[...])` in the next step.

---

## Step 4: Connect to Life Engine

### 4.1 Update the Life Engine Skill

Add video briefing capability to your existing `/life-engine` skill by adding this section:

```markdown
## Video Briefing Mode (Optional)

When generating a morning briefing or evening summary, you MAY render
a video briefing instead of (or in addition to) a text message.

### When to use video:
- Morning briefings (daily rundown)
- Evening summaries (day wrap-up)
- NOT for pre-meeting prep (too slow — use text for time-sensitive briefs)
- NOT for check-in prompts (text is faster for quick interactions)

### Video briefing flow:
1. Gather all briefing data (calendar, habits, OB1 context)
2. Write a natural voiceover script (30-45 seconds spoken)
3. Call ElevenLabs /with-timestamps API to generate audio + timing
4. Save audio to ~/life-engine-video/public/voice.mp3
5. Convert character timestamps to 5-7 word subtitle cues
6. Write briefing.json to ~/life-engine-video/src/data/
7. Run: bash ~/life-engine-video/scripts/generate-briefing.sh
8. Send via Telegram channel: `reply(chat_id=..., text="📹 Your briefing is ready", files=["~/life-engine-video/out/briefing-normalized.mp4"])`
9. Log to life_engine_briefings with delivered_via = 'telegram_video'

### Voiceover script guidelines:
- Keep it under 45 seconds spoken (~100-120 words)
- Conversational tone — like a friend giving you a heads up
- Start with greeting, end with encouragement
- Pre-normalize numbers: "3" → "three", phone numbers spelled out
- No special characters or abbreviations the TTS might stumble on

### Example VO script (morning):
"Good morning! It's Wednesday March eighteenth. You've got three things
on the calendar today. First up, a standup at nine. Then a client call
with Dave at eleven — I pulled some notes from your brain on Rooster
Creative. And a design review at two. Don't forget your morning jog.
Have a great day!"
```

### 4.2 Skill Decision Logic

The updated Life Engine skill now has two delivery modes. Claude decides which to use:

| Briefing Type | Delivery | Why |
|--------------|----------|-----|
| Morning briefing | **Video** | Not time-sensitive, worth the 2-min render |
| Pre-meeting prep | **Text** | Time-sensitive, needs to arrive quickly |
| Check-in prompt | **Text** | Interactive, expects a reply |
| Evening summary | **Video** | Reflective, nice to watch at end of day |
| Habit reminder | **Text** | Quick nudge, not worth a video |

---

## Step 5: Customize Your Style

### 5.1 Theme Options

The briefing data includes a `theme` object. Switch between light and dark:

| Theme | Background | Accent | Best For |
|-------|-----------|--------|----------|
| Light | `#fafafa` | `#6366f1` (indigo) | Morning briefings |
| Dark | `#0a0a0f` | `#a78bfa` (purple) | Evening summaries |
| Warm | `#fdf6e3` | `#f59e0b` (amber) | Casual check-ins |

### 5.2 Voice Selection

Different briefing types can use different voices:

```json
{
  "morning": { "voice_id": "YOUR_MORNING_VOICE_ID", "name": "Your morning voice" },
  "evening": { "voice_id": "YOUR_EVENING_VOICE_ID", "name": "Your evening voice" }
}
```

### 5.3 Music

Add ambient background music at low volume (0.10-0.15). Generate short loops via:
- ElevenLabs Music API
- Suno
- Any royalty-free ambient track

Place in `public/music.mp3`. The composition plays it at 12-15% volume under the voiceover.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Render crashes with SIGSEGV** | Use `--codec h264`, NOT h265/libx265 (crashes on Apple Silicon) |
| **Render takes too long** | Keep videos under 45 seconds. Use `--scale 0.5` for testing |
| **Subtitles out of sync** | Use `normalized_alignment` from ElevenLabs, not `alignment` |
| **Telegram rejects video** | Max file size is 50MB per the `reply` tool. 30s H.264 at CRF 23 is typically 3-5MB |
| **TTS sounds robotic** | Adjust stability (0.4-0.6) and style (0.1-0.3). Lower stability = more expressive |
| **Missing fonts** | Install Inter font, or Remotion will fall back to system-ui |
| **FFmpeg not found** | Set PATH explicitly: `PATH="/opt/homebrew/bin:$PATH"` |

---

## Going Further

### Dynamic Scene Assembly
Instead of fixed scene types, let Claude decide which scenes to include based on the data. If there are no habits, skip the habits scene. If there's a lot of OB1 context for a meeting, add an extra context scene. The composition adapts to the data.

### Weekly Recap Videos
Every Sunday, render a 60-second recap of the week: meetings attended, habits completed, mood trends, and highlights. Use chart/graph animations for habit streaks.

### Voice Briefings (Audio Only)
Skip the video render entirely and just send the TTS audio as a voice message via Telegram. Much faster (seconds instead of minutes), still personal. Good for quick habit reminders.

### Screen Recording Integration
For meeting prep, capture a screenshot of the client's website or relevant dashboard and animate it into the prep briefing video. Use `@remotion/gif` to embed Chrome GIF captures.

---

## How the Pipeline Works (Technical)

```
┌──────────────────────────────────────────────────────────────┐
│                    Claude Code Session                        │
│                                                              │
│  /life-engine fires                                          │
│       │                                                      │
│  1. Gather data (Calendar MCP + OB1 MCP + Supabase)         │
│       │                                                      │
│  2. Generate VO script (~100 words, conversational)          │
│       │                                                      │
│  3. POST to ElevenLabs /with-timestamps                     │
│       │  → Returns: audio_base64 + character timestamps     │
│       │                                                      │
│  4. Decode audio → save to public/voice.mp3                 │
│       │                                                      │
│  5. Group characters into 5-7 word subtitle cues            │
│       │                                                      │
│  6. Write briefing.json with all data + subtitles           │
│       │                                                      │
│  7. Run: remotion render → out/briefing.mp4                 │
│       │  (~60-90 sec render on Apple Silicon)                │
│       │                                                      │
│  8. Run: normalize-audio.sh → out/briefing-normalized.mp4   │
│       │                                                      │
│  9. Send via Telegram channel `reply` tool (files param)     │
│       │                                                      │
│  10. Log to life_engine_briefings (type: telegram_video)    │
│       │                                                      │
│  11. Cleanup temp files                                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Total pipeline time:** 2-3 minutes (TTS: ~5s, Render: ~90s, Normalize: ~10s, Upload: ~5s)

This is why video briefings are used for non-time-sensitive messages (morning, evening) and text is used for urgent ones (pre-meeting prep).

---

## Expected Outcome

After setup, your Life Engine will:

- ✅ Render a **30-second morning briefing video** with your day's events, habits, and voiceover
- ✅ Render an **evening summary video** with your day's stats and tomorrow's preview
- ✅ Send videos directly to your phone via Telegram
- ✅ Fall back to text for time-sensitive briefings (meeting prep, check-ins)
- ✅ Use synced subtitles so you can watch without sound
- ✅ Customize voice, theme, and music to your preference

**You started with a text message. Now you have a personal AI news anchor.**
