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
    slug: '/pdf-verkleinen',
    emoji: '📉',
    title: 'PDF verkleinen',
    tagline: 'Te groot voor de upload? Alleen de afbeeldingen gaan omlaag — je tekst blijft tekst.',
    keywords: ['pdf verkleinen', 'pdf comprimeren', 'pdf kleiner maken', 'pdf te groot'],
    priority: 0.85,
  },
  {
    slug: '/afbeeldingen-naar-pdf',
    emoji: '🖼️',
    title: "Foto's naar PDF",
    tagline: 'Bonnetjes van je telefoon als \u00e9\u00e9n net document, in de volgorde die jij bepaalt.',
    keywords: ['afbeeldingen naar pdf', 'jpg naar pdf', 'bonnetjes naar pdf', 'foto naar pdf'],
    priority: 0.85,
  },
  {
    slug: '/afbeelding-verkleinen',
    emoji: '📷',
    title: 'Afbeelding verkleinen',
    tagline: 'Een telefoonfoto van 4 MB tot onder de grens die het portaal accepteert.',
    keywords: ['afbeelding verkleinen', 'foto verkleinen', 'jpg verkleinen', 'foto kleiner maken'],
    priority: 0.8,
  },
  {
    slug: '/pdf-naar-afbeelding',
    emoji: '🖨️',
    title: 'PDF naar JPG',
    tagline: 'Elke pagina als afbeelding, in de resolutie die je nodig hebt.',
    keywords: ['pdf naar jpg', 'pdf naar png', 'pdf naar afbeelding'],
    priority: 0.8,
  },
  {
    slug: '/pdf-watermerk',
    emoji: '💧',
    title: 'Watermerk op een PDF',
    tagline: 'KOPIE of CONCEPT over elke pagina, met paginanummers. Je ziet meteen hoe het wordt.',
    keywords: ['watermerk pdf', 'kopie stempel pdf', 'paginanummers pdf'],
    priority: 0.7,
  },
  {
    slug: '/pdf-eigenschappen',
    emoji: '🏷️',
    title: 'PDF-eigenschappen',
    tagline: 'Zie welke naam en software er in je document staan \u2014 en haal ze eruit.',
    keywords: ['pdf eigenschappen', 'pdf metadata verwijderen', 'naam uit pdf halen'],
    priority: 0.7,
  },
  {
    slug: '/pdf-naar-tekst',
    emoji: '📝',
    title: 'PDF naar tekst',
    tagline: 'De tekst uit een PDF, om te kopi\u00ebren of te bewaren.',
    keywords: ['pdf naar tekst', 'tekst uit pdf halen', 'pdf naar txt'],
    priority: 0.7,
  },
  {
    slug: '/afbeeldingen-uit-pdf',
    emoji: '📤',
    title: 'Afbeeldingen uit een PDF',
    tagline: "De foto's en logo's die erin zitten, op hun eigen resolutie.",
    keywords: ['afbeeldingen uit pdf', 'foto uit pdf halen', 'logo uit pdf'],
    priority: 0.65,
  },
  {
    slug: '/afbeelding-omzetten',
    emoji: '🔄',
    title: 'Afbeelding omzetten',
    tagline: 'Naar WebP, JPG of PNG \u2014 meerdere tegelijk, en je mag van gedachten veranderen.',
    keywords: ['afbeelding omzetten', 'png naar jpg', 'jpg naar webp', 'webp maken'],
    priority: 0.65,
  },
  {
    slug: '/afbeelding-formaat',
    emoji: '📐',
    title: 'Afbeelding op maat',
    tagline: 'De juiste maat voor LinkedIn, Instagram of een link die je deelt.',
    keywords: ['afbeelding formaat', 'foto bijsnijden', 'linkedin formaat', 'open graph afbeelding'],
    priority: 0.6,
  },
  {
    slug: '/watermerk-op-foto',
    emoji: '\u270D\uFE0F',
    title: 'Watermerk op een foto',
    tagline: 'Je naam over de foto, in de hoek of over het hele beeld.',
    keywords: ['watermerk foto', 'logo op foto', 'copyright op foto'],
    priority: 0.6,
  },
  {
    slug: '/favicon-maken',
    emoji: '\u2728',
    title: 'Favicon maken',
    tagline: '\u00c9\u00e9n logo erin, alle maten en het .ico eruit \u2014 met de HTML erbij.',
    keywords: ['favicon maken', 'favicon generator', 'ico maken'],
    priority: 0.55,
  },
  {
    slug: '/pdf-samenvoegen',
    emoji: '🔗',
    title: 'PDF samenvoegen',
    tagline: "Meerdere PDF's tot \u00e9\u00e9n document \u2014 en je kiest per bestand welke pagina's meegaan.",
    keywords: ['pdf samenvoegen', "pdf's combineren", 'bonnetjes samenvoegen'],
    priority: 0.9,
  },
  {
    slug: '/pdf-splitsen',
    emoji: '\u2702\uFE0F',
    title: 'PDF splitsen',
    tagline: "Haal de pagina's eruit die je nodig hebt, of knip het in gelijke delen.",
    keywords: ['pdf splitsen', 'pagina uit pdf halen', 'pdf knippen'],
    priority: 0.85,
  },
  {
    slug: '/pdf-ondertekenen',
    emoji: '🖊️',
    title: 'PDF ondertekenen',
    tagline: 'Teken met je vinger en wijs aan waar hij komt \u2014 zonder printen en scannen.',
    keywords: ['pdf ondertekenen', 'handtekening pdf', 'offerte ondertekenen'],
    priority: 0.8,
  },
  {
    slug: '/pdf-paginas-ordenen',
    emoji: '🔃',
    title: "PDF-pagina's ordenen",
    tagline: 'Scheve scans rechtzetten, verplaatsen en weggooien \u2014 alles in \u00e9\u00e9n overzicht.',
    keywords: ['pdf pagina draaien', 'pdf pagina verwijderen', 'pdf roteren'],
    priority: 0.75,
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
