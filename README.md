# The Veil — TheVeil.media

Weekly UAP news intelligence. Every story scored 0–100 for credibility, with an editorial "So What" layer.

## How it works

- **`index.html`** — a single static page (no build step). On load it fetches the current week's stories from Supabase via the public **anon** key and renders the lead story, the tile grid, category filters, and per-story modals (summary, "So What," and the credibility-score rationale).
- **Data** lives in Supabase (`public.articles`). Row-Level Security exposes only a public read policy, so the anon key in this page is safe to ship.
- **Pipeline** (Make.com, weekly): GNews ingests UAP news → Claude (`claude-opus-4-8`) scores each story and writes the editorial layer → rows land in `articles`. A second scenario calls `get_newsletter_html()` and sends the issue via Brevo.

## Deploy (Cloudflare Pages)

Static site, no build:

- **Framework preset:** None
- **Build command:** *(empty)*
- **Build output directory:** `/` (repo root)

Connect this repo in Cloudflare Pages → Create project → Connect to Git, then add the `theveil.media` custom domain.

## Stack

Supabase · Make.com · Brevo · GNews · Anthropic Claude · Cloudflare Pages
