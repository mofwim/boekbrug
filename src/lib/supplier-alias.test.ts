// [SUPPLIER-ALIAS] Pure node test — run: npx tsx --test src/lib/supplier-alias.test.ts
//
// The case this is all for: the reader writes "Ozer food bv", the owner types "Oz&er food", and
// next month the same paper arrives and reads the same wrong way. What has to survive that month
// is not the corrected name — the next invoice does not carry it — but the LINK between the two.
//
// The other half is the one that can lose data: a name is the weakest key there is, and both a
// rename and an alias reach beyond the invoice they were made on.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planSupplierAlias,
  aliasWouldHijack,
  aliasLearnedText,
  ALIAS_HOLD_REASON,
  type AliasPlan,
} from './supplier-alias'

/** The plan's hold, or null when it learned something. Keeps each case to one line. */
function hold(plan: AliasPlan): string | null {
  return plan.learn ? null : plan.hold
}

test('[SUPPLIER-ALIAS] the correction that started this is remembered', () => {
  const plan = planSupplierAlias({
    printedName: 'Ozer food bv', correctedName: 'Oz&er food', vendorIban: 'NL65RABO0171136276',
  })
  assert.equal(plan.learn, true)
  assert.equal(plan.learn && plan.aliasKey, 'ozer food', 'keyed on what the PAPER says — that is what comes back next month')
  assert.equal(plan.learn && plan.canonicalName, 'Oz&er food', 'and it resolves to what the owner calls them')
  assert.equal(plan.learn && plan.mayRename, true, 'the IBAN says which company this is, so the registry may adopt the name')
})

test('[SUPPLIER-ALIAS] a name-only correction is remembered but renames nothing', () => {
  // The distinction the whole module exists for. An alias only ever ADDS a way to find a supplier
  // and is undone by deleting one row. A rename changes what every other invoice pointing at that
  // supplier is called — and one name pointing at another is not enough to authorise that.
  const plan = planSupplierAlias({ printedName: 'Ozer food bv', correctedName: 'Oz&er food' })
  assert.equal(plan.learn, true, 'the alias is still safe — it finds, it does not overwrite')
  assert.equal(plan.learn && plan.mayRename, false, 'but nothing may be renamed on a name alone')

  // Each strong key on its own is enough.
  for (const strong of [{ supplierId: 's1' }, { vendorIban: 'NL65RABO0171136276' }, { kvk: '76895009' }]) {
    const p = planSupplierAlias({ printedName: 'Ozer food bv', correctedName: 'Oz&er food', ...strong })
    assert.equal(p.learn && p.mayRename, true, `${Object.keys(strong)[0]} identifies the company`)
  }
})

test('[SUPPLIER-ALIAS] a cosmetic correction is not a second spelling', () => {
  // "Ozer Food BV" and "Ozer Food B.V." already normalize to one key, so the registry has always
  // treated them as the same company. Storing an alias here would be a row pointing at itself.
  assert.equal(hold(planSupplierAlias({ printedName: 'Ozer Food BV', correctedName: 'Ozer Food B.V.' })), 'same-key')
  assert.equal(hold(planSupplierAlias({ printedName: 'Oz&er food', correctedName: 'Oz&er food' })), 'no-change')
  assert.equal(hold(planSupplierAlias({ printedName: 'Oz&er food', correctedName: '  Oz&er food  ' })), 'no-change', 'trimmed on both sides')
  assert.equal(ALIAS_HOLD_REASON['same-key'], null, 'and the owner is told nothing, because nothing happened')
})

test('[SUPPLIER-ALIAS] a placeholder is never a key', () => {
  // The failure that would be invisible: alias "onbekende afzender" → some supplier, and from then
  // on every invoice the reader could not identify resolves to that one company.
  for (const junk of ['Onbekende afzender', 'Onbekend', '???', 'x']) {
    assert.equal(
      hold(planSupplierAlias({ printedName: 'Ozer food bv', correctedName: junk })), 'unreliable-name',
      `"${junk}" must not become a supplier's name`,
    )
  }
  assert.match(ALIAS_HOLD_REASON['unreliable-name'] ?? '', /zoals hij op de factuur staat/, 'and this one IS said, with a way out')
})

test('[SUPPLIER-ALIAS] with nothing printed there is nothing to alias from', () => {
  // An invoice whose leverancier field was empty: the owner is FILLING IN, not correcting. There is
  // no second spelling to remember — and an empty key would match every nameless invoice.
  assert.equal(hold(planSupplierAlias({ printedName: null, correctedName: 'Oz&er food' })), 'nothing-printed')
  assert.equal(hold(planSupplierAlias({ printedName: '   ', correctedName: 'Oz&er food' })), 'nothing-printed')
  assert.equal(hold(planSupplierAlias({ printedName: '&&&', correctedName: 'Oz&er food' })), 'nothing-printed', 'punctuation normalizes to no key at all')
})

