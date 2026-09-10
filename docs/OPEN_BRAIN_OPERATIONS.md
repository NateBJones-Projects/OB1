# Open Brain operating guide

## Open the dashboard

In Hermes, choose **Open Brain** in the sidebar. Hermes starts the localhost dashboard when needed and embeds the full dashboard at `127.0.0.1:3049`. The **Open in Browser** button opens the hosted dashboard as a fallback.

Use the **Open Brain Dashboard** shortcut on the Windows desktop for a standalone local session. The launcher starts the dashboard on `127.0.0.1:3049`, waits for it to become healthy, and opens the sign-in page. The service is localhost-only and hard deletion is disabled.

The hosted dashboard is also available at <https://temporary-quick-boron-fefsc1w.vercel.app>. It uses the same Open Brain access key and the same hard-delete safeguards.

The dashboard stores the access key only in an encrypted, HTTP-only session cookie; the browser never stores it in local storage.

## Recommended daily rhythm

1. Capture first; organize later. Send a complete thought, decision, task, lesson, or reference through the enhanced Open Brain connector.
2. Add enough context to make the entry useful six months later: why it matters, source, project, people, and the next action when one exists.
3. Search before starting substantial work. Use semantic search for concepts and text search for exact names, phrases, or identifiers.
4. Use the dashboard for browsing, editing, connections, reflections, task status, quality review, and read-only duplicate review.
5. Archive completed or stale workflow items. Prefer superseding an incorrect thought with a corrected thought and a link between them instead of deleting history.

## Weekly review

- Review the Kanban board: promote actionable tasks, finish or archive stale items, and keep importance scores meaningful.
- Inspect low-quality thoughts in Audit and enrich the useful ones rather than deleting them.
- Review duplicate candidates. Hard deletion remains intentionally unavailable until the backup, audit trail, and supersession workflow have proven reliable over time.
- Search for the week's active projects and write one synthesis or decision note that connects the most useful material.

## Safety and recovery

- Do not put the access key in URLs or command-line arguments.
- Every capture, update, and delete is recorded transactionally in `public.thought_audit`.
- Local launcher logs are under `%LOCALAPPDATA%\OpenBrainDashboard`.
- Run `scripts\Stop-Open-Brain-Dashboard.ps1` from the local Open Brain project to stop the local dashboard.
- Keep `ALLOW_HARD_DELETE` and `NEXT_PUBLIC_ALLOW_HARD_DELETE` unset or `false` unless a separately reviewed deletion policy is approved.
- The pre-replacement Hermes plugin is preserved locally under `%LOCALAPPDATA%\hermes\plugins\_backups` for rollback.

## Dashboard deployment

The Vercel project is `cfkleins-projects/open-brain-dashboard`. Deploy from `dashboards/open-brain-dashboard-next`, not the repository root:

```powershell
Set-Location "dashboards\open-brain-dashboard-next"
npx vercel --prod --yes
```

Next.js standalone output is disabled only on Vercel builds because Next.js 16.3 standalone packaging is currently incompatible with Vercel's build adapter. Local builds retain standalone output for the desktop launcher.
