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
    tagline: 'Maak gratis een professionele, wettelijk kloppende factuur en download hem als PDF.',
    keywords: ['factuur maken', 'gratis factuur', 'factuur pdf'],
    priority: 0.9,
  },
  {
    slug: '/factuur-scannen',
    emoji: '📄',
    title: 'Factuur scannen met AI',
    tagline: 'Upload een PDF of foto en lees leverancier, bedrag en BTW automatisch uit.',
    keywords: ['factuur scannen', 'ocr factuur', 'factuur uitlezen'],
    priority: 0.9,
  },
  {
    slug: '/btw-berekenen',
    emoji: '🧮',
    title: 'BTW berekenen',
    tagline: 'Reken snel het BTW-bedrag en het bedrag inclusief of exclusief BTW uit.',
    keywords: ['btw berekenen', 'btw calculator', '21% btw'],
    priority: 0.8,
  },
  {
    slug: '/btw-aangifte-berekenen',
    emoji: '📊',
    title: 'BTW-aangifte berekenen',
    tagline: 'Verschuldigde BTW min voorbelasting: zie wat je betaalt of terugkrijgt.',
    keywords: ['btw aangifte berekenen', 'voorbelasting', 'btw teruggave'],
    priority: 0.8,
  },
  {
    slug: '/netto-inkomen-zzp',
    emoji: '💶',
    title: 'Netto inkomen ZZP',
    tagline: 'Bereken indicatief wat je als ZZP’er netto overhoudt van je winst (2026).',
    keywords: ['netto inkomen zzp', 'zzp belasting', 'bruto netto zzp'],
    priority: 0.8,
  },
  {
    slug: '/uurtarief-berekenen',
    emoji: '⏱️',
    title: 'Uurtarief berekenen',
    tagline: 'Bepaal een gezond ZZP-uurtarief op basis van je gewenste jaarinkomen.',
    keywords: ['uurtarief berekenen', 'zzp uurtarief', 'tarief freelancer'],
    priority: 0.7,
  },
  {
    slug: '/kilometervergoeding',
    emoji: '🚗',
    title: 'Kilometervergoeding',
    tagline: 'Reken je onbelaste kilometervergoeding uit tegen € 0,25 per km (2026).',
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
