# Connect a Custom Open Brain MCP Server to Google Antigravity

Connect a remote Open Brain-compatible MCP server to the Google Antigravity desktop app for memory search and capture.

> [!NOTE]
> These instructions use Google Antigravity rather than the Gemini app. The Gemini app does not currently provide a way to configure a custom MCP server, while Antigravity supports custom MCP server configuration.

## What It Does

This recipe shows how to connect a remote Open Brain-compatible Model Context Protocol (MCP) server to the Google Antigravity desktop app. Once connected, Antigravity can use the server’s approved tools to search your saved memories and save new memories when you approve the action.

## Prerequisites

- A working Open Brain setup. Follow the [Open Brain getting-started guide](../../docs/01-getting-started.md) if you have not completed one.
- A remotely deployed Open Brain-compatible MCP server.
- The full URL for that MCP server.
- The exact authentication-header name required by the server.
- A valid private key or token for that header.
- Google Antigravity installed and signed in.

## Steps

### 1. Open Antigravity’s MCP configuration

1. Open the Google Antigravity desktop app.
2. Click **Settings** in the lower-left corner.
3. Select **Customizations**.
4. Under **Installed MCP Servers**, click **Open MCP Config**.

✅ **Done when:** Antigravity opens its MCP configuration file in an editor.

### 2. Add your Open Brain MCP server

In the MCP configuration file, add the following configuration:

```json
{
  "mcpServers": {
    "open-brain": {
      "serverUrl": "https://SUPABASE_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp",
      "headers": {
        "x-brain-key": "YOUR_OPEN_BRAIN_KEY"
      }
    }
  }
}
```

Replace these placeholders before saving:

| Placeholder | Where to find it |
| --- | --- |
| `SUPABASE_PROJECT_REF` | The project-reference string in your Supabase dashboard URL and/or your private credential tracker |
| `YOUR_OPEN_BRAIN_KEY` | The Open Brain secret key from your private credential tracker |

> [!CAUTION]
> Enter your real key only in your local Antigravity configuration file. Never paste it into this README, GitHub, a pull request, an issue, a screenshot, or an AI chat.

If the configuration file already contains other MCP servers, keep the existing `mcpServers` object and add the `open-brain` entry inside it. Use a comma between server entries.

Save the configuration file.

✅ **Done when:** The configuration file is saved, your real project reference and key are entered only locally, and the JSON has no syntax errors.

### 3. Restart Antigravity and verify the connection

1. Save the MCP configuration file.
2. Fully quit Google Antigravity.
   - On macOS, press **Command + Q** or choose **Antigravity → Quit Antigravity** from the menu bar.
3. Reopen Google Antigravity.
4. Open **Settings**.
5. Select **Customizations**.
6. Under **Installed MCP Servers**, confirm that `open-brain` appears.
7. Turn on the server toggle if it is disabled.

✅ **Done when:** `open-brain` appears under Installed MCP Servers and its toggle is enabled.

### 4. Save a test memory

Open a new Antigravity conversation and enter:

```text
Use the open-brain MCP server to save this test memory: "This is a test memory from Google Antigravity."
```

Before approving the tool request, confirm that it:

- Uses the `open-brain` MCP server.
- Is a save or capture action.
- Contains exactly the test memory text shown above.
- Does not include private credentials, tokens, or other sensitive information.

Approve the request only after those checks pass.

✅ **Done when:** Antigravity confirms that it saved the test memory.

### 5. Test a read-only memory search

Open a new Antigravity conversation and enter:

```text
Use the open-brain MCP server to search my saved memories for "This is a test memory from Google Antigravity." Tell me whether you find it. Do not save, modify, or delete anything.
```

Before approving any tool request, confirm that it:

- Uses the `open-brain` MCP server.
- Is a read-only search or retrieval action.
- Does not create, update, or delete a memory.

✅ **Done when:** Antigravity finds the memory, `This is a test memory from Google Antigravity.`, without creating, updating, or deleting anything in Open Brain.

## Expected Outcome

Google Antigravity lists `open-brain` under **Settings → Customizations → Installed MCP Servers** with the server enabled. You can use Antigravity to save the test memory, `This is a test memory from Google Antigravity.`, then retrieve that same memory with a read-only search through your Open Brain MCP server.

## Troubleshooting

### The server does not appear in Installed MCP Servers

**Likely cause:** Antigravity has not reloaded the configuration file, or the JSON has a syntax error.

**Solution:**

1. Confirm that you saved the MCP configuration file.
2. Fully quit Antigravity, then reopen it.
3. Reopen **Settings → Customizations** and check **Installed MCP Servers** again.
4. If the server still does not appear, check the configuration for missing commas, quotation marks, or braces.

### The server appears, but memory searches or saves fail

**Likely cause:** The MCP endpoint URL, the `x-brain-key` header name, or the Open Brain key is incorrect.

**Solution:**

1. Confirm the endpoint follows this format:

   ```text
   https://SUPABASE_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp
   ```

2. Confirm `SUPABASE_PROJECT_REF` exactly matches the project-reference string in your Supabase dashboard URL.
3. Confirm the header name is exactly `x-brain-key`.
4. Replace the key in your local configuration file with the correct Open Brain key from your private credential tracker.
5. Save the file, fully quit Antigravity, and reopen it before testing again.

### Antigravity requests an action you did not intend

**Likely cause:** The prompt is ambiguous, or the agent selected a tool that does more than the task requires.

**Solution:**

1. Do not approve the request.
2. Check that the request uses the `open-brain` MCP server.
3. For a search, approve only a read-only search or retrieval action.
4. For a save, confirm the exact text to be stored and verify that it contains no credentials or sensitive information.
5. Rewrite the prompt to explicitly say whether the agent may save information or must not modify anything.


