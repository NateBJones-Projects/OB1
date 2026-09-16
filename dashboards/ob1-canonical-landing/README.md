# Open Brain Canonical Landing Page

![Community Contribution](https://img.shields.io/badge/Community-Contribution-orange)
![Difficulty: Beginner](https://img.shields.io/badge/Difficulty-Beginner-green)
![Time: 10 minutes](https://img.shields.io/badge/Setup-10%20minutes-blue)

A cite-able single-page canonical landing for Open Brain, designed for hosting at `openbrain.fyi` via GitHub Pages. Includes full SEO meta, JSON-LD structured data (`TechArticle` + `DefinedTerm`), bundled OB1 brand assets (square logo, wide hero banner, social share image, favicons), WCAG 2.1 AA accessibility, and all crawler companion files (`sitemap.xml`, `robots.txt`, `llms.txt`, `site.webmanifest`, `404.html`).

This is a static HTML contribution — no build step, no dependencies, no framework. The maintainer can adopt it as the project's official landing page by adding one GitHub Actions workflow and flipping the Pages switch.

## Prerequisites

- Maintainer access to the `NateBJones-Projects/OB1` repository (to configure GitHub Pages and DNS)
- A registered `openbrain.fyi` domain with access to DNS settings
- No Open Brain setup required to deploy this page

## Setup

### Step 1 — Merge this PR

Merge the contribution branch. All landing page files — including the OG image, favicons, and brand assets — will land in `dashboards/ob1-canonical-landing/`. The page is fully self-contained.

### Step 2 — Add the deploy workflow

Create `.github/workflows/deploy-pages.yml` with the following content. This workflow deploys the `dashboards/ob1-canonical-landing/` folder to GitHub Pages whenever `main` is updated.

```yaml
name: Deploy landing page

on:
  push:
    branches: [main]
    paths:
      - 'dashboards/ob1-canonical-landing/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dashboards/ob1-canonical-landing/
      - uses: actions/deploy-pages@v4
        id: deployment
```

### Step 3 — Verify DNS

DNS for `openbrain.fyi` is already pointing at this org's GitHub Pages — the records below are documented here for reference and for future changes (registrar moves, additional subdomains, etc.).

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | `185.199.108.153` | Automatic |
| A | @ | `185.199.109.153` | Automatic |
| A | @ | `185.199.110.153` | Automatic |
| A | @ | `185.199.111.153` | Automatic |
| CNAME | www | `natebjones-projects.github.io.` | Automatic |

Verify resolution:

```bash
dig @8.8.8.8 +short openbrain.fyi A
dig @8.8.8.8 +short www.openbrain.fyi CNAME
```

Expect the four GitHub IPs and `natebjones-projects.github.io.` respectively.

### Step 4 — Enable GitHub Pages with the custom domain

1. Go to **Settings → Pages**
2. Under **Build and deployment → Source**, select **GitHub Actions**
3. Under **Custom domain**, enter `openbrain.fyi` and click **Save**
   - GitHub runs a DNS check; with Step 3 verified, it shows a green check
   - This also validates the `CNAME` file already in the repo (`dashboards/ob1-canonical-landing/CNAME`)
4. Wait 5–30 minutes for **Enforce HTTPS** to become available, then check the box
   - Behind the scenes GitHub provisions a Let's Encrypt certificate; the box stays greyed out until issuance succeeds
5. Trigger the deploy by either pushing any change to a path under `dashboards/ob1-canonical-landing/` or running the workflow manually via **Actions → Deploy landing page → Run workflow**

The site is live once the workflow's `deploy` job succeeds and the cert is issued. Both `https://openbrain.fyi/` and `https://www.openbrain.fyi/` resolve, with `www` redirecting to apex.

#### Optional: org-level domain verification

If `NateBJones-Projects` has [verified domains](https://docs.github.com/en/organizations/managing-organization-settings/verifying-or-approving-a-domain-for-your-organization) enforcement enabled, add the TXT record GitHub provides under **Org Settings → Pages → Add a domain** before Step 4. This prevents domain takeover if Pages is ever disabled. Skip if your org doesn't enforce this.

## Expected outcome

After completing setup:

- `https://openbrain.fyi/` serves the landing page with HTTPS
- `http://openbrain.fyi/` redirects to HTTPS (GitHub Pages handles this)
- `https://openbrain.fyi/sitemap.xml`, `/robots.txt`, `/llms.txt` all return `200`
- `https://openbrain.fyi/404` returns the branded 404 page
- The page passes WCAG 2.1 AA (verified with axe-core during contribution review)
- JSON-LD structured data passes Google's Rich Results Test

Verify the deploy with:

```bash
curl -sI https://openbrain.fyi/ | grep -iE "^(HTTP|server|content-type)"
dig @8.8.8.8 +short openbrain.fyi A
```

Expected: `HTTP/2 200`, `server: GitHub.com`, four IPs in the `185.199.108-111.153` range.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Canonical landing page |
| `MAINTENANCE.md` | Post-merge guide for editing copy, swapping assets, validating, and verifying deploys |
| `404.html` | Branded 404 with `noindex` and return-home link |
| `CNAME` | Custom domain declaration for GitHub Pages |
| `sitemap.xml` | Single-URL sitemap for crawler discoverability |
| `robots.txt` | Allow all crawlers, point to sitemap |
| `llms.txt` | LLM-readable project summary following the llms.txt convention |
| `site.webmanifest` | Web app manifest for Android home-screen affordance |
| `imgs/ob1-logo.png` | Square OB1 brand logo (512×512), used in nav |
| `imgs/ob1-logo-wide.png` | Wide OB1 banner (1200×360), used as hero image |
| `imgs/og.png` | Social share image (1200×630), wide logo on brand-navy bg |
| `imgs/favicon-32.png` | 32×32 favicon |
| `imgs/apple-touch-icon.png` | 180×180 iOS home-screen icon |

## Troubleshooting

**Pages shows "Your site is ready" but `openbrain.fyi` doesn't resolve.**
DNS propagation can take up to 48 hours, though it usually completes within an hour. Run `dig @8.8.8.8 +short openbrain.fyi A` to check current resolution. If it returns GitHub IPs but HTTPS isn't working, wait a few more minutes for GitHub's certificate provisioning.

**"The custom domain openbrain.fyi is already taken" error.**
This means another host or a previous GitHub configuration holds a claim on the domain. Check your domain registrar's hosting panel and release any existing site attachment. If the issue persists, see [GitHub's custom domain troubleshooting docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages).

**Workflow fails with permissions error.**
Ensure the repository has **Pages write** permission enabled for Actions. In Settings → Actions → General, set "Workflow permissions" to "Read and write permissions".
