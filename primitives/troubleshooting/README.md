# Common Troubleshooting

Solutions for issues that come up across any Open Brain extension. If your problem is specific to one extension (e.g., a particular table or tool), check that extension's README instead.

## Connection Issues

**"Cannot connect to Supabase"**
- Verify your Supabase project is active (check the dashboard — paused projects need to be restored)
- If using Edge Functions, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — no manual setup needed
- Check your Supabase project region matches your expectations
- Ensure Row Level Security (RLS) policies are configured correctly (service role bypasses RLS, but policies must exist for RLS-enabled tables)

**"Getting 401 Unauthorized"**
- The access key doesn't match what's stored in Supabase secrets
- Double-check that the `?key=` value in your Connection URL matches your MCP Access Key exactly
- If using header-based auth (Claude Code), the core Open Brain server expects `x-brain-key` while extension servers expect `x-access-key` — prefer using the `?key=` query parameter to avoid confusion
- Do not use `mcp-remote` with `--header` for Cursor — use Cursor's native `url` field instead (see [Remote MCP Connection](../remote-mcp/))
- Verify the secret is set: `supabase secrets list` should show `MCP_ACCESS_KEY`
- Try regenerating the key: `openssl rand -hex 32`, then `supabase secrets set MCP_ACCESS_KEY=new-key` and update your Connection URL

**"Tools don't appear in Claude Desktop"**
- Verify the connector is enabled for your conversation — click the "+" button at the bottom of the chat → Connectors → check the toggle
- Check that the MCP Connection URL is correct and includes `?key=your-access-key`
- Try removing and re-adding the connector in Settings → Connectors
- Start a new conversation after adding the connector
- Restart Claude Desktop after making changes

**"ChatGPT doesn't use the tools"**
- Confirm Developer Mode is enabled (Settings → Apps & Connectors → Advanced settings)
- Check that the connector is active for your current conversation in the tools/apps panel
- Be explicit: "Use the [tool_name] tool to [do thing]." ChatGPT often needs direct tool references the first few times before it picks up the habit.

## Deployment Issues

**Edge Function won't deploy**
- Verify the Supabase CLI is installed and linked: `supabase --version`
- Check that you're linked to the right project: `supabase link --project-ref YOUR_PROJECT_REF`
- Verify the function directory exists: `ls supabase/functions/your-function-name/`
- Make sure `deno.json` is in the function directory (not the project root)
- Run `supabase functions deploy your-function --no-verify-jwt` (the `--no-verify-jwt` flag is required for MCP)

**"Invalid JWT" or JWT verification errors**
- Make sure you deployed with `--no-verify-jwt` flag: `supabase functions deploy your-function --no-verify-jwt`
- The MCP server handles its own authentication via the access key — JWT verification should be disabled

**Deploy succeeds but function returns errors**
- Check Edge Function logs: Supabase Dashboard → Edge Functions → your function → Logs
- Look for import errors (usually means `deno.json` is missing or has wrong paths)
- Verify secrets are set: `supabase secrets list`
- Check function logs from terminal: `supabase functions logs your-function-name`

## Database Issues

**"relation 'table_name' does not exist"**
- The extension's `schema.sql` wasn't run successfully
- Go to your Supabase SQL Editor and re-run the SQL
- Check for errors in the SQL output — common issues include missing the pgvector extension or running statements out of order

**"permission denied" or RLS errors**
- The service role key bypasses Row Level Security, so this usually means a configuration issue
- Verify the `SUPABASE_SERVICE_ROLE_KEY` is correct (not the publishable/anon key)
- For extensions using RLS (Extensions 4-6), verify the RLS policies were created by the schema.sql
- Check that `user_id` values are valid UUIDs
- Ensure all RLS-enabled tables have policies created correctly

**"Foreign key violation" errors**
- Parent records must exist before creating child records (e.g., create a company before adding a job posting)
- Verify the referenced ID exists and belongs to the same `user_id`
- Check that you're using the correct UUID — copy-paste rather than typing
- Ensure foreign key constraints are not blocking inserts

## Performance Issues

**Tools work but responses are slow**
- First request on a cold Edge Function takes a few seconds to warm up — this is normal
- Subsequent calls within the same session are faster
- Check your Supabase project region — pick the one closest to you
- If consistently slow, check the Edge Function logs for query performance issues

**Search returns no results**
- Make sure you've added data first (the extension starts empty)
- Try broader search terms — most search tools use ILIKE which requires partial matches
- Check date ranges and filters — a common issue is filtering by a date range that doesn't include your data
- For semantic search, try asking the AI to "search with threshold 0.3" for a wider net

## Data Issues

**"Date parsing errors"**
- Ensure dates are in ISO 8601 format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`
- The MCP server expects date strings, which PostgreSQL will parse
- For "N days from now" calculations, let the tool compute the date

**"Auto-calculated fields not updating"**
- Verify that the database trigger exists (check the schema.sql was run completely)
- Check that the tool completed successfully (look at Edge Function logs)
- For date calculations, ensure the frequency/interval field has a value set
- For one-time tasks (null frequency), auto-calculated fields may remain null by design

## Getting More Help

- **Supabase AI assistant**: Look for the chat icon in the bottom-right corner of your Supabase dashboard. It has access to all Supabase documentation and can help with database, Edge Function, and SQL issues.
- **OB1 Discord**: Join the [Open Brain Discord](https://discord.gg/Cgh9WJEkeG) — there's a `#help` channel for troubleshooting.

## Extensions That Use This

All extensions reference this guide for common issues:

- [Household Knowledge Base](../../extensions/household-knowledge/) (Extension 1)
- [Home Maintenance Tracker](../../extensions/home-maintenance/) (Extension 2)
- [Family Calendar](../../extensions/family-calendar/) (Extension 3)
- [Meal Planning](../../extensions/meal-planning/) (Extension 4)
- [Professional CRM](../../extensions/professional-crm/) (Extension 5)
- [Job Hunt Pipeline](../../extensions/job-hunt/) (Extension 6)
