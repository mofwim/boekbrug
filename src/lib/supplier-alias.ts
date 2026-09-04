// src/lib/supplier-alias.ts
// [SUPPLIER-ALIAS] What the app is allowed to LEARN when the owner corrects a supplier's name.
//
// ── THE STORY ──
// A wholesale invoice comes in, the reader puts "Ozer food bv" in the leverancier field, the owner
// opens the card and types "Oz&er food". Today that one word goes onto that one invoice row and
// nowhere else. Next month the same shop sends the same kind of paper, the reader makes the same
// mistake, and the owner corrects it again. The app never learns, because nothing was ever asked
// to remember.
//
// ── AND IT IS WORSE THAN NOT LEARNING ──
// invoices.client_name is not a label in this app. It is the IDENTITY KEY that four separate
// systems use, all of them through supplierNameKey():
//
//   · knownIbanForVendor — the IBAN-change check, the only thing standing between the owner and a
//     redirected payment. It looks the supplier up by name_key;
//   · the incasso mandate — which suppliers the bank collects from;
//   · the creditnota signal — the numbers this supplier has used before;
//   · the reading memory — what the owner keeps correcting here.
//
// So correcting a name silently moves the invoice OUT of its supplier's history. The corrected
// name finds no suppliers row (that row still holds the misread name), and the fraud check then
// answers "this supplier has no IBAN on record" — which is a clean, unflagged invoice. The
// correction that was meant to make the books more accurate quietly turned a gate off.
//
// ── THE TWO DIMENSIONS, AND WHY THEY ARE NOT THE SAME QUESTION ──
//
//   1. STORING it — the corrected name should reach the supplier registry, so every screen and
//      every gate calls this company what the owner calls it.
//   2. RECOGNISING it next time — and this is the harder half, because the NEXT invoice does not
//      carry the corrected name. It carries what is printed on the paper, read by the same reader
//      that got it wrong. Renaming the supplier row does nothing for that: the misread name still
//      resolves to nothing, or to a second supplier island.
//
// The thing that actually breaks the loop is an ALIAS: "when a paper reads like this, it is that
// supplier". That is a statement about the owner's own books, it is what they just made, and it is
// the only one of the two that survives contact with next month's invoice.
//
// ── WHEN WE MAY RENAME, AND WHEN WE MAY ONLY REMEMBER ──
// A name is the WEAKEST key there is. Renaming a supplier row from an invoice that is linked to it
// by nothing but a name would let one correction rename a company the owner never meant — and
// suppliers is shared by every invoice that points at it. So:
//
//   · linked by a strong key (an existing supplier_id, an IBAN, a KVK) → we know WHICH company
//     this is, and the owner just told us its name. Rename, and remember the old spelling.
//   · name only → remember the alias, change nothing. The alias is safe because it only ever adds
//     a way to FIND a supplier; the rename would change what other invoices are called.
//
// Pure: no I/O. The caller does the reads, and one of those reads is not optional — see
// aliasWouldHijack.

import { supplierNameKey, isReliableSupplierName } from '@/lib/supplier-registry'

/** Why nothing was learned from this correction. Each one is a case where learning would be wrong. */
export type AliasHold =
  | 'no-change'         // the name did not actually change
  | 'unreliable-name'   // "Onbekende afzender" and friends — keying on it merges every stranger
  | 'same-key'          // "Ozer Food BV" → "Ozer Food B.V.": the registry already treats these as one
  | 'nothing-printed'   // there was no previous name to alias FROM
  | 'placeholder-printed' // the previous name was a placeholder, so it may never become a key

/** Dutch, owner-facing. Only 'unreliable-name' is worth showing; the rest are silent non-events. */
export const ALIAS_HOLD_REASON: Record<AliasHold, string | null> = {
  'no-change': null,
  'same-key': null,
  'nothing-printed': null,
  // Silent on purpose. The owner did nothing wrong here — they typed the right company over a
  // placeholder the READER produced. 'unreliable-name' asks them to "fill in the name as it appears
  // on the invoice", which they already did; saying it would send them back to fix nothing.
  'placeholder-printed': null,
  'unreliable-name': 'deze naam is te algemeen om te onthouden — vul de naam van de leverancier aan zoals hij op de factuur staat',
}

export type AliasPlan =
  | {
      learn: true
      /** The normalized key of what was PRINTED — the spelling next month's invoice will carry. */
      aliasKey: string
      /** The name the owner gave. What the supplier should be called from now on. */
      canonicalName: string
      /** The key of the corrected name, for the caller's own lookups. */
      canonicalKey: string
      /**
       * May the caller also RENAME the supplier row?
       *
       * Only when the invoice identifies the company by something stronger than a name. An alias
       * adds a way to find a supplier and can be undone by deleting one row; a rename changes what
       * every other invoice pointing at that supplier is called.
       */
      mayRename: boolean
    }
  | { learn: false; hold: AliasHold }

