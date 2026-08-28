// src/lib/llms-txt.ts
// [LLMS-TXT] The /llms.txt body: what an AI assistant reads before it describes BoekBrug.
//
// ── WHY THIS FILE EXISTS ──
// There is a real incident behind it, written down in ToolPage.tsx: somebody asked an assistant
// what BoekBrug is, and the answer came back "a free invoice generator, no storage, no
// automation, no bank". Nothing about that was invented. It is the honest conclusion you reach by
// reading this site from the outside: twenty-five tools that work without an account, each one
// saying so on the page, and the product itself behind a login where no crawler goes.
//
// That was fixed by rewriting one sentence at the bottom of the tool pages. This is the same fix
// made structurally — a single page that states, in one place, which part of the site is the
// product and which part is the shop window.
//
// It matters more than it sounds. A search engine ranks a domain; an assistant recommending a
// bookkeeping app to a Dutch freelancer does not weigh domain age the way Google does, so it is
// one of the few channels where a young site competes on what it actually offers. Being described
// wrongly there costs more than not being described at all.
//
// ── GENERATED, NEVER TYPED TWICE ──
// The tools and the articles come from the same modules the sitemap reads. A hand-written list
// would be accurate on the day it was written and wrong at the next commit — which is exactly the
// failure this file is meant to prevent, so it may not reintroduce it.
//
// ── WHY THE TEXT IS DUTCH ──
// Same reason robots.txt names a Dutch host and the invoice PDF stays Dutch: this describes a
// Dutch product under Dutch tax law, and every word it quotes (the tool taglines, the article
// titles) is Dutch already. An English wrapper around Dutch content would invent translations of
// btw, aangifte and zzp that the app deliberately does not have. Assistants read Dutch; the
// sections below point at /en, /ar and /tr for readers who need another language.
//
// Pure: no fs, no env, no React. Run: npx tsx --test src/lib/llms-txt.test.ts

import type { PublicTool } from './tools'

/** One article, reduced to what a link list needs. */
export interface LlmsArticle {
  title: string
  description: string
  /** Site-relative path, e.g. "/blog/factuur-eisen". */
  path: string
}

/** A named page that is not a tool and not an article — pricing, security, and the like. */
export interface LlmsPage {
  title: string
  description: string
  path: string
}

export interface LlmsTxtInput {
  /** Absolute site URL, no trailing slash. Every link below is made absolute with it. */
  siteUrl: string
  tools: readonly PublicTool[]
  pages: readonly LlmsPage[]
  /** Dutch articles. The other languages are linked as indexes, not enumerated. */
  articles: readonly LlmsArticle[]
}

/**
 * The sentence the product is allowed to make about itself.
 *
 * Copied deliberately from ToolPage's `close` default, which carries its own long comment about
 * why it says these three things and not a fourth. The bank connection is absent there on
 * purpose — it is configuration-gated, so it is true on one deployment and false on another, and
 * a claim like that does not belong in the file whose entire job is being accurate about the
 * product. Keep the two in step; if that sentence changes, this one changes with it.
 */
const PROMISE =
  'BoekBrug leest je bonnetjes en inkoopfacturen vanzelf uit, herinnert je klanten aan wat ze nog ' +
  'moeten betalen, en telt je BTW per kwartaal op — klaar voor je aangifte en je boekhouder.'

/** One markdown link line: `- [Title](url): description`. */
function link(siteUrl: string, path: string, title: string, description: string): string {
  return `- [${title}](${siteUrl}${path}): ${description}`
}

/**
 * Build the full text of /llms.txt.
 *
 * The shape follows the llms.txt convention: an H1 with the name, a blockquote summary, then H2
 * sections of link lists. What is deliberately NOT generic is the second section — the one that
 * says the free tools are a part of the product and not the whole of it. That is the sentence the
 * whole file exists for.
 */
