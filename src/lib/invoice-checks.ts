// src/lib/invoice-checks.ts
// [CHECKLIST] What the app actually checked on this invoice — said out loud, including the checks
// that could NOT run.
//
// ── THE PROBLEM THIS IS FOR ──
// "The import is always right, and I still want to look at every invoice." That is not an
// irrational habit. It is the correct instinct of someone who is legally answerable for their own
// books, and no amount of accuracy removes it — because accuracy is invisible. The app runs six
// real checks on every incoming invoice and, when they all pass, says NOTHING. Silence is what a
// clean invoice earns, and silence is indistinguishable from not having looked.
//
// So the owner does the only thing left: they check everything themselves, every time, forever.
//
// ── WHY A LIST OF TICKS IS THE ANSWER, AND WHY IT IS DANGEROUS ──
// Stating the checks turns an absence of warnings into a claim that can be judged. That is the
// whole value — and it is also the risk, because a green tick is a promise. The moment this list
// shows "✓ rekeningnummer ongewijzigd" on an invoice where the IBAN check could not run, the app
// has told the owner something it does not know, on the one axis where being wrong costs them the
// payment. A list that overstates is worse than no list: it replaces a healthy habit with a false
// one.
//
// Hence three outcomes and not two. `not-checked` is a first-class answer, and the two cases it
// exists for are already recorded at import time for exactly this reason — _safecore's
// iban_check_unavailable and one_invoice_unverified are both "we could not look", written by code
// that refused to let a skipped check read as a passed one.
//
// ── AND IT HAPPENED ANYWAY, ON THE AXIS NOBODY WAS WATCHING ──
// Enka Horeca 26701681 showed "Alle 7 controles gedaan, niets geks gevonden" over a btw that was
// € 0,46 wrong. No check misfired: the list simply had no row for the btw itself, and the row it
// did have — "bedragen kloppen met elkaar" — is true of any three numbers that were made to add
// up. The lesson is narrower than "check more": a check whose CONSTRAINT disappears on some
// invoices must say so on those invoices. On a mixed-rate invoice the legal-rate constraint does
// exactly that, silently. See btw-split.ts, and check 2 below.
//
// Pure: no I/O, no clock. It reads what the import already stored and what classifyImportHealth
// already computes — it introduces no new judgement about an invoice, it only says what the
// existing ones concluded.

import { classifyImportHealth, type HealthInput, type FieldConfidence } from '@/lib/import-health'
import { creditStance, payableAsDebt } from '@/lib/creditnota-signal'
import { classifyBtwSplit, btwSplitCorroborated, btwSplitDetail } from '@/lib/btw-split'

export type CheckOutcome =
  | 'passed'      // the check ran and found nothing wrong
  | 'flagged'     // the check ran and found something the owner should look at
  | 'not-checked' // the check could not run, or there was nothing to check it against

export interface InvoiceCheck {
  /** Stable id for keys and tests. */
  id: 'arithmetic' | 'total-on-document' | 'btw-split' | 'duplicate' | 'iban' | 'single-invoice' | 'date' | 'number' | 'kind'
  /** What was checked. Dutch — this is what the owner reads (AGENTS.md). */
  label: string
  outcome: CheckOutcome
  /** One line of why, when there is something to add. Dutch. Null on a plain pass. */
  detail: string | null
}

/** The invoice fields these checks read. A structural subset of the row. */
export interface CheckInput extends HealthInput {
  /** The supplier's account number as printed. Without one there is nothing to compare. */
  vendor_iban?: string | null
  /** Other invoice numbers from the same supplier — the creditnota signal needs them. */
  vendorNumbers?: string[]
}

/** The stored _safecore block, or an empty object — every read below is optional anyway. */
function safecore(fc: FieldConfidence | null | undefined): NonNullable<FieldConfidence['_safecore']> {
  return fc?._safecore ?? {}
}

