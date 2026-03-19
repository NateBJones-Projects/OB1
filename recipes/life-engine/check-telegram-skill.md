# /check-telegram — Poll for Telegram Messages

Check for new Telegram messages from the user.

1. Use the Telegram MCP tools to check for unread messages.
2. If there are NO unread messages, do nothing — just say "No new messages." and stop.
3. If there ARE unread messages:
   a. Read and understand what the user is asking for.
   b. Mark the messages as read by calling the bridge (POST http://localhost:3456/messages/read).
   c. Determine if this is a Life Engine response:
      - **Habit confirmation** (e.g., "done", "finished my jog") → Log to `life_engine_habit_log`
      - **Check-in response** (e.g., "feeling great", "tired", "7/10") → Log to `life_engine_checkins`
      - **Improvement approval** (e.g., "yes", "approved") → Update `life_engine_evolution` with `approved: true`
      - **Improvement rejection** (e.g., "no", "skip") → Update `life_engine_evolution` with `approved: false`
      - **General message** → Handle normally, respond via Telegram
   d. Send your response back via Telegram so the user sees it on their phone.
   e. Keep responses concise and mobile-friendly.
