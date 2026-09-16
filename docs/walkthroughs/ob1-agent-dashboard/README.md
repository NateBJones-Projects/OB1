# OB1 Agent Dashboard Walkthrough

This folder generates the first full walkthrough package for the OB1 Agent Dashboard:

- seeded local demo data for every major dashboard tab
- 1920x1080 screenshot frames
- a PDF/HTML guide
- an ElevenLabs voiceover
- a Remotion MP4 walkthrough

The goal is to make the dashboard legible without a wall-of-text explainer. The assets carry subtle Nate B. Jones / OB1 provenance through the visual system, data story, voiceover, and tutorial frames.

## Outputs

| Output | Path |
| --- | --- |
| Screenshots | `docs/assets/agent-memory/screenshots/dashboard-walkthrough/` |
| PDF guide | `output/OB1-Agent-Dashboard-Walkthrough.pdf` |
| HTML guide | `output/OB1-Agent-Dashboard-Walkthrough.html` |
| Video | `output/OB1-Agent-Dashboard-Walkthrough.mp4` |
| Voiceover | `output/audio/voiceover.mp3` |
| Voiceover script | `output/audio/voiceover-script.txt` |

## Local Services

Run the Agent Memory API proxy as usual on `127.0.0.1:3022`, then start the local demo REST shim:

```bash
node docs/walkthroughs/ob1-agent-dashboard/demo-rest-server.mjs
```

Start the dashboard against the shim and enable the local-only demo auth bypass:

```bash
cd dashboards/open-brain-dashboard-next

SESSION_SECRET=0123456789abcdef0123456789abcdef \
NEXT_PUBLIC_API_URL=http://127.0.0.1:3024 \
AGENT_MEMORY_API_URL=http://127.0.0.1:3022 \
AGENT_MEMORY_WORKSPACE_ID=nate-jones-personal-ob1 \
AGENT_MEMORY_PROJECT_ID=continuity-os \
OB1_DEMO_AUTH_BYPASS=true \
npm run start -- --port 3020
```

`OB1_DEMO_AUTH_BYPASS` is only for local screenshot/video capture. Do not use it in shared previews or production.

## Generate Assets

```bash
cd docs/walkthroughs/ob1-agent-dashboard

npm run screenshots
npm run guide
ELEVENLABS_API_KEY=... npm run voiceover
npm run video
```

The `video` script expects Remotion dependencies to be installed. In this run, rendering reused the existing Nate b-roll Remotion install instead of adding another dependency tree to the repo.

## Seed Story

The seed data intentionally covers:

- Dashboard stats and recent activity
- Thought records for Nate's proposal, OB1 repo context, OpenClaw launch work, and documentation tasks
- Workflow cards for plugin distribution, ClawHub publishing, screenshots, evals, and review flows
- Agent Memory review examples from the live Nate continuity demo project
- Recall trace debugging
- Duplicate review pairs
- Low-quality audit rows that demonstrate memory hygiene

This is demo infrastructure, not a production data source. The REST shim keeps the visual walkthrough repeatable while the production dashboard REST gateway remains separate from the Agent Memory API.
