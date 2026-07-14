# BoekBrug Blog / Kennisbank — Developer Guide

Everything a developer needs to maintain and extend the blog at `/blog` (NL) and
`/en/blog` (EN), and the tool↔blog cross-links. Companion to the editorial plan
in `docs/kennisbank-content-strategie.md`.

> TL;DR: articles are Markdown files with YAML frontmatter under `content/blog/`.
> They are statically generated (SSG). To add an article you only write a
> `.mdx` file — no code. The tool pages link back to the blog via one small
> presentational component (`KennisbankLinks`) — **links only, no tool logic**.

---

## 1. Architecture at a glance

- **Storage:** Markdown files, no database. `content/blog/nl/*.mdx` (Dutch,
  default locale, no URL prefix) and `content/blog/en/*.mdx` (English, `/en/`).
- **Rendering:** statically generated at build time via `generateStaticParams`
  with `dynamicParams = false` (drafts and unknown slugs 404).
- **Markdown:** `gray-matter` (frontmatter) + `react-markdown` + `remark-gfm`
  (tables) + `rehype-slug` (heading anchors). No MDX/JSX inside articles.
- **Design:** reuses the site design system (`PublicHeader`/`PublicFooter`,
  `#007aff`, 720px content column).

### File map
```
content/blog/{nl,en}/<slug>.mdx     the articles (the only thing you edit to publish)
public/blog/*.png                   cover / OG images (real product screenshots)
src/lib/blog.ts                     read/parse, list, drafts, clusters, alternates
src/lib/blog-seo.ts                 per-article Metadata + JSON-LD (BlogPosting + Breadcrumb)
src/components/blog/
  ArticleCard.tsx                   index list card
  ArticleLayout.tsx                 article page (breadcrumb, meta, cover, body, CTA, siblings)
  BlogIndex.tsx                     the /blog and /en/blog index body
  ToolCTA.tsx                       end-of-article funnel (related tool + /register)
src/app/blog/page.tsx               NL index          (route)
src/app/blog/[slug]/page.tsx        NL article        (route, SSG)
src/app/en/blog/page.tsx            EN index          (route)
src/app/en/blog/[slug]/page.tsx    EN article        (route, SSG)
src/app/sitemap.ts                  includes every published article, both locales
src/components/KennisbankLinks.tsx  tool page → blog cross-links (see §8)
```

---

## 2. Add an article (no code)

1. Create `content/blog/nl/<slug>.mdx` (and, ideally, the EN mirror
   `content/blog/en/<en-slug>.mdx`).
2. Fill the frontmatter (see §3) and write the body in plain Markdown.
3. Put the image referenced by `coverImage` in `public/blog/`.
4. Run `npx next build` — the new URL is prerendered and added to the sitemap.

The **filename is the slug** (the URL). `getPost` trusts the filename, so the
`slug:` field must match the filename.

---

## 3. Frontmatter schema

```yaml
---
title: "..."                 # <h1> + <title> + og:title
description: "..."           # meta description + og/twitter description
slug: "netto-inkomen-zzp-2026"   # MUST equal the filename (without .mdx)
locale: "nl"                # "nl" | "en"
publishedAt: "2026-07-13"   # ISO date, MUST be <= today (future dates hurt indexing)
updatedAt: "2026-07-13"     # optional; defaults to publishedAt
author: "BoekBrug"
keywords: ["...", "..."]
relatedTool: "/factuur-maken"     # ToolCTA primary button target (a real route)
relatedToolLabel: "Maak gratis een factuur"
coverImage: "/blog/factuur-maken.png"   # optional; file must exist in public/blog/
alternateSlug: "free-invoice-maker"      # the SAME article's slug in the other locale (§4)
pillarSlug: "factuur-maken-gids"         # the pillar/guide this article belongs to (§5)
pillarTitle: "Factuur maken: de gids"    # display title for the pillar chip
draft: false                # true = never listed or built
# You may add YAML `#` comments here (e.g. a "verify tax figures" note). They are
# parsed away by gray-matter and NEVER appear on the site. Do NOT use Markdown
# HTML comments <!-- --> in the body — react-markdown renders them as text.
---
```

Only `title, description, slug, locale, publishedAt, author, relatedTool,
relatedToolLabel` are strictly required; the rest are optional.

---

## 4. Bilingual & hreflang (`alternateSlug`)

Each language is its own file. Link the two with `alternateSlug` pointing at the
other locale's slug (both directions). When both exist and are published,
`lib/blog.ts#getAlternate` resolves the pair and:
- `blog-seo.ts` emits `<link rel="alternate" hreflang=...>` for both,
- `ArticleLayout` shows a "Read in English" / "Lees in het Nederlands" switch.

Dutch is primary; write the EN mirror in plain, simple English (many readers are
expats) and explain Dutch terms the first time.

---

## 5. Topic clusters (pillar ↔ supporting)

Hub-and-spoke: a **pillar** article is a broad guide; **supporting** articles
set `pillarSlug`/`pillarTitle` pointing up to it. Then:
- Supporting → pillar: `ArticleLayout` renders an "Onderdeel van de gids" chip
  (from the frontmatter).
