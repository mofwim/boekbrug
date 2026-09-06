// [DUP-ON-PAY] Pure node test — run: npx tsx --test src/lib/duplicate-payable.test.ts
//
// Both real pairs are here verbatim, because both were found by the owner adding up their own pay
// list rather than by the app saying anything:
//
//     26701681  Enka Horeca B.V.        € 1.348,14  and  € 1.335,68
//     2601291   Al-Malika Bakkerij B.V. € 128,40    and  € 155,43
//
// The import-time [DEDUP-CORRECTED] flag knows this shape and is deliberately not a block. What
// was missing is the SECOND moment: both copies confirmed, side by side on the pay screen, each
// with a Betalen button, both counted in the total at the top.
//
// The other half is what must NOT be paired, and it is the half that makes the warning worth
// reading: a placeholder number, and two different suppliers who both number from 1.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  findPayableDuplicates,
  duplicateWarningText,
  type DuplicateCandidateRow,
} from './duplicate-payable'

const row = (o: Partial<DuplicateCandidateRow> & { id: string }): DuplicateCandidateRow => ({
  invoice_number: '26701681',
  client_name: 'Enka Horeca B.V.',
  invoice_date: '2026-03-11',
  total_inc_btw: 1335.68,
  status: 'received',
  amount_paid: 0,
  ...o,
})

test('[DUP-ON-PAY] the Enka pair is found, and both rows are told', () => {
  const rows = [
    row({ id: 'a', total_inc_btw: 1348.14 }),
    row({ id: 'b', total_inc_btw: 1335.68 }),
    row({ id: 'other', invoice_number: '26302050', client_name: 'ATAPACK Cash & Carry B.V.', invoice_date: '2026-03-11', total_inc_btw: 6662.8 }),
  ]
  const dups = findPayableDuplicates(rows)
  assert.equal(dups.size, 2, 'both copies carry the warning — the owner may open either one')
  assert.equal(dups.has('other'), false, 'an unrelated invoice is left alone')

  const w = dups.get('a')!
  assert.equal(w.others.length, 1)
  assert.equal(w.amountsDiffer, true, 'a corrected re-issue, not a plain double import')
  assert.equal(w.anyPaid, false)

  // The text has to name the OTHER amount: that is the whole decision, and it is answered by
  // looking at the paper. On this very pair the CORRECT copy was the one our reader got wrong.
  const text = duplicateWarningText(w, '26701681')
  assert.match(text, /26701681/)
  // Row 'a' IS the € 1.348,14 copy, so what it must name is the OTHER one.
  assert.match(text, /1\.335,68/, 'it names what the other copy says')
  assert.match(duplicateWarningText(dups.get('b')!, '26701681'), /1\.348,14/, 'and symmetrically')
  assert.match(text, /correctie of een dubbele import/)
})

test('[DUP-ON-PAY] the Al-Malika pair too, across a differently-read legal suffix', () => {
  // The two imports need not have read the supplier name identically. Folding the legal suffix is
  // what makes the pairing survive that.
  const rows = [
    row({ id: 'x', invoice_number: '2601291', client_name: 'Al-Malika Bakkerij B.V.', invoice_date: '2026-03-11', total_inc_btw: 128.4 }),
    row({ id: 'y', invoice_number: '2601291', client_name: 'Al-Malika Bakkerij bv', invoice_date: '2026-03-11', total_inc_btw: 155.43 }),
  ]
  const dups = findPayableDuplicates(rows)
  assert.equal(dups.size, 2)
  assert.match(duplicateWarningText(dups.get('x')!, '2601291'), /155,43/)
})

test('[DUP-ON-PAY] an already-paid twin is the expensive case and says so first', () => {
  const rows = [
    row({ id: 'open' }),
    row({ id: 'settled', status: 'paid', amount_paid: 1335.68 }),
  ]
  const w = findPayableDuplicates(rows).get('open')!
  assert.equal(w.anyPaid, true)
  const text = duplicateWarningText(w, '26701681')
  assert.match(text, /al betaald/, 'about to pay a bill that is already settled')
  assert.doesNotMatch(text, /Verwijder er één/, 'deleting is not the advice when money already moved')
})

test('[DUP-ON-PAY] two copies of the SAME amount read as a double import', () => {
  const w = findPayableDuplicates([row({ id: 'a' }), row({ id: 'b' })]).get('a')!
  assert.equal(w.amountsDiffer, false)
  assert.match(duplicateWarningText(w, '26701681'), /twee keer geïmporteerd/)
})

