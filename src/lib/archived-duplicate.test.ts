// [DUP-ARCHIVED] Pure node test — run: npx tsx src/lib/archived-duplicate.test.ts
// Guards the ONE sentence a geweigerde upload laat zien als de bestaande factuur genegeerd is.
// Hij moet altijd (a) Genegeerd noemen — anders zoekt de eigenaar in een lijst waar de factuur
// per definitie niet in staat — en (b) terugzetten als handeling noemen, want bij een identiek
// bestand is dat de enige weg vooruit (de byte-hash-poort is met opzet niet te forceren).
import { archivedDuplicateMessage } from "./archived-duplicate";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const inv = (invoice_number: string | null, client_name: string | null) =>
  ({ invoice_id: "i1", invoice_number, client_name });

console.log("\n— archivedDuplicateMessage (altijd Genegeerd + terugzetten) —");

const full = archivedDuplicateMessage(inv("2026-0041", "Atapack B.V."));
check("noemt nummer én leverancier", full.includes("2026-0041") && full.includes("Atapack B.V."));
check("noemt Genegeerd", full.includes("Genegeerd"));
check("noemt terugzetten als handeling", /terug/i.test(full));

// Let op: de staartzin bevat legitiem "in plaats van" — dus toets het ONDERWERP, niet de hele
// string, anders faalt de test op een woord dat er hoort te staan.
const noVendor = archivedDuplicateMessage(inv("2026-0041", null));
check("zonder leverancier: nummer blijft, geen loze 'van' achter het nummer",
  noVendor.startsWith("Factuur 2026-0041 staat in Genegeerd"));

const noNumber = archivedDuplicateMessage(inv(null, "Atapack B.V."));
check("zonder nummer: valt terug op de leverancier", noNumber.includes("Atapack B.V.") && noNumber.includes("Genegeerd"));

const bare = archivedDuplicateMessage(inv(null, null));
check("zonder allebei: nog steeds een hele zin", bare.startsWith("Deze factuur") && bare.includes("Genegeerd"));
check("zonder allebei: geen 'null'/'undefined' in beeld", !/null|undefined/.test(bare));

const blanks = archivedDuplicateMessage(inv("   ", "  "));
check("witruimte telt als leeg (geen 'Factuur    van')", blanks === bare);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
