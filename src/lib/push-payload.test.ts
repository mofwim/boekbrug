// [PUSH] Pure test — run: npx tsx src/lib/push-payload.test.ts
import { buildPushPayload, isGoneStatus, isVapidConfigured, normalizeVapidSubject } from "./push-payload";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, "\n     got:", g, "\n     want:", w); }
}

console.log("\n— buildPushPayload —");
eq("full row maps straight through",
  buildPushPayload({ title: "Factuur betaald", body: "€ 121,00", link: "/dashboard/facturen", type: "payment" }),
  { title: "Factuur betaald", body: "€ 121,00", url: "/dashboard/facturen", tag: "payment:/dashboard/facturen" });

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

// The tag decides what REPLACES what on the device. Two conversations must not collapse into one.
eq("two conversations keep separate tags",
  buildPushPayload({ title: "Nieuw bericht", type: "message", link: "/dashboard/messages/aaa" }).tag ===
  buildPushPayload({ title: "Nieuw bericht", type: "message", link: "/dashboard/messages/bbb" }).tag,
  false);

eq("the same conversation collapses onto itself",
  buildPushPayload({ title: "Nieuw bericht", type: "message", link: "/dashboard/messages/aaa" }).tag ===
  buildPushPayload({ title: "Nieuw bericht", type: "message", link: "/dashboard/messages/aaa" }).tag,
  true);

eq("two payment notifications about different screens keep separate tags",
  buildPushPayload({ title: "Factuur betaald", type: "payment", link: "/dashboard/invoice/x" }).tag ===
  buildPushPayload({ title: "Nog een deel open", type: "payment", link: "/dashboard/bank" }).tag,
  false);

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

console.log("\n— normalizeVapidSubject —");
// The exact production value. VAPID_SUBJECT held a bare address, web-push threw on every send,
// and push was off for 23 users between 31 July and 19 August without one visible symptom.
eq("the bare address that disabled push is completed to mailto:",
  normalizeVapidSubject("mofwim@gmail.com"), "mailto:mofwim@gmail.com");
eq("an address with surrounding whitespace is trimmed first",
  normalizeVapidSubject("  info@boekbrug.nl \n"), "mailto:info@boekbrug.nl");

eq("a mailto: URI is already right and is left alone",
  normalizeVapidSubject("mailto:info@boekbrug.nl"), "mailto:info@boekbrug.nl");
eq("an https: URL is the other form web-push accepts",
  normalizeVapidSubject("https://boekbrug.nl/contact"), "https://boekbrug.nl/contact");

// web-push demands https: or mailto: specifically (vapid-helper.js:84). Silently upgrading http:
// would change which URL the push service is told to reach, so it is refused instead.
eq("http: is not silently upgraded to https:", normalizeVapidSubject("http://boekbrug.nl"), null);
eq("some other scheme is refused", normalizeVapidSubject("ftp://boekbrug.nl"), null);

eq("nothing set stays nothing", normalizeVapidSubject(undefined), null);
eq("blank stays nothing", normalizeVapidSubject("   "), null);
eq("null stays nothing", normalizeVapidSubject(null), null);

// Strict on purpose: completing a typo produces a mailto: nobody reads, which is worse than off.
eq("a name is not an address", normalizeVapidSubject("BoekBrug support"), null);
eq("no domain dot is not an address", normalizeVapidSubject("info@localhost"), null);
eq("two @ is not an address", normalizeVapidSubject("a@b@c.nl"), null);
eq("an address with a space is not an address", normalizeVapidSubject("in fo@boekbrug.nl"), null);

console.log("\n— isVapidConfigured, now that the subject must be usable —");
// This is the assertion that would have caught it: complete config, present subject, and the
// old check said yes because the string was non-empty.
eq("a bare address now completes rather than reaching web-push raw",
  isVapidConfigured({ publicKey: "a", privateKey: "b", subject: "mofwim@gmail.com" }), true);
eq("a subject that is set but unusable is NOT configured",
  isVapidConfigured({ publicKey: "a", privateKey: "b", subject: "BoekBrug support" }), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
