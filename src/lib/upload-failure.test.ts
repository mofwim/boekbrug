// src/lib/upload-failure.test.ts — [UPLOAD-ERRORS]
// Run: npx tsx src/lib/upload-failure.test.ts
//
// Wat hier bewaakt wordt is niet de tekst maar de BESLISSING: krijgt de eigenaar een knop die niets
// kan opleveren, en horen we van de server of van onszelf wat er misging. Stijl: check() + exitcode,
// gelijk aan safecore.test.ts en retention.test.ts.

import { describeUploadFailure } from './upload-failure'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n═══ [UPLOAD-ERRORS] geen knop die niets kan opleveren ═══\n')
{
  // DE REGRESSIE. 402 viel in de algemene tak: rode fout + "opnieuw proberen", terwijl opnieuw
  // proberen tot de 1e van de maand hetzelfde antwoord geeft.
  const fair = describeUploadFailure(402, 'Je hebt deze maand 50 documenten laten uitlezen.')
  check('402 draagt geen retry-knop', fair.noRetry === true)
  check('402 is herkenbaar als fair use (→ verwijzing naar /prijzen)', fair.fairUse === true)
  check('402 laat de zin van de server staan — die noemt de echte stand',
    fair.message === 'Je hebt deze maand 50 documenten laten uitlezen.')
  check('402 zonder serverzin valt niet terug op "lezen mislukt"',
    !/lezen mislukt/i.test(describeUploadFailure(402).message))

  // 413 komt van het platform: HTML-body, dus er ís geen serverzin. Juist daarom viel het altijd
  // in de algemene tak en las de eigenaar dat zijn bestand onleesbaar was.
  const big = describeUploadFailure(413)
  check('413 draagt geen retry-knop (hetzelfde bestand blijft te groot)', big.noRetry === true)
  check('413 noemt de grootte, niet het lezen', /te groot/i.test(big.message))
  check('413 negeert een eventuele serverzin (die bestaat hier niet echt)',
    describeUploadFailure(413, 'iets anders').message === big.message)

  // Wél opnieuw proberen, maar met de juiste reden.
  check('504 mag opnieuw geprobeerd worden', describeUploadFailure(504).noRetry !== true)
  check('504 zegt dat het niet aan het bestand ligt', /niet aan je bestand/i.test(describeUploadFailure(504).message))
  check('408 gedraagt zich als 504', describeUploadFailure(408).message === describeUploadFailure(504).message)

  // 429 houdt zijn eigen kleur.
  const rl = describeUploadFailure(429)
  check('429 blijft rateLimited', rl.rateLimited === true)
  check('429 draagt wél een retry-knop', rl.noRetry !== true)

  // De server weet het beter dan wij, waar hij iets zegt.
  check('503 met serverzin gebruikt die zin',
    describeUploadFailure(503, 'We konden dit bestand nu niet lezen.').message === 'We konden dit bestand nu niet lezen.')
  check('503 zonder serverzin heeft een eigen zin',
    describeUploadFailure(503).message.length > 0 && !/undefined/.test(describeUploadFailure(503).message))
  check('500 met serverzin gebruikt die zin',
    describeUploadFailure(500, 'Opslaan van de factuur is mislukt.').message === 'Opslaan van de factuur is mislukt.')

  // Zonder JSON noemen we de status in plaats van te gokken.
  const weird = describeUploadFailure(418)
  check('onbekende status zonder JSON noemt de status', /418/.test(weird.message))
  check('onbekende status doet geen uitspraak over het bestand', !/lezen mislukt/i.test(weird.message))

  // Lege/whitespace serverzin telt niet als zin — anders staat er een lege melding op het scherm.
  check('lege serverzin valt terug op onze eigen zin', describeUploadFailure(500, '   ').message.length > 0)
  check('lege serverzin wordt niet letterlijk getoond', describeUploadFailure(500, '   ').message.trim() !== '')
}

console.log(`\n${failures === 0 ? '✅ ALLE TESTS GESLAAGD' : `❌ ${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
