// src/lib/og-tool-image.tsx
// [OG-TOOL] The social-share card for a single free tool.
//
// ── WHY EACH TOOL NEEDS ITS OWN ──
// The free tools ARE the acquisition strategy: no account, real output, and a stranger can use one
// before he knows what BoekBrug is. That makes them the pages people actually paste into a
// WhatsApp group or a ZZP forum — and until now every one of those pastes previewed as the generic
// site card, "De brug tussen jou en je boekhouder". True, and it tells nobody that the link they
// are looking at converts a bank statement to Excel.
//
// A share is a free impression from someone who already vouched for us. Spending it on a sentence
// that does not name the thing is the cheapest loss on the site.
//
// ── WHY THE COPY COMES FROM tools.ts ──
// The title and tagline are the ones the /tools hub already shows. Writing new ones here would
// give the same tool two descriptions that drift apart, and the hub's are written for exactly this
// job: one line, plain Dutch, says what you get.
//
// ── WHY A SHARED MODULE ──
// next/og needs a file per route (opengraph-image.tsx), so the alternative was the same forty
// lines of JSX copied eight times. The route files are three lines each and this holds the design,
// which means a change to the card is one edit rather than eight that have to agree.
//
// Self-contained: no external font, no fetched asset, so it renders the same everywhere.

import { ImageResponse } from 'next/og'
import { TOOLS } from './tools'

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

/** The tool as tools.ts describes it, or undefined for a slug that is not a tool. */
export function toolBySlug(slug: string) {
  return TOOLS.find((t) => t.slug === slug)
}

/**
 * Render the share card for one tool.
 *
 * The layout is the site card's: same gradient, same white pill, same weights — a person who has
 * seen one BoekBrug preview should recognise the next. What changes is that the big line names the
 * tool instead of the company, and a "Gratis · geen account" badge sits where the eye lands after
 * it, because that is the reason to click and it is the one thing the competition cannot copy
 * without changing their product.
 */
export function toolOgImage(slug: string) {
  const tool = toolBySlug(slug)
  const title = tool?.title ?? 'Gratis tools'
  const tagline = tool?.tagline ?? 'Facturen, BTW en je administratie — gratis en zonder account.'

  // [OG-TOOL] tools.ts has an emoji per tool and it is deliberately NOT used here. next/og ships no
  // emoji font, so the glyph renders as an empty gap next to the wordmark — worse than absent,
  // because it reads as a broken image. Giving it a font means fetching an external asset at build
  // time, which is exactly the dependency this card avoids.

  // A long title has to shrink or it collides with the tagline; 1200×630 is fixed, the words are
  // not. Three steps rather than a formula, so the result is predictable at review time.
  const titleSize = title.length > 26 ? 68 : title.length > 18 ? 78 : 88

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: 'linear-gradient(135deg, #1a73e8 0%, #0056d6 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 600, opacity: 0.9, marginBottom: 26 }}>
          BoekBrug
        </div>

        <div style={{ fontSize: titleSize, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
          {title}
        </div>

        <div style={{ fontSize: 32, opacity: 0.92, marginTop: 30, maxWidth: 940, lineHeight: 1.35 }}>
          {tagline}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 44 }}>
          <div
            style={{
              display: 'flex',
              background: '#ffffff',
              color: '#1a73e8',
              fontSize: 30,
              fontWeight: 700,
              padding: '14px 32px',
              borderRadius: 9999,
            }}
          >
            Gratis · geen account
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, opacity: 0.9 }}>boekbrug.nl</div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  )
}
