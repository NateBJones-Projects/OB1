# Maintaining openbrain.fyi

This guide is for the OB1 maintainer and any future contributors who need to update the canonical landing page after it goes live. The page is intentionally a single static `index.html` with no build step — every change is a normal git edit, and every deploy is a single push.

## Edit-and-deploy loop

1. Edit any file under `dashboards/ob1-canonical-landing/`
2. Open a PR (or push to `main` if you have direct write access)
3. The `Deploy landing page` workflow fires on the path filter and pushes the artifact to Pages
4. The `https://openbrain.fyi/` cache refreshes within 1–2 minutes of the deploy job finishing

Watch progress at **Actions → Deploy landing page**. The job's environment URL links to the live site once it's published.

## Common edits

### Update copy, headlines, or links

All visible text lives directly in `index.html`. The major sections are marked with HTML `id`s for navigation:

| `id` | Section |
|------|---------|
| `main-content` | Skip-link target, wraps everything below the nav |
| (hero, no id) | The first `<section class="hero">` — h1, byline, CTA buttons, demo video |
| `how-it-works` | Three-pillar overview |
| `get-started` | Numbered steps + AI-assistant cards + companion prompts |
| `extensions` | Extensions table |
| `community` | Recipes + tools + skills tables, dashboards/integrations pillars |

After any copy change, update `dateModified` in three places so search engines and citations stay in sync:

| File | Field |
|------|-------|
| `index.html` | `<meta property="article:modified_time" content="...">` |
| `index.html` | JSON-LD `TechArticle` → `"dateModified"` |
| `index.html` | Byline `<time datetime="...">Updated ...</time>` |
| `sitemap.xml` | `<lastmod>` |
| `metadata.json` | `"updated"` |

All five should be the same ISO date (`YYYY-MM-DD`).

### Add or swap a video

Videos use GitHub user-attachment URLs (the same URLs that render in the project README). To add a new video:

1. Drag the `.mp4` into a GitHub issue or PR comment to upload it; copy the `https://github.com/user-attachments/assets/...` URL
2. Embed using the existing pattern:

```html
<video class="inline-video" controls preload="none" playsinline aria-label="Brief description">
  <source src="https://github.com/user-attachments/assets/UUID" type="video/mp4">
  <a href="https://github.com/NateBJones-Projects/OB1" target="_blank" rel="noopener">Watch on GitHub</a>
</video>
```

Always set a meaningful `aria-label` — screen readers announce it. Use `preload="metadata"` only for the hero video; keep all below-fold videos at `preload="none"` to protect first-paint performance.

If a GitHub user-attachment URL ever goes 404, replace with a re-uploaded asset; do not host video binaries in the repo (gate rule blocks files >1MB).

### Replace or update the logo

The page ships three brand-image variants generated from a single source:

| File | Use | Source |
|------|-----|--------|
| `imgs/ob1-logo.png` (512×512) | Nav + manifest icon | Square master |
| `imgs/ob1-logo-wide.png` (1200×360) | Hero banner | Wide master |
| `imgs/og.png` (1200×630) | Social share | Wide on `#0f1b33` background |
| `imgs/apple-touch-icon.png` (180×180) | iOS home screen | Square master |
| `imgs/favicon-32.png` (32×32) | Browser tab | Square master |

To regenerate from new master images, drop the new sources at `imgs/_master-square.png` and `imgs/_master-wide.png`, then run:

```bash
cd dashboards/ob1-canonical-landing/imgs
magick _master-square.png -resize 512x512 -strip ob1-logo.png
magick _master-square.png -resize 180x180 -strip apple-touch-icon.png
magick _master-square.png -resize 32x32  -strip favicon-32.png
magick _master-wide.png   -resize 1200x  -strip ob1-logo-wide.png
magick _master-wide.png   -resize 1000x -background "#0f1b33" -gravity center -extent 1200x630 og.png
rm _master-square.png _master-wide.png
```

Requires ImageMagick 7+ (`brew install imagemagick`). The `-strip` flag removes EXIF/color-profile metadata that bloats files and leaks build-environment info.

If the logo's color palette changes, update the four CSS custom properties in the `:root` block of `index.html`:

```css
--accent: #e05a20;          /* primary accent (OB1 orange) */
--brand-blue-deep: #0f1b33; /* used in hero gradient + OG bg */
--brand-blue-mid: #1a3a6e;
--brand-blue-bright: #2563b8;
```

### Add a new content section

Use the existing pattern so styling, spacing, and a11y stay consistent:

```html
<section id="kebab-case-id">
  <div class="container">
    <h2>Section title</h2>
    <p>Lead paragraph.</p>
    <!-- content -->
  </div>
</section>
```

