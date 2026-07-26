// [PUSH] Pure test — run: npx tsx src/lib/push-payload.test.ts
import { buildPushPayload, isGoneStatus, isVapidConfigured } from "./push-payload";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, "\n     got:", g, "\n     want:", w); }
}

console.log("\n— buildPushPayload —");
eq("full row maps straight through",
  buildPushPayload({ title: "Factuur betaald", body: "€ 121,00", link: "/dashboard/facturen", type: "payment" }),
  { title: "Factuur betaald", body: "€ 121,00", url: "/dashboard/facturen", tag: "payment" });

eq("empty title falls back to BoekBrug",
  buildPushPayload({ title: "   ", type: "status" }),
  { title: "BoekBrug", body: "", url: "/dashboard", tag: "status" });

eq("missing body -> empty string (never 'null')",
  buildPushPayload({ title: "Hoi", body: null }),
  { title: "Hoi", body: "", url: "/dashboard", tag: "boekbrug" });

eq("non-relative link is rejected (no off-app redirect)",
  buildPushPayload({ title: "X", link: "https://evil.example/steal" }).url,
  "/dashboard");

eq("relative link is kept",
  buildPushPayload({ title: "X", link: "/dashboard/bank" }).url,
  "/dashboard/bank");

eq("missing type -> default tag",
  buildPushPayload({ title: "X" }).tag,
  "boekbrug");

console.log("\n— isGoneStatus (prune decision) —");
eq("404 -> prune", isGoneStatus(404), true);
eq("410 -> prune", isGoneStatus(410), true);
eq("429 rate-limit -> keep", isGoneStatus(429), false);
eq("500 outage -> keep", isGoneStatus(500), false);
eq("201 success -> keep", isGoneStatus(201), false);
eq("undefined (network error) -> keep", isGoneStatus(undefined), false);

console.log("\n— isVapidConfigured —");
eq("all three set -> true", isVapidConfigured({ publicKey: "a", privateKey: "b", subject: "mailto:x@y.z" }), true);
eq("missing private -> false", isVapidConfigured({ publicKey: "a", subject: "mailto:x@y.z" }), false);
eq("missing subject -> false", isVapidConfigured({ publicKey: "a", privateKey: "b" }), false);
eq("blank strings -> false", isVapidConfigured({ publicKey: "  ", privateKey: "  ", subject: "  " }), false);
eq("empty object -> false", isVapidConfigured({}), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