test('[DUP-ON-PAY] what must NOT be paired', () => {
  // Two suppliers who both number from 1. Numbers are unique PER supplier, not across them —
  // pairing these puts a false warning on two honest invoices.
  const twoSuppliers = findPayableDuplicates([
    row({ id: 'p', invoice_number: '0714', client_name: 'Bakkerij Saada' }),
    row({ id: 'q', invoice_number: '0714', client_name: 'Dutch Sweets Company B.V.' }),
  ])
  assert.equal(twoSuppliers.size, 0)

  // A placeholder is minted per import and can only ever collide by accident, so it is never a KEY.
  // [BON-DUBBEL] Two such rows are still paired — on their supplier, amount and date, and reported
  // as matchedOn 'amount'. What is asserted here is the thing that must not happen: the pairing may
  // not be attributed to the number, because then the sentence would tell the owner these are
  // certainly one document.
  const placeholders = findPayableDuplicates([
    row({ id: 'r', invoice_number: 'UPLOAD-1700000000000' }),
    row({ id: 's', invoice_number: 'UPLOAD-1700000000000' }),
  ])
  for (const w of placeholders.values()) {
    assert.equal(w.matchedOn, 'amount', 'a minted stand-in may never count as a matching number')
  }

  // No supplier — nothing to key on either way, in both passes.
  assert.equal(findPayableDuplicates([row({ id: 'v', client_name: null }), row({ id: 'w', client_name: null })]).size, 0)

  // And the clause that keeps the amount pass quiet: two REAL numbers from one supplier for the
  // same amount is a monthly bill at a fixed price. This administration is full of them — rent,
  // KPN, the bookkeeper — and pairing those would put a false warning on fifty honest invoices.
  assert.equal(
    findPayableDuplicates([
      row({ id: 'huur1', invoice_number: 'VHF0000939101', client_name: 'WonenBreburg', invoice_date: '2026-02-15', total_inc_btw: 81.51 }),
      row({ id: 'huur2', invoice_number: 'VHF0000905921', client_name: 'WonenBreburg', invoice_date: '2026-01-15', total_inc_btw: 81.51 }),
    ]).size,
    0,
    'two invoices that each carry their own number are two invoices',
  )

  // And a single invoice is never a duplicate of itself.
  assert.equal(findPayableDuplicates([row({ id: 'only' })]).size, 0)
})

test('[DUP-ON-PAY] spacing in a printed number does not hide the pair', () => {
  // The same folding the hard dedup key uses: "26 / 3958" and "26/3958" are one number.
  const dups = findPayableDuplicates([
    row({ id: 'a', invoice_number: '26 / 3958' }),
    row({ id: 'b', invoice_number: '26/3958' }),
  ])
  assert.equal(dups.size, 2)
})

// ── [HAND-DUBBEL] De rij die AL betaald is, gezien vanaf de tik ────────────────────────────────
//
// Twee van de drie dubbele boekingen in de live administratie zijn door de "betaald"-tik gemaakt,
// niet door een automatische pas. Op dat moment stond de tweelingrij al betaald — door de bank —
// en de lijst waar de waarschuwing uit komt bevatte hem niet altijd. De server kijkt nu zelf, en
// dit is het antwoord dat hij daarop leest.

test('[HAND-DUBBEL] een tweeling die al betaald is, is de dure waarschuwing', () => {
  // FAMZFOOD "26 / 1876": twee lezingen, hetzelfde bedrag, de ene door de bank betaald op 9 maart.
  // De leestekens verschillen — dat is precies waarom de nummers genormaliseerd worden vergeleken.
  const w = findPayableDuplicates([
    { id: 'open', invoice_number: '26 / 1876', client_name: 'FAMZFOOD BV', invoice_date: '2026-03-11', total_inc_btw: 665.02, status: 'received', amount_paid: 0 },
    { id: 'betaald', invoice_number: '26/1876', client_name: 'FAMZFOOD bv', invoice_date: '2026-03-11', total_inc_btw: 665.02, status: 'paid', amount_paid: 665.02 },
  ]).get('open')
  assert.ok(w, 'de twee rijen horen als één factuur herkend te worden')
  assert.equal(w!.anyPaid, true, 'de tweeling staat betaald — dit is de toestand die geld kost')
  assert.equal(w!.amountsDiffer, false)
  assert.match(
    duplicateWarningText(w!, '26 / 1876'), /al betaald/,
    'de zin moet zeggen dat de andere al betaald is — dat is wat de tik tegenhoudt',
  )
})

