# BoekBrug — the demonstration deck

The deck that explains BoekBrug to a stranger. It is **generated**, not drawn:
one command rebuilds every slide from the words already in the codebase.

```bash
npx tsx scripts/generate-deck.mts
```

> Output lands in `store-assets/deck/`, which is gitignored. The generator is the
> source; the slides are build output. Regenerate rather than archive them.

---

## 1. What comes out

Nine slides, two languages, two shapes, plus a PDF per language.

| File | Size | What it is for |
| --- | --- | --- |
| `store-assets/deck/nl/square-01…09.png` | 1080×1080 | Carousel posts, groups, Instagram |
| `store-assets/deck/nl/wide-01…09.png` | 1920×1080 | Presenting on a screen |
| `store-assets/deck/nl/boekbrug-nl.pdf` | 1920×1080, 9 pages | LinkedIn document post, e-mail attachment |
| `store-assets/deck/en/…` | same | the English deck |

The run takes seconds and needs no server, no build and no network — the
typeface is embedded, so it behaves the same on a laptop and in locked-down CI.

## 2. Where the words come from

Nothing in the deck is a fresh marketing claim. `src/lib/deck.ts` assembles the
slides out of modules that already hold vetted copy:

| Source | What it contributes |
| --- | --- |
| `src/lib/belofte.ts` | the Dutch promise, the problem, the three steps, the reassurance, the bookkeeper |
| `src/lib/belofte-en.ts` | the same in English |
| `src/lib/tools.ts` | the tool count and the six named tools |

**This is the point of the whole arrangement.** A deck is the one marketing
asset normally kept outside the codebase, so it is the one that always goes
stale — and a posted deck is the one thing nobody can edit afterwards. Change
the promise and the next run says the new thing.

`src/lib/deck.test.ts` guards the two failures that would otherwise be silent:
a slide outrunning the promise it was built from (a guarantee, "doet zichzelf",
filing a return we do not file, being an accountant we are not), and the two
languages drifting into different arguments.

## 3. The order is the argument

The sequence is deliberate and does not open with the product. Changing it
changes the pitch, so change it on purpose.

1. **Cover** — the promise, in two lines.
2. **The problem** — receipts in a pocket, invoices in a mailbox. A reader who
   has not recognised himself yet has no reason to care what an app does.
3. **The turn** — "De oplossing is niet dat jij leert boekhouden." The one blue
   slide in the deck, because this is the sentence the pitch rests on.
4–6. **The three steps** — what the reader actually has to do.
7. **The free tools** — the cheapest possible proof, and a call to action that
   costs the reader nothing.
8. **The bookkeeper** — a second audience, and the reason one reader can be
   worth fifty: an administratiekantoor decides for its whole book.
9. **Close** — the reassurance and the address.

Colour carries the same arc: dark (problem) → blue (the turn) → light (how it
works) → dark (close).

## 4. Where to post it

- **LinkedIn** — upload `boekbrug-nl.pdf` as a *document* post; it renders as a
  swipeable carousel. This is the format that suits a ZZP audience best.
- **Facebook / WhatsApp groups for ZZP'ers** — the square PNGs, in order.
- **Instagram** — the square PNGs as a carousel.
- **E-mail to an administratiekantoor** — the PDF, with slide 8 as the reason
  to open it.

Read each community's self-promotion rules first. A deck posted where promotion
is unwelcome costs more than the reach it buys.

## 5. Why there is no Arabic or Turkish deck

A decision, not a gap. `src/lib/belofte-en.ts` states the policy: the promise is
legal-adjacent text — `BELOFTE_GERUST` alone carries three commitments out of
voorwaarden §5.2 (free, no expiring trial, never automatically charged) — and a
machine translation of a contractual claim, presented as ours, is exactly the
kind of claim this product refuses to make.

The blog publishes in four languages because an article is an article. A price
promise is not.

If an Arabic deck is wanted, the honest route is the one `belofte-en.ts` took: a
translated promise module, reviewed by somebody who can be held to it, with a
parity test beside it. Then `deck.ts` gets a third case in `COPY` and a third
entry in `DeckLocale`, and nothing else changes.

## 6. Ideas for later

Recorded so they are not re-invented from scratch.

- **Real screenshots on the slides.** The widescreen layout already leaves the
  right half empty for exactly this. The pieces exist: `scripts/seed-demo-account.sql`
  creates a demo tenant and `scripts/capture-screenshots.mjs` will shoot the
  `/dashboard` screens when given `SHOT_EMAIL` and `SHOT_PASSWORD`. Known
  obstacle: in a sandbox whose egress is a proxy, the *browser* also has to reach
  Supabase to log in, and that has not worked yet — so this needs a run somewhere
  with normal network access. Never point it at a real tenant.
- **A vertical shape, 1080×1920,** for Stories and Reels. One more entry in the
  `SHAPES` array in the generator; the layout already scales from canvas height.
- **Per-tool mini decks** — three slides for one tool, for posting alongside a
  link to that tool rather than the whole product.
- **Speaker notes** in the PDF, if the deck is ever presented live rather than
  scrolled.
