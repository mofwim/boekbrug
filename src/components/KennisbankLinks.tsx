// src/components/KennisbankLinks.tsx
// [BLOG-CROSSLINK] Presentational "Lees ook in onze kennisbank" block: a small
// list of relevant blog articles shown at the bottom of each public tool page.
//
// Purpose (SEO + funnel): the blog already links DOWN to the tools; this closes
// the loop by linking the high-traffic tool pages back UP to the blog, passing
// internal-link authority both ways and giving tool visitors a reason to read
// (and then sign up).
//
// IMPORTANT FOR DEVELOPERS:
// - This component is LINKS ONLY. It contains no tool logic, no state, no data
//   fetching, no side effects — just <Link>s. It was added next to the existing
//   <ToolsCrossLinks/> slot without changing any calculator/tool behaviour.
// - It is server-safe AND client-safe (no hooks, no server-only APIs), so it can
//   be dropped into either a server page or the client tool components.
// - To wire a NEW tool: add an entry to LINKS keyed by the tool's path. To point
//   at a different article: edit the {href,title} pairs. All href slugs must be
//   published articles under content/blog/nl/ (Dutch tool pages → NL articles).

import Link from 'next/link'

type ArticleLink = { href: string; title: string }

// Tool path → up to 3 topically-relevant NL blog articles. Keep every href in
// sync with an existing content/blog/nl/<slug>.mdx file.
const LINKS: Record<string, ArticleLink[]> = {
  '/factuur-maken': [
    { href: '/blog/factuur-maken-gids', title: 'Factuur maken: de complete gids' },
    { href: '/blog/offerte-maken-zzp', title: 'Offerte maken: wat erop hoort' },
    { href: '/blog/factuur-eisen', title: 'Waar moet een factuur aan voldoen?' },
  ],
  '/factuur-scannen': [
    { href: '/blog/factuur-scannen-hoe-werkt-het', title: 'Factuur scannen met AI: hoe werkt het?' },
    { href: '/blog/bonnetjes-bewaren-zzp', title: 'Bonnetjes en facturen bewaren' },
    { href: '/blog/documenten-automatisch-ordenen', title: 'Je documenten automatisch ordenen' },
  ],
  '/btw-berekenen': [
    { href: '/blog/btw-gids-zzp', title: "BTW voor ZZP'ers: de complete gids" },
    { href: '/blog/kleineondernemersregeling-kor', title: 'De kleineondernemersregeling (KOR)' },
    { href: '/blog/btw-aangifte-doen', title: 'Btw-aangifte doen: stap voor stap' },
  ],
  '/btw-aangifte-berekenen': [
    { href: '/blog/btw-aangifte-doen', title: 'Btw-aangifte doen: stap voor stap' },
    { href: '/blog/zzp-deadlines-2026-btw-kalender', title: 'ZZP-deadlines 2026: de btw-kalender' },
    { href: '/blog/btw-gids-zzp', title: "BTW voor ZZP'ers: de complete gids" },
  ],
  '/netto-inkomen-zzp': [
    { href: '/blog/netto-inkomen-zzp-2026', title: 'Netto inkomen ZZP 2026 berekenen' },
    { href: '/blog/aftrekposten-zzp-2026', title: 'Aftrekposten voor ZZP’ers in 2026' },
    { href: '/blog/aangifte-inkomstenbelasting-zzp', title: 'Aangifte inkomstenbelasting: stap voor stap' },
  ],
  '/uurtarief-berekenen': [
    { href: '/blog/goed-uurtarief-zzp', title: "Wat is een goed uurtarief als ZZP'er?" },
    { href: '/blog/zzp-starten', title: 'ZZP starten: de startersgids' },
    { href: '/blog/belasting-reserveren-zzp', title: 'Hoeveel reserveren voor de belasting?' },
  ],
  '/kilometervergoeding': [
    { href: '/blog/kilometervergoeding-2026', title: 'Kilometervergoeding 2026: € 0,25 per km' },
    { href: '/blog/zzp-belasting-2026', title: 'ZZP belasting 2026: de complete gids' },
    { href: '/blog/boekhouding-bijhouden-zzp', title: "Boekhouding bijhouden als ZZP'er" },
  ],
  // Hubs / landing: point at the three pillar guides.
  '/tools': [
    { href: '/blog/zzp-belasting-2026', title: 'ZZP belasting 2026: de complete gids' },
    { href: '/blog/factuur-maken-gids', title: 'Factuur maken: de complete gids' },
    { href: '/blog/boekhouding-bijhouden-zzp', title: "Boekhouding bijhouden als ZZP'er" },
  ],
}

// Generic fallback = the three pillar guides.
const FALLBACK: ArticleLink[] = LINKS['/tools']

export default function KennisbankLinks({ tool }: { tool: string }) {
  const items = LINKS[tool] ?? FALLBACK
  return (
    <section style={{ maxWidth: 680, margin: '0 auto', padding: '8px 16px 40px' }}>
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: '22px 24px', boxShadow: '0 2px 14px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#70757a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Lees ook in onze kennisbank
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((a) => (
            <li key={a.href}>
              <Link href={a.href} style={{ fontSize: 15, fontWeight: 600, color: '#1a73e8', textDecoration: 'none' }}>
                {a.title} →
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f3f4' }}>
          <Link href="/blog" style={{ fontSize: 14, color: '#5f6368', textDecoration: 'none' }}>
            Alle artikelen in de kennisbank →
          </Link>
        </div>
      </div>
    </section>
  )
}
