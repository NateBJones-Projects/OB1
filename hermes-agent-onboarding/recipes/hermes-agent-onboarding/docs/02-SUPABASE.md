# Supabase Setup

This guide covers creating your Supabase project and applying the required database migrations for the onboarding meta-skill.

## Creating a Project

1. Go to [supabase.com](https://supabase.com/) → **Start your project**
2. Give it a name (e.g., "hermes-onboarding")
3. Set a secure database password (save it!)
4. Choose a region close to you
5. Click **Create new project**
6. Wait ~2 minutes for the database to provision

## Getting Your Credentials

Once the project is ready:

1. Go to **Project Settings** (gear icon) → **API**
2. Under **Project URL**, copy the URL (format: `https://xxxxx.supabase.co`)
3. Under **Project API keys**, copy the **service_role key** (NOT anon)
   - The service_role key starts with `eyJhbGciOi...` and has full access
   - **Never share this key** or commit it to version control

## Installing Supabase CLI

```bash
# Using npm (recommended)
npm install -g supabase

# Using Homebrew (macOS)
brew install supabase/tap/supabase

# Using apt (Linux)
# Download from: https://github.com/supabase/cli/releases
```

Verify:
```bash
supabase --version
# Should print: 2.x.x
```

## Linking to Your Project

```bash
# Login to Supabase
supabase login

# You'll be asked to create a Personal Access Token (PAT)
# Go to: https://supabase.com/dashboard/account/tokens
# Create a token and paste it when prompted

# Link your local environment to your project
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is the part of your URL before `.supabase.co`:
```
URL:  https://abcdefghijklm.supabase.co
REF:  abcdefghijklm
```

## Applying Migrations

From the `hermes-agent-onboarding` repo directory:

```bash
cd hermes-agent-onboarding
supabase db push --linked
```

This runs all migrations in `migrations/`, creating the 6 base tables:

- `user_profiles` — identity, family, routines
- `user_preferences` — tone, autonomy, finance tracking
- `user_mbti` — 4 dimensions, type, traits
- `user_style` — communication style
- `user_relations` — key people
- `user_beliefs` — values and principles

## Verifying Tables

```bash
# List tables in public schema
supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'user_%'"

# Check RLS is active
supabase db query --linked "SELECT tablename, rowsecurity FROM pg_catalog.pg_tables WHERE tablename LIKE 'user_%'"
```

Expected output: 6 tables, all with `rowsecurity = true`.

## Security Model

All onboarding tables use Row-Level Security (RLS) with the following model:

- **service_role key**: Full access (SELECT, INSERT, UPDATE, DELETE)
- **anon key**: No access (blocked by RLS policy)
- **authenticated users**: No access (blocked by RLS policy)

The policy checks the JWT claim:
```sql
(auth.jwt() ->> 'role') = 'service_role'
```

This ensures only the Hermes Agent (using service_role key) can read or write user data.

## Next Steps

Proceed to [Running the Onboarding](03-RUNNING.md).
