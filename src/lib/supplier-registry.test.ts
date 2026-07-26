// [SUPPLIER-REGISTRY] Pure node test — run: npx tsx src/lib/supplier-registry.test.ts
// Locks the pure identity helpers that decide when two vendor spellings are the SAME supplier.
import { supplierNameKey, normalizeIban, isReliableSupplierName, normalizeKvk } from "./supplier-registry";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— supplierNameKey: same company, different spellings → same key —");
check("legal suffix stripped: 'M.H. BAL GROOTHANDEL VOF' == 'M.H. Bal Groothandel'",
  supplierNameKey("M.H. BAL GROOTHANDEL VOF") === supplierNameKey("M.H. Bal Groothandel"));
check("'Atapack B.V.' == 'atapack  b.v.' (case + double space + dots)",
  supplierNameKey("Atapack B.V.") === supplierNameKey("atapack  b.v."));
check("'Enka Horeca B.V.' == 'Enka Horeca'",
  supplierNameKey("Enka Horeca B.V.") === supplierNameKey("Enka Horeca"));
check("dotted acronym collapses: 'M.H. BAL...' key has 'mh bal groothandel'",
  supplierNameKey("M.H. BAL GROOTHANDEL VOF") === "mh bal groothandel");

console.log("\n— supplierNameKey: genuinely different companies → different keys —");
check("'Enka Horeca' != 'Sumer Food'",
  supplierNameKey("Enka Horeca B.V.") !== supplierNameKey("Sumer Food B.V."));
check("'Jos Ketels' != 'William Ketels' (different first name → different supplier, correctly NOT merged)",
  supplierNameKey("Jos Ketels") !== supplierNameKey("William Ketels"));

console.log("\n— normalizeIban —");
check("spaces stripped + uppercased", normalizeIban("nl37 bngh 0123 4567 89") === "NL37BNGH0123456789");
check("too short → null", normalizeIban("NL37BNGH") === null);
check("null → null", normalizeIban(null) === null);
check("junk chars → null", normalizeIban("not-an-iban!!") === null);

console.log("\n— isReliableSupplierName: don't create a supplier from junk —");
check("real name → reliable", isReliableSupplierName("Enka Horeca B.V.") === true);
check("empty → not reliable", isReliableSupplierName("") === false);
check("'onbekende afzender' → not reliable", isReliableSupplierName("Onbekende afzender") === false);
check("2-letter core → not reliable (too generic to merge on)", isReliableSupplierName("BV") === false);
check("dash → not reliable", isReliableSupplierName("-") === false);

console.log("\n— normalizeKvk: the strong legal-entity key —");
check("spaces/dots stripped, 8 digits kept", normalizeKvk("KVK: 12 34 56 78") === "12345678");
check("already-clean 8 digits", normalizeKvk("12345678") === "12345678");
check("7 digits → null (not a KVK)", normalizeKvk("1234567") === null);
check("9 digits → null", normalizeKvk("123456789") === null);
check("null → null", normalizeKvk(null) === null);
check("letters only → null", normalizeKvk("abcdefgh") === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