/**
 * The checks, in the order they matter to someone holding the paper.
 *
 * Money first (do the amounts add up, is this a second copy), then who gets paid, then what the
 * document is. That order is not cosmetic: it is the order in which being wrong costs the owner
 * something, and a list read top-down should spend the reader's attention accordingly.
 */
export function invoiceChecks(inv: CheckInput): InvoiceCheck[] {
  const health = classifyImportHealth(inv)
  const sc = safecore(inv.field_confidence)
  const out: InvoiceCheck[] = []

  // ── 1. The arithmetic ──
  //
  // [PRINTED-TOTAL] A pass here means the three amounts agree WITH EACH OTHER. That is worth
  // something only when all three came off the paper. When the reader returned two of them and we
  // computed the third, the identity holds because we made it hold — and a tick would be reporting
  // our own subtraction back to the owner as a verified fact about their invoice.
  const totalDerived = inv.field_confidence?._total_derived
  out.push({
    id: 'arithmetic',
    label: 'Bedragen kloppen met elkaar',
    // [NIET-OP-HET-DOCUMENT] Judged on the ARITHMETIC, which is what this row is named after.
    // flags.arithmetic carries two different findings — a sum that does not add up, and a total
    // that is not in the document's text — because both mean "do not book this unseen". That part
    // is right; printing one row about both is not. On BALKIP 264091 this row said "excl. + btw
    // komt niet uit op het totaal" over 1.123,62 + 101,13 = 1.224,75, which is exact to the cent.
    // An owner who checks that and finds it false stops reading the whole list — including on the
    // invoice where it is right. The other finding has its own row below.
    outcome: health.flags.arithmetic && !health.flags.notOnDocument
      ? 'flagged'
      : totalDerived ? 'not-checked' : 'passed',
    // The SAME condition as the outcome above. Keying the detail on flags.arithmetic while the
    // outcome is keyed on the narrower question put a green tick over the sentence "excl. + btw
    // komt niet uit op het totaal" — a row contradicting itself, which is worse than either half.
    detail: health.flags.arithmetic && !health.flags.notOnDocument
      ? 'excl. + btw komt niet uit op het totaal'
      : totalDerived === 'total'
        ? 'het totaal stond niet los op de factuur — wij hebben het uit excl. + btw berekend'
        : totalDerived === 'excl'
          ? 'het bedrag excl. btw stond niet los op de factuur — wij hebben het uit totaal − btw berekend'
          : null,
  })

  // ── 1b. Is the total we read actually printed on the paper? ──
  //
  // [GEGROND-OCR] proved it is not: a second, blind read of the document transcribed every amount
  // it could see, and ours was not among them. That is a different question from whether the three
  // amounts agree — they can agree perfectly and still all be wrong together — and it is the
  // question the owner can settle fastest, because they are holding the invoice.
  //
  // Only when it fired. A row that says "we found your total" on every clean invoice would be a
  // green tick for a check that mostly cannot run (a photo has no text to search), and this
  // checklist does not hand out ticks it has not earned.
  if (health.flags.notOnDocument) {
    out.push({
      id: 'total-on-document',
      label: 'Totaalbedrag teruggevonden op het document',
      outcome: 'flagged',
      detail: 'het bedrag dat wij lazen staat niet in de tekst van dit document — vergelijk het even met de factuur',
    })
  }

  // ── 2. The btw itself ──
  //
  // [BTW-SPLIT] The axis the checklist used to be silent about, and the one that let a € 0,46
  // error through with seven green ticks. On a single-rate invoice btw/excl must land exactly on
  // 9% or 21%, so the amounts corroborate each other and a tick is earned. On a MIXED-rate invoice
  // any blend between the rates is legal, that constraint disappears, and unless the per-rate
  // summary block was read there is nothing left that the btw was compared against. See
  // btw-split.ts — the row is omitted entirely when there are no amounts, because the arithmetic
  // row above already says that and repeating it is noise rather than honesty.
  const split = classifyBtwSplit({
    totalExBtw: inv.total_ex_btw,
    btwAmount: inv.btw_amount,
    rows: inv.field_confidence?._btw_rows ?? null,
  })
  if (split.kind !== 'no-basis') {
    out.push({
      id: 'btw-split',
      label: 'Btw-bedrag nagerekend',
      outcome: btwSplitCorroborated(split)
        ? 'passed'
        : split.kind === 'blend-unverified'
          ? 'not-checked'
          : 'flagged',
      detail: btwSplitDetail(split, inv.btw_amount),
    })
  }

  // ── 3. A second copy of an invoice you already have ──
  out.push({
    id: 'duplicate',
    label: 'Geen dubbele factuur gevonden',
    outcome: health.flags.possibleDuplicate ? 'flagged' : 'passed',
    detail: health.flags.possibleDuplicate
      ? `lijkt op ${sc.possible_duplicate_of ? `factuur ${sc.possible_duplicate_of}` : 'een factuur die je al hebt'}`
      : null,
  })

  // ── 4. The account number — the axis where a wrong tick costs the payment ──
  //
  // Three genuinely different states, and collapsing any two of them is the failure this whole
  // file is careful about:
  //   · the registry was unreachable → the check DID NOT RUN. _safecore records that at import
  //     time precisely so it cannot pass for a clean result;
  //   · no IBAN printed on this invoice → there was nothing to compare. Also not a pass;
  //   · compared, and unchanged → the only case that earns a tick.
  //
  // Read from _safecore directly, NOT from health.flags.ibanChanged — that flag is deliberately
  // true for BOTH cases, because the verify queue is right to want a human on either. Here they
  // are the two different things this file exists to keep apart, and collapsing them is precisely
  // the tick that would lie.
  const ibanPrinted = ((inv.vendor_iban ?? '').trim().length >= 15)
  const ibanChanged = sc.iban_changed === true
  out.push({
    id: 'iban',
    label: 'Rekeningnummer van deze leverancier',
    outcome: ibanChanged ? 'flagged'
      : sc.iban_check_unavailable === true ? 'not-checked'
      : !ibanPrinted ? 'not-checked'
      : 'passed',
    detail: ibanChanged
      ? `stond eerder op ${sc.iban_changed_from ?? 'een ander nummer'} — bel de leverancier op een nummer dat je zelf opzoekt`
      : sc.iban_check_unavailable ? 'we konden dit niet nagaan'
      : !ibanPrinted ? 'er staat geen rekeningnummer op deze factuur'
      : 'ongewijzigd ten opzichte van eerdere facturen',
  })

  // ── 5. One invoice, or several in one file ──
  // Same split as the IBAN row above, and for the same reason: health.flags.multipleInvoices is
  // true for "we saw several" AND for "a scanned pdf gave us no text to look at".
  const multiple = sc.multiple_invoices === true
  out.push({
    id: 'single-invoice',
    label: 'Eén factuur in dit bestand',
    outcome: multiple ? 'flagged'
      : sc.one_invoice_unverified === true ? 'not-checked'
      : 'passed',
    detail: multiple
      ? (sc.multiple_invoices_reason ?? 'er lijken meerdere facturen in dit bestand te zitten')
      : sc.one_invoice_unverified === true
        ? 'een gescande pdf zonder tekstlaag — dit konden we niet nagaan'
        : null,
  })

  // ── 6. The date, which decides the kwartaal ──
  //
  // A MISSING date is 'flagged', not 'not-checked', and the difference is real: the check ran and
  // its answer is that this invoice has no usable date. Under the factuurstelsel that date picks
  // the kwartaal, so it is a problem with the invoice, not a gap in our looking. Only the DETAIL
  // separates "there is none" from "we are not sure of the one we read".
  out.push({
    id: 'date',
    label: 'Factuurdatum gelezen',
    outcome: health.flags.invoiceDate ? 'flagged' : 'passed',
    detail: !inv.invoice_date ? 'er staat geen datum op'
      : health.flags.invoiceDate ? 'we zijn niet zeker van de datum'
      : null,
  })

  // ── 7. The invoice number ──
  // Skipped entirely for a kassabon: it carries no factuurnummer and does not have to (a
  // vereenvoudigde factuur is not an art. 35 invoice), so a row about it would be noise on every
  // receipt — the same reasoning classifyImportHealth uses to leave that axis alone.
  if (sc && inv.field_confidence?._intake_kind !== 'receipt') {
    out.push({
      id: 'number',
      label: 'Factuurnummer gelezen',
      // Same rule as the date above: an absent number is an answer, not a gap. Art. 35 Wet OB
      // requires one on a real invoice, so "there is none" is a finding.
      outcome: health.flags.invoiceNumber ? 'flagged' : 'passed',
      detail: !inv.invoice_number ? 'er staat geen nummer op'
        : health.flags.invoiceNumber ? 'we zijn niet zeker van het nummer'
        : null,
    })
  }

  // ── 8. Factuur or creditnota ──
  // The signal that says a document numbered CR… is behaving as a debt. It is here rather than in
  // a warning banner because on a CLEAN invoice this row is the reassurance: it says the app looked
  // at what kind of document this is, and not merely at its numbers.
  const stance = creditStance({
    invoiceNumber: inv.invoice_number ?? null,
    totalIncBtw: inv.total_inc_btw,
    invoiceType: inv.invoice_type ?? null,
    vendorNumbers: inv.vendorNumbers ?? [],
  })
  const isCredit = !payableAsDebt(stance)
  out.push({
    id: 'kind',
    label: isCredit ? 'Dit is een creditnota' : 'Dit is een gewone factuur',
    outcome: stance === 'conflict' || stance === 'suspected' ? 'flagged' : 'passed',
    detail: stance === 'conflict' ? 'geboekt als creditnota, maar de bedragen staan positief'
      : stance === 'suspected' ? 'het nummer lijkt op een creditnota van deze leverancier'
      : isCredit ? 'dit bedrag gaat van je openstaande saldo af'
      : null,
  })

  return out
}

