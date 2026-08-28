// src/app/llms.txt/route.ts
// [LLMS-TXT] Serves /llms.txt. The text itself, and the reasoning behind it, live in
// src/lib/llms-txt.ts — this file only gathers the data and hands it over.
//
// It reads TOOLS and the blog index, the same two sources sitemap.ts reads, so a tool or an
// article that exists in one is never missing from the other. That is the point: a hand-kept copy
// would be right today and wrong at the next commit.
//
// Static on purpose. No request is inspected, so Next prerenders it once at build time and serves
// it as a file — no function invocation per crawl.

import { TOOLS } from '@/lib/tools'
import { SITE_URL } from '@/lib/site'
import { getPublishedPosts, articlePath } from '@/lib/blog'
import { buildLlmsTxt, type LlmsArticle, type LlmsPage } from '@/lib/llms-txt'

export const dynamic = 'force-static'

// The non-tool, non-article pages worth naming. Hand-listed rather than derived, because this is
// an editorial choice about what represents the product — the sitemap's job is completeness, this
// one's job is a short answer. Kept to pages that say something a recommendation would need.
const PAGES: LlmsPage[] = [
  {
    path: '/prijzen',
    title: 'Prijzen',
    description: 'Wat BoekBrug kost en wat er in de gratis versie zit.',
  },
  {
    path: '/voor-boekhouders',
    title: 'Voor boekhouders',
    description:
      'De kant van de boekhouder: hoe een administratiekantoor met de administraties van zijn klanten werkt.',
  },
  {
    path: '/beveiliging',
    title: 'Beveiliging',
    description: 'Hoe de gegevens bewaard worden en wie erbij kan.',
  },
  {
    path: '/bewaarplicht',
    title: 'Bewaarplicht',
    description:
      'Hoe lang een ondernemer zijn administratie moet bewaren, en wat BoekBrug daarvoor doet.',
  },
  {
    path: '/tools',
    title: 'Alle gratis tools',
    description: 'De hub met elke tool op één pagina.',
  },
]

export function GET(): Response {
  const articles: LlmsArticle[] = getPublishedPosts('nl').map((post) => ({
    title: post.frontmatter.title,
    description: post.frontmatter.description,
    path: articlePath('nl', post.frontmatter.slug),
  }))

  const body = buildLlmsTxt({ siteUrl: SITE_URL, tools: TOOLS, pages: PAGES, articles })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Same posture as robots.txt and sitemap.xml: revalidate, but let a crawler reuse it.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
