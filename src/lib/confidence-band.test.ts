// [TRUST-UNCERTAIN] Pure node test — run: npx tsx src/lib/confidence-band.test.ts
// Locks the rule that a real-but-hard-to-read invoice is FLAGGED for review, never
// silently dropped, while genuine non-invoices are still skipped quietly.
import { decideConfidenceBand } from './ai'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

check('high confidence → accept', decideConfidenceBand(0.9, true) === 'accept')
check('exactly 0.6 → accept', decideConfidenceBand(0.6, true) === 'accept')
check('uncertain band WITH signal → review (not dropped)', decideConfidenceBand(0.5, true) === 'review')
check('0.35 boundary with signal → review', decideConfidenceBand(0.35, true) === 'review')
check('uncertain band WITHOUT signal → skip (spam/newsletter)', decideConfidenceBand(0.5, false) === 'skip')
check('below hard floor even with signal → skip', decideConfidenceBand(0.2, true) === 'skip')
check('zero → skip', decideConfidenceBand(0, true) === 'skip')
check('NaN → skip (never crash/accept)', decideConfidenceBand(NaN, true) === 'skip')
check('negative → skip', decideConfidenceBand(-1, true) === 'skip')

// The trust invariant: a signal-bearing read in the uncertain band is NEVER dropped.
check('INVARIANT: 0.35–0.6 + signal is always review, never skip',
  [0.35, 0.4, 0.5, 0.59].every((c) => decideConfidenceBand(c, true) === 'review'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
