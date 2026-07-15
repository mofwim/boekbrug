// [TRUST-DEDUP] Pure node test — run: npx tsx src/lib/email-dedup.test.ts
// Guards the number-tier duplicate check: a re-arrived invoice under a differently
// formatted vendor name must STILL be caught (no double-booking), while two genuinely
// different vendors sharing a number+total must NOT be merged (no lost invoice).
import { vendorCoreKey, vendorsAreDifferent } from "./email-integration";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— vendorCoreKey (format-insensitive) —");
check("legal suffix stripped: 'Atapack B.V.' === 'Atapack'",
  vendorCoreKey("Atapack B.V.") === vendorCoreKey("Atapack"));
check("double space + case: 'Atapack  B.V.' === 'atapack bv'",
  vendorCoreKey("Atapack  B.V.") === vendorCoreKey("atapack bv"));
check("trailing dot / punctuation ignored: 'KPN.' === 'KPN'",
  vendorCoreKey("KPN.") === vendorCoreKey("KPN"));
check("different names stay different",
  vendorCoreKey("Atapack") !== vendorCoreKey("Bol.com"));
check("empty/junk → empty key", vendorCoreKey("  ") === "" && vendorCoreKey(null) === "");

console.log("\n— vendorsAreDifferent (only blocks the merge for REAL different vendors) —");
check("same vendor, different formatting → NOT different (duplicate is caught)",
  vendorsAreDifferent("Atapack B.V.", "Atapack") === false);
check("two genuinely different reliable vendors → different (not merged)",
  vendorsAreDifferent("Atapack B.V.", "Jansen Bouw") === true);
check("unknown vendor on one side → not 'different' (strong number+total anchor decides)",
  vendorsAreDifferent(null, "Atapack") === false);
check("junk/unreliable vendor → not 'different'",
  vendorsAreDifferent("Onbekende afzender", "Atapack") === false);
check("both unknown → not different",
  vendorsAreDifferent("", null) === false);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
