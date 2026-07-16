// [MH1] Pure node test — run: npx tsx src/lib/oauth-state.test.ts
// Locks the CSRF property: a forged state with no matching cookie is rejected, and the
// authoritative userId always comes from the cookie, never from the state param.
import { makeOAuthState, verifyOAuthState } from "./oauth-state";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— a legitimate round-trip verifies and returns the cookie userId —");
{
  const { state, cookieValue } = makeOAuthState("victim-uuid", "gmail");
  const r = verifyOAuthState(state, cookieValue, "gmail");
  check("verifies", r.ok === true);
  check("userId is the cookie's", r.ok && r.userId === "victim-uuid");
}

console.log("\n— a FORGED state naming the victim, with no matching cookie, is rejected —");
{
  // Attacker crafts state for the victim (the old code trusted state.userId here).
  const forged = Buffer.from(JSON.stringify({ nonce: "attacker-picked", provider: "gmail" })).toString("base64url");
  check("no cookie → rejected", verifyOAuthState(forged, undefined, "gmail").ok === false);
  // Attacker's OWN cookie (from their own /connect) carries a DIFFERENT nonce → mismatch.
  const attacker = makeOAuthState("attacker-uuid", "gmail");
  check("nonce mismatch → rejected", verifyOAuthState(forged, attacker.cookieValue, "gmail").ok === false);
}

console.log("\n— provider must line up (no gmail state against an outlook cookie) —");
{
  const g = makeOAuthState("u", "gmail");
  check("provider mismatch → rejected", verifyOAuthState(g.state, g.cookieValue, "outlook").ok === false);
}

console.log("\n— the attacker's own cookie can only ever link the attacker's own account —");
{
  // If the attacker completes their OWN flow, cookie+state match but userId is the
  // attacker's — the mailbox links to the attacker, never the victim. No cross-account.
  const a = makeOAuthState("attacker-uuid", "gmail");
  const r = verifyOAuthState(a.state, a.cookieValue, "gmail");
  check("links to the attacker's own uuid, not a victim", r.ok && r.userId === "attacker-uuid");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
