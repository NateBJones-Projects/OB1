# Journals/Blogger Import

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Import blog posts from Google Blogger Atom XML exports into Open Brain.

## What It Does

Parses Google Blogger's Atom XML export format and imports blog posts and comments as thoughts with embeddings. Works with any standard Atom feed export. Blog posts are stored as `type: journal` thoughts.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The **content-fingerprint-dedup** primitive installed (provides the `upsert_thought` RPC function used for deduplication)
- **Blogger export files** — `.atom` files from Google Blogger
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
JOURNALS/BLOGGER IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Export your blog data:**
   - Go to your Blogger Dashboard → Settings → Manage Blog → Back up content
   - Download the `.atom` file
   - If you have multiple blogs, export each one

2. **Place all `.atom` files in a folder:**
   ```
   blogger-exports/
   ├── my-tech-blog.atom
   ├── personal-journal.atom
   └── travel-blog.atom
   ```

3. **Copy this recipe folder** and install dependencies:
   ```bash
   cd journals-blogger-import
   npm install
   ```

4. **Create `.env`** with your credentials (see `.env.example`):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENROUTER_API_KEY=sk-or-v1-your-key
   ```

5. **Preview what will be imported** (dry run):
   ```bash
   node import-blogger.mjs /path/to/blogger-exports --dry-run
   ```

6. **Run the import:**
   ```bash
   node import-blogger.mjs /path/to/blogger-exports
   ```

## Expected Outcome

After running the import:
- Each blog post becomes a thought with `type: journal` and `source_type: blogger_import`
- Post titles and publication dates are preserved
- HTML content is stripped to plain text (line breaks preserved)
- Blog comments are imported separately
- Settings and template entries are automatically filtered out

**Scale reference:** Tested with 3,000+ blog posts across multiple blogs imported successfully.

## Troubleshooting

**Issue: No entries found in .atom file**
The parser looks for `<entry>` tags with `kind#post` or `kind#comment` categories. Blogger settings and template entries are filtered out. If your Atom file uses a different schema, check the XML structure.

**Issue: HTML tags appearing in imported text**
The HTML stripper handles common tags and entities. If you see raw HTML in your thoughts, the post may use unusual HTML structures. The content is still searchable.

**Issue: Wrong dates on posts**
The parser uses the `<published>` tag from the Atom feed. If dates look wrong, check the timezone in your Blogger export settings.
