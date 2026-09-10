# Open Brain Dashboard

The Hermes **Open Brain** sidebar entry now starts and embeds the verified
localhost dashboard at `http://127.0.0.1:3049`. The hosted Vercel dashboard is
available from the **Open in Browser** button.

Security boundary:

- The local dashboard binds only to `127.0.0.1`.
- Authentication uses the existing Open Brain access key in an HTTP-only
  encrypted session cookie.
- Hard deletion is disabled in the dashboard and REST gateway.
- The launch endpoint accepts no path, command, or URL input; it can start only
  the fixed, verified Open Brain dashboard launcher.
- The former read-only plugin is preserved under `plugins/_backups/` for
  rollback.
