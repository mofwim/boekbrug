// src/lib/deck.ts
// [DECK] The slide deck BoekBrug is demonstrated with — as data, not as a file somebody drew.
//
// ── WHY THIS IS GENERATED AND NOT A .PPTX IN A DRIVE FOLDER ──
// A deck is the one marketing asset that always goes stale, because it is the only one kept
// outside the codebase. Somebody exports it, the product changes, and a year later a stranger in
// a ZZP group is reading a claim that stopped being true — the worst possible place for it, since
// a deck is what gets posted where nobody can correct it.
//
// So the deck is built from the modules that already hold the vetted words: belofte.ts for Dutch,
// belofte-en.ts for English, tools.ts for the tools. Nothing here is a fresh marketing claim. If
// the promise changes, the next `npx tsx scripts/generate-deck.mts` says the new thing.
//
// ── WHY THERE IS NO ARABIC OR TURKISH DECK ──
// Not an omission and not a backlog item. belofte-en.ts states the policy: the promise is
// legal-adjacent text — BELOFTE_GERUST alone carries three commitments out of voorwaarden §5.2 —
// and a machine translation of a contractual claim, presented as ours, is exactly the kind of
// claim this product refuses to make. The blog publishes in four languages because an article is
// an article. A price promise is not.
//
// If an Arabic deck is ever wanted, the honest route is the same one belofte-en.ts took: a
// translated promise module, reviewed by somebody who can be held to it, with a parity test
// beside it. Then this file gets a third case and nothing else changes.
//
// Pure: no fs, no env, no React. Run: npx tsx --test src/lib/deck.test.ts

import {
  BELOFTE_KOP,
  BELOFTE_KOP_2,
  BELOFTE_GERUST,
  BELOFTE_STAPPEN,
  BELOFTE_BOEKHOUDER,
  PROBLEEM_KOP,
  PROBLEEM_1,
  PROBLEEM_2_VET,
  PROBLEEM_2,
} from './belofte'
import {
  PROMISE_HEAD,
  PROMISE_HEAD_2,
  PROMISE_REASSURE,
  PROMISE_STEPS,
  PROMISE_BOOKKEEPER,
  PROBLEM_HEAD,
  PROBLEM_1,
  PROBLEM_2_BOLD,
  PROBLEM_2,
} from './belofte-en'
import { TOOLS } from './tools'

/** The languages the deck exists in. See the note above for why the list stops here. */
export type DeckLocale = 'nl' | 'en'

/**
 * What a slide is for. The renderer reads this, not a stack of styling flags — so a change of
 * art direction never has to touch the words, and a new word never has to guess at a layout.
 *
 * `bridge` is the deck's turn: the slide where the problem stops being described and the product
 * starts. It is its own kind because it is the only slide that carries the sentence the whole
 * pitch rests on, and it should never quietly become a body paragraph.
 */
export type SlideKind = 'cover' | 'problem' | 'bridge' | 'step' | 'tools' | 'bookkeeper' | 'close'

export interface Slide {
  kind: SlideKind
  /** Small line above the heading. Absent on slides that should open with the heading itself. */
  eyebrow?: string
  head: string
  body?: string
  /** Short lines rendered as a list — the tool names, and nothing else so far. */
  items?: string[]
  /** 1-based position within the steps, for the slides that are one of a numbered sequence. */
  step?: number
  stepCount?: number
}

export interface Deck {
  locale: DeckLocale
  dir: 'ltr' | 'rtl'
  /** The wordmark line printed on every slide. */
  site: string
  slides: Slide[]
}

/** The site is the call to action; there is no other one, and no campaign parameter on it. */
const SITE = 'boekbrug.nl'

/**
 * How many tools the proof slide names.
 *
 * Six, and they come off the top of TOOLS because that array is ordered by intent on purpose —
 * its own comment says "the order is the ranking". Taking the first six therefore shows the six
 * that matter most to somebody doing their books, not the six that get the most searches.
 */
const TOOLS_ON_SLIDE = 6