test('[SUPPLIER-ALIAS] an alias may never steal a name that is already a supplier', () => {
  // The one way this feature loses data instead of finding it: the owner corrects "Jumbo" to
  // "Jumbo Tilburg" while "Jumbo" is itself a supplier in their book. Aliasing `jumbo` would send
  // every future Jumbo invoice to the Tilburg branch, silently, including the ones that are not.
  const suppliers = [
    { id: 'jumbo', name_key: 'jumbo' },
    { id: 'tilburg', name_key: 'jumbo tilburg' },
  ]
  assert.equal(aliasWouldHijack('jumbo', suppliers, 'tilburg'), true, 'that alias belongs to another supplier')
  assert.equal(aliasWouldHijack('jumbo', suppliers, 'jumbo'), false, 'pointing a key at its own supplier is a no-op, not a theft')
  assert.equal(aliasWouldHijack('ozer food', suppliers, 'tilburg'), false, 'a key nobody owns is free')
  assert.equal(aliasWouldHijack('jumbo', [], null), false, 'no suppliers, nothing to collide with')
})

test('[SUPPLIER-ALIAS] the owner is told what will happen next month, not how it works', () => {
  const strong = planSupplierAlias({ printedName: 'Ozer food bv', correctedName: 'Oz&er food', supplierId: 's1' })
  const weak = planSupplierAlias({ printedName: 'Ozer food bv', correctedName: 'Oz&er food' })
  assert.ok(strong.learn && weak.learn, 'precondition')
  for (const [plan, label] of [[strong, 'strong'], [weak, 'weak']] as const) {
    const text = aliasLearnedText(plan as Extract<AliasPlan, { learn: true }>, 'Ozer food bv')
    assert.match(text, /Oz&er food/, `${label}: it names what they will be called`)
    assert.match(text, /Ozer food bv/, `${label}: and what was on the paper`)
    assert.doesNotMatch(text, /[a-z]+_[a-z]+|alias|key/i, `${label}: no machine words in a sentence the owner reads: "${text}"`)
  }
})

// ─── Wiring gates ─────────────────────────────────────────────────────────────
//
// The decision above is pure and covered. What is NOT visible at runtime is whether it is ever
// CALLED — and this is a feature whose entire failure mode is silence: the correction saves, the
// screen updates, and the app simply learns nothing. That is exactly the state it was in.

import { readFileSync } from 'node:fs'

/** Source with comments stripped — this file explains the mistakes the gates look for. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

test('[SUPPLIER-ALIAS] BOTH correction doors learn from a corrected name', () => {
  // The queue's confirm and the pay screen's correction sheet are the same act in two places. A
  // lesson learned at one and not the other is a feature the owner cannot rely on — and the queue
  // is the door they use first, on every imported invoice.
  for (const door of [
    'src/app/api/invoice/[id]/amounts/route.ts',
    'src/app/api/email/confirm/[id]/route.ts',
  ]) {
    const src = code(door)
    assert.match(
      src, /learnSupplierAlias\(/,
      `${door} saves a corrected leverancier name and learns nothing from it — next month the reader ` +
        `repeats the same misread and the owner corrects it again`,
    )
    // The strong keys have to be READ, or mayRename can never be true and the registry keeps the
    // misread name forever while the invoices show the corrected one.
    assert.match(src, /supplier_id, vendor_iban/, `${door} no longer reads the keys that say WHICH company this is`)
  }
})

test('[SUPPLIER-ALIAS] the import consults what the owner already taught it', () => {
  // Storing the lesson and never reading it is the same as not storing it. This is the one call
  // that turns a stored alias into a supplier that stops splitting into islands.
  const src = code('src/lib/supplier-registry.ts')
  assert.match(
    src, /supplierIdForPrintedName\(/,
    'resolveSupplierForImport no longer looks at the aliases, so a corrected misread founds a new ' +
      'supplier row again every month',
  )
  // Ahead of the name tiers, behind the IBAN. An IBAN is a stronger statement about identity than a
  // name mapping, and letting a stale lesson outrank it could redirect a payment.
  const aliasAt = src.indexOf('supplierIdForPrintedName(')
  // [ÉÉN-LEVERANCIERSSLEUTEL] The name tier's marker moved: the raw .eq('name_key', key) now
  // lives inside findByNameKeyHealing, and the tier is its LAST call site (the IBAN- and
  // KVK-adoption lookups come earlier). The invariant is unchanged — alias before the plain
  // name tier — only the spelling of the tier moved.
  const nameTierAt = src.lastIndexOf('findByNameKeyHealing(')
  assert.ok(aliasAt > 0 && nameTierAt > 0, 'both tiers must still exist')
  assert.ok(aliasAt < nameTierAt, 'the alias must be consulted before the plain name tier')
  assert.match(src, /if \(!iban\) \{/, 'and never ahead of the IBAN, which is the stronger identity')
})

test('[SUPPLIER-ALIAS] the hijack check is not optional', () => {
  const src = code('src/lib/supplier-alias-write.ts')
  assert.match(
    src, /aliasWouldHijack\(/,
    'without it, correcting "Jumbo" to "Jumbo Tilburg" re-points every future Jumbo invoice at the ' +
      'Tilburg branch — the one way this feature loses data instead of finding it',
  )
  // Learning must never be able to fail a correction that already saved.
  assert.match(src, /catch \(e\) \{/, 'the learn path must swallow its own failures')
})
