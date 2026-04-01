# 06 — Email Import (Outlook)

Import your Outlook email correspondence into the Superbrain, filtered to contacts in your CRM. Each email becomes a searchable thought, and each is logged as a CRM interaction.

---

## Prerequisites

- CRM contacts populated with email addresses (see [04 — CRM Setup](04-crm-setup.md))
- Microsoft Azure AD app registration
- Deno installed

---

## Step 1: Register an Azure AD App

1. Go to [portal.azure.com](https://portal.azure.com) > **Azure Active Directory** > **App registrations** > **New registration**
2. Name: `Amicus Outlook Import`
3. Supported account types: pick based on your account
4. Redirect URI: leave blank
5. Click **Register**

### Add Mail.Read Permission

1. **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**
2. Search `Mail.Read` and add it
3. For work/school accounts: click **Grant admin consent**

### Enable Public Client Flows

1. **Authentication** > **Advanced settings**
2. Set **Allow public client flows** to **Yes**
3. Click **Save**

Copy the **Application (Client) ID** and **Tenant ID** from the Overview page to your credential tracker.

---

## Step 2: Configure Environment

```bash
cd recipes/outlook-email-import
cp .env.example .env
```

Edit `.env` with your values:

```
SUPABASE_URL=https://YOUR_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=sk-or-v1-your-key
MICROSOFT_CLIENT_ID=your-azure-client-id
MICROSOFT_TENANT_ID=your-tenant-id-or-common
DEFAULT_USER_ID=your-crm-user-uuid
```

Load them:

```bash
source <(grep -v '^#' .env | grep '=' | sed 's/^/export /')
```

---

## Step 3: Authenticate

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --dry-run --limit=5
```

This triggers the device code flow:
1. A URL and code are printed
2. Open the URL in your browser
3. Enter the code and sign in
4. Token is cached in `token.json`

---

## Step 4: Dry Run

Preview which emails match your CRM contacts:

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts \
  --crm-only --dry-run --window=90d --folders=Inbox,SentItems --limit=100
```

This shows:
- Which emails match CRM contacts
- How many would be imported vs skipped (noise/no CRM match)
- Zero data is written

---

## Step 5: Import

Run without `--dry-run` to import for real:

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts \
  --crm-only --window=6m --folders=Inbox,SentItems --limit=5000
```

Each imported email:
- Creates a **thought** with embedding (searchable via `search_thoughts`)
- Logs a **CRM interaction** (type: `email`) against the matched contact
- Updates `last_contacted` on the contact
- Is tracked in `sync-log.json` to prevent duplicate imports on re-run

---

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `90d`, `6m`, `1y`, `all` |
| `--folders=` | `SentItems` | Comma-separated: `Inbox`, `SentItems`, `Drafts`, etc. |
| `--importance=` | _(all)_ | Filter: `high`, `normal`, `low` |
| `--crm-only` | off | Only import emails from/to CRM contacts |
| `--limit=` | `50` | Max emails to process |
| `--dry-run` | off | Preview without importing |
| `--list-folders` | off | List all Outlook folders |

---

## Ongoing Use

Run periodically to import new correspondence:

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts \
  --crm-only --window=7d --folders=Inbox,SentItems --limit=500
```

The sync log ensures no duplicates. Content fingerprints provide a second layer of dedup at the database level.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Device code flow fails | Enable "Allow public client flows" in Azure AD app |
| 403 from Graph API | Grant admin consent for Mail.Read permission |
| MailboxNotEnabledForRESTAPI | Account doesn't have Exchange Online — check you can access outlook.office.com |
| Token refresh fails | Delete `token.json` and re-authenticate |
| Duplicate emails | Normal — sync log and content fingerprints prevent actual duplicates |

---

Next: [07 — Document Management](07-document-management.md)