- Supporting ↔ siblings: `ArticleLayout` renders a "Lees ook in deze gids" block
  automatically via `lib/blog.ts#getClusterSiblings` (same locale + pillarSlug).
- Pillar → supporting: add normal Markdown links `[..](/blog/<slug>)` in the
  pillar body.

---

## 6. Cover / OG images

`coverImage` (a path under `public/blog/`) is used by `ArticleCard`, the article
hero (`ArticleLayout`, via `next/image`), the `og:image`, and the JSON-LD image.
Current images are **real screenshots of the public product tool pages**
(16:9). If none is set, everything falls back to the site-wide `/opengraph-image`.

To (re)generate product screenshots: run the app locally and screenshot the
public tool pages at 1200×675 into `public/blog/`. The authenticated dashboard
can't be captured from a sandbox (needs a real Supabase login).

---

## 7. SEO plumbing (already wired — don't duplicate)

- **Metadata** (`generateMetadata` → `blog-seo.ts#buildArticleMetadata`): title,
  description, keywords, canonical, hreflang, Open Graph `article`, Twitter card.
- **JSON-LD** (`buildArticleJsonLd`): a `@graph` of `BlogPosting` + `BreadcrumbList`.
- **Sitemap** (`src/app/sitemap.ts`): auto-includes every published article in
  both locales — nothing to do per article.
- **robots** (`src/app/robots.ts`): allows `/`, so `/blog` + `/en/blog` are
  crawlable.
- **Middleware** (`src/middleware.ts`): `/blog` and `/en/blog` are in
  `PUBLIC_PATHS` so logged-out users and crawlers can reach them. If you add a
  new public blog route prefix, add it here too.

---

## 8. Tool pages → blog cross-links (`KennisbankLinks`)

**What:** `src/components/KennisbankLinks.tsx` renders a "Lees ook in onze
kennisbank" card with 2–3 relevant article links + "Alle artikelen →". It is
placed at the bottom of each public tool page, next to the existing
`<ToolsCrossLinks/>` slot (and before `<PublicFooter/>` on the tools hub).

**Why:** the blog links DOWN to the tools; this closes the loop by linking the
high-traffic tool pages back UP to the blog — internal-link authority both ways
+ a reason for tool visitors to read and sign up.

**Wired into** (import + one `<KennisbankLinks tool="..."/>` line each):
`factuur-maken` (inside `GratisFactuur.tsx`), `factuur-scannen`, `btw-berekenen`,
`btw-aangifte-berekenen`, `netto-inkomen-zzp`, `uurtarief-berekenen`,
`kilometervergoeding`, and `tools` (hub).

**⚠️ Hard rule (per product owner):** on the tool pages this is **links only** —
the change is purely additive (an import + one JSX line, 0 deletions) and does
**not** touch any calculator/tool logic, state, or behaviour. Keep it that way.

**Maintain:**
- To change which articles a tool links to, edit the `LINKS` map in
  `KennisbankLinks.tsx` (keys are tool paths; every `href` must be an existing
  published `content/blog/nl/<slug>.mdx`).
- To wire a NEW tool page, add a `LINKS` entry and drop
  `<KennisbankLinks tool="/your-tool" />` next to that page's `<ToolsCrossLinks/>`
  (or before its `<PublicFooter/>`), plus the import. Nothing else.
- The component is intentionally static (no hooks/fetch) so it is safe inside
  both server pages and the one client tool component.

---

## 9. Build & verify

```bash
# Build (SSG). Placeholder envs let it complete without real secrets:
RESEND_API_KEY=re_x NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
NEXT_PUBLIC_BASE_URL=https://boekbrug.nl npx next build

# Internal-link integrity (0 broken expected):
python3 - <<'PY'
import re, os, glob
def slugs(d): return {os.path.basename(f)[:-4] for f in glob.glob(f'content/blog/{d}/*.mdx')}
nl, en = slugs('nl'), slugs('en'); bad=[]
for f in glob.glob('content/blog/**/*.mdx', recursive=True) + ['src/components/KennisbankLinks.tsx']:
    for m in re.finditer(r'[\("](/(en/)?blog/([a-z0-9-]+))[\)"]', open(f).read()):
        ok = (m.group(3) in en) if m.group(2) else (m.group(3) in nl)
        if not ok: bad.append((f, m.group(1)))
print("broken:", len(bad), *bad[:20])
PY
```

---

## 10. Content guardrails (non-negotiable)

- **Only shipped features.** Product claims must map to a real route in
  `src/app/api/*` / `src/app/dashboard/*`. Never mention roadmap features.
  (e.g. bank is statement **upload**, not a live PSD2 feed; BoekBrug **exports**
  UBL, it does not file it; VAT is **prepared** per quarter, not auto-filed.)
- **Verify tax/legal figures** against the Belastingdienst before `draft:false`;
  keep them in sync with the live calculators (e.g. Zvw 4,85%, not the spec's
  5,32%). Leave a `#` YAML note listing the numbers checked.
- **Plain language** (≈ B1), short sentences, jargon explained — expat-friendly.
- **One tool CTA per article.** Clarity converts.
- **No future dates.** `publishedAt`/`updatedAt` must be ≤ today.