Alternate `<section>` and `<section class="alt">` for visual rhythm. Add a nav link in the sticky `<nav>` block if the section is top-level.

Heading hierarchy must stay clean: one `<h1>` (in the hero), `<h2>` per section, `<h3>` for sub-blocks. Skipping levels breaks screen-reader navigation.

### Update the byline

The page is currently bylined to Nate B. Jones. If authorship changes (or co-authors are added), update **all** of these in lockstep:

- `<meta name="author">`
- `<meta property="article:author">`
- `<meta name="twitter:creator">`
- JSON-LD `TechArticle` → `author`
- The visible `.byline` block in the hero

## Pre-deploy validation

Run these locally before pushing significant changes. None of them are part of the deploy workflow yet — they're discretionary checks that catch most regressions.

### Structured data

```bash
# Extract JSON-LD blocks and parse them
python3 -c "
import re, json
html = open('dashboards/ob1-canonical-landing/index.html').read()
for i, m in enumerate(re.finditer(r'<script type=\"application/ld\\+json\">(.+?)</script>', html, re.DOTALL)):
    try:
        json.loads(m.group(1)); print(f'block {i+1}: ok')
    except Exception as e:
        print(f'block {i+1}: FAIL — {e}')
"
```

Then paste a deployed URL into [Google's Rich Results Test](https://search.google.com/test/rich-results) and the [Schema.org Validator](https://validator.schema.org/) once or twice a year, or after any JSON-LD edit.

### Accessibility

The page targets WCAG 2.1 AA. Run [axe DevTools](https://www.deque.com/axe/devtools/) in Chrome or [Pa11y](https://pa11y.org/) locally:

```bash
npx pa11y --standard WCAG2AA https://openbrain.fyi/
```

Common things that break it: text on the orange accent (use `var(--bg)` not `var(--text)` for contrast); missing `alt` on new images; nested interactive elements (a button inside an anchor, or vice versa).

### Link health

```bash
# Quick check — should return zero broken external links
grep -oE 'href="https?://[^"]+"' dashboards/ob1-canonical-landing/index.html \
  | sort -u \
  | sed 's/href="//;s/"$//' \
  | xargs -P 8 -I{} curl -sLo /dev/null -w "%{http_code} {}\n" {} \
  | grep -v "^200"
```

### Size budget

The page should stay under 60KB HTML and 200KB total assets. Check:

```bash
du -sh dashboards/ob1-canonical-landing/index.html dashboards/ob1-canonical-landing/imgs/
```

If either grows substantially, audit before merging. Optimize new images with `magick INPUT -strip -quality 85 OUTPUT` before committing.

## Post-deploy verification

After every meaningful edit, spot-check production:

```bash
# Page resolves with HTTPS, served by GitHub
curl -sI https://openbrain.fyi/ | grep -iE "^(HTTP|server|content-type|x-github)"

# Crawler files all return 200
for path in / /sitemap.xml /robots.txt /llms.txt /site.webmanifest; do
  printf "%-25s %s\n" "$path" "$(curl -s -o /dev/null -w "%{http_code}" https://openbrain.fyi$path)"
done

# 404 page works (note: GitHub Pages serves /404 for any unknown path)
curl -s -o /dev/null -w "%{http_code}\n" https://openbrain.fyi/this-does-not-exist
# Expected: 404
```

If anything looks off, check **Actions → Deploy landing page** for the most recent run's logs and the deploy environment URL.

## Cert renewal and DNS health

Let's Encrypt certs auto-renew via GitHub Pages — no maintainer action needed. If "Enforce HTTPS" ever becomes unchecked unexpectedly, it usually means DNS was edited and broke verification. Re-run:

```bash
dig @8.8.8.8 +short openbrain.fyi A
dig @8.8.8.8 +short www.openbrain.fyi CNAME
```

If the four `185.199.108–111.153` IPs and `natebjones-projects.github.io.` aren't all returned, restore the registrar's DNS to match the table in `README.md` Step 3.

## Decommissioning

If `openbrain.fyi` is ever retired:

1. **Settings → Pages → Custom domain**: clear the field and save
2. Disable the workflow file (rename to `.disabled` or delete)
3. At the registrar, remove the four A records and the www CNAME
4. Optionally delete `dashboards/ob1-canonical-landing/CNAME` to prevent the next maintainer from re-binding the domain by accident

The page itself can stay in the repo as a reference template even when not served live.

## Files at a glance

See the **Files** table in `README.md` for the canonical list. Every file in this folder is purposeful — there are no leftover scaffolding files or stubs.

## Questions or issues

Open an issue in the OB1 repo with the label `landing-page`.
