// [PARTIAL-PAY-INVARIANT] Pure node test — run: npx tsx --test src/lib/partial-pay-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// One invariant holds the instalment system together:
//
//     invoices.amount_paid = Σ bank_tx_invoices.amount_applied
//
// and exactly one thing maintains it: the recompute_invoice_amount_paid RPC, which re-derives
// amount_paid from the surviving links under a row lock. Everything else — the optimistic JS
// decrement in the unlink route, the reset to 0 in the batch path — is a fast guess that this
// function is expected to correct.
//
// THE BUG THIS PREVENTS
//
// Three of the five call sites were written as
//
//     try { await pipeline.rpc("recompute_invoice_amount_paid", …) } catch { /* non-fatal */ }
//
// and supabase-js does not throw on an RPC — it answers { data, error }. So the catch could never
// fire, the error was discarded, and a failed recompute was not merely tolerated but UNOBSERVABLE.
// In the batch-unlink path that mattered most: every invoice there had just been forced to
// amount_paid = 0 on the explicit promise that the recompute would reconcile it, and an invoice
// carrying an instalment from a DIFFERENT bank line would then read as more open than it is —
// the direction in which an owner pays the same money twice.
//
// The failure is silent by construction, so no runtime test can catch it and no reviewer will
// notice the missing `error:` in six months. This gate reads the source instead: every call to the
// function that maintains the money invariant must destructure its error. What the route then DOES
// with it is its own decision — refuse (pay-toggle), warn the caller (batch unlink), or log and
// carry on (single unlink) — but pretending it cannot fail is not one of the options.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = join(process.cwd(), "src", "app", "api");
const RPC_NAME = "recompute_invoice_amount_paid";

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

test("[PARTIAL-PAY-INVARIANT] every recompute call reads its error", () => {
  const offenders: string[] = [];

  for (const file of routeFiles(API_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(RPC_NAME)) continue;

    // Walk the actual call sites rather than the file as a whole: one route may hold several, and a
    // single correct one elsewhere must not vouch for a careless one.
    for (const line of src.split("\n")) {
      if (!line.includes(`rpc("${RPC_NAME}"`)) continue;
      // The error has to be destructured on the same line as the call. That is the shape all five
      // sites use, and requiring it keeps this gate free of guesswork about scope.
      if (!/const\s*\{[^}]*error[^}]*\}\s*=\s*await/.test(line)) {
        offenders.push(`${file.replace(process.cwd() + "/", "")}: ${line.trim().slice(0, 100)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These calls discard the result of the one function that maintains " +
      "amount_paid = Σ amount_applied. supabase-js does not throw on an RPC, so a try/catch around " +
      "it catches nothing — destructure `error` and decide what to do with it:\n" +
      offenders.join("\n"),
  );
});

test("[PARTIAL-PAY-INVARIANT] the gate is actually looking at something", () => {
  // A source-scanning gate that silently matches nothing passes forever. Assert it found the call
  // sites it is meant to be guarding — if the RPC is ever renamed, this fails instead of going quiet.
  const found = routeFiles(API_ROOT).filter((f) => readFileSync(f, "utf8").includes(RPC_NAME));
  assert.ok(found.length >= 3, `expected several routes to call ${RPC_NAME}, found ${found.length}`);
});
