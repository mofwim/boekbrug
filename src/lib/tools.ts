// src/lib/tools.ts
// [SEO] Single source of truth for the public, login-free lead-gen tools.
// Consumed by the /tools hub, the sitemap, and the cross-link footer so the
// three never drift apart. Adding a tool here wires it into all of them.

export interface PublicTool {
  slug: string // path, e.g. '/factuur-maken'
  emoji: string
  title: string // card title (Dutch, action-oriented)
  tagline: string // one-line description
  keywords: string[] // for the hub copy; not rendered as meta
  priority: number // sitemap priority hint (0..1)
}

export const TOOLS: PublicTool[] = [
  {
    slug: '/factuur-maken',
    emoji: '🧾',
    title: 'Factuur maken',
    tagline: 'Maak gratis een nette factuur die klopt met de regels. Download hem als PDF.',
    keywords: ['factuur maken', 'gratis factuur', 'factuur pdf'],
    priority: 0.9,
  },
  {
    slug: '/factuur-scannen',
    emoji: '📄',
    title: 'Factuur scannen met AI',
    tagline: 'Upload een PDF of foto. Lees de leverancier, het bedrag en de BTW automatisch uit.',
    keywords: ['factuur scannen', 'ocr factuur', 'factuur uitlezen'],
    priority: 0.9,
  },
  {
    slug: '/bankafschrift-naar-excel',
    emoji: '🏦',
    title: 'Bankafschrift naar Excel',
    tagline: 'Zet je bankafschrift (CSV, MT940 of CAMT.053) om naar een nette Excel. Blijft in je browser.',
    keywords: ['bankafschrift naar excel', 'mt940 naar excel', 'camt naar excel', 'bankafschrift omzetten'],
    priority: 0.85,
  },
  {
    slug: '/btw-berekenen',
    emoji: '🧮',
    title: 'BTW berekenen',
    tagline: 'Reken snel de BTW uit. Zie het bedrag met en zonder BTW.',
    keywords: ['btw berekenen', 'btw calculator', '21% btw'],
    priority: 0.8,
  },
  {
    slug: '/btw-aangifte-berekenen',
    emoji: '📊',
    title: 'BTW-aangifte berekenen',
    tagline: 'BTW over je omzet min de voorbelasting (BTW op je kosten). Zie wat je betaalt of terugkrijgt.',
    keywords: ['btw aangifte berekenen', 'voorbelasting', 'btw teruggave'],
    priority: 0.8,
  },
  {
    slug: '/netto-inkomen-zzp',
    emoji: '💶',
    title: 'Netto inkomen ZZP',
    tagline: 'Reken uit wat je als ZZP’er netto overhoudt van je winst (2026). Het is een schatting.',
    keywords: ['netto inkomen zzp', 'zzp belasting', 'bruto netto zzp'],
    priority: 0.8,
  },
  {
    slug: '/uurtarief-berekenen',
    emoji: '⏱️',
    title: 'Uurtarief berekenen',
    tagline: 'Bereken een goed ZZP-uurtarief op basis van wat je per jaar wilt verdienen.',
    keywords: ['uurtarief berekenen', 'zzp uurtarief', 'tarief freelancer'],
    priority: 0.7,
  },
  {
    slug: '/kilometervergoeding',
    emoji: '🚗',
    title: 'Kilometervergoeding',
    tagline: 'Reken je kilometervergoeding uit. Tarief 2026: € 0,25 per km.',
    keywords: ['kilometervergoeding', 'reiskosten zzp', '0,25 per km'],
    priority: 0.7,
  },
]

// Cross-link helper: the tools that follow the current one (wrapping around),
// so every page links to a DIFFERENT set — better internal-link spread for SEO
// than always surfacing the same first few.
export function otherTools(currentSlug: string, limit = 3): PublicTool[] {
  const idx = TOOLS.findIndex((t) => t.slug === currentSlug)
  const rest = TOOLS.filter((t) => t.slug !== currentSlug)
  if (idx === -1) return rest.slice(0, limit)
  const rotated = [...rest.slice(idx), ...rest.slice(0, idx)]
  return rotated.slice(0, limit)
}