export interface AliasInput {
  /** What stood in the leverancier field BEFORE the correction — the reader's version. */
  printedName: string | null | undefined
  /** What the owner typed. */
  correctedName: string | null | undefined
  /** The invoice's existing supplier link, when it has one. A strong identity on its own. */
  supplierId?: string | null
  /** The supplier's account number as printed on this invoice. The strongest key in the registry. */
  vendorIban?: string | null
  /** The supplier's KVK, when the reader found one. Legal, unique. */
  kvk?: string | null
}

/**
 * What may be learned from one name correction.
 *
 * The order is the order of certainty, and every hold below is a case where the app knows less than
 * it would be claiming.
 */
export function planSupplierAlias(input: AliasInput): AliasPlan {
  const printed = (input.printedName ?? '').trim()
  const corrected = (input.correctedName ?? '').trim()

  if (!corrected) return { learn: false, hold: 'no-change' }
  if (!printed) return { learn: false, hold: 'nothing-printed' }
  if (printed === corrected) return { learn: false, hold: 'no-change' }

  // A placeholder as an alias key would point every unidentified invoice in the book at one
  // supplier — the same reason resolveSupplierForImport refuses to create a supplier from one.
  //
  // BOTH SIDES, and only one of them was checked. The sentence above is about the alias KEY, which
  // comes from `printed`; the guard read `corrected`. So "Onbekende afzender" — the literal string
  // /api/intake writes when the reader found no sender — corrected to a real company was a learn,
  // and the lesson it stored was "every invoice whose sender could not be read is that company".
  // The reader fails on a bad photo, not on a particular supplier, so the next unreadable invoice
  // from anyone would inherit that name, its IBAN, and its place in the crediteurenstand.
  if (!isReliableSupplierName(corrected)) return { learn: false, hold: 'unreliable-name' }

  const aliasKey = supplierNameKey(printed)
  const canonicalKey = supplierNameKey(corrected)
  if (!aliasKey) return { learn: false, hold: 'nothing-printed' }
  // After the empty-key check, so "&&&" is still reported as nothing printed — which is what it is.
  // This one is for a printed name that IS a string and still may not be a key.
  if (!isReliableSupplierName(printed)) return { learn: false, hold: 'placeholder-printed' }
  // "Ozer Food BV" and "Ozer Food B.V." already normalize to the same key: the registry has always
  // treated them as one company, so there is no second spelling to remember. Not a failure —
  // the correction was cosmetic and the identity never moved.
  if (aliasKey === canonicalKey) return { learn: false, hold: 'same-key' }

  // The rename half. A supplier_id, an IBAN or a KVK each say WHICH company this is independently
  // of what the paper spelled — without one of them, all we have is one name pointing at another.
  const mayRename = !!(input.supplierId || (input.vendorIban ?? '').trim() || (input.kvk ?? '').trim())

  return { learn: true, aliasKey, canonicalName: corrected, canonicalKey, mayRename }
}

/**
 * Would storing this alias steal a name that already belongs to a DIFFERENT supplier?
 *
 * The case: the owner corrects "Jumbo" to "Jumbo Tilburg", and "Jumbo" is itself a supplier in
 * their book. Aliasing `jumbo` → Jumbo Tilburg would make every future Jumbo invoice resolve to
 * the Tilburg branch, silently, including the ones that are not from it.
 *
 * Pure, so the caller does the read and hands the result in. It is not optional: an alias whose key
 * collides with a live supplier's own name_key is the one way this feature can lose data instead of
 * finding it.
 */
export function aliasWouldHijack(
  aliasKey: string,
  existingSuppliers: readonly { id: string; name_key: string | null }[],
  targetSupplierId: string | null,
): boolean {
  return existingSuppliers.some((s) => s.name_key === aliasKey && s.id !== targetSupplierId)
}

/**
 * The sentence the owner reads when it was remembered. Product text, so Dutch (AGENTS.md).
 *
 * It names the CONSEQUENCE, not the mechanism: what the owner cares about is that they will not be
 * typing this again next month.
 */
export function aliasLearnedText(plan: Extract<AliasPlan, { learn: true }>, printedName: string): string {
  return plan.mayRename
    ? `Onthouden: facturen met "${printedName}" erop noemen we voortaan ${plan.canonicalName}.`
    : `Onthouden: "${printedName}" op een factuur betekent voortaan ${plan.canonicalName}.`
}