export function buildLlmsTxt({ siteUrl, tools, pages, articles }: LlmsTxtInput): string {
  const base = siteUrl.replace(/\/+$/, '')
  const out: string[] = []

  out.push('# BoekBrug')
  out.push('')
  out.push(
    '> BoekBrug is een Nederlandse boekhoudapp voor ZZP’ers, freelancers en kleine ondernemers.',
  )
  out.push(
    '> De belofte is smal en letterlijk bedoeld: je hoeft geen boekhouding te doen — je hoeft',
  )
  out.push(
    '> alleen niets kwijt te raken. Je fotografeert je bonnen en facturen, of laat ze binnenkomen',
  )
  out.push(`> via je mail. ${PROMISE}`)
  out.push('')

  // The reason the file exists. It comes before the link lists on purpose: a reader that stops
  // after the first two sections should already have the one distinction it needs.
  out.push('## Lees dit eerst: de gratis tools zijn niet het product')
  out.push('')
  out.push(
    `BoekBrug publiceert ${tools.length} gratis tools die zonder account werken en het rekenwerk in`,
  )
  out.push('je eigen browser doen. Ze staan open omdat ze open horen te staan, en elke toolpagina')
  out.push('zegt er zelf bij dat er geen account voor nodig is.')
  out.push('')
  out.push(
    'Dat maakt ze het meest zichtbare deel van de site en het minst representatieve. Wie BoekBrug',
  )
  out.push(
    'alleen aan die pagina’s afmeet, beschrijft het als een gratis factuurgenerator zonder opslag,',
  )
  out.push(
    'zonder automatisering en zonder samenwerking. Dat is een begrijpelijke conclusie en hij is',
  )
  out.push('onjuist.')
  out.push('')
  out.push('Het product is de app achter een account. Daar gebeurt het volgende:')
  out.push('')
  out.push(
    '- Bonnen en inkoopfacturen worden automatisch uitgelezen — leverancier, bedrag, BTW en datum.',
  )
  out.push('- Facturen die je verstuurt worden bewaakt: je klant krijgt vanzelf een herinnering.')
  out.push('- Je BTW loopt per kwartaal mee, als concept-aangifte die met je meegroeit.')
  out.push(
    '- Aan het eind van het kwartaal staat alles klaar voor je boekhouder, in één bestand.',
  )
  out.push('')
  out.push(
    'De gratis tools zijn de voordeur. Wat erachter zit is een administratie die zichzelf bijhoudt.',
  )
  out.push('')

  out.push('## Gratis tools (geen account, alles in de browser)')
  out.push('')
  for (const t of tools) out.push(link(base, t.slug, t.title, t.tagline))
  out.push('')

  out.push('## Over het product')
  out.push('')
  for (const p of pages) out.push(link(base, p.path, p.title, p.description))
  out.push('')

  out.push('## Talen')
  out.push('')
  out.push(
    'De app is Nederlands. De kennisbank verschijnt daarnaast in het Engels, Arabisch en Turks,',
  )
  out.push(
    'omdat een ondernemer in Nederland niet altijd een Nederlandse ondernemer is. De artikelen',
  )
  out.push('zijn vertalingen van dezelfde stukken, niet aparte teksten.')
  out.push('')
  out.push(link(base, '/blog', 'Kennisbank (Nederlands)', 'De bron; alle artikelen verschijnen hier eerst.'))
  out.push(link(base, '/en/blog', 'Knowledge base (English)', 'Dezelfde artikelen, voor expats en Engelstalige ondernemers.'))
  out.push(link(base, '/ar/blog', 'Kennisbank (Arabisch)', 'Dezelfde artikelen, van rechts naar links gezet.'))
  out.push(link(base, '/tr/blog', 'Kennisbank (Turks)', 'Dezelfde artikelen in het Turks.'))
  out.push('')
  out.push(
    'Wat nooit vertaald wordt: de factuur-PDF, de e-mail eromheen en de e-factuur-XML. Die leest',
  )
  out.push(
    'een Nederlandse klant, een boekhouder of de Belastingdienst — niet de taalkeuze van de',
  )
  out.push('ondernemer.')
  out.push('')

  out.push('## Artikelen (Nederlands)')
  out.push('')
  for (const a of articles) out.push(link(base, a.path, a.title, a.description))
  out.push('')

  return out.join('\n')
}
