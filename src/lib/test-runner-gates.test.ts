// [TEST-REACH] Pure node test — run: npx tsx --test src/lib/test-runner-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// `npm run test:unit` runs an explicit list of globs. It read `src/lib/*.test.ts`, which does not
// descend: a test written in `src/lib/design/` was collected by nothing, reported by nothing, and
// counted by nothing. It would sit in the repo looking like coverage and never once execute.
//
// That nearly happened the day it was noticed — the sheet-bottom gate was written, run by hand,
// green, committed, and the unit count did not move. The count is what gave it away, and only
// because the number was fresh in mind. On another day it would have shipped as a test that exists
// and does not run, which is worse than no test: no test leaves the gap visible.
//
// It is the same shape as the [BON-BETAALWIJZE] gate one directory up — something built, typed,
// tested and then quietly not wired in — and it deserves the same answer: a check that reads the
// wiring itself rather than trusting it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function allTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allTests(p, out);
    else if (/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Turn one shell glob into a matcher. Only `*` occurs here, and it never crosses a `/`. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("/")
    .map((seg) => seg.split("*").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join("/");
  return new RegExp(`^${body}$`);
}

test("[TEST-REACH] every test file under src/ is actually run by npm run test:unit", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const cmd: string = pkg.scripts?.["test:unit"] ?? "";
  assert.ok(cmd.includes("--test"), "test:unit must still be a node test-runner invocation");

  const globs = cmd.split(/\s+/).filter((t) => t.includes("*")).map(globToRegExp);
  assert.ok(globs.length > 0, "test:unit names no globs — nothing would run at all");

  const files = allTests("src");
  // The floor: an empty walk would make the loop below vacuously true, which is the exact failure
  // this file exists to make impossible.
  assert.ok(files.length > 50, `walked ${files.length} test files — the directory walk broke`);

  const unreachable = files.filter((f) => !globs.some((g) => g.test(f)));
  assert.deepEqual(
    unreachable, [],
    `these test files are never executed by the gate set:\n` +
      unreachable.map((f) => `  · ${f}`).join("\n") +
      `\n\nEither move them where a glob reaches, or widen "test:unit" in package.json. ` +
      `A test that does not run is worse than no test — no test at least leaves the gap visible.`,
  );
});