test('[HAND-DUBBEL] ook als de twee lezingen het over het bedrag oneens zijn', () => {
  // Doyum 26700385: de bank betaalde 222,05 met het factuurnummer erbij; de tweede lezing zei
  // 239,47 en werd er bovenop geboekt.
  const w = findPayableDuplicates([
    { id: 'tweede', invoice_number: '26700385', client_name: 'Doyum Food B.V.', invoice_date: '2026-03-11', total_inc_btw: 239.47, status: 'received', amount_paid: 0 },
    { id: 'echt', invoice_number: '26700385', client_name: 'Doyum Food B.V.', invoice_date: '2026-03-11', total_inc_btw: 222.05, status: 'paid', amount_paid: 222.05 },
  ]).get('tweede')
  assert.ok(w)
  assert.equal(w!.anyPaid, true)
  assert.equal(w!.amountsDiffer, true, 'verschillende bedragen — een correctie of een dubbele lezing')
})

test('[HAND-DUBBEL] tegenproef: twee leveranciers met hetzelfde nummer is géén waarschuwing', () => {
  // Zonder deze test slaagt alles hierboven ook als de regel alleen op het nummer sleutelt — en dan
  // krijgt elke eerlijke "2026001" een waarschuwing, wat de waarschuwing waardeloos maakt.
  const w = findPayableDuplicates([
    { id: 'a', invoice_number: '2026001', client_name: 'Bakkerij Noord', invoice_date: '2026-03-11', total_inc_btw: 100, status: 'received', amount_paid: 0 },
    { id: 'b', invoice_number: '2026001', client_name: 'Loodgieter De Vries', invoice_date: '2026-03-11', total_inc_btw: 100, status: 'paid', amount_paid: 100 },
  ])
  assert.equal(w.size, 0, 'nummers zijn uniek PER leverancier, niet erover heen')
})

// ── [BON-DUBBEL] De bon die geen nummer heeft ──────────────────────────────────────────────────
//
// Een gefotografeerde kassabon draagt een verzonnen stand-in ("CAMERA-1784373753563", één per
// import), dus twee foto's van ÉÉN bon leveren twee nummers op die nooit kunnen matchen. Dat is
// precies de invoerweg waar dezelfde bon het makkelijkst twee keer belandt — het is één tik.
//
// In de live administratie: Nettorama Huizen € 10,74, twee rijen die vijfendertig seconden na
// elkaar zijn aangemaakt in één upload. De ene draagt CAMERA-1784373753563 en 22 april, de andere
// 631394 en 1 juni — met een betaaldatum van 1 mei, vóór zijn eigen factuurdatum. € 0,89
// voorbelasting dubbel, en geen van beide rijen zei ooit iets.

test('[BON-DUBBEL] het echte Nettorama-paar wordt nu wél gezien', () => {
  const w = findPayableDuplicates([
    { id: 'foto', invoice_number: 'CAMERA-1784373753563', client_name: 'Nettorama Huizen',
      invoice_date: '2026-04-22', total_inc_btw: 10.74, status: 'received', amount_paid: 0 },
    { id: 'betaald', invoice_number: '631394', client_name: 'Nettorama Huizen',
      invoice_date: '2026-06-01', total_inc_btw: 10.74, status: 'paid', amount_paid: 10.74 },
  ]).get('foto')

  assert.ok(w, 'de twee rijen horen als mogelijk hetzelfde document herkend te worden')
  assert.equal(w!.matchedOn, 'amount', 'op het bedrag vergeleken, niet op het nummer')
  assert.equal(w!.anyPaid, true, 'de andere staat betaald — dit is de toestand die geld kost')
  assert.equal(w!.amountsDiffer, false, 'gelijk tot op de cent, want dat is wat ze koppelde')

  // En de zin zegt WAT er is vergeleken, en beweert niet dat het één document is.
  const zin = duplicateWarningText(w!, 'CAMERA-1784373753563')
  assert.match(zin, /Nettorama Huizen/, 'noem de leverancier — dat is waar de eigenaar op zoekt')
  assert.match(zin, /geen leesbaar factuurnummer/, 'zeg waarom de vergelijking zwakker is')
  assert.match(zin, /al betaald/, 'de andere staat betaald, en dat is de reden om te stoppen')
  assert.doesNotMatch(zin, /Verwijder er één/,
    'op twee bonnen die toevallig hetzelfde kosten vernietigt dat advies een echte voorbelasting')
  assert.doesNotMatch(zin, /CAMERA-/, 'een verzonnen nummer hoort niet op het scherm van de eigenaar')
})

