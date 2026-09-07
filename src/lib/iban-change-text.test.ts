// src/lib/iban-change-text.test.ts — run: npx tsx --test src/lib/iban-change-text.test.ts
// [BETAALMOMENT] De wissel zoals hij is OPGESLAGEN, en de zin die de eigenaar erbij leest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storedIbanChange, ibanChangeReason, formatIban } from './iban-change-text'

test('[BETAALMOMENT] de echte rij: Enka Horeca 26713540', () => {
  // € 1.559,97, nog niet betaald. Bekend op NL89RABO0322814162, op deze factuur NL61INGB0116981407.
  const fc = {
    _safecore: {
      iban_changed: true,
      iban_changed_from: 'NL89RABO0322814162',
      iban_changed_to: 'NL61INGB0116981407',
    },
  }
  const w = storedIbanChange(fc)
  assert.ok(w, 'de wissel staat in de rij en moet eruit komen')
  assert.equal(w!.from, 'NL89RABO0322814162')
  assert.equal(w!.to, 'NL61INGB0116981407')

  // De zin noemt BEIDE nummers — dat IS de controle die de eigenaar moet doen — en de instructie.
  const zin = ibanChangeReason({ from: w!.from!, to: w!.to! })
  assert.match(zin, /NL89 RABO 0322 8141 62/, 'het oude nummer, in blokken van vier')
  assert.match(zin, /NL61 INGB 0116 9814 07/, 'en het nieuwe')
  assert.match(zin, /een nummer dat je zelf opzoekt/,
    'de instructie is het halve punt: wie belt naar het nummer op de vervalste factuur, belt de fraudeur')
})

test('[BETAALMOMENT] een wissel zonder opgeslagen nummers is nog steeds een wissel', () => {
  // Rijen van vóór iban_changed_from bestond. Zwijgen omdat een veld ontbreekt zou de bevinding
  // verbergen op precies de oudste rijen — die niemand meer naleest.
  const w = storedIbanChange({ _safecore: { iban_changed: true } })
  assert.ok(w, 'de wissel verdwijnt niet omdat de cijfers ontbreken')
  assert.equal(w!.from, null)
  assert.equal(w!.to, null)

  // Lege strings tellen als afwezig, niet als een nummer.
  const leeg = storedIbanChange({ _safecore: { iban_changed: true, iban_changed_from: '   ', iban_changed_to: '' } })
  assert.deepEqual(leeg, { from: null, to: null })
})

test('[BETAALMOMENT] tegenproef: zonder wissel wordt er niets gemeld', () => {
  // Zonder deze slagen de twee tests hierboven ook als de functie altijd iets teruggeeft — en dan
  // krijgt élke factuur een rode fraudewaarschuwing, wat de waarschuwing waardeloos maakt.
  assert.equal(storedIbanChange(null), null)
  assert.equal(storedIbanChange(undefined), null)
  assert.equal(storedIbanChange({}), null)
  assert.equal(storedIbanChange({ _safecore: null }), null)
  assert.equal(storedIbanChange({ _safecore: {} }), null)
  assert.equal(storedIbanChange({ _safecore: { iban_changed: false } }), null)
  // En een rij die alleen de nummers draagt zonder de vlag: de vlag is het oordeel, niet de velden.
  assert.equal(storedIbanChange({ _safecore: { iban_changed_from: 'NL89RABO0322814162' } }), null)
})

test('[BETAALMOMENT] formatIban maakt vergelijken mogelijk, en verzint niets', () => {
  assert.equal(formatIban('NL61INGB0116981407'), 'NL61 INGB 0116 9814 07')
  // Een rest van minder dan vier tekens blijft gewoon staan — niets wordt aangevuld of afgekapt.
  assert.equal(formatIban('NL61ING'), 'NL61 ING')
  assert.equal(formatIban(''), '')
})
