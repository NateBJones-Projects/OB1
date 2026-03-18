# Home Maintenance Dashboard

## What It Does

A dark-mode personal dashboard for your Home Maintenance Tracker extension. Glanceable view of overdue alerts, upcoming tasks, and recent maintenance activity — designed to be checked daily or weekly.

## Prerequisites

- Working Open Brain setup with Extension 2 (Home Maintenance Tracker) deployed
- Supabase project with `maintenance_tasks` and `maintenance_logs` tables
- Node.js 18+
- Vercel account (for deployment) or run locally

## Credential Tracker

```text
HOME MAINTENANCE DASHBOARD -- CREDENTIAL TRACKER
--------------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Anon key:              ____________

HOSTING
  Deploy URL:            ____________

--------------------------------------------------
```

## Steps

### 1. Clone and Install

```bash
cd dashboards/home-maintenance
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Deploy to Vercel

Push to a Git repository, then import into Vercel:

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your repository
3. Set the **Root Directory** to `dashboards/home-maintenance`
4. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Deploy

## Expected Outcome

After setup, you should see:

- **Overdue banner** (red) at the top if any tasks are past due
- **Upcoming tasks** grouped by "This Week" and "This Month" with category-colored left borders and priority indicators
- **Recent activity** table showing the last 10 maintenance logs with task name, who performed it, cost, and notes

## Troubleshooting

**Dashboard shows "Failed to load data"**
- Verify your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct in `.env.local`
- Check that RLS policies are in place on `maintenance_tasks` and `maintenance_logs`

**No tasks or logs appear**
- Make sure you have data in the database (use the MCP tools via Claude to add tasks first)
- Confirm you are authenticated — the anon key with RLS requires a logged-in user session

**Styles look broken**
- Run `npm install` to ensure all dependencies are installed
- Check that `tailwind.config.ts` and `postcss.config.js` are present