test('[BON-DUBBEL] het venster: dezelfde bon slecht gelezen, en twee losse aankopen', () => {
  const paar = (datumA: string, datumB: string) => findPayableDuplicates([
    { id: 'a', invoice_number: 'CAMERA-1', client_name: 'ALDI', invoice_date: datumA,
      total_inc_btw: 46.22, status: 'received', amount_paid: 0 },
    { id: 'b', invoice_number: 'CAMERA-2', client_name: 'ALDI', invoice_date: datumB,
      total_inc_btw: 46.22, status: 'received', amount_paid: 0 },
  ])

  // Veertig dagen: precies de afstand van het Nettorama-paar, ontstaan doordat één lezing de datum
  // mis had. Een krap venster laat juist de slecht gelezen paren door, en dat zijn de enige die
  // niets anders vangt.
  assert.equal(paar('2026-04-22', '2026-06-01').size, 2, 'veertig dagen valt binnen het venster')
  assert.equal(paar('2026-04-21', '2026-04-21').size, 2, 'dezelfde dag hoort er zeker bij')

  // Maar een half jaar niet: dan zijn het twee keer boodschappen doen.
  assert.equal(paar('2026-01-05', '2026-08-05').size, 0, 'zeven maanden is geen leesfout')
})

test('[BON-DUBBEL] een datum die ontbreekt is geen antwoord van "ver uit elkaar"', () => {
  // [NO-SILENT-EMPTY] Een document waarvan het nummer niet te lezen was, is precies het document
  // waarvan ook de datum onzeker is. "Ik weet niet wanneer dit was" stilzwijgend als "deze horen
  // niet bij elkaar" behandelen, is een controle die niet kon lopen laten lezen als een controle
  // die slaagde — en dan zwijgt de app juist op het slechtst gelezen paar.
  const w = findPayableDuplicates([
    { id: 'zonder', invoice_number: 'CAMERA-9', client_name: 'Lidl Tilburg', invoice_date: null,
      total_inc_btw: 70.29, status: 'received', amount_paid: 0 },
    { id: 'met', invoice_number: '884412', client_name: 'Lidl Tilburg', invoice_date: '2026-04-23',
      total_inc_btw: 70.29, status: 'paid', amount_paid: 70.29 },
  ])
  assert.equal(w.size, 2, 'een onbekende datum sluit het paar niet uit')
  assert.equal(w.get('zonder')!.anyPaid, true)
})

