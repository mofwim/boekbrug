// [ACCOUNTANT-TRUTH] Pure node test — run: npx tsx src/lib/accountant-access.test.ts
// resolveQuarterOwner is the IDOR guard for the cross-client quarter routes (result /
// aangifte / readiness). These tests pin every authorization branch so an accountant can
// only ever reach a client they are actually linked to — and a non-accountant never.
import { resolveQuarterOwner } from "./accountant-access";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// Minimal chainable fake of the RLS server client — only what resolveQuarterOwner calls.
function fakeClient(config: { role?: string | null; hasLink?: boolean }) {
  const make = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === "profiles") return { data: "role" in config ? { role: config.role } : null };
        if (table === "accountant_clients") return { data: config.hasLink ? { id: "link-1" } : null };
        return { data: null };
      },
    };
    return chain;
  };
  return { from: (t: string) => make(t) } as unknown as Parameters<typeof resolveQuarterOwner>[0];
}

async function main() {
console.log("\n— own data (the common case, no DB roundtrip) —");
{
  const noClient = await resolveQuarterOwner(fakeClient({}), "user-1", null);
  check("no clientId → own data", noClient.ok === true && noClient.ok && noClient.ownerId === "user-1");
  const self = await resolveQuarterOwner(fakeClient({}), "user-1", "user-1");
  check("clientId === self → own data", self.ok && self.ownerId === "user-1");
  const undef = await resolveQuarterOwner(fakeClient({}), "user-1", undefined);
  check("undefined clientId → own data", undef.ok && undef.ownerId === "user-1");
}

console.log("\n— a non-accountant may NEVER reach another user's quarter —");
{
  const zzp = await resolveQuarterOwner(fakeClient({ role: "zzper", hasLink: true }), "user-1", "victim-2");
  check("role 'zzper' → 403 (even if a link row somehow existed)", zzp.ok === false && !zzp.ok && zzp.status === 403);
  const noProfile = await resolveQuarterOwner(fakeClient({ role: null }), "user-1", "victim-2");
  check("no profile/role → 403", noProfile.ok === false && !noProfile.ok && noProfile.status === 403);
}

console.log("\n— an accountant needs an ACTUAL link to the client —");
{
  const noLink = await resolveQuarterOwner(fakeClient({ role: "accountant", hasLink: false }), "acc-1", "client-9");
  check("accountant, no link → 403", noLink.ok === false && !noLink.ok && noLink.status === 403);
  const linked = await resolveQuarterOwner(fakeClient({ role: "accountant", hasLink: true }), "acc-1", "client-9");
  check("accountant + link → the CLIENT's data", linked.ok === true && linked.ok && linked.ownerId === "client-9");
}

// ─── [BRUG] De brug loopt twee kanten op, en de tweede kant leest anders ──────────────
//
// Twee gezondheidsvragen — loopt de nummering door (art. 35), kloppen de boeken met zichzelf —
// stonden alleen op het scherm van de EIGENAAR en in het kwartaalpakket. De boekhouder, die ze
// als eerste stelt, moest er een ZIP voor downloaden. Ze zijn nu dubbelpad.
//
// Twee dingen moeten daarbij waar blijven, en ze zijn allebei stil als ze breken:
//
//  1. ZONDER clientId blijft requireOwner staan. resolveQuarterOwner kent het verschil tussen een
//     eigenaar en een MEDEWERKER niet: die is de sender_id van geen enkele factuur, leest dus een
//     lege reeks, en een lege reeks heeft geen gaten. Het scherm zou hem melden dat zijn
//     nummering doorloopt over een administratie die hij niet kan zien.
//  2. MET clientId moet de PIPELINE lezen. RLS geeft een boekhouder geen enkele factuurrij van
//     zijn klant terug — door de sessie lezen levert precies dezelfde lege, valse groene uitslag.
//     Dit is de reden dat het bestand hierboven die eis in zijn kop schrijft.
{
  for (const route of ["src/app/api/invoice/continuity/route.ts", "src/app/api/money-audit/route.ts"]) {
    const src = readFileSync(route, "utf8");
    check(`${route} kent het dubbelpad`, /resolveQuarterOwner\(supabase, user\.id, clientId\)/.test(src));
    check(`${route} houdt requireOwner op het eigen pad`, /requireOwner\(/.test(src));
    check(`${route} leest de klant met de pipeline`, /db = createPipelineClient\(\)/.test(src));
    // En geen enkele lezing mag nog rechtstreeks op de sessie staan: één vergeten `supabase.from`
    // is één tabel die voor de boekhouder leeg terugkomt zonder dat er iets faalt.
    const leftover = src.match(/\n\s*(?:await\s+)?supabase\s*\n?\s*\.from\(/g) ?? [];
    check(`${route} heeft geen sessie-lezing meer laten staan`, leftover.length === 0);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
}
main();
