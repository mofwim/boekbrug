// [SECURITY] Pure test — run: npx tsx src/lib/timing-safe.test.ts
// Locks the constant-time comparison used to check cron bearer tokens. We can't assert timing here,
// only correctness of the boolean result (equal → true, any difference → false, including length).
import { timingSafeEqualStr } from './timing-safe'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

check('identical strings → true', timingSafeEqualStr('Bearer s3cr3t', 'Bearer s3cr3t') === true)
check('different content, same length → false', timingSafeEqualStr('Bearer aaaaaa', 'Bearer bbbbbb') === false)
check('different length → false', timingSafeEqualStr('Bearer s3cr3t', 'Bearer s3cr3t-longer') === false)
check('empty vs non-empty → false', timingSafeEqualStr('', 'Bearer x') === false)
check('both empty → true', timingSafeEqualStr('', '') === true)
check('one leading byte differs → false (no early-accept)', timingSafeEqualStr('Xearer s3cr3t', 'Bearer s3cr3t') === false)
check('trailing byte differs → false', timingSafeEqualStr('Bearer s3cr3T', 'Bearer s3cr3t') === false)
check('unicode handled (utf8) → true', timingSafeEqualStr('Bearer café', 'Bearer café') === true)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
