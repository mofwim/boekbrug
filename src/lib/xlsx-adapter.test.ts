// [SEC-XLSX / C1] Tests for the SheetJS containment guards.
//   run: npx tsx --test src/lib/xlsx-adapter.test.ts
//
// These do NOT test SheetJS. They test the wrapper that stands between six
// upload routes and a parser pinned at xlsx@0.18.5, which carries a live
// prototype-pollution CVE (CVE-2023-30533) because the fixed releases were
// never published to npm.
//
// The property that matters: pollution MUST NOT SURVIVE THE CALL. The reason
// that CVE is rated 7.8 is not that one upload gets a wrong answer — it is that
// a poisoned Object.prototype outlives the request and silently corrupts every
// later request the same Node process serves, for other users, with no trace.
// So each test below pollutes on purpose and then asserts the prototype came
// back clean.
//
// A real XLSX.read is never invoked here: the guard is deliberately parser-
// agnostic (it wraps a thunk), which is what lets it keep protecting the app
// after the upgrade to ≥0.20.2, and what lets these tests simulate an attack
// without shipping a malicious fixture into the repo.

import {
  withPrototypeGuard,
  assertWithinParseLimit,
  MAX_PARSE_BYTES,
} from "./xlsx-adapter";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

/** Is a key absent from every guarded prototype? */
function clean(key: string): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(Object.prototype, key) &&
    !Object.prototype.hasOwnProperty.call(Array.prototype, key) &&
    !Object.prototype.hasOwnProperty.call(Function.prototype, key)
  );
}

/** Simulates what a crafted sheet does inside the parser. */
function pollute(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

console.log("\n[SEC-XLSX] the guard is invisible when nothing is wrong");

check(
  "a clean call returns its value untouched",
  withPrototypeGuard(() => [["a", 1]]).length === 1
);

check(
  "a clean call leaves no residue",
  (() => {
    withPrototypeGuard(() => 42);
    return clean("boekbrugTestMarker");
  })()
);

check(
  "an ordinary parse error propagates unchanged",
  (() => {
    try {
      withPrototypeGuard(() => {
        throw new Error("kon het bestand niet lezen");
      });
      return false;
    } catch (err) {
      // Must be the ORIGINAL error, not a security error — the six callers map
      // this to a friendly 422 and that behaviour must not change.
      return err instanceof Error && err.message === "kon het bestand niet lezen";
    }
  })()
);

console.log("\n[SEC-XLSX] pollution is detected, reverted, and refused");

check(
  "Object.prototype pollution throws and is reverted",
  (() => {
    let threw = false;
    try {
      withPrototypeGuard(() => pollute(Object.prototype, "polluted_obj", "x"));
    } catch {
      threw = true;
    }
    return threw && clean("polluted_obj");
  })()
);

check(
  "Array.prototype pollution throws and is reverted",
  (() => {
    let threw = false;
    try {
      withPrototypeGuard(() => pollute(Array.prototype, "polluted_arr", 1));
    } catch {
      threw = true;
    }
    return threw && clean("polluted_arr");
  })()
);

check(
  "Function.prototype pollution throws and is reverted",
  (() => {
    let threw = false;
    try {
      withPrototypeGuard(() => pollute(Function.prototype, "polluted_fn", 1));
    } catch {
      threw = true;
    }
    return threw && clean("polluted_fn");
  })()
);

check(
  "the thrown error names the security problem, not a parse problem",
  (() => {
    try {
      withPrototypeGuard(() => pollute(Object.prototype, "polluted_named", 1));
      return false;
    } catch (err) {
      return err instanceof Error && err.message.includes("prototype pollution");
    }
  })()
);

check(
  "a symbol-keyed injection is caught too",
  (() => {
    const sym = Symbol("polluted_symbol");
    let threw = false;
    try {
      withPrototypeGuard(() => pollute(Object.prototype, sym as unknown as string, 1));
    } catch {
      threw = true;
    }
    return threw && !Object.prototype.hasOwnProperty.call(Object.prototype, sym);
  })()
);

check(
  "several injections in one call are all reverted",
  (() => {
    try {
      withPrototypeGuard(() => {
        pollute(Object.prototype, "polluted_multi_a", 1);
        pollute(Array.prototype, "polluted_multi_b", 2);
      });
    } catch { /* expected */ }
    return clean("polluted_multi_a") && clean("polluted_multi_b");
  })()
);

console.log("\n[SEC-XLSX] the case that matters most: pollute, THEN crash");

check(
  "pollution that happens before the parser throws is still reverted",
  // This is the realistic attack shape: the payload poisons the prototype and
  // the malformed file then blows up the parser. Without the finally-block the
  // caller's try/catch swallows the crash as "unreadable file" and the process
  // stays poisoned — invisibly, for every later request.
  (() => {
    try {
      withPrototypeGuard(() => {
        pollute(Object.prototype, "polluted_then_threw", "payload");
        throw new Error("corrupt zip");
      });
    } catch { /* expected */ }
    return clean("polluted_then_threw");
  })()
);

check(
  "when it polluted AND threw, the security error wins over the parse error",
  (() => {
    try {
      withPrototypeGuard(() => {
        pollute(Object.prototype, "polluted_wins", 1);
        throw new Error("corrupt zip");
      });
      return false;
    } catch (err) {
      return err instanceof Error && err.message.includes("prototype pollution");
    }
  })()
);

console.log("\n[SEC-XLSX] size ceiling (bounds the ReDoS, does not fix it)");

check("a normal file passes", (() => { assertWithinParseLimit(50_000); return true; })());
check("exactly at the limit passes", (() => { assertWithinParseLimit(MAX_PARSE_BYTES); return true; })());

check(
  "one byte over the limit is refused",
  (() => {
    try { assertWithinParseLimit(MAX_PARSE_BYTES + 1); return false; }
    catch (err) { return err instanceof Error && err.message.includes("too large"); }
  })()
);

check(
  "the backstop sits ABOVE the routes' own 10MB cap, so it never rejects a file they accepted",
  MAX_PARSE_BYTES > 10 * 1024 * 1024
);

console.log(`\n[SEC-XLSX] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
