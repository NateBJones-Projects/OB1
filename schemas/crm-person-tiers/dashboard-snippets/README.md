# Dashboard Snippet — CRM Tier List

Optional Next.js App Router page that renders the output of the
`crm_person_tiers` RPC shipped with this schema. Drop it into an
existing Open Brain dashboard to get a people view with tier badges
and mention counts without building your own UI.

## Prerequisites

- This schema (`schemas/crm-person-tiers/schema.sql`) is already applied to your Supabase database
- A Next.js 13+ App Router dashboard (the `dashboards/open-brain-dashboard-next` template works)
- A Supabase **server-side** client helper in your dashboard — `page.tsx` imports from `@/lib/supabase/server` and expects a `getSupabaseServerClient()` function. Use your `service_role` key (or an authenticated session) server-side; the RPC is not granted to `anon` on purpose. See the **Security** section in `../README.md` for why.

## How to install

1. Copy `page.tsx` into your dashboard at `app/crm/page.tsx` (or any route you prefer)
2. Open `page.tsx` and update the import path for `getSupabaseServerClient` so it points at your dashboard's Supabase helper
3. Start (or restart) your dashboard. The new page is available at `/crm`

## What it shows

- Per-tier summary strip with counts (`connected`, `contact`, `known`, `unknown`)
- Paginated list of persons (loads up to 400 rows by default) with name, tier badge, last-seen, first-seen, aliases, and mention count
- Tiers reflect the `effective_tier` column from the RPC, which promotes high-activity recent contacts to `connected`

## What's intentionally not included

- A contact detail view. Add one at `app/crm/[id]/page.tsx` that queries `crm_persons` and `crm_person_mentions` directly for the person's linked thoughts
- Write operations (creating or editing persons). The RPC and this page are read-only
- Client-side search. The RPC exposes a `p_search` parameter you can wire to a query-string search box

## Troubleshooting

**"crm_person_tiers RPC failed"**
Run `schemas/crm-person-tiers/schema.sql` in your Supabase SQL editor, then run `NOTIFY pgrst, 'reload schema';` so PostgREST picks up the new RPC.

**"Cannot find module '@/lib/supabase/server'"**
Update the import at the top of `page.tsx` to match your dashboard's Supabase client helper.

**"All rows show `unknown` tier"**
Stored `relationship_tier` defaults to `unknown` on new rows. Update `crm_persons.relationship_tier` manually or via an import script when you add a person you already know.