test('[BON-DUBBEL] tegenproef: het nummer blijft het sterkste bewijs', () => {
  // Een rij die op haar NUMMER al gekoppeld is, houdt die koppeling. De zwakkere van twee
  // bevindingen tonen zou een stap terug zijn op precies de rijen waar we het meest weten.
  const w = findPayableDuplicates([
    { id: 'a', invoice_number: '26701681', client_name: 'Enka Horeca B.V.', invoice_date: '2026-03-11',
      total_inc_btw: 1335.68, status: 'received', amount_paid: 0 },
    { id: 'b', invoice_number: '26701681', client_name: 'Enka Horeca bv', invoice_date: '2026-03-11',
      total_inc_btw: 1335.68, status: 'paid', amount_paid: 1335.68 },
    { id: 'foto', invoice_number: 'CAMERA-7', client_name: 'Enka Horeca B.V.', invoice_date: '2026-03-11',
      total_inc_btw: 1335.68, status: 'received', amount_paid: 0 },
  ])
  assert.equal(w.get('a')!.matchedOn, 'number', 'het nummer koppelde deze twee, en dat blijft zo')
  assert.equal(w.get('foto')!.matchedOn, 'amount', 'de foto heeft geen nummer en wordt op bedrag gekoppeld')

  // [NEGATIEVE CONTROLE] Alles hierboven slaagt ook als de tweede pas ALLES koppelt wat hetzelfde
  // bedrag heeft. Deze pinnen de andere kant: zonder één nummerloze rij gebeurt er niets, en een
  // ander bedrag koppelt nooit.
  assert.equal(findPayableDuplicates([
    { id: 'x', invoice_number: '1260089', client_name: 'ONS IT', invoice_date: '2026-02-02',
      total_inc_btw: 32.67, status: 'paid', amount_paid: 32.67 },
    { id: 'y', invoice_number: '1260184', client_name: 'ONS IT', invoice_date: '2026-03-03',
      total_inc_btw: 32.67, status: 'paid', amount_paid: 32.67 },
  ]).size, 0, 'twee eigen nummers is een maandelijkse rekening, geen paar')

  assert.equal(findPayableDuplicates([
    { id: 'p', invoice_number: 'CAMERA-3', client_name: 'ALDI', invoice_date: '2026-04-21',
      total_inc_btw: 46.22, status: 'received', amount_paid: 0 },
    { id: 'q', invoice_number: 'CAMERA-4', client_name: 'ALDI', invoice_date: '2026-04-21',
      total_inc_btw: 46.23, status: 'received', amount_paid: 0 },
  ]).size, 0, 'één cent verschil is een ander bedrag — een gelijkenis is deze regel niet genoeg')

  assert.equal(findPayableDuplicates([
    { id: 'm', invoice_number: 'CAMERA-5', client_name: 'ALDI', invoice_date: '2026-04-21',
      total_inc_btw: 46.22, status: 'received', amount_paid: 0 },
    { id: 'n', invoice_number: 'CAMERA-6', client_name: 'Lidl Tilburg', invoice_date: '2026-04-21',
      total_inc_btw: 46.22, status: 'received', amount_paid: 0 },
  ]).size, 0, 'twee winkels die toevallig hetzelfde kosten zijn twee aankopen')

  // Nul is geen bedrag om op te koppelen: dan lijkt elke nulregel op elke andere.
  assert.equal(findPayableDuplicates([
    { id: 'n1', invoice_number: 'CAMERA-10', client_name: 'ALDI', invoice_date: '2026-04-21',
      total_inc_btw: 0, status: 'received', amount_paid: 0 },
    { id: 'n2', invoice_number: 'CAMERA-11', client_name: 'ALDI', invoice_date: '2026-04-21',
      total_inc_btw: 0, status: 'received', amount_paid: 0 },
  ]).size, 0)
})

test('[BON-DUBBEL] de nummerloze regel geldt per PAAR, niet per groep', () => {
  // De fout die dit vangt zat in de eerste versie van deze pas: de groep kwalificeerde zodra ér
  // één nummerloze rij in zat, en daarna koppelden de twee GENUMMERDE rijen met elkaar. Precies de
  // maandrekening-ruis die de nummerloze clausule moet wegnemen, via de achterdeur terug.
  const w = findPayableDuplicates([
    { id: 'bon', invoice_number: 'CAMERA-12', client_name: 'ONS IT', invoice_date: '2026-02-02',
      total_inc_btw: 32.67, status: 'received', amount_paid: 0 },
    { id: 'feb', invoice_number: '1260089', client_name: 'ONS IT', invoice_date: '2026-02-02',
      total_inc_btw: 32.67, status: 'paid', amount_paid: 32.67 },
    { id: 'mrt', invoice_number: '1260184', client_name: 'ONS IT', invoice_date: '2026-03-03',
      total_inc_btw: 32.67, status: 'paid', amount_paid: 32.67 },
  ])

  // De bon wordt met allebei vergeleken — hij heeft geen nummer, dus dat is de vraag die hoort.
  assert.equal(w.get('bon')!.others.length, 2)
  assert.equal(w.get('bon')!.matchedOn, 'amount')

  // Maar februari en maart zien elkaar niet: allebei een eigen nummer.
  for (const id of ['feb', 'mrt']) {
    const warn = w.get(id)
    assert.ok(warn, `${id} hoort de bon wél te zien`)
    assert.deepEqual(warn!.others.map((o) => o.id), ['bon'],
      `${id} is gekoppeld aan een rij die haar eigen factuurnummer draagt — twee eigen nummers ` +
      'zijn twee facturen, ook als er toevallig een bon van hetzelfde bedrag naast ligt')
  }
})
