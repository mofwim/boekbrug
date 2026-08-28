// src/lib/invoice-tool-faq.ts
// [FACTUUR-FAQ] The questions under the free invoice generator, in one place.
//
// The answers are Dutch because they are read by a Dutch ondernemer on a public page — this is
// product content, not code (see AGENTS.md).
//
// WHY THIS IS A MODULE AND NOT TWO LITERALS
// These questions have to exist twice: as visible text on /factuur-maken, and inside the FAQPage
// JSON-LD that the server shell emits. Google only honours FAQ markup whose questions actually
// appear on the page, so the two copies are not merely similar — a difference between them is a
// structured-data violation. Before this file they had already drifted the whole way: the shell
// carried three questions in JSON-LD and the page rendered none of them.
//
// One export, imported by both, so they cannot disagree again.

export type FaqItem = { q: string; a: string }

export const INVOICE_TOOL_FAQ: FaqItem[] = [
  {
    q: 'Kan ik gratis een factuur maken?',
    a: 'Ja. Met BoekBrug kun je gratis een factuur maken en als PDF downloaden. Je hebt hiervoor geen account nodig.',
  },
  {
    q: 'Kan ik een factuur maken zonder account?',
    a: 'Ja. Je kunt de factuur direct in je browser maken zonder account. Je gegevens blijven in je browser zolang je geen account maakt.',
  },
  {
    q: 'Kan ik een factuur als PDF downloaden?',
    a: 'Ja. Nadat je de factuur hebt ingevuld, kun je deze direct als PDF downloaden.',
  },
  {
    q: 'Is BoekBrug geschikt voor ZZP’ers?',
    a: 'Ja. BoekBrug is gemaakt voor ZZP’ers en kleine ondernemers. Je kunt gratis facturen maken en daarnaast verschillende andere administratieve tools gebruiken.',
  },
  {
    q: 'Wordt de BTW automatisch berekend?',
    a: 'Ja. Tijdens het maken van de factuur wordt het BTW-bedrag berekend en zie je het totaal inclusief BTW.',
  },
]