const COPY = {
  nl: {
    coverHead: `${BELOFTE_KOP}\n${BELOFTE_KOP_2}`,
    problemEyebrow: PROBLEEM_KOP,
    problemHead: PROBLEEM_1,
    bridgeHead: PROBLEEM_2_VET,
    bridgeBody: PROBLEEM_2.trim(),
    stepsEyebrow: 'Wat jij doet',
    toolsEyebrow: 'Nu al te proberen',
    toolsHead: `${TOOLS.length} gratis tools. Geen account, geen upload.`,
    toolsBody:
      'Het rekenwerk gebeurt in je eigen browser — je bestand gaat nergens heen. Probeer er een ' +
      'voordat je iets aanmaakt.',
    bookkeeperEyebrow: 'En voor je boekhouder',
    bookkeeperHead: 'Een afgesloten kwartaal in plaats van een schoenendoos.',
    bookkeeperBody: BELOFTE_BOEKHOUDER,
    closeHead: BELOFTE_KOP_2,
    closeBody: BELOFTE_GERUST,
  },
  en: {
    coverHead: `${PROMISE_HEAD}\n${PROMISE_HEAD_2}`,
    problemEyebrow: PROBLEM_HEAD,
    problemHead: PROBLEM_1,
    bridgeHead: PROBLEM_2_BOLD,
    bridgeBody: PROBLEM_2.trim(),
    stepsEyebrow: 'What you do',
    toolsEyebrow: 'Try one now',
    toolsHead: `${TOOLS.length} free tools. No account, no upload.`,
    toolsBody:
      'The work happens in your own browser — your file goes nowhere. Try one before you create ' +
      'anything.',
    bookkeeperEyebrow: 'And for your bookkeeper',
    bookkeeperHead: 'A closed quarter instead of a shoebox.',
    bookkeeperBody: PROMISE_BOOKKEEPER,
    closeHead: PROMISE_HEAD_2,
    closeBody: PROMISE_REASSURE,
  },
} as const

/**
 * Build the deck for one language.
 *
 * The order is the argument, and it is deliberately not "here is our product": the problem comes
 * first, because a reader who has not recognised themselves yet has no reason to care what the
 * app does. Then the one sentence that reframes it, then the three things they actually have to
 * do, then the free tools as the cheapest possible proof, and only at the end the bookkeeper —
 * who is a second audience and the reason one reader can be worth fifty.
 */
export function buildDeck(locale: DeckLocale): Deck {
  const t = COPY[locale]
  const steps = locale === 'nl' ? BELOFTE_STAPPEN : PROMISE_STEPS

  const slides: Slide[] = [
    { kind: 'cover', head: t.coverHead },
    { kind: 'problem', eyebrow: t.problemEyebrow, head: t.problemHead },
    { kind: 'bridge', head: t.bridgeHead, body: t.bridgeBody },
  ]

  steps.forEach((s, i) => {
    // BELOFTE_STAPPEN calls them kop/tekst and PROMISE_STEPS head/text — the same shape under
    // two languages' field names, so read whichever this one has.
    const head = 'kop' in s ? s.kop : s.head
    const body = 'tekst' in s ? s.tekst : s.text
    slides.push({
      kind: 'step',
      eyebrow: t.stepsEyebrow,
      head,
      body,
      step: i + 1,
      stepCount: steps.length,
    })
  })

  slides.push({
    kind: 'tools',
    eyebrow: t.toolsEyebrow,
    head: t.toolsHead,
    body: t.toolsBody,
    items: TOOLS.slice(0, TOOLS_ON_SLIDE).map((tool) => tool.title),
  })

  slides.push({
    kind: 'bookkeeper',
    eyebrow: t.bookkeeperEyebrow,
    head: t.bookkeeperHead,
    body: t.bookkeeperBody,
  })

  slides.push({ kind: 'close', head: t.closeHead, body: t.closeBody })

  return { locale, dir: 'ltr', site: SITE, slides }
}
