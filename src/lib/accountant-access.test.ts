// [ACCOUNTANT-TRUTH] Pure node test — run: npx tsx src/lib/accountant-access.test.ts
// resolveQuarterOwner is the IDOR guard for the cross-client quarter routes (result /
// aangifte / readiness). These tests pin every authorization branch so an accountant can
// only ever reach a client they are actually linked to — and a non-accountant never.
import { resolveQuarterOwner } from "./accountant-access";

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
}
main();