/** How many of the checks actually ran and passed — the number the summary line quotes. */
export function checksPassed(checks: readonly InvoiceCheck[]): number {
  return checks.filter((c) => c.outcome === 'passed').length
}

/**
 * The one line above the list.
 *
 * It never says "alles gecontroleerd" when something could not run. That sentence is the exact
 * overstatement this file exists to prevent: the owner would stop looking on the strength of a
 * check the app skipped.
 */
export function checksSummary(checks: readonly InvoiceCheck[]): string {
  const flagged = checks.filter((c) => c.outcome === 'flagged').length
  const unknown = checks.filter((c) => c.outcome === 'not-checked').length
  const passed = checksPassed(checks)

  if (flagged > 0) {
    const kop = flagged === 1 ? 'Eén ding om even naar te kijken' : `${flagged} dingen om even naar te kijken`
    // [CHECKLIST-BEIDE] En de controles die NIET konden draaien, ook als er al iets is opgevallen.
    //
    // Deze tak zweeg daarover, en dat is precies de overdrijving waar de rest van deze functie
    // tegen is gebouwd — één regel hoger staat waarom. Gemeten op een echte factuur: één rood punt
    // (het rekeningnummer van de leverancier was veranderd) en daarboven "Eén ding om even naar te
    // kijken", terwijl het btw-bedrag helemaal niet was nagerekend omdat de factuur tarieven mengt.
    // De ondernemer leest "één ding", regelt dat ding, en hoort nooit dat de btw ongecontroleerd
    // bleef. Twee open punten worden er dan één, in zijn nadeel.
    if (unknown === 0) return kop
    return `${kop} — en ${unknown === 1 ? '1 controle konden we' : `${unknown} controles konden we`} niet nagaan`
  }
  if (unknown > 0) {
    return `${passed} van de ${checks.length} controles gedaan — ${unknown} konden we niet nagaan`
  }
  return `Alle ${checks.length} controles gedaan, niets geks gevonden`
}
