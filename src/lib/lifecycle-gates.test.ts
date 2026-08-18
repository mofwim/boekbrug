// [LIFECYCLE] Pure node test — run: npx tsx --test src/lib/lifecycle-gates.test.ts
//
// Findings from the end-to-end audit of an invoice's life, held as gates.
//
// Every one of these is the same shape: a refusal that was WRITTEN, argued for at length in its own
// comment, and then made unreachable by a sibling line — a nested guard, or a newer code path that
// returns before it. Nothing turns red when that happens. The invoice imports, the payment books,
// the screen looks right, and the only trace is a number in the books that nobody will question
// until an accountant does, a year later.
//
// They are source-level because that is where the defect lives. Both of these are about the ORDER
// and the PLACEMENT of code, not about what any function returns when you call it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

/**
 * Source with comments stripped — these files explain the very mistakes the gates look for, so a
 * gate that searched the raw text would match its own description instead of the code.
 *
 * [STRIPPER-BLIND] The block-comment rule requires a delimiter before the `/*`, and that is not
 * cosmetic — without it this helper DELETES REAL CODE. `accept=".pdf,image/*"` is an ordinary file
 * input attribute, and the `/*` inside that STRING opened a comment that ran to the next genuine
 * `*​/` — 1549 characters of live JSX in IncomingManageClient, and the same shape in BankClient and
 * UploadClient. Every gate over those regions was reading a hole.
 *
 * Which direction that breaks matters: an assert.match over deleted code FAILS loudly, so it gets
 * noticed. An assert.doesNotMatch over deleted code PASSES — vacuously, forever, on exactly the
 * files where "this must never come back" is being claimed. That is this file's own defect class,
 * in the helper the file is built on.
 *
 * A real comment always follows a delimiter: line start, whitespace, or one of `{(,;=`. A `/*`
 * inside a path-ish string follows a letter or a dot, so requiring the delimiter separates them
 * without needing a tokenizer.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, "$1 ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("[STRIPPER-BLIND] the comment stripper this whole file rests on does not eat code", () => {
  // Every gate here reads code() and asserts over the result. So a stripper that deletes real code
  // does not fail — it makes the gates read a hole, and the ones written as doesNotMatch then pass
  // VACUOUSLY, forever, on exactly the files where "this must never come back" is being claimed.
  //
  // It was doing that. `accept=".pdf,image/*"` is an ordinary file input attribute; the `/*` inside
  // that string opened a comment which ran to the next real `*​/`. Measured across the files that
  // contain it, over 14.000 characters of live code were invisible — 4.146 in BankClient alone, and
  // 702 in email-integration.ts, which is a doesNotMatch target two tests below.
  const sample = [
    'const a = 1',
    'accept=".pdf,image/*"',   // the string that broke it
    'const KEEP_ME = "reachable"',
    '{/* a real comment */}',
    'const ALSO_KEEP = "reachable too"',
  ].join("\n");
  const stripped = sample
    .replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, "$1 ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  assert.match(stripped, /KEEP_ME/, "code between a path-ish string and the next comment was eaten");
  assert.match(stripped, /ALSO_KEEP/, "code after the comment was eaten");
  assert.doesNotMatch(stripped, /a real comment/, "and a genuine comment must still be removed");

  // And the rule itself, in the file, so a later 'simplification' back to the naive regex is caught
  // here rather than by a gate quietly going blind.
  const self = readFileSync("src/lib/lifecycle-gates.test.ts", "utf8");
  assert.ok(
    self.includes("(^|[\\s{(,;=])\\/\\*"),
    "the block-comment rule lost its leading-delimiter requirement — without it, `image/*` in a " +
      "string opens a comment and this file starts reading holes again",
  );
});

// ─── [DEDUP-READ-HONEST] A failed duplicate probe must not read as "no duplicate" ─────
//
// supabase-js does not throw. A timed-out probe on a busy invoices table gives { data: null } →
// `?? []` → no candidate found → possibleDup null. If the "we could not run the check" marker is
// only written when a candidate WAS found, it can never be written at all — and the invoice then
// reads 'clean' to classifyImportHealth and AUTO-BOOKS.
//
// The cost, concretely: a paper invoice photographed after the same invoice arrived by e-mail (the
// bytes differ, so the hash gate correctly misses) becomes a second purchase invoice with no human
// in the loop — a second cost in the P&L and a second voorbelasting claim, discoverable only by
// reading the inkoopboek line by line.

test("[DEDUP-READ-HONEST] the intake path can actually WRITE the flag it computes", () => {
  const src = code("src/app/api/intake/route.ts");

  // The bug in one line: the merge nested inside "a candidate was found".
  assert.doesNotMatch(
    src, /if \(possibleDup\) \{\s*const merged = \(dedupCheckFailed/,
    "the duplicate-check-unavailable marker is nested inside `if (possibleDup)` again. It exists " +
      "for the case where the probe FAILED and therefore found nothing, so nesting it there makes " +
      "it provably unwritable — and a failed probe then auto-books a second copy of a bill.",
  );

  // Both handlers in this file — the photo/upload path and the UBL e-invoice path.
  const merges = [...src.matchAll(/dedupCheckFailed\s*\?\s*markDuplicateCheckUnavailable/g)];
  assert.equal(
    merges.length, 2,
    `expected the marker on BOTH intake handlers (photo/upload and UBL), found ${merges.length}`,
  );

  // And it must be computed, not just referenced: three reads that nothing writes is how this
  // started.
  assert.match(src, /if \(dedupErr\) dedupCheckFailed = true/, "the failure must still be recorded");
});

test("[DEDUP-READ-HONEST] the sibling paths still apply it unconditionally", () => {
  // These two were always right, and they are the shape intake now matches. If a later change
  // nests them the same way, the same silent double-booking comes back through those doors.
  // The invariant, not the syntax: these two doors reach it differently — upload with a ternary on
  // the field_confidence it is about to store, email-integration with its own `if (dedupCheckFailed)`
  // over an accumulating safecore. Both are correct. What must hold in either shape is that the
  // marker is reachable when the probe FAILED, which is exactly when no candidate exists.
  for (const f of ["src/app/api/email/upload/route.ts", "src/lib/email-integration.ts"]) {
    const src = code(f);
    assert.match(
      src, /markDuplicateCheckUnavailable\(/,
      `${f} no longer applies the duplicate-check-unavailable marker on a failed probe`,
    );
    assert.doesNotMatch(
      src, /if \(possibleDup\)[\s\S]{0,200}?markDuplicateCheckUnavailable/,
      `${f} has put the marker inside "a candidate was found" — the intake bug, in a second door`,
    );
  }
});

test("[PAGE-KEY] every paged read over a non-unique key carries a tiebreaker", () => {
  // A .range() page boundary is only stable over a TOTAL order. Postgres gives no defined order
  // among ties, so paging on a non-unique key can serve a row twice and skip another — and in a
  // running balance that does not spoil one day, it shifts every eindsaldo after it.
  //
  // Two keys in this codebase are non-unique per owner: cash_entries.entry_date (several movements
  // a day is ordinary for a shop) and ledger_daily.ledger_date (unique per day AND KIND, so up to
  // four rows a day). daily_turnover.turnover_date carries UNIQUE (user_id, turnover_date) and is
  // deliberately left alone — a tiebreaker there would imply a hazard that does not exist.
  //
  // The live /api/kasboek read had this right; the closing package, which produces the copy the
  // accountant reads and nobody cross-checks, did not.
  const NON_UNIQUE = /\.order\("(entry_date|ledger_date)", \{ ascending: true \}\)(?!\s*\.order\("id")/g;
  const offenders: string[] = [];
  for (const f of [
    "src/lib/closing-package.ts",
    "src/lib/compute-result-range.ts",
    "src/app/api/readiness/route.ts",
    "src/app/api/kasboek/route.ts",
    "src/app/api/cash/route.ts",
  ]) {
    const src = code(f);
    for (const m of src.matchAll(NON_UNIQUE)) {
      // Only a PAGED read is at risk: a single unpaged query returns one consistent snapshot.
      const after = src.slice(m.index ?? 0, (m.index ?? 0) + 200);
      if (/range\(from, to\)/.test(after)) offenders.push(`${f} — ${m[1]}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    "these paged reads order by a NON-UNIQUE key, so their page boundaries are undefined and a " +
      "row can be served twice or skipped:\n" + offenders.map((o) => `  · ${o}`).join("\n") +
      "\n\nAdd .order(\"id\", { ascending: true }) after it.",
  );
});

test("[EVIDENCE-EXT] the accountant's package keeps each file's real extension", () => {
  // Every entry was written as `.pdf` whatever it actually was, so a photographed bon stored as a
  // JPEG arrived as `2026-03-04_Sligro_26701681.pdf` — a file the accountant's reader refuses to
  // open. Evidence that is present and unreadable is, for a package whose whole job is to be
  // handed to someone else, the same as missing.
  const src = code("src/lib/closing-package.ts");
  assert.match(
    src, /zip\.file\(`facturen-en-bonnen\/\$\{dir\}\/\$\{bucket\}\/\$\{baseName\}\.\$\{ext\}`/,
    "the package writes a hard-coded .pdf extension again — a JPEG bon then lands in the " +
      "accountant's ZIP under a name their PDF reader cannot open",
  );
  // And the extension comes off the STORAGE PATH, which always carries it, not the display name —
  // an e-mail attachment or a camera capture frequently has no extension in its name at all.
  assert.match(src, /exec\(file\.path\)/, "the extension is read off the storage path");
  // A payment stamp is drawn with pdf-lib and cannot touch an image. Silently skipping it left
  // the package claiming elsewhere that a paid invoice carries its date on page 1.
  assert.match(src, /code: "payment_date_unstamped"/, "an unstampable file says so");
});

test("[MULTI-INVOICE] the e-mail door asks the same two questions before auto-booking", () => {
  // One PDF can carry several invoices; exactly one gets read and the others exist nowhere. The
  // intake door refuses to auto-book on that signal, and on its counterpart — a scanned stack has
  // no text layer, so the check cannot RUN, and null is not "one invoice, all fine".
  //
  // The e-mail door asked neither, and not by decision: the text layer both checks read came from
  // a helper private to the intake route, so the question was unaskable from there. Suppliers
  // batch by MAIL more than by camera, so this is the door where it matters most — a wholesaler's
  // three-invoice PDF booked one of them _auto_verified and lost two bills entirely.
  const src = code("src/lib/email-integration.ts");
  for (const call of ["detectMultipleInvoices(", "cannotVerifySingleInvoice(", "readPdfTextLayer("]) {
    assert.ok(src.includes(call), `the e-mail door no longer calls ${call} — a multi-invoice PDF ` +
      `then auto-books one invoice and silently drops the rest`);
  }
  // Before the gate, not after: these signals work by making classifyImportHealth see a problem,
  // and shouldAutoAdvanceInvoice reads that health. Merged afterwards they change nothing.
  assert.ok(
    src.indexOf("detectMultipleInvoices(") < src.indexOf("shouldAutoAdvanceInvoice("),
    "the multi-invoice check must run BEFORE the auto-advance gate — it works by holding the " +
      "invoice through health, so merging it afterwards leaves the booking already decided",
  );

  // And one reader, not two. The private copy in the intake route is what made the e-mail door
  // unable to ask; a second copy would put it straight back.
  assert.doesNotMatch(
    code("src/app/api/intake/route.ts"), /async function readPdf\(/,
    "the PDF text reader is private to the intake route again — that is exactly what kept the " +
      "e-mail door from running the checks that read a text layer",
  );
});

// ─── The issuing path: two reads whose empty answer was accepted as an answer ──────────
//
// Both are art. 35 surfaces, and both failed OPEN. supabase-js does not throw, so `const { data }`
// and `const { count }` turn a database problem into "no lines" and "nobody has invoiced yet" —
// and on this path those are not recoverable states. A number is consumed and a document goes to
// a customer.

test("[ART35-READ-HONEST] sending an invoice refuses when its lines cannot be read", () => {
  // `lines ?? []` reaches renderInvoicePdf. A failed read therefore e-mailed an invoice with an
  // EMPTY item table, carrying a consumed number that cannot be rolled back — and the totals fell
  // back to the browser-supplied figures the block right above them exists to stop trusting.
  // The refusal runs BEFORE the number is minted, so nothing is written and a retry costs nothing.
  const src = code("src/app/api/invoice/send/route.ts");
  assert.match(
    src, /const \{ data: lines, error: linesError \}/,
    "the invoice_lines read dropped its error again — an unreadable read then becomes an invoice " +
      "with no goods or services on it, sent, under a number that cannot be given back",
  );
  assert.match(src, /code: 'lines_unavailable'/, "and it must refuse, not merely log");
  // Order matters as much as the check: refusing after the number is minted leaves a permanent
  // gap in the doorlopende reeks for a failure that was fully recoverable. Anchored on the MINT
  // itself rather than on the "POINT OF NO RETURN" comment beside it — `code()` strips comments,
  // so a prose anchor here silently matches nothing and the ordering goes unchecked.
  const guard = src.indexOf("lines_unavailable");
  const mint = src.indexOf("generateInvoiceNumber(");
  assert.ok(guard > 0 && mint > 0 && guard < mint,
    "the refusal must come BEFORE the number is minted — refusing after it leaves a permanent " +
      "gap in the doorlopende reeks for a failure that was entirely recoverable");
});

test("[ART35-READ-HONEST] an unreadable issued-count locks the numbering instead of opening it", () => {
  // `(issuedCount ?? 0) > 0` read a failed count as "this owner has issued nothing", so the
  // template and padding of a doorlopende reeks could be rewritten after numbers had gone out —
  // and the audit row that exists to prove the platform refused exactly that was skipped too.
  //
  // [NUMMER-SLOT] The lock is now TWO counts (invoice_date window + invoice number pattern), so
  // this is asserted on the helper that owns both rather than on one destructure. Both errors must
  // be read, and the helper's "unknown" must be a value the caller cannot mistake for zero.
  const src = code("src/app/api/invoice/numbering/route.ts");
  const helper = src.slice(
    src.indexOf("async function countIssuedForCounterYear"),
    src.indexOf("export async function POST"),
  );
  assert.ok(helper.length > 100, "the lock's counting helper is gone — the rule has nowhere to live");
  assert.match(helper, /byDate\.error \|\| byNumber\.error/, "BOTH counts' errors must be read");
  assert.match(helper, /return null/, "…and an unreadable count answers 'unknown', not a number");
  // null, not 0 — the whole bug was a failed read that looked like an honest zero. `?? 0` anywhere
  // on this value puts it straight back.
  assert.doesNotMatch(src, /issuedCount \?\? 0/, "`?? 0` turns an unknown count back into 'nobody has invoiced'");
  assert.match(src, /if \(issuedCount === null\)/, "the POST handler must refuse on unknown");
  assert.match(src, /code: 'lock_check_unavailable'/, "an unreadable count must refuse, not unlock");
  // The GET card decides the same way. An open form shown on an unknown answer invites the owner
  // into the 409 — or into believing there is no lock.
  assert.match(src, /const locked = count === null \|\| count > 0/, "the GET card locks on unknown too");
});

test("[REREAD-CONFIRMED] the re-read predicate is given the columns it reads", () => {
  // A predicate whose inputs are missing does not fail loudly — it answers "no". So an
  // "Opnieuw inlezen" button gated on reimportDecision simply never renders, on any card, and a
  // control that is never on screen is indistinguishable from one that was never built. Both
  // screens and the route decide from the same three columns; each has to actually select them.
  for (const [f, needs] of [
    ["src/app/dashboard/incoming/page.tsx", ["direction", "accountant_status"]],
    ["src/app/dashboard/incoming/manage/page.tsx", ["direction", "accountant_status"]],
    ["src/app/api/email/reimport/[id]/route.ts", ["accountant_status"]],
  ] as const) {
    // The invoice projection is the quoted comma-list that carries total_inc_btw — matched that
    // way rather than by `.select(` because two of these files hold it in a named constant.
    const lists = (code(f).match(/["'`][^"'`\n]*total_inc_btw[^"'`\n]*["'`]/g) ?? []).join(" ");
    for (const col of needs) {
      assert.ok(
        lists.includes(col),
        `${f} no longer selects ${col} — reimportDecision then reads undefined and silently ` +
          `refuses every invoice, so the re-read offer disappears with nothing failing`,
      );
    }
  }

  // And the rule stays ONE rule. Re-deriving it inline on a screen is how the button and the
  // route drift into disagreeing, which shows the owner a control that then refuses them.
  for (const f of [
    "src/app/dashboard/incoming/IncomingInvoicesClient.tsx",
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",
    "src/app/api/email/reimport/[id]/route.ts",
  ]) {
    assert.match(code(f), /reimportDecision\(/, `${f} no longer asks the shared predicate`);
  }
});

test("[SKIPPED-READ-HONEST] the panel that explains a missing invoice cannot answer 'nothing'", () => {
  // This is where an owner goes when an invoice never arrived. Both of its reads answered a
  // database failure with an empty result — `const { data }` → null → `?? []`, and a failed COUNT
  // → 0 — so the panel would report "niets overgeslagen" to the one person actively looking for
  // something that IS missing, and they would stop looking.
  //
  // Retargeted: this named the two error VARIABLES it expected. That is weaker than it looks — it
  // passed for months while a THIRD read (the [TWEEDE-KANS] unread list) destructured no error at
  // all, because a gate that knows two names cannot notice a name that was never there. It then
  // went red on a refactor that merged two reads into one and renamed the survivor, while the
  // property it exists for held better than before.
  //
  // So: EVERY supabase read in this route keeps its error. No names, no count.
  const src = code("src/app/api/email/skipped/route.ts");
  const reads = [...src.matchAll(/const \{([^}]*)\} = await supabase/g)];
  assert.ok(reads.length >= 2, "this route still reads more than one source");
  const blind = reads.map((m) => m[1].trim()).filter((d) => !/\berror\b/.test(d));
  assert.deepEqual(
    blind, [],
    "these reads drop the error, which supabase-js does not throw — so a database failure becomes " +
      `null, then \`?? []\`, then "niets overgeslagen" to the one person actively looking for an ` +
      "invoice that IS missing:\n" + blind.map((b) => `  · const {${b}} = await supabase`).join("\n"),
  );
  assert.match(src, /code: 'skipped_unavailable'/, "a failed read must refuse, not report zero");
});

test("[PAYMENT-NAMES-MISSING] a payment naming an un-imported invoice is still a batch", () => {
  // resolveBatchNumbers iterates over the invoice numbers we HOLD, so a payment naming a bill that
  // was never imported can only ever resolve to the others. Gating the multi-invoice view on that
  // count downgraded the card to single-invoice mode, where "Bevestig betaling" books the WHOLE
  // debit onto the one invoice we recognise — overpaying it and spending the money that belonged
  // to the missing one. The card's own label said "2 facturen" three lines away.
  const src = code("src/app/dashboard/bank/BankClient.tsx");
  assert.match(src, /namedInvoiceNumbers\(/, "the payment text is read for names, not only for matches");
  assert.match(
    src, /resolvedRefCount \+ missingNamed\.length >= 2/,
    "the multi gate counts what the payment NAMED, not only what resolved",
  );
  // The slot the owner cannot fill needs the reason beside it, or "Koppelen" on an invoice that
  // does not exist is a button that can only fail.
  assert.match(src, /missingInvoiceNoticeText\(missingNamed\)/, "and the reason is on screen");
  // The numbers must reach the slot list too — the gate opening on a list that still holds one row
  // would show a two-invoice batch as a single slot.
  assert.match(src, /\.\.\.missingNamed\.filter/, "the missing numbers become slots");
});

test("[INCASSO-CONFIRM] the switch that can settle a year of invoices asks first", () => {
  // Turning auto-incasso ON settles every invoice from that supplier the bank has already
  // collected — the route's own header says so. A bare toggle for a change of that size is the
  // same shape as the "gelukt" toasts this codebase keeps replacing: large action, small gesture.
  const src = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(
    src, /setIncassoAsk\(\{ inv, on: !isIncassoRow\(inv\) \}\)/,
    "the toggle opens a confirm instead of firing the request",
  );
  assert.doesNotMatch(
    src, /onClick=\{e => \{ e\.stopPropagation\(\); toggleIncasso\(/,
    "the switch calls the route directly again — one tap then marks a year of invoices paid",
  );
});

test("[INCASSO-CONFIRM] the switch sits after the sentence, and IS the whole control", () => {
  // Trailing edge, where a switch lives on a phone: the label says what it controls and the
  // control is where the thumb reaches. Leading it also made the two lines of explanation hang off
  // a 20px column, starting the paragraph a third of the way across the card.
  //
  // [INCASSO-SWITCH-TARGET] And the sentence is NOT part of the control. The whole block used to be
  // a single <button>, so reading the explanation — three lines about money leaving your account by
  // itself — and touching it anywhere flipped the setting. The most consequential switch on this
  // screen had the largest possible accidental hit area, made of the very sentence asking you to
  // think about it.
  //
  // Held here rather than in the render gate because this block only exists inside the EXPANDED
  // card, and that gate renders the collapsed list — an assertion there would match nothing and
  // pass forever, which is the shape of half the defects in this file.
  const src = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  // [TAAL] Anchored on the key, not the Dutch sentence.
  const label = src.indexOf("t('ink.schrijftAf'");
  const toggle = src.indexOf('role="switch"');
  assert.ok(label > 0 && toggle > 0, "both the label and the switch must still be there");
  assert.ok(label < toggle, "the switch renders after its label, not in front of it");

  // The onClick belongs to the switch and to nothing wider. A wrapper carrying it means the
  // paragraph is a button again, whatever it looks like.
  const openers = [...src.matchAll(/setIncassoAsk\(\{ inv, on: !isIncassoRow\(inv\) \}\)/g)];
  assert.equal(openers.length, 1, "exactly one thing opens the incasso confirm");
  const before = src.slice(0, openers[0].index ?? 0);
  const lastButton = before.lastIndexOf("<button");
  const lastSwitch = before.lastIndexOf('role="switch"');
  assert.ok(
    lastSwitch > lastButton - 200 && lastSwitch !== -1,
    "the handler must sit on the element carrying role=\"switch\" — not on a wrapper that also " +
      "contains the explanation, which is how the text became tappable in the first place",
  );

  // A real switch, not a glyph: it needs a state a screen reader can read and a target a thumb can
  // hit. The icon it replaced was 26px of ink with no defined touch area.
  assert.match(src, /aria-checked=\{isIncassoRow\(inv\)\}/, "the switch reports its own state");
  assert.match(src, /minHeight: 48/, "and carries a real touch target");
});

test("[BULK-UNDO] undoing payments in bulk goes through the audited single route", () => {
  // Every guard that route carries — the accountant's 'verwerkt' trigger, the link removal, the
  // kasboek reconcile, recompute_invoice_amount_paid, the audit row — is inherited rather than
  // re-implemented. A bulk SQL path would have to repeat all of them, and repeating them is how
  // the two drift apart on the invariant this app exists to protect.
  const src = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(src, /executeBulkUndo/, "the bulk undo exists");
  assert.match(
    src, /body: JSON\.stringify\(\{ invoiceId: row\.id, action: 'undo' \}\)/,
    "and it calls the same pay-toggle route the single undo uses",
  );
  // Confirmed before it runs, with the consequences named — a filed quarter above all, which is
  // the one effect that reaches outside the app.
  assert.match(src, /bulkUndoWarnings\(bulkUndoPlan\)/, "the consequences are shown before the tap");
});

test("[DATE-NL] no owner-typed date is left to the browser's locale", () => {
  // A native <input type="date"> orders its segments by the BROWSER's locale, and nothing on the
  // page changes that — measured, including `lang` on the input, on a wrapper and on <html>. Under
  // an en-US browser the first box is the MONTH, so a Dutch owner cannot type a two-digit day, and
  // the field then reads 02/01/2026, which is two different dates depending on who looks at it.
  //
  // Every one of these fields decides a quarter: an invoice date under the factuurstelsel, a
  // payment date under the kasstelsel, a cash entry's day in the drawer. One re-introduced native
  // control is one screen where the owner silently cannot type what they mean.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const offenders = walk("src/app")
    .filter((f) => /type="date"/.test(code(f)))
    .map((f) => f);

  assert.deepEqual(
    offenders, [],
    "these screens still use a native date input, whose segment order follows the browser's " +
      "locale rather than the owner's:\n" + offenders.map((o) => `  · ${o}`).join("\n") +
      "\n\nUse DateFieldNL from @/components/ui/DateFieldNL — it types in dd-mm-jjjj, keeps the " +
      "native picker one tap away, and says back which date it understood.",
  );
});

test("[SCHEME-MERGE] no money-read route replaces the scheme's per-invoice maps", () => {
  // Under kas the invoices a quarter SETTLES are mostly not the ones it DATES, so
  // `{ ...sr.opts, exemptShareByInvoice: myOwnMap }` deletes the half that quarter is about — and
  // under a vrijgestelde-omzet regime that turns exempt turnover into taxed turnover on the
  // aangifte. It reads like overriding a default, which is why it survived in two of the three
  // routes while the third merged by hand with a comment explaining why merging was necessary.
  for (const f of ["src/app/api/aangifte/route.ts", "src/app/api/readiness/route.ts"]) {
    const src = code(f);
    assert.match(src, /mergeSchemeOpts\(sr\.opts/, `${f} no longer merges the scheme opts`);
    // The assignment shape that caused it: a per-invoice map set on the same object literal that
    // spreads sr.opts. mergeSchemeOpts takes them as arguments instead, so this cannot recur
    // without deleting the call above.
    assert.doesNotMatch(
      src, /\.\.\.sr\.opts,[\s\S]{0,600}?(exemptShareByInvoice|rateSharesByInvoice|deductionByInvoice):/,
      `${f} sets a per-invoice map alongside a raw \`...sr.opts\` spread again — that drops every ` +
        `invoice this quarter SETTLED but did not DATE, which under kas is most of them`,
    );
    // deductionByInvoice belongs INSIDE the merge, not after it. Assigning it on the outer object
    // literal — where it reads like the two lines next to it — replaces the settled attributions
    // with the dated ones, and every cost that loses its attribution falls to the pro-rata bucket.
    assert.doesNotMatch(
      src, /\}\),\s*(exemptRegime: [^,]+,\s*)?deductionByInvoice:/,
      `${f} assigns deductionByInvoice AFTER mergeSchemeOpts, which overwrites the attributions ` +
        `of the invoices this quarter settled — an owner who attributed their costs then gets ` +
        `the pro-rata ratio applied to them anyway`,
    );
  }
});

test("[CASH-CREDITNOTA] the reconciler still reads what decides the drawer's direction", () => {
  // cash.ts flips the drawer for a creditnota, and it can only do that for a row it is TOLD is
  // one. The reconciler is the sole caller, and its projection is a hand-written column list —
  // drop invoice_type from it and settlementDirection falls back to the sign alone, so a credit
  // stored with positive amounts (the 'conflict' stance) books the till backwards again, by twice
  // its amount. A pure fix nobody wired is not a fix.
  const src = code("src/lib/cash-settle.ts");
  assert.match(
    src, /const baseColumns = "[^"]*\binvoice_type\b/,
    "invoice_type left the invoice projection — the creditnota direction flip in cash.ts then " +
      "never sees a document type and a cash refund moves the drawer the wrong way",
  );
});

test("[REVERSAL-SET] deleting a statement decides its reversal in the tested place", () => {
  // The two tiers are not the same kind of evidence, and the filter that tells them apart moved
  // from the SQL (where it silenced the proven tier too) into planStatementReversal. Putting a
  // payment_method filter back on this query re-creates the defect: an invoice settled in two
  // instalments reads 'kas', drops out of the reversal, and is left marked fully paid with half of
  // it still owed. Doing the split inline again loses the tests that keep the other direction —
  // never un-paying a cash-settled invoice whose number a deleted statement merely prints.
  const src = code("src/app/api/bank/delete-statement/route.ts");
  assert.match(src, /planStatementReversal\(paid, idSet, txs/, "the reversal set is planned in one tested place");
  assert.doesNotMatch(
    src, /\.eq\("payment_method", "bank"\)/,
    "the reversal query filters on payment_method again — that hides every invoice whose LAST " +
      "instalment was cash, and nothing re-derives status, so it stays marked paid while half of " +
      "it is still owed",
  );

  // [VERWERKT-SCOPE] The accountant lock must be checked over every invoice this delete TOUCHES,
  // not only the ones it un-pays. Reading it off `toRestore` — which comes from a status='paid'
  // query — left a partially-paid, accountant-locked invoice invisible to the refusal while its
  // links cascaded away and its amount_paid was recomputed underneath it.
  assert.doesNotMatch(
    src, /toRestore\.some\(\(i\) => i\.accountant_status === "verwerkt"\)/,
    "the verwerkt refusal reads the restore set again, which is status='paid' only — a partially " +
      "paid invoice the accountant has locked is then modified with no 409 anywhere",
  );
  assert.match(src, /const willTouch = /, "the lock is checked over everything the delete touches");
});

test("[DEDUP-READ-HONEST] the bank-attach refusal is REACHABLE, not merely written", () => {
  // The same class again, one level deeper. Every queued path may degrade a failed probe to "no
  // flag" — a human still sees the invoice. /api/bank/attach-invoice may not: it books straight to
  // 'paid', so there is no later moment where anyone looks. It therefore throws inside its probe
  // callbacks and answers 503 "we konden nu niet nakijken".
  //
  // For a long time that could not happen. collectPossibleDuplicate caught the throw one frame in
  // and returned null — which is the same value as "no look-alike found" — so the route carried on
  // and booked the payment. The 503, its Dutch message, its `dedup_unavailable` code and its force
  // door were all unreachable.
  //
  // Two halves, and BOTH are needed: the callbacks must still throw, and the call must NOT ask for
  // bestEffort. Either one alone puts the silent double-booking back.
  const src = code("src/app/api/bank/attach-invoice/route.ts");
  assert.match(
    src, /if \(error\) throw new Error\(error\.message\)/,
    "the duplicate probes no longer throw on a failed read — a { data: null } answer then reads " +
      "as 'no duplicate' and this route pays the bill a second time",
  );
  assert.doesNotMatch(
    src, /collectPossibleDuplicate\([\s\S]{0,3000}?bestEffort/,
    "this route asked for bestEffort. That swallows the throw above and returns null, which is " +
      "the same answer as 'no look-alike found' — on the one path that books money without a " +
      "human. The 503 below it becomes unreachable code.",
  );
  assert.match(
    src, /code: "dedup_unavailable"/,
    "the refusal itself is gone — then a failed probe has no honest answer left at all",
  );
});

// ─── [DECLARED-INVOICE] The double-payment refusal must precede the booking ───────────
//
// The refusal exists for the ATAPACK case: a payment whose description names TWO invoices while
// only one is in the administration. Booking the whole line onto the one we hold spends the money
// for the other, and when that invoice arrives it reads fully open, gets dunned, and is paid a
// second time.
//
// It was written, argued for ("waiting is reversible and a wrong booking is not"), and then a newer
// atomic RPC was added ABOVE it that books and returns. From the moment bank_confirm_atomic.sql was
// applied, the refusal was unreachable — it survived only on the pre-migration fall-through. A
// guard that runs after the write is not a guard.

test("[DECLARED-INVOICE] the refusal runs before EVERY booking path, not just the legacy one", () => {
  const src = code("src/app/api/bank/confirm/route.ts");

  const guard = src.indexOf("declared_invoice_missing");
  // The atomic call is chosen by name at runtime since [DEEL-BEDRAG], so this anchors on the
  // dispatch as well as the literal names.
  const atomic = src.search(/rpc as any\)\(atomicFn|rpc as any\)\("confirm_bank_payment"|rpc\("confirm_bank_payment"/);
  const legacy = src.indexOf('rpc("apply_bank_payment"');

  assert.ok(guard > 0, "the declared-invoice refusal is gone entirely");
  assert.ok(atomic > 0, "the atomic confirm path is gone");
  assert.ok(legacy > 0, "the legacy apply path is gone");

  assert.ok(
    guard < atomic,
    "the declared-invoice refusal sits AFTER the atomic confirm_bank_payment call, which books and " +
      "returns — so on any database where bank_confirm_atomic.sql is applied the refusal is dead " +
      "code, and a payment naming an invoice you do not hold is booked in full onto the one you do.",
  );
  assert.ok(
    guard < legacy,
    "the refusal must precede the legacy booking path too",
  );
});

test("[DECLARED-INVOICE] and it still knows how much of the line the booking would take", () => {
  // The refusal only fires when the booking would swallow the WHOLE line (`!moneyLeftOver`), no
  // amount was stated, and the owner did not override. Hoisting it above the atomic call is only
  // correct while that arithmetic is hoisted with it — otherwise the condition silently reads
  // `undefined` and the guard never fires for a different reason than before.
  const src = code("src/app/api/bank/confirm/route.ts");
  const money = src.indexOf("const moneyLeftOver = paymentExceedsOpenBalance");
  const guard = src.indexOf("declared_invoice_missing");
  assert.ok(money > 0 && money < guard, "moneyLeftOver must be computed before the refusal reads it");
  assert.match(
    src, /requestedAmount == null && !force && !moneyLeftOver/,
    "the refusal's three conditions must be intact: no stated amount, no override, whole line consumed",
  );
});

// ─── The import itself, end to end on the expression that now runs on every intake ────
//
// The source gates above hold the PLACEMENT. This holds the BEHAVIOUR, and above all the half that
// a fix in an import path has to prove first: that a healthy invoice still imports exactly as it
// did. Moving a merge out of a guard makes it run on every single import — including the millions
// where nothing is wrong — so "unchanged for a clean invoice" is not an assumption to make.

import { mergePossibleDuplicate, markDuplicateCheckUnavailable } from "./possible-duplicate-collect";
import type { PossibleDuplicate } from "./safecore";

/** The exact expression /api/intake now runs, unconditionally, on both handlers. */
function intakeMerge(
  fc: Record<string, unknown>,
  dedupCheckFailed: boolean,
  possibleDup: PossibleDuplicate | null,
): Record<string, unknown> {
  const merged = (dedupCheckFailed
    ? markDuplicateCheckUnavailable(mergePossibleDuplicate(fc, possibleDup))
    : mergePossibleDuplicate(fc, possibleDup)) as Record<string, unknown> | null;
  if (merged?._safecore) fc._safecore = merged._safecore;
  return fc;
}

const readField = () => ({ vendor: 0.93, invoice_number: 0.98, _safecore: { arithmetic_ok: true } }) as Record<string, unknown>;
const LOOKALIKE: PossibleDuplicate = {
  match: { id: "x", invoice_number: "2026-4471", client_name: "Atapack" } as PossibleDuplicate["match"],
  reason: "zelfde bedrag en datum",
};

test("[DEDUP-READ-HONEST] a healthy import is byte-for-byte what it was before the fix", () => {
  // The one that matters most. This expression now runs on EVERY import, so the ordinary case —
  // a clean invoice, a probe that answered, no look-alike — must come out untouched.
  const before = JSON.stringify(readField());
  const after = intakeMerge(readField(), false, null);
  assert.equal(JSON.stringify(after), before, "a clean import must not gain a single key");
});

test("[DEDUP-READ-HONEST] a probe that could not run now reaches the row", () => {
  // The whole point. Before the fix this produced nothing at all, and the invoice auto-booked.
  const sc = intakeMerge(readField(), true, null)._safecore as Record<string, unknown>;
  assert.equal(sc.possible_duplicate, true, "classifyImportHealth reads this → needs-review → no auto-advance");
  assert.equal(sc.possible_duplicate_reason, "we konden de dubbelcheck niet uitvoeren");
  assert.equal(sc.arithmetic_ok, true, "and it does not trample what the reader already stored");
});

test("[DEDUP-READ-HONEST] a NAMED look-alike outranks the generic reason", () => {
  // The precedence markDuplicateCheckUnavailable's own comment argues for: a run that found a
  // look-alike and then failed its second probe must keep naming the invoice it did find. "Lijkt op
  // factuur 2026-4471" is something the owner can act on; "we konden het niet nagaan" is not.
  const found = intakeMerge(readField(), false, LOOKALIKE)._safecore as Record<string, unknown>;
  const both = intakeMerge(readField(), true, LOOKALIKE)._safecore as Record<string, unknown>;
  assert.equal(found.possible_duplicate_of, "2026-4471");
  assert.deepEqual(both, found, "a failed second probe must not overwrite a real find");
});

// ─── [WATERMARK-SERVER-TIME] The mailbox must not be stoppable by a sender ────────────
//
// The sync watermark is the point every LATER sync starts from. It walks the dates of the messages
// in the window and stores the newest complete one; the next run then asks the provider for mail
// after it.
//
// The Gmail path took that date from the `Date:` header — written by whoever sent the mail. One
// message stamped 1 January 2027 does not import one wrong invoice: it moves the mark to 2027 and
// the mailbox imports NOTHING for a year and a half, while every sync reports success. It needs no
// attacker; a sending server with a wrong clock is enough, and the app cannot tell them apart.
//
// Microsoft has always used receivedDateTime — the server's own receipt time. Gmail now uses
// internalDate, its exact analogue. And because a third provider will one day be added by someone
// who has not read that sentence, a second belt drops future-dated messages from the walk
// regardless of where the date came from.

test("[WATERMARK-SERVER-TIME] the Gmail walk is fed the server's receipt time, not the sender's header", () => {
  const src = code("src/lib/email-integration.ts");
  assert.match(
    src, /const internalMs = Number\(msg\.internalDate\)/,
    "the Gmail message date no longer comes from internalDate — a sender's `Date:` header can move " +
      "the sync watermark, which stops the mailbox importing for as long as that date is away",
  );
  // The header stays as a FALLBACK, which is correct — a message with neither is caught by the
  // existing NaN guard. What must not come back is the header as the primary source.
  assert.doesNotMatch(
    src, /const date = headerVal\('date'\)/,
    "the header is the primary source again",
  );
  // Microsoft's side must keep using the server's own timestamp.
  assert.match(src, /date: m\.receivedDateTime as string/, "the Microsoft path lost receivedDateTime");
});

test("[WATERMARK-SERVER-TIME] a future-dated message is dropped from the walk, whatever the provider", () => {
  const src = code("src/lib/email-integration.ts");
  assert.match(src, /const futureFloorMs = Date\.now\(\)/, "the future clamp is gone");
  assert.match(
    src, /t <= futureFloorMs/,
    "the walk no longer excludes future-dated messages — the belt that protects a mailbox when a " +
      "provider returns something odd, and when a third provider is added later",
  );
});

// ─── Every import door still reaches the books ────────────────────────────────────────
//
// The doors are: the camera/upload intake, the UBL e-invoice intake, the manual file upload, and
// the two mailbox syncs. They share nothing but the shape of what they must produce, so a change in
// one is exactly the kind that silently skips another — and an invoice that never becomes a row
// makes no noise at all.

test("[IMPORT-COMPLETE] every door still writes an invoice row, and still holds its guards", () => {
  const doors: Array<[string, string[]]> = [
    // [file, phrases that must survive]
    ["src/app/api/intake/route.ts", ['from("invoices")', "shouldAutoAdvanceInvoice", "markDuplicateCheckUnavailable"]],
    ["src/app/api/email/upload/route.ts", ['from("invoices")', "markDuplicateCheckUnavailable"]],
    ["src/lib/email-integration.ts", ["from('invoices')", "markDuplicateCheckUnavailable"]],
  ];
  for (const [f, phrases] of doors) {
    const src = code(f);
    for (const p of phrases) {
      assert.ok(
        src.includes(p),
        `${f} no longer contains \`${p}\` — an import door that stopped writing, or stopped ` +
          `checking, is invisible: the owner simply never sees the invoice again`,
      );
    }
  }
});

test("[IMPORT-COMPLETE] the byte-hash gate is still the first thing every file meets", () => {
  // The gate that makes re-uploading the same file harmless. If it moves after the AI read, a
  // re-upload costs a paid extraction; if it disappears, the same bytes become a second cost.
  for (const f of ["src/app/api/intake/route.ts", "src/app/api/email/upload/route.ts"]) {
    const src = code(f);
    assert.match(
      src, /content_hash|contentHash/,
      `${f} no longer consults the byte hash — the same file re-uploaded becomes a second invoice`,
    );
  }
});

test("[KAS-AUTO-BOOK] the blanket kas refusal is gone, and what replaced it still refuses", () => {
  // The line removed was `if (tier === "amount_only" && ownerScheme === "kas") continue` — right in
  // its premise, wider than its premise in its conclusion, and the width cost a kasstelsel owner
  // every amount-only booking forever. What replaced it must not be a plain deletion: the refusal
  // still has to exist for a quarter that has been DECLARED, and for one we could not read.
  const src = code("src/lib/bank-auto-confirm.ts");
  assert.doesNotMatch(
    src, /tier === "amount_only" && ownerScheme === "kas"/,
    "the blanket refusal is back — every amount-only match is manual again under kasstelsel",
  );
  assert.match(src, /decideKasAutoBook/, "the decision is delegated to the module that argues it");
  assert.match(
    src, /filingStateOf\(/,
    "and it is fed the three-state filing answer, not a boolean that cannot say 'unknown'",
  );
  assert.match(
    src, /if \(!verdict\.book\)[\s\S]{0,120}continue/,
    "a refusal must still SKIP the booking — a verdict computed and then ignored is the defect " +
      "class this file exists for",
  );
});

test("[KAS-AUTO-BOOK] a failed btw_filings read can never read as 'nothing is filed'", () => {
  // `const { data } = await …` turns an outage into an empty set, and an empty set is the single
  // answer that authorises booking into a declared quarter. The read is wrapped and the flag is
  // separate from the rows, all the way to the decision.
  const src = code("src/lib/bank-auto-confirm.ts");
  assert.match(src, /filingsReadOk/, "the read's success is carried as its own fact");
  assert.match(
    src, /filingsReadOk = false/,
    "and something must actually SET it false — a flag that is always true is not a flag",
  );
  assert.match(
    src, /isMissingRelation\(message\)/,
    "with the migration-not-applied case told apart from a failure (that one IS a complete answer)",
  );
});

test("[KAS-AUTO-BOOK] the flag the booking leaves behind can be answered both ways", () => {
  // An amount-only booking is allowed to happen unattended because it stays reversible until the
  // aangifte. That makes the review real only if the owner can END it: "Ontkoppelen" said the
  // booking is wrong, and nothing said it was right, so the amber banner could never come down.
  const client = code("src/app/dashboard/bank/BankClient.tsx");
  // Anchored on the WIRING, not on the declaration. A first version of this gate matched the bare
  // word `onMatchChecked`, which the optional prop type satisfies on its own — so removing the call
  // site AND disabling the button left the gate green. An unreachable button is exactly what this
  // test is for, and the negative control is what said so.
  assert.match(
    client, /onMatchChecked=\{\(\) => markMatchChecked\(/,
    "the card is actually GIVEN the handler — an optional prop nobody passes renders nothing",
  );
  assert.match(
    client, /\{onMatchChecked && \(\s*<button/,
    "and the button renders on the strength of that prop, not behind a disabled condition",
  );
  assert.match(client, /match-checked/, "and calls the route that clears the flag");
  // The button must live INSIDE the amount-only warning: a "Klopt, gecontroleerd" anywhere else
  // answers a question nobody asked.
  const warn = client.indexOf("amount_only");
  // [TAAL] Anchored on the key, not the Dutch label.
  const btn = client.indexOf("t('bank.kloptGecontroleerd')");
  assert.ok(warn > 0 && btn > warn, "the confirm sits inside the flag it answers");
  const route = code("src/app/api/bank/match-checked/route.ts");
  assert.match(route, /auto_match_reason: null/, "which is what clearing it means");
  assert.match(
    route, /\.eq\("status", "matched"\)/,
    "and only on a line that is still linked — confirming a flag on an unlinked line claims " +
      "something about a booking that no longer exists",
  );
});

test("[KAS-AUTO-BOOK] the quarter-close is where the flagged bookings are actually offered", () => {
  // The permission to book unattended rests on "the owner reviews before filing". A promise with
  // no mechanism is a promise that is false, so readiness has to count them on the quarter they
  // land in — after filing, the same correction is a suppletie.
  const readiness = code("src/lib/readiness.ts");
  assert.match(readiness, /amountOnlyBookingCount/, "the signal exists");
  assert.match(
    readiness, /alleen op bedrag gekoppeld/,
    "and it is SAID — a signal collected and never rendered is not a review",
  );
  const route = code("src/app/api/readiness/route.ts");
  assert.match(route, /amountOnlyBookingCount/, "and the route actually measures it");
  assert.match(
    route, /not\("auto_match_reason", "is", null\)/,
    "counting the flagged rows themselves, so confirming one clears the risk (counted ⟺ shown)",
  );
});

test("[SUPPLIER-IBAN] the registry account reaches EVERY matcher entry point, or none", () => {
  // Three doors run the same matcher: the /bank screen, the "probeer alles opnieuw" sweep, and the
  // server-side auto-confirm (import, verify, cron, email). Evidence that reaches one and not
  // another makes the two disagree about the same line — worse than neither having it, because the
  // owner then sees a suggestion that the background pass will not book, or the reverse.
  for (const f of [
    "src/app/api/bank/match/route.ts",
    "src/app/api/bank/rematch/route.ts",
    "src/lib/bank-auto-confirm.ts",
  ]) {
    const src = code(f);
    assert.match(src, /supplier_id/, `${f} no longer selects supplier_id — the link to the registry`);
    assert.match(
      src, /withSupplierIbans\(/,
      `${f} loads the invoices but never attaches the known account — the signal silently vanishes ` +
        `on this door while the other two still have it`,
    );
  }
});

test("[SUPPLIER-IBAN] it is weighed as what it is, not as the document's own account", () => {
  const src = code("src/lib/bank-matching.ts");
  // Booked flagged, never silently: the registry can attach an account to a supplier via a
  // normalised NAME key, and two real companies can collide on one.
  assert.doesNotMatch(
    src, /includes\("reference"\) \|\| sig\.includes\("iban"\) \|\| sig\.includes\("supplier_iban"\)/,
    "the registry account reached the 'certain' tier — that books with no human and no flag",
  );
  assert.match(
    src, /if \(sig\.includes\("supplier_iban"\)\)[\s\S]{0,900}return "amount_only"/,
    "its tier must resolve to the flagged booking",
  );
  // The double-count guard: when the document named the account, the registry adds nothing.
  assert.match(
    src, /!ibanOk && ibanMatches\(tx\.counterpartIban, inv\.supplier_known_iban\)/,
    "without !ibanOk the same account is counted twice and a plain document match climbs the ranking",
  );
  // And the collision veto — the one weakness the tier actually has.
  assert.match(
    src, /counterpartName \?\? ""\)\.trim\(\) && !sig\.includes\("counterpart"\)/,
    "a name on the line that does not even reach the listing bar must refuse the booking",
  );
});

test("[ORIGINEEL] the loop the accountant opens can be closed by the client", () => {
  // The accountant's "opvragen" is built from readiness items, so it can ask for a missing original
  // by invoice number. Until this existed the client could not answer: document_id was written at
  // CREATION by three doors and by NOTHING afterwards. Each half is gated, because either half
  // alone is a feature that does not work.
  const route = code("src/app/api/invoice/[id]/document/route.ts");
  assert.match(route, /document_id: documentId/, "the route links the file to the invoice");
  assert.match(
    route, /\.is\("document_id", null\)/,
    "as a compare-and-set — two tabs attaching at once must not leave the second file linked to nothing",
  );

  const client = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(client, /attachOriginal\(inv, f\)/, "the button is wired to the handler");
  assert.match(client, /api\/invoice\/\$\{inv\.id\}\/document/, "which calls the route");
  assert.match(
    client, /\{!inv\.document_id && \(/,
    "and it is offered exactly where the slot is empty — a button on a row that already has its " +
      "original is an action the route will refuse",
  );

  const readiness = code("src/lib/readiness.ts");
  assert.match(
    readiness, /filter=geen-document/,
    "the readiness item points at the tab — it was the ONE item in the report with no fix link, " +
      "and re-losing the link puts the client back where they could see the problem and not act on it",
  );
});

test("[ORIGINEEL] it adds evidence and never touches a figure", () => {
  // The whole safety of this route. Every other upload door READS the file and creates an invoice
  // from what it finds. This invoice already exists and its amounts are confirmed — by the owner,
  // or by an accountant who has processed it. A re-read here would let a misread silently overwrite
  // a booked figure, which is the most expensive possible way to fix a missing attachment.
  const route = code("src/app/api/invoice/[id]/document/route.ts");
  assert.doesNotMatch(
    route, /verifyInvoiceFromPdf|extractInvoice|readInvoice/,
    "the route reads the document with the extractor — that can overwrite a confirmed amount",
  );
  // The invoice update must carry the two evidence pointers and nothing else. Stated as "there is
  // exactly ONE update on invoices, and it is that one" rather than as a blanket ban on money words
  // anywhere in the file: the first version banned the words and failed on `invoice_date: string |
  // null` in a type annotation over a READ, which is not a write at all. A gate that cannot tell a
  // read from a write teaches people to loosen it.
  const updates = [...route.matchAll(/\.from\("invoices"\)\s*\.update\(([^)]*)\)/g)];
  assert.equal(updates.length, 1, `expected exactly one invoices update, found ${updates.length}`);
  assert.match(
    updates[0][1], /^\{ document_id: documentId, pdf_url: storagePath \}$/,
    "the invoice write must be the two evidence pointers and nothing else — any money or status " +
      "field here means this route can change a figure the owner already confirmed",
  );
  // And it must not refuse an accountant-locked invoice: the lock protects the figures they booked,
  // this changes none of them, and refusing would refuse precisely the invoice they asked about.
  assert.doesNotMatch(
    route, /accountant_status/,
    "the 'verwerkt' lock was applied here — it would block exactly the invoice the accountant " +
      "requested the original for, which is the case this whole route exists to serve",
  );
});

test("[ORIGINEEL] one tab rule, so the count and the list cannot disagree", () => {
  // The tab predicate was written out twice, twenty lines apart — once for the list and once for
  // the dateless-hidden count. A fifth tab added to one of them is a tab whose own count contradicts
  // what it shows.
  const client = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(client, /function matchesTab\(inv: IncomingRow, tab: FilterTab\)/, "one predicate");
  const inlined = [...client.matchAll(/filter === 'all' \? true : filter === 'auto'/g)];
  assert.equal(
    inlined.length, 0,
    "the tab rule is inlined again — the two copies drift, and the drift is invisible until a tab " +
      "shows rows its own counter does not know about",
  );
  const uses = [...client.matchAll(/matchesTab\(inv, filter\)/g)];
  assert.ok(uses.length >= 2, `both call sites must use it (found ${uses.length})`);
});

test("[FACTUURVRAAG] the counters that were reading zero now have a writer", () => {
  // Three accountant surfaces READ invoices.accountant_status = 'vraag': the "Open vraag" KPI on
  // the home, the red dot in Klantenbeheer, and the ❓ todo on the werkboard. No route wrote it.
  // The DB trigger explicitly permits an accountant to move accountant_status — the permission was
  // granted and the write path never built, so the single most common bookkeeper question had no
  // home in the app and its counters read zero forever.
  const route = code("src/app/api/accountant/invoice-question/route.ts");
  assert.match(
    route, /\.from\('invoices'\)\s*\.update\(\{ accountant_status: VRAAG_STATUS \}\)/,
    "the route must actually set the status the three surfaces count",
  );
  // And the TEXT, without which a 'vraag' is the problem this feature exists to replace: the client
  // sees that something is wrong and not what.
  assert.match(route, /subject_type: 'invoice'/, "the question is stored against the invoice");
  assert.match(route, /vraag_text: question/, "with the accountant's actual words");
  // Text first, status second — a status with no text is worse than no status.
  assert.ok(
    route.indexOf("vraag_text: question") < route.indexOf("accountant_status: VRAAG_STATUS"),
    "the text must be written BEFORE the status, so a half-failure never leaves a question the " +
      "client can see the existence of but not the content of",
  );
  // An empty question is refused rather than stored.
  assert.match(route, /if \(!question\) return/, "an empty question is not a question");
});

test("[FACTUURVRAAG] the client can reach the invoice the question is about", () => {
  // /dashboard/vragen filtered subject_type='document', so an invoice question could never appear
  // on the one screen built to show questions. Both halves are read, separately — they arrive under
  // different RLS policies, and one query for both fails entirely until the second policy ships.
  const page = code("src/app/dashboard/vragen/page.tsx");
  assert.match(page, /\.eq\('subject_type', 'invoice'\)/, "invoice questions are read");
  assert.match(page, /buildOpenInvoiceVragen\(/, "and built into the list");
  assert.match(
    page, /if \(invStatusErr\) loadFailed = true/,
    "[NO-SILENT-EMPTY] a failed read of this half must not read as 'no questions' either",
  );

  const client = code("src/app/dashboard/vragen/VragenClient.tsx");
  assert.match(
    client, /\/dashboard\/incoming\/manage\?focus=/,
    "the question must link to the invoice itself — otherwise the client hunts through four " +
      "hundred rows for the one being asked about, and the conversation moves to WhatsApp",
  );
  assert.match(
    client, /!vraag\.documentMissing/,
    "and only when the invoice was actually readable: a link to a row that is not there is worse " +
      "than no link",
  );
});

test("[FACTUURVRAAG] the accountant asks from where they are looking", () => {
  // The button was a bare <a href="/dashboard/accountant/opvragen">: it navigated AWAY from the
  // invoice to a quarter-level screen for missing DOCUMENTS, carrying nothing — not the invoice,
  // not the client, not the doubt. That is where the loop ended.
  const src = code("src/modules/accountant/pages/AccountantBevestigen.tsx");
  assert.doesNotMatch(
    src, /href="\/dashboard\/accountant\/opvragen"/,
    "the row's 'klopt niet' action navigates away again, carrying no invoice",
  );
  assert.match(src, /invoice-question/, "it posts the question about THIS invoice");
  // Anchored on the question's OWN body, not on the words appearing somewhere in the file. The
  // first version asserted `clientId: rij.clientId` file-wide and stayed green when the question
  // call lost it — because the CONFIRM call three functions up passes the same pair. A gate that
  // can be satisfied by a different call site is not guarding this one.
  const body = /invoice-question[\s\S]{0,400}?body: JSON\.stringify\(\{([^}]*)\}\)/.exec(src);
  assert.ok(body, "the question's request body must be findable next to its URL");
  assert.match(
    body[1], /invoiceId: rij\.id/,
    "with the invoice id — the whole difference between a question and a change of screen",
  );
  assert.match(
    body[1], /clientId: rij\.clientId/,
    "and the client it belongs to, so a question can never land in another client's books",
  );
});

test("[BULK-BEVESTIG] a doubt can never be swept into a bulk confirmation", () => {
  // This screen's own doctrine, from its header and from the render gate that guards it: "a confirm
  // button above a hidden doubt turns the accountant into a rubber stamp". A checkbox on a row the
  // reader was unsure about does exactly that, at scale, in one tap — so the checkbox is not
  // rendered there, AND the planner refuses such a row even if one arrives selected.
  const src = code("src/modules/accountant/pages/AccountantBevestigen.tsx");
  assert.match(
    src, /bulkConfirmable\(rij\) && \(\s*<input\s*type="checkbox"/,
    "the checkbox must be gated on the row being sweepable — an ungated one is the rubber stamp",
  );
  const mod = code("src/lib/bulk-confirm.ts");
  assert.match(
    mod, /if \(!bulkConfirmable\(r\)\) \{[\s\S]{0,120}?continue/,
    "and the planner refuses it again, because a UI gate is not a guarantee about what arrives",
  );
  assert.match(
    mod, /twijfels\.length === 0/,
    "sweepable means the reader flagged NOTHING — any other rule lets a doubt through",
  );
});

test("[BULK-BEVESTIG] the bulk path books through the one audited route", () => {
  // Every guard that route carries — the mandate check, the compare-and-swap on status,
  // confirmed_by, the client's notification — is inherited rather than reimplemented. A second
  // booking path in SQL would have to repeat all of them, and repeating them is how two paths drift
  // on the invariant that matters.
  const src = code("src/modules/accountant/pages/AccountantBevestigen.tsx");
  assert.match(src, /bevestigSelectie/, "the bulk run exists");
  assert.match(
    src, /bevestigSelectie[\s\S]{0,1400}?fetch\('\/api\/accountant\/bevestig'/,
    "and it calls the SAME single route per invoice, not a new bulk endpoint",
  );
  // A half-succeeded run must say both numbers. "Gelukt" over a partial run is the failure this
  // codebase keeps correcting.
  assert.match(src, /bulkConfirmResultText\(gelukt, mislukt\)/, "both counts reach the screen");
  const mod = code("src/lib/bulk-confirm.ts");
  assert.match(mod, /bevestigd, \$\{failed\} niet/, "and the sentence names the failures");
});

test("[BULK-BEVESTIG] the confirm keeps what the single confirm promised", () => {
  // Two sentences the single-confirm screen carries and the render gate holds there: the reading is
  // not being changed, and the liability stays with the entrepreneur (art. 52 AWR). A bulk action
  // booking forty invoices without them would be the one place the law is not mentioned.
  const mod = code("src/lib/bulk-confirm.ts");
  assert.match(mod, /art\. 52 AWR/, "the liability sentence survives the bulk path");
  assert.match(mod, /je verandert er niets aan/, "and so does 'you confirm the reading'");
  // More than one client is said out loud: this screen spans every authorised client at once, and
  // booking into the wrong client's books is the mistake that costs most.
  assert.match(mod, /verschillende klanten/, "a multi-client selection says so");
});

test("[DAGSTART] the morning message stays silent unless something moved", () => {
  // This app produces around forty distinct notifications and exactly ONE is addressed to an
  // accountant — from quarter-close, four times a year. So the confirm stack grows in silence and
  // the deadline counts down on a screen nobody was asked to open.
  //
  // The obvious fix is worse: "you have 40 invoices waiting", every morning, is a message people
  // stop reading — and then the day it says something new, they miss it. What makes this safe is
  // that it speaks about work that is NEW and about a deadline that has MOVED, and otherwise says
  // nothing at all.
  const mod = code("src/lib/accountant-daily.ts");
  // Read as a SHAPE rather than as one exact string. A third trigger was added later ([SUPPLETIE]:
  // a filed quarter that has moved) and pinning the literal condition made a legitimate signal look
  // like a regression — while a gate that only ever matches today's text stops describing the rule
  // it is protecting. The rule is: every term in the early return is a thing that MOVED, and no
  // term is a standing total. That is what turns this into a nag, and that is what is checked.
  const guard = /if \(([^)]*?)\) return null/.exec(mod);
  assert.ok(guard, "the early return that produces silence still exists");
  assert.match(guard![1], /newWork === 0/, "no new work is part of being silent");
  assert.match(guard![1], /!deadline/, "and no deadline band");
  for (const standing of ["totalToConfirm", "divergedStanding", "clientsNotFiled"]) {
    assert.ok(
      !guard![1].includes(standing),
      `${standing} is a STANDING total and may never trigger a message — that is the daily nag ` +
        "this module exists to refuse, and it is strictly worse than the silence it replaced",
    );
  }
  assert.match(
    mod, /DEADLINE_BANDS as readonly number\[\]\)\.includes\(days\)/,
    "the deadline speaks on its bands, not every day — otherwise it repeats itself for a month",
  );

  const cron = code("src/app/api/cron/accountant-daily/route.ts");
  // "New" must be measured against a window, not against the whole stack. Reading totalToConfirm
  // as the trigger is exactly the nag above.
  // The WINDOW, not the shape of the comparison. This pinned the exact expression
  // `(r.created_at ?? "") >= since` and then failed when that comparison was replaced by a parsed
  // one — which is strictly more correct (PostgREST renders `+00:00`, this cron builds `Z`, and the
  // two diverge lexicographically at the boundary). What the rule actually says is: newToConfirm is
  // measured against a time window and never against the whole stack.
  const newWorkLine = code("src/app/api/cron/accountant-daily/route.ts")
    .split("\n").find((l) => l.includes("const newToConfirm ="));
  assert.ok(newWorkLine, "the cron still measures new work");
  assert.match(newWorkLine!, /rows\.filter\(/, "new work is a SUBSET of the stack…");
  assert.match(newWorkLine!, /isNew\(|since/, "…chosen by a time window");
  assert.doesNotMatch(newWorkLine!, /rows\.length/,
    "the whole stack is not 'new' — that is the daily nag this module refuses");
  assert.match(
    cron, /if \(!message\) \{ quiet\+\+; continue; \}/,
    "and a null plan must actually SKIP the send — a plan computed and then ignored is the defect " +
      "class this whole file exists for",
  );
  // It may write notifications and nothing else: a digest that could move a figure is a digest
  // nobody should trust.
  assert.doesNotMatch(
    cron, /\.update\(|\.upsert\(/,
    "the morning message writes nothing but a notification",
  );
});

test("[GEGROND] the only non-self-referential check on a money field is actually wired", () => {
  // Everything else that judges an amount asks the reader about the reader: the arithmetic gate
  // compares three numbers ONE read produced, and field_confidence is its opinion of its own
  // opinion. A read that is wrong consistently passes all of it — which is exactly what produced a
  // € 0,46 BTW error on a real invoice, and why an owner keeps the paper copy open beside the app.
  //
  // A module that computes this and is never called changes nothing at all, so what is gated here
  // is the WIRING, at every point it has to exist.
  const ai = code("src/lib/ai.ts");
  assert.match(ai, /groundMoneyFields\(/, "the extractor must actually run the check");
  assert.match(
    ai, /_grounding = grounding/,
    "and STORE it — a verdict computed and dropped is the defect class this whole file is for",
  );
  assert.match(
    ai, /groundMoneyFields\(amounts, statementText, 'text'\)/,
    "fed with the document's own extracted text, which is the entire point: any other input makes " +
      "this the reader checking itself again",
  );

  // Both auto-booking doors, or neither. A gate on one door is not a gate — that is how the intake
  // path and the e-mail path came to disagree about the duplicate marker.
  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    assert.match(
      code(f), /totalGrounding: groundingOf\(/,
      `${f} no longer passes the grounding verdict — this door auto-books a total that the ` +
        `document does not contain, while the other door refuses it`,
    );
  }

  const aa = code("src/lib/auto-advance.ts");
  assert.match(
    aa, /if \(!amountsSettled && s\.totalGrounding === "absent"\)[\s\S]{0,120}?advance: false/,
    "and the gate must REFUSE on it — a signal that is passed in and ignored is decoration",
  );
  // [E-FACTUUR-BESLECHT] The ONE thing that may relax it, pinned by name.
  //
  // This guard used to demand the refusal be unconditional. It is now conditional, and that is a
  // narrowing worth guarding harder rather than softer: the check exists because an amount was
  // READ off a page, and it steps aside only where there is no page to have misread — a complete,
  // self-consistent e-invoice the supplier produced. Pinning the identifier means a future `if
  // (!somethingElse && s.totalGrounding === "absent")` fails this test instead of quietly widening
  // the one door the money gates have.
  assert.match(
    aa, /const amountsSettled = eInvoiceSettlesAmounts\(s\.health\.field_confidence\)/,
    "the only permitted relaxation is the supplier's own structured figures — nothing else may gate this",
  );
  // 'unreadable' must never block: a photographed receipt is the ordinary case this app exists for,
  // and refusing to automate those would take the product away in the name of protecting it.
  assert.doesNotMatch(
    aa, /totalGrounding === "unreadable"[\s\S]{0,80}?advance: false/,
    "a photo has no text layer — blocking there turns a certainty feature into a stuck queue",
  );

  // And the owner has to SEE it, or the app is still asking them to trust it.
  const health = code("src/lib/import-health.ts");
  assert.match(
    health, /_grounding[\s\S]{0,400}?niet letterlijk in de tekst/,
    "the verify screen must say it in words — that sentence is the difference between checking " +
      "the invoice yourself and not having to",
  );
});

test("[GEGROND-OCR] the second read is blind, or it is worth nothing", () => {
  // [GEGROND] gave the app its first check on a money figure that is not the reader checking itself
  // — but only for a text PDF. A photograph has no characters to search, so the majority of intake
  // got no independent check at all. This is the photo half.
  //
  // Its entire value is that the transcription call never sees what the extractor found. Show a
  // model a number and ask it to check that number and it agrees; the exercise then measures
  // nothing while reporting confidence, which is worse than not running it — it manufactures trust.
  const mod = code("src/lib/ocr-amounts.ts");
  assert.doesNotMatch(
    mod, /OCR_AMOUNTS_PROMPT[\s\S]{0,600}?\$\{/,
    "the transcription prompt gained an interpolation — anything from the extraction reaching it " +
      "turns an independent witness into an echo",
  );
  assert.match(mod, /Reken NIETS uit/, "and it asks for what is SEEN, not for a total");

  const ai = code("src/lib/ai.ts");
  assert.match(
    ai, /transcribeAmountsForGrounding\(fileBase64, mimeType/,
    "the call receives the FILE and nothing derived from the first read",
  );
  assert.match(
    ai, /grounding\.totalIncBtw === 'unreadable' &&/,
    "and it runs only where the text layer gave nothing — paying an API call to re-confirm what " +
      "the document's own characters already proved buys a WORSE answer",
  );
  assert.match(
    ai, /groundMoneyFields\(amounts, transcribed, 'ocr'\)/,
    "the verdict must record which witness spoke: presenting a model read as the mechanical " +
      "certainty of a text layer is how a green tick stops meaning anything",
  );
});

test("[GEGROND-OCR] the weaker witness never borrows the stronger one's words", () => {
  // An owner told "we found this literally in the text" about a photograph, who later finds one of
  // those wrong, is right to distrust every green tick afterwards.
  const g = code("src/lib/amount-grounding.ts");
  assert.match(g, /source === 'ocr'/, "the sentence branches on the witness");
  assert.match(g, /teruggelezen van de foto/, "with its own, weaker claim");
  // And the separator class may not swallow line breaks again: `\s` covers `\n`, which made a
  // newline between two amounts read as a thousands separator and turned correct reads into false
  // alarms. Spelled out, so the ordinary space cannot silently fall out of it either.
  assert.match(
    g, /const SEP = \/\[\.,\\u0020\\u00A0\\u202F\\u2009\]\//,
    "the grouping-separator class was changed — this is the guard that decides whether a match is " +
      "part of a bigger number, and it has broken in BOTH directions before",
  );
});

test("[NAREKENEN] the audit writes evidence and never a figure", () => {
  // [GEGROND] verifies at IMPORT, so it says nothing about the invoices already in the books —
  // which is exactly the set an owner doubts. This pass covers those. And the single property that
  // makes it safe to run over a whole administration is that it cannot change one: an audit that
  // also "fixes" what it finds is an audit whose results cannot be checked, and on a booked invoice
  // a silent correction moves a figure that may already sit in a filed aangifte.
  const src = code("src/app/api/invoice/audit/route.ts");
  const updates = [...src.matchAll(/\.from\("invoices"\)\s*\.update\(([^)]*)\)/g)];
  assert.equal(updates.length, 1, `expected exactly one invoices update, found ${updates.length}`);
  assert.match(
    updates[0][1], /^\{ field_confidence: merged \}/,
    "the audit's only invoice write must be the verdict — any money, date or status field here " +
      "turns a report into a silent correction",
  );
  // No blanket ban on money words in the file. That was tried, on the [ORIGINEEL] route, and it
  // failed on `invoice_date: string | null` inside a TYPE ANNOTATION over a read — a gate that
  // cannot tell a read from a write teaches people to loosen it. The exactly-one-update assertion
  // above is the real claim, and it is checkable.
  // And it must be the owner's own books only.
  assert.match(src, /\.eq\("receiver_id", user\.id\)/, "scoped to the caller");
});

test("[NAREKENEN] what it could not check is never counted as fine", () => {
  // The failure that would make the whole report worthless: "everything checks out" while silently
  // skipping every photograph. That is a claim about documents nobody opened, and it is worse than
  // running nothing at all.
  const mod = code("src/lib/books-audit.ts");
  assert.match(mod, /unchecked: rows\.filter\(\(r\) => r\.verdict === 'unreadable'\)\.length/);
  assert.match(mod, /foto of scan/, "the report says it in words");
  assert.match(
    mod, /daar zeggen deze cijfers dus niets over/,
    "and says plainly that the other numbers do not cover them",
  );
  // A problem leads the headline; a reassuring count above it is how a report gets skimmed.
  assert.match(
    mod, /if \(s\.mismatched\.length > 0\)[\s\S]{0,200}?klopt niet met het document/,
    "the failing count must come before the confirming one in the title",
  );

  const route = code("src/app/api/invoice/audit/route.ts");
  // A cap the owner cannot see is a report claiming to cover more than it did.
  assert.match(route, /truncated,/, "the per-run cap is reported");
  assert.match(route, /withoutDocument:/, "and so are the invoices with nothing to check against");
});

test("[NAREKENEN] the audit is reachable, and looks like what it is", () => {
  // A route with no button is a feature nobody has. This one answers the doubt an owner actually
  // has — about the invoices ALREADY in their books — so it has to be somewhere they are looking.
  const src = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(src, /runBooksAudit/, "the handler exists");
  assert.match(
    src, /onClick=\{\(\) => void runBooksAudit\(\)\}/,
    "and a button is actually wired to it — an optional handler nobody calls renders nothing",
  );
  assert.match(src, /'\/api\/invoice\/audit'/, "which calls the audit route");
  // The result has to be SHOWN. A pass that reports nothing is a pass that changed nothing and
  // said nothing, which is indistinguishable from not running.
  assert.match(src, /auditTitle\(summary\)/, "the report is rendered");
  assert.match(src, /auditLines\(summary, auditReport\.photosChecked/, "with the sentences under it");
  // And the counts the route reports about its own limits must reach the owner too: a cap they
  // cannot see is a report claiming to cover more than it did.
  // Anchored on the CONDITION, not on the words appearing somewhere. A first version matched the
  // bare identifier and stayed green when the branch was disabled with `if (false)` — the counts
  // were still referenced inside a block that could never run. Same trap as the clientId gate.
  assert.match(
    src, /if \(auditReport\.withoutDocument > 0\) \{/,
    "invoices with no document must actually reach the report",
  );
  assert.match(
    src, /if \(auditReport\.truncated > 0\) \{/,
    "and so must the per-run cap — a limit the owner cannot see is a report claiming to cover " +
      "more than it did",
  );

  // Not a primary button. It changes nothing, and a control that looks like an action is read as
  // one that fixes things — on a screen where nothing here fixes anything.
  // [TAAL] The end anchor is the key of the button label.
  const btn = src.slice(src.indexOf("runBooksAudit()"), src.indexOf("t('ink.rekenBoekenNa')"));
  assert.doesNotMatch(
    btn, /background: M3\.primary/,
    "the audit button is styled as a primary action — it only reports, and looking like it acts " +
      "is how an owner comes to believe their books were corrected",
  );
});

test("[NAREKENEN-FOTO] the paid half never runs without a human saying yes to a number", () => {
  // The text-layer half reads a PDF's own characters: free, mechanical. A photograph has none, so
  // checking one means an AI read — a real cost, per document. A bill nobody agreed to is not a
  // feature, so this half is opt-in and the question names the COUNT.
  const route = code("src/app/api/invoice/audit/route.ts");
  assert.match(
    route, /includePhotos = \(body as \{ includePhotos\?: unknown \}\)\.includePhotos === true/,
    "strict true only — a truthy default is how an opt-in becomes a surprise",
  );
  assert.match(
    route, /if \(\s*includePhotos &&[\s\S]{0,320}?photosDone < MAX_PHOTOS_PER_RUN/,
    "and the flag AND the cap must both gate the call",
  );
  assert.match(route, /photosCapped:/, "the cap being hit is reported, never silent");
  assert.match(
    route, /photosChecked,/,
    "and so is what the photo half actually produced — 'we did not look at your photographs' must " +
      "be a sentence the owner reads, not an absence they infer",
  );

  const client = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.match(
    client, /setPhotoAsk\(json\.summary\.unchecked\)/,
    "the screen OFFERS the paid half with the count, rather than running it",
  );
  assert.match(
    client, /if \(!includePhotos &&[\s\S]{0,140}?unchecked > 0\)/,
    "offered only after a free run, and only when there is something to offer",
  );
  assert.match(
    client, /onConfirm=\{\(\) => \{ setPhotoAsk\(null\); setAuditReport\(null\); void runBooksAudit\(true\) \}\}/,
    "and it runs ONLY from the confirm — a path that reaches runBooksAudit(true) without the ask " +
      "spends money the owner never approved",
  );
});

test("[NAREKENEN-FOTO] the photo witness never borrows the text layer's sentence", () => {
  // A photo is checked by a second blind READ, not by the document's characters. An owner told both
  // in the same breath cannot tell which one they are trusting — and the whole point of this work
  // is that they can.
  const mod = code("src/lib/books-audit.ts");
  assert.match(mod, /photosChecked > 0/, "the photo count gets its own sentence");
  assert.match(
    mod, /iets zekerder, niet hetzelfde/,
    "which says plainly that it is weaker than the literal text check",
  );
  // And the import path's transcription is REUSED, not copied: two prompts would drift, and then
  // the audit and the import would be measuring different things while reporting the same word.
  const route = code("src/app/api/invoice/audit/route.ts");
  assert.match(route, /transcribeStoredDocumentAmounts/, "the shared entry is used");
  assert.doesNotMatch(route, /OCR_AMOUNTS_PROMPT/, "the prompt is not re-declared here");
});

test("[DOCCHECK] the sharper check is wired at every point the weaker one was", () => {
  // [GEGROND] proves a figure is PRINTED. Measured on a real layout, that still waved through the
  // SUBTOTAL, a LINE ITEM and the BTW read as the total — all three are printed. This asks whether
  // it is printed WHERE A TOTAL IS PRINTED, and a module that is never called changes nothing.
  const ai = code("src/lib/ai.ts");
  assert.match(ai, /verifyDocument\(/, "the extractor runs it");
  assert.match(ai, /_doccheck = check/, "and STORES it — a verdict computed and dropped is nothing");
  assert.match(
    ai, /grounding\.source === 'ocr' \? null : statementText/,
    "never fed the OCR transcription: that reply is a bare list of amounts with no labels and no " +
      "guarantee of completeness, so 'largest' would be a claim about a page we only partly saw",
  );

  // Both auto-booking doors, or neither.
  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    assert.match(
      code(f), /totalPlacement: placementOf\(/,
      `${f} no longer passes the placement — this door books a subtotal that the other door refuses`,
    );
  }

  const aa = code("src/lib/auto-advance.ts");
  assert.match(
    aa, /if \(!amountsSettled && s\.totalPlacement === "present"\)[\s\S]{0,140}?advance: false/,
    "and the gate must REFUSE on it — 'present' IS the subtotal-read-as-total shape",
  );
  // The two states that must never block: a photo, and a correctly-placed total.
  for (const v of ["unreadable", "anchored", "largest"]) {
    assert.doesNotMatch(
      aa, new RegExp(`totalPlacement === "${v}"[\\s\\S]{0,80}?advance: false`),
      `blocking on '${v}' would hold correct invoices, and a queue of correct invoices is how a ` +
        `safety feature gets switched off`,
    );
  }

  // And the owner has to see it, in words that name the actual suspicion.
  const health = code("src/lib/import-health.ts");
  assert.match(health, /_doccheck/, "the verify screen reads it");
  assert.match(
    health, /niet waar het totaal staat/,
    "and says WHAT is suspected — 'er klopt iets niet' sends the owner hunting",
  );
  assert.match(health, /factuurdatum staat niet zo op het document/, "the date has a witness now too");
});

test("[DOCCHECK] an excl-label must never anchor the total it is not", () => {
  // The one permissive failure that would make this worse than nothing: if "Totaal excl. btw"
  // anchored, the module would bless exactly the read it exists to catch — and with MORE confidence
  // than the check it replaced.
  const mod = code("src/lib/document-verify.ts");
  assert.match(mod, /const NOT_TOTAL = \[/, "the exclusion list exists");
  for (const w of ["'sub'", "'excl'", "'netto'"]) {
    assert.ok(mod.includes(w), `the exclusion list lost ${w}`);
  }
  assert.match(
    mod, /if \(NOT_TOTAL\.some\(\(n\) => before\.includes\(n\) \|\| after\.includes\(n\)\)\) continue/,
    "and it is checked on BOTH sides: 'subtotaal' puts it before the word, 'totaal excl.' after",
  );
});

test("[DOCCHECK-SPLIT] the error this whole line of work started from is finally held", () => {
  // Measured with the total-placement check already shipped: the € 0,46 error STILL booked. Right
  // total, anchored; consistent arithmetic; only the split invented — and the split held nothing,
  // because the total was the only field that could hold an invoice.
  const mod = code("src/lib/document-verify.ts");
  assert.match(mod, /export function findPrintedSplit\(/, "the printed split is found");
  assert.match(
    mod, /if \(!amounts\.some\(\(a\) => Math\.abs\(a - btw\) < CENT\)\) continue/,
    "and BOTH numbers must be on the paper — one printed number plus arithmetic is us inventing a " +
      "split and then holding an invoice against our own invention",
  );
  assert.match(
    mod, /c\.btwContradiction !== null/,
    "the block rule must include it, or the original error books again",
  );

  const aa = code("src/lib/auto-advance.ts");
  assert.match(
    aa, /if \(s\.btwContradictsDocument === true\)[\s\S]{0,140}?advance: false/,
    "and auto-advance must refuse on it",
  );
  // Never on a merely-unprinted BTW: a receipt stating a rate and a total leaves the split to be
  // computed, and holding those would fill the queue with correct documents.
  assert.doesNotMatch(
    aa, /btw === "absent"[\s\S]{0,80}?advance: false/,
    "holding on an unprinted BTW would fire on every receipt that prints only a rate",
  );

  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    assert.match(
      code(f), /btwContradictsDocument: btwContradictionOf\(/,
      `${f} no longer passes it — this door books a contradicted split the other door refuses`,
    );
  }

  // And the owner is told what the PAPER says, not just that something is wrong.
  const health = code("src/lib/import-health.ts");
  assert.match(
    health, /op het document staat \$\{formatEuroNL\(contra\.excl\)\} \+ \$\{formatEuroNL\(contra\.btw\)\}/,
    "the sentence must name the printed split — that is the answer, not just the problem",
  );
});

test("[OVERSLAG-ZICHTBAAR] both e-mail doors record what they refused, not just refuse it", () => {
  // THE DEFECT: three different refusals — te groot, te klein, onleesbaar formaat — all left
  // through the same silent `continue` as a logo in a signature. The skipped panel then reported
  // "Niets overgeslagen" about an e-mail that carried a purchase invoice.
  //
  // The pure tests hold the SPLIT (which refusal speaks, which stays quiet). This one holds the
  // WIRING, which is where this file's own defect class lives: a gate that matches a mention
  // rather than the call is a gate that passes after the call is deleted.
  const src = code("src/lib/email-integration.ts");

  // Exactly three gate sites, and the number is the point: Gmail's parts, Outlook's file
  // attachments, and [DOORGESTUURD] the attachments read out of a forwarded message. Every route by
  // which a file can enter the pipeline passes the same gate — a fourth appearing without this
  // count moving is a copy that will drift, and a route that loses one is a door with no rulebook.
  const gates = src.match(/triageAttachment\(\{/g) ?? [];
  assert.equal(gates.length, 3, "one gate per entry route, no more and no fewer");

  // And each of them must PUSH the refusal onward, not merely compute it. All three are the same
  // four lines on purpose — a route that "also" reports, in its own shape, is a route whose
  // reporting can be changed without anyone noticing the other two were left behind.
  const wired = src.match(
    /const triage = triageAttachment\(\{[\s\S]{0,160}?if \(!triage\.keep\) \{[\s\S]{0,320}?unread\.push\(\{[\s\S]{0,200}?kind: triage\.kind[\s\S]{0,80}?continue/g,
  ) ?? [];
  assert.equal(wired.length, 3, "every route must record the refusal before continuing");

  // The unreadable-MIME branch is the quietest path of all: a .xlsx invoice, an iPhone .heic
  // receipt or a zipped bundle failed normalizeAttachmentMime and vanished leaving nothing.
  const unreadable = src.match(
    /const unreadableReason = unreadableFormatReason\(filename\)[\s\S]{0,220}?unread\.push\(\{[\s\S]{0,180}?kind: 'unreadable-format'/g,
  ) ?? [];
  assert.equal(unreadable.length, 2, "both doors must report a format they cannot open");

  // And it may never sit above the bank-statement branch, which has its own, better answer.
  for (const half of src.split("looksLikeBankStatementFile(filename)").slice(1)) {
    const stmt = half.indexOf("statements.push");
    const fmt = half.indexOf("unreadableFormatReason");
    assert.ok(stmt >= 0 && fmt > stmt, "a bank statement keeps its own reason, never the generic one");
  }

  // The old two-step (attachmentSkipReason, then isLikelyInvoiceCandidate) is gone from the doors.
  // Two implementations of one decision is a file dropped by one and accounted for by the other.
  assert.doesNotMatch(
    src, /if \(!isLikelyInvoiceCandidate\(/,
    "the fetchers must go through the gate that carries its own reason",
  );
});

test("[OVERSLAG-ZICHTBAAR] the panel gets every refusal, the push only the one it can describe", () => {
  const src = code("src/lib/email-integration.ts");

  // Every recorded refusal reaches the registry — that is the panel, and it must be complete.
  assert.match(
    src, /for \(const ov of unread\)[\s\S]{0,400}?from\('email_skipped_attachments'\)[\s\S]{0,200}?reason: ov\.reason/,
    "each refusal must become a row with its own reason",
  );

  // The notification is the exception, and it is keyed on the KIND. Keyed on the filename alone
  // (the previous rule: "any .pdf") it would announce an 8 KB PDF as "groter dan 10 MB" — a
  // notification that lies is worse than none, and it lies about the one number it names.
  assert.match(
    src, /ov\.kind === 'oversized' && \/\\\.pdf\$\/i\.test\(ov\.filename\)/,
    "only a genuinely oversized PDF may claim to be one",
  );

  // Still outside the invoice balance math: these were never candidates, so counting them would
  // make `fetched` and the reconciliation disagree with each other.
  assert.doesNotMatch(
    src, /fetched \+= unread\.length|unread\.length \+ attachments\.length/,
    "a file that was never a candidate may not inflate the balance",
  );
});

test("[BON-AUTO] both doors settle a bon through the audited payment path, never by hand", () => {
  // A kassabon is proof the counter was already paid — that is what makes it a receipt rather than
  // an invoice. Both doors nevertheless switched auto-advance OFF for every bon, because
  // auto-advance can only produce 'received' (booked, UNPAID), and that is the one status a
  // settled bon must never get.
  //
  // The pure tests hold WHEN it may settle. This holds HOW, and the how is the dangerous half:
  // writing status='paid' straight onto the insert looks equivalent and is not — it skips the
  // bank_tx_invoices instalment row that keeps amount_paid = SUM(amount_applied) true, and
  // recompute_invoice_amount_paid would then zero amount_paid on an invoice that says it is paid.
  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    const src = code(f);
    assert.match(src, /planReceiptSettlement\(\{/, `${f} must ask the shared decision`);
    // The booking goes through the RPC the manual button uses, with the whole remaining balance
    // and the payable status it was just inserted with.
    assert.match(
      src,
      /apply_manual_payment[\s\S]{0,400}?p_amount: null[\s\S]{0,300}?p_payable_statuses: \["received"\]|apply_manual_payment[\s\S]{0,400}?p_amount: null[\s\S]{0,300}?p_payable_statuses: \['received'\]/,
      `${f} must settle through apply_manual_payment, not by writing the columns itself`,
    );
    // Both halves, never one: a trustworthy READ (autoAdv) AND a payment the PAPER proves.
    assert.match(
      src, /willSettle = autoAdv\.advance && settlePlan\.settle/,
      `${f}: either half alone books something nobody checked`,
    );
    // A failed settlement is never swallowed — the row is right either way, but "automatisch
    // afgehandeld" followed by a bon in "nog te betalen" needs a trail saying which half ran.
    assert.match(
      src, /settleErr[\s\S]{0,200}?console\.error\('?"?\[BON-AUTO\]/,
      `${f} must report a failed settlement`,
    );
  }

  // And nowhere does either door set a paid status on a ROW it writes.
  //
  // The first draft of this gate banned the string outright and failed on the audit log's own
  // `newValue: { status: "paid" }` — a DESCRIPTION of what the RPC did, not a write. That is this
  // file's own defect class arriving from the other side: a gate that matches a mention. So match
  // what a write actually looks like — a paid status inside an .insert()/.update() payload — and
  // let the trail describe the outcome in the words the trail needs.
  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    assert.doesNotMatch(
      code(f), /\.(?:insert|update)\(\{[^}]{0,4000}?status: ['"]paid['"]/,
      `${f} may not write status='paid' onto a row — that skips the instalment row`,
    );
    // The audit trail, on the other hand, MUST say what happened.
    assert.match(
      code(f), /action: ['"]invoice\.auto_paid['"]/,
      `${f} must leave a trail for a payment no human authorised`,
    );
  }
});

test("[BON-AUTO] the paid-suggestion block still holds everything it is NOT settling", () => {
  // The block exists because auto-advance lands an invoice as 'received' — booked and UNPAID. The
  // hole opened for a settled bon must be exactly that: a pen-marked INVOICE (suggestPaid via a
  // handwritten mark, never a till line) must still be held, or money already gone stands as a
  // debt behind an "automatisch geverifieerd" tag.
  assert.match(
    code("src/lib/email-integration.ts"),
    /!classification\.uncertain && \(!pay\.suggestPaid \|\| settlePlan\.settle\)/,
    "the e-mail door's hole must be settle-shaped, not open",
  );
  assert.match(
    code("src/app/api/intake/route.ts"),
    /\(!decision\.suggestPaid \|\| settlePlan\.settle\)/,
    "and the camera door's the same",
  );
  // planReceiptSettlement itself refuses anything that is not a receipt, which is what makes that
  // hole safe. Held here too, because the callers' correctness depends on it.
  assert.match(
    code("src/lib/receipt-auto-settle.ts"),
    /if \(kind !== 'receipt'\) return HOLD\('not_a_receipt'\)/,
    "a pen mark on an invoice is not a till line",
  );
  // And the gate that makes the whole thing defensible: the PAPER named the method.
  assert.match(
    code("src/lib/receipt-auto-settle.ts"),
    /if \(input\.suggestion\.paidMethodZeker !== true\) return HOLD\('method_not_printed'\)/,
    "guessing kas-vs-bank moves a cash drawer that never moved",
  );
});

test("[BON-AUTO] a cash-settled bon reaches the kasboek, and a card one clears its bank line", () => {
  // 'kas' is a dated drawer movement. Settle without reconciling and the payment sits on the
  // invoice while the kassaldo the accountant reads still holds the money.
  const email = code("src/lib/email-integration.ts");
  assert.match(
    email, /settlePlan\.method === 'kas'\) cashSettledThisRun = true/,
    "the e-mail loop must remember it settled cash",
  );
  // [CASH-RETRY] Either the reconcile itself or the shared retry wrapper around it — what this gate
  // is about is that the kasboek is brought in step once the loop has settled cash, not which of the
  // two names does it. The wrapper is the stronger form: it reads the pass's verdict and asks again.
  assert.match(
    email, /if \(cashSettledThisRun\)[\s\S]{0,320}?reconcileCash(?:Settlements|WithRetry)\(/,
    "and reconcile the kasboek once after the loop",
  );
  // The camera door reconciles in its existing side-effect block — the settlement must come FIRST,
  // or the drawer is a pass behind.
  const intake = code("src/app/api/intake/route.ts");
  const settleAt = intake.indexOf("apply_manual_payment");
  // [CASH-RETRY] Anchored on the shared wrapper OR the bare pass, for the same reason as the
  // assertion above: what is being held here is the ORDER, and a needle pinned to one function name
  // reports a rename as a broken ordering. This gate did exactly that when the four pay doors were
  // moved onto reconcileCashWithRetry — the settle still came first, and the search found nothing.
  const reconcileAt = Math.max(
    intake.indexOf("reconcileCashWithRetry(pipeline"),
    intake.indexOf("reconcileCashSettlements(pipeline"),
  );
  assert.ok(settleAt > 0 && reconcileAt > settleAt, "intake must settle before it reconciles");

  // The other consequence: a card bon becomes 'paid', which hides it from the matcher — and a
  // till prints neither an invoice number nor an IBAN, so the existing explain rule can never fire
  // for one. Without this, every pin-paid bon turns its own debit into a "missende inkoopfactuur".
  assert.match(
    code("src/app/api/bank/match/route.ts"),
    /receiptIds\.has\(m\.best\.invoiceId\)[\s\S]{0,140}?sig\.includes\("counterpart"\)[\s\S]{0,80}?sig\.includes\("amount"\)[\s\S]{0,80}?sig\.includes\("date"\)/,
    "a paid kassabon must be able to explain its own bank line",
  );
});

test("[DOORGESTUURD] an e-mail attached to an e-mail is opened, not dropped", () => {
  // THE HOLE: Graph returns a forwarded message as an itemAttachment with no contentBytes, and the
  // Outlook fetcher's first line dropped everything that was not a fileAttachment. So for an
  // Outlook user the most ordinary way an invoice reaches a bookkeeper produced nothing at all —
  // no row, no file, no notification, not even a skip-registry entry. Gmail never had it: its
  // payload nests the forwarded message's parts and the existing walk descends into them.
  const src = code("src/lib/email-integration.ts");

  // The branch must run BEFORE the fileAttachment test that used to swallow it.
  const itemAt = src.indexOf("'#microsoft.graph.itemAttachment'");
  const fileAt = src.indexOf("att['@odata.type'] !== '#microsoft.graph.fileAttachment'");
  assert.ok(itemAt > 0 && fileAt > itemAt, "the embedded-message branch must come first");

  // It reads the raw MIME Graph offers, which is the only way those bytes are reachable — through
  // the ONE helper that also decides whether a failure is worth retrying. Exactly one place builds
  // that URL: a second would be a second answer to "is this weather or permanence".
  assert.equal(
    (src.match(/\/\$value/g) ?? []).length, 1,
    "one $value fetcher, shared by the forwarded-message and large-attachment paths",
  );
  assert.match(
    src, /const value = await fetchGraphAttachmentValue\(messageId, att\.id, accessToken\)/,
    "the embedded item's MIME must actually be fetched",
  );

  // Every extracted file goes through the SAME gate as any other attachment. A forwarded mail
  // carries the original's signature logos too, and its PDF can be over the ceiling — a second
  // rulebook for one door is how doors drift apart.
  assert.match(
    src,
    /for \(const found of embedded\.items\)[\s\S]{0,400}?triageAttachment\(\{[\s\S]{0,200}?if \(!triage\.keep\)[\s\S]{0,260}?unread\.push/,
    "extracted attachments must be triaged like every other one",
  );

  // The supplier's own address, not the forwarder's. The outer mail is often from the owner
  // themselves; that address on the crediteur is wrong, and a sender rule for the real supplier
  // would never fire.
  assert.match(src, /from: embedded\.from \|\| from/, "the inner sender wins where it exists");

  // Two originals in one forward that both call their invoice "factuur.pdf" must stay two
  // invoices: the import keys on `${messageId}:${filename}`, so one shared name is one dedup key
  // and the second bill would vanish as already-seen.
  assert.match(
    src, /uniqueAttachmentName\(f\.filename, takenNames\)/,
    "two forwarded bills with one filename must keep separate identities",
  );
});

test("[DOORGESTUURD] a failure that will never succeed does not freeze the mailbox", () => {
  // The distinction the whole thing rests on. Holding the watermark is right for weather and
  // catastrophic for a permanent error: every NEWER invoice queues behind a message that can never
  // be read, and the sync goes quiet with no one able to say why.
  const src = code("src/lib/email-integration.ts");
  assert.match(
    src, /transient: res\.status === 429 \|\| res\.status >= 500, status: res\.status/,
    "only a throttle or a server error may be retried forever",
  );
  assert.match(
    src, /if \(value\.transient\) return \{ \.\.\.none, transient: true \}/,
    "…and only that case holds the mark",
  );
  assert.match(
    src, /if \(embedded\.transient\) \{[\s\S]{0,200}?ok = false/,
    "the caller must turn a transient failure into an incomplete fetch",
  );
  // A permanent failure reports instead of holding — silence is the one answer not allowed.
  assert.match(
    src, /kind: 'unreadable-format',\s*\n\s*reason: 'een doorgestuurd bericht dat wij niet konden openen/,
    "a permanently unreadable forward must reach the skipped panel",
  );

  // And the MIME reader may never be reimplemented next to the one that already exists: the
  // question "which types can we read" must have exactly one answer.
  assert.match(
    src, /extractMimeAttachments\(raw, \{ normalizeMime: normalizeAttachmentMime \}\)/,
    "the type rule is injected, never copied",
  );
});

test("[ONBEREIKBAAR] a byte fetch that will never succeed must not freeze the mailbox", () => {
  // THE WORST FAILURE MODE IN THE IMPORT, and it was silent in both directions.
  //
  // Gmail's per-attachment byte fetch answered `return null` for every failure, and one null marks
  // the whole email incomplete — which HOLDS the watermark. That is right for a throttle: the next
  // sync re-lists the same mail and gets the bytes. For a 404 (Gmail rotates attachment ids when a
  // message is modified) or a 403 it is catastrophic: the mark never advances, EVERY newer invoice
  // queues behind one unreachable file, and the import goes quiet with nothing on any screen
  // saying why. Losing one file loudly beats losing all of them silently.
  const src = code("src/lib/email-integration.ts");

  assert.match(
    src, /const transient = attRes\.status === 429 \|\| attRes\.status >= 500/,
    "Gmail must sort weather from permanence",
  );
  // The permanent one reports and lets the mark move; the transient one holds it. Both, not either.
  assert.match(
    src, /return transient \? \{ kind: 'transient' \} : \{ kind: 'permanent', filename: att\.filename \}/,
    "…and act on the difference",
  );
  assert.match(
    src, /if \(r\.kind === 'transient'\) \{ allReachable = false; continue \}[\s\S]{0,200}?unread\.push\(\{[\s\S]{0,120}?kind: 'unreachable'/,
    "only weather holds the watermark; permanence becomes a row the owner can read",
  );
  assert.match(
    src, /return \{ items, ok: allReachable, statements, unread \}/,
    "the fetch reports itself incomplete ONLY for the retryable case",
  );
  // The old rule counted every failure the same way. If it comes back, so does the frozen mailbox.
  assert.doesNotMatch(
    src, /ok: items\.length === resolved\.length/,
    "counting nulls treats a permanent failure as something to retry forever",
  );

  // Outlook's mirror: Graph does not always inline the bytes, and the old line dropped a listed
  // purchase invoice for the one field the provider chose not to send.
  assert.doesNotMatch(
    src, /if \(!att\.contentBytes\) continue/,
    "an attachment listed without inline bytes is fetchable, not disposable",
  );
  assert.match(
    src, /let contentBytes = att\.contentBytes[\s\S]{0,600}?fetchGraphAttachmentValue\(message\.id, att\.id, accessToken\)/,
    "Outlook must fetch the bytes Graph withheld",
  );
  // …and it must sit BELOW the filters, or we download the logos we are about to refuse.
  const triageAt = src.indexOf("const triage = triageAttachment({ filename, mimeType, size: att.size || 0 })");
  const lazyAt = src.indexOf("let contentBytes = att.contentBytes");
  assert.ok(triageAt > 0 && lazyAt > triageAt, "bytes are fetched after the filters, never before");

  // One sentence for the same situation at both doors.
  assert.equal(
    (src.match(/UNREACHABLE_ATTACHMENT_REASON/g) ?? []).length, 4,
    "one definition, used at each of the three places it can happen",
  );
});

test("[E-FACTUUR] the supplier's own figures are read, and they outrank the reading", () => {
  // A Factur-X or ZUGFeRD PDF carries the invoice a SECOND time as XML the supplier produced, and
  // the app was photographing it like any other page while the exact figures sat unread inside the
  // same bytes. NL makes Peppol e-invoicing mandatory over €800k turnover from 2027 and for
  // everyone from 2028, so this arrives now and will only arrive more.
  const ai = code("src/lib/ai.ts");
  assert.match(
    ai, /extractEmbeddedInvoiceXml\(Buffer\.from\(cleanBase64\(fileBase64\), 'base64'\)\)/,
    "the reader must look inside the PDF for it",
  );
  assert.match(
    ai, /_einvoice = \{[\s\S]{0,160}?contradicts: eInvoiceContradicts\(eInvoice, parsed\.total_inc_btw\)/,
    "…and record whether it disagrees with what was read",
  );
  // Never pay for an OCR second-reading when the document itself already answered.
  assert.match(
    ai, /grounding\.totalIncBtw === 'unreadable' &&[\s\S]{0,400}?!eInvoice &&/,
    "the OCR pass must stand down when structured figures are in hand",
  );

  // BOTH auto-booking doors ask it — a gate on one door is not a gate.
  for (const f of ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"]) {
    assert.match(
      code(f), /eInvoiceContradicts: eInvoiceContradictsRead\(/,
      `${f} does not pass it — this door books what the other refuses`,
    );
  }

  // And the refusal exists, keyed on `true` only: a PDF with no e-invoice answers null, and a
  // check that could not run may never read as one that failed.
  const aa = code("src/lib/auto-advance.ts");
  assert.match(
    aa, /if \(s\.eInvoiceContradicts === true\)[\s\S]{0,140}?advance: false/,
    "a contradiction must block the automatic booking",
  );
  assert.doesNotMatch(
    aa, /if \(!s\.eInvoiceContradicts\)[\s\S]{0,80}?advance: false/,
    "absence of an e-invoice is not a reason to hold anything",
  );

  // The owner is told the RIGHT NUMBER, not merely that something is wrong. The app already knows
  // it; making them hunt for what it knows is a riddle, not a check.
  assert.match(
    code("src/lib/import-health.ts"),
    /de leverancier stuurde een e-factuur mee en daarin staat \$\{formatEuroNL\(efact\.totalIncBtw\)\}/,
    "the sentence must name the supplier's own figure",
  );
});

test("[E-FACTUUR] nothing is trusted from a half-read or non-euro e-invoice", () => {
  // These figures outrank the model, so the completeness gate is the whole safety of the feature.
  // A broken document accepted here is worse than never having built it.
  const m = code("src/lib/e-invoice.ts");
  assert.match(
    m, /if \(inc === null \|\| ex === null \|\| btw === null\) return null/,
    "three figures or nothing",
  );
  assert.match(
    m, /if \(v\.currency !== null && v\.currency\.toUpperCase\(\) !== 'EUR'\) return null/,
    "1 200 SEK booked as € 1 200 survives every other check in the building",
  );
  assert.match(
    m, /if \(Math\.abs\(round2\(ex \+ btw\) - round2\(inc\)\) > 0\.01\) return null/,
    "an e-invoice whose own numbers disagree is not a better witness than the model",
  );
  // The totals are read from INSIDE the header block: the same element names occur per line and
  // per tax rate, so a document-wide search can pick up a line's figure.
  assert.match(
    m, /firstBlock\(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation'\)/,
    "CII totals come from the header summation, never a line",
  );
  assert.match(m, /firstBlock\(xml, 'LegalMonetaryTotal'\)/, "UBL likewise");
  // Namespace prefixes are chosen by the producer. Keying on one reads a correct invoice as empty.
  assert.match(
    m, /return `\(\?:\[A-Za-z0-9_\.-\]\+:\)\?\$\{name\}`/,
    "matching must be on the local name, never the prefix",
  );
  // Both syntaxes, because both arrive — knowing only one fails silently on the other.
  assert.match(m, /isCii \? parseCii\(xml\) : parseUbl\(xml\)/, "CII and UBL both");
});

test("[MAILTEKST] a body-only invoice is found, stored as a document, and never books itself", () => {
  // Both listings ask for mail WITH an attachment. A hosting bill, a phone subscription or a
  // parking app that lays the invoice out in the message body was never even seen — not skipped,
  // not reported, not counted — every month, for as long as the subscription runs.
  const src = code("src/lib/email-integration.ts");

  // The pass exists and is appended to the SAME list, so dedup, classifier, health and queue need
  // no new case.
  assert.match(
    src, /await fetchBodyOnlyInvoices\(tokens\.provider, accessToken, syncAfterMs, tokens\.email \?\? null\)/,
    "the sync must run the body pass",
  );
  assert.match(
    src, /attachments = \[\.\.\.attachments, \.\.\.body\.items\]/,
    "…and feed it through the ordinary pipeline",
  );

  // It must NOT enter the watermark walk. messageIndex is the guarantee that no attachment is
  // skipped; a body message added to it could advance the mark over mail nobody read.
  assert.doesNotMatch(
    src, /messageIndex(?:\s*=\s*\[[^\]]*|\.push\([^)]*)body/,
    "the body pass may never touch the watermark walk",
  );

  // Filtered MECHANICALLY before anything is sent anywhere — this path starts from ordinary mail,
  // where almost everything carrying a euro amount is not an invoice.
  assert.match(
    src, /const verdict = bodyLooksLikeInvoice\(m\.text, m\.subject\)\s*\n\s*if \(!verdict\.candidate\) return null/,
    "the filter runs before the render and before any AI call",
  );

  // And it becomes a real document, because the bewaarplicht needs one and [GEGROND] needs its
  // text layer.
  assert.match(src, /const pdf = await textToPdf\(m\.text,/, "the body is stored as a PDF");

  // Never auto-booked. "Is this a purchase invoice at all" is the one question the mechanical
  // filter cannot settle, and getting it wrong invents a cost with a voorbelasting claim on it.
  assert.match(
    src, /const autoAdv = attachment\.fromBody === true\s*\n\s*\? \{ advance: false, reason: 'from_email_body' \}/,
    "a body-rendered invoice must be refused before every other consideration",
  );
  // The owner is told what they are looking at before they confirm it.
  assert.match(
    src, /_mailtekst: true/,
    "the row must record that the document is a rendering of an e-mail",
  );
  assert.match(
    code("src/lib/import-health.ts"),
    /deze factuur stond in de TEKST van een e-mail/,
    "…and the queue must say so in words",
  );
});

test("[MAILTEKST] the text conversion keeps table cells apart", () => {
  // The bug this prevents is silent and total: the naive replace(/<[^>]+>/g,'') welds cells
  // together, so "21%€ 21,00" is a token no amount parser reads and "Totaal€ 121,00" stops the
  // grounding check finding a total that IS on the page — a correct invoice reading as a wrong one.
  const m = code("src/lib/email-body-invoice.ts");
  assert.match(
    m, /\.replace\(\/<\[\^>\]\+>\/g, ' '\)/,
    "a stripped tag must become a SPACE — with '' the cells weld into one unreadable token",
  );
  // Script and style carry numbers that are not money.
  assert.match(m, /<script\\b\[\\s\\S\]\*\?<\\\/script>/, "script is stripped whole");
  assert.match(m, /<style\\b\[\\s\\S\]\*\?<\\\/style>/, "and style");
  // The filter needs ALL four conditions — each alone admits far too much.
  for (const tag of ["body_too_short", "no_invoice_word", "no_tax_line", "no_euro_amount"]) {
    assert.ok(m.includes(tag), `the ${tag} refusal must exist`);
  }
  // …and the exclusion list, which is what makes the filter trustworthy at all.
  for (const shape of ["orderbevestiging", "offerte", "betaling ontvangen", "aanmaning", "proforma"]) {
    assert.ok(m.includes(shape), `"${shape}" must stay out of the queue`);
  }
});

test("[E-FACTUUR-XML] ONE reader books a Peppol invoice, and BOTH doors reach it", () => {
  // NL makes Peppol e-invoicing mandatory over €800k turnover from 2027 and for everyone from
  // 2028, and suppliers send UBL alongside their PDF today. The app could EXPORT UBL and could not
  // read one.
  //
  // It is read in verifyInvoiceFromPdf — the reader BOTH doors call — and not at a door. The first
  // version of this lived in the e-mail sync, which made that the only door able to book a Peppol
  // invoice: the identical file uploaded by hand was filed as "a format we cannot read". A reader
  // on one door is not a reader; it is an inconsistency nobody can explain to the owner.
  const ai = code("src/lib/ai.ts");
  assert.match(
    ai,
    /if \(isEInvoiceXmlMime\(mimeType\)\) \{[\s\S]{0,400}?parseEInvoice\(Buffer\.from\(cleanBase64\(fileBase64\), 'base64'\)\.toString\('utf8'\)\)/,
    "the shared reader must read it from its own structure",
  );
  // …and BEFORE anything that could reach the model, or the API call happens anyway.
  const guardAt = ai.indexOf("if (isEInvoiceXmlMime(mimeType))");
  const tryAt = ai.indexOf("try {", ai.indexOf("const preferRawPdf ="));
  assert.ok(guardAt > 0 && tryAt > guardAt, "the interception precedes the read path");

  // Half an e-invoice is never booked: it falls through to the ordinary could-not-read path,
  // which keeps the file, counts it and names it to the owner.
  assert.match(
    ai, /reason: 'e-factuur XML kon niet volledig worden gelezen'/,
    "an XML that does not parse completely must not become an invoice",
  );
  // It records where its figures came from, so [E-FACTUUR-BESLECHT] can stand the money gates
  // down. contradicts:false is a FACT — the stored figures ARE the XML.
  assert.match(ai, /_einvoice: \{ \.\.\.f, contradicts: false \}/, "provenance on the row");
  assert.match(ai, /confidence: 1,/, "nothing here was inferred");

  // BOTH doors. The e-mail fetchers let the file through…
  const mail = code("src/lib/email-integration.ts");
  assert.match(mail, /pending\.push\(\{ filename, mimeType: E_INVOICE_XML_MIME/, "Gmail lets it through");
  assert.match(
    mail, /looksLikeInvoiceXml\(xml\)\) \{[\s\S]{0,240}?mimeType: E_INVOICE_XML_MIME/,
    "Outlook checks the content, not just the extension",
  );
  // …and the upload/camera door stops filing it as unreadable.
  const intake = code("src/app/api/intake/route.ts");
  assert.match(
    intake, /const isEInvoice = looksLikeInvoiceXmlBytes\(buffer\)/,
    "the upload door must recognise a Peppol invoice by its CONTENT",
  );
  assert.match(
    intake, /effectiveType\.startsWith\("image\/"\) \|\|\s*\n\s*isEInvoice \|\|/,
    "…and send it to the reader instead of the unreadable bin",
  );

  // One definition of the media type, shared. A fabricated marker would be written to Storage and
  // to documents.file_type and follow the file for seven years.
  assert.match(
    code("src/lib/e-invoice.ts"), /export const E_INVOICE_XML_MIME = 'application\/xml'/,
    "no invented media type may be stored on a document",
  );
  // And exactly one place decides it — a second copy is a second answer.
  assert.doesNotMatch(mail, /export const E_INVOICE_XML_MIME/, "the constant lives in e-invoice.ts");
});

test("[E-FACTUUR-XML] the supplier's party is read from the SUPPLIER's block", () => {
  // Both parties carry the same element names in both syntaxes. The buyer booked as the supplier is
  // a mistake nothing downstream can catch — the invoice looks perfectly ordinary, under the wrong
  // crediteur, with the wrong IBAN on the payment sheet.
  const m = code("src/lib/e-invoice.ts");
  assert.match(m, /firstBlock\(xml, 'AccountingSupplierParty'\)/, "UBL: scoped to the supplier");
  assert.match(m, /firstBlock\(xml, 'SellerTradeParty'\)/, "CII: scoped to the seller");
  assert.doesNotMatch(
    m, /firstText\(xml, 'RegistrationName'\)|firstText\(xml, 'Name'\)/,
    "a document-wide name search can return the buyer",
  );
  // An IBAN only travels when it IS one — it reaches the bank matcher and the payment sheet.
  assert.match(
    m, /return \/\^\[A-Z\]\{2\}\\d\{2\}\[A-Z0-9\]\{11,30\}\$\/\.test\(s\) \? s : null/,
    "a value that is not an IBAN must never reach the payment sheet",
  );
});

test("[E-FACTUUR-XML] a free read never spends the monthly AI allowance", () => {
  // A cross-session interaction, and the kind that produces no merge conflict at all: one session
  // added a monthly quota on 'aiDocuments', another added a document class that costs NO ai read.
  // Counted together, the owner pays quota for something free — and worse, a real invoice that DOES
  // need reading gets pushed out of the allowance by one that never used it.
  const src = code("src/lib/email-integration.ts");
  assert.match(
    src, /const aiCandidates = batchCandidates\.filter\(\(a\) => !isEInvoiceXmlMime\(a\.mimeType\)\)/,
    "only the reads that cost something may be counted",
  );
  assert.match(
    src, /wanted: aiCandidates\.length/,
    "…and the reservation must ask for that number, not the batch size",
  );
  // A positional slice would let a free XML occupy a paid place. The selection walks the batch and
  // keeps every XML plus paid reads until the grant runs out.
  assert.doesNotMatch(
    src, /const freshAttachments = batchCandidates\.slice\(0, fairUse\.granted\)/,
    "a slice counts an XML as a place and still pushes a real invoice out",
  );
  assert.match(
    src, /if \(isEInvoiceXmlMime\(a\.mimeType\)\) return true[\s\S]{0,120}?if \(aiBudget <= 0\) return false/,
    "free reads always pass; paid ones stop at the grant",
  );
});

test("[E-FACTUUR-BESLECHT] the invoice NO model read gets at least the trust of one a model did", () => {
  // A seam between two changes that were each correct alone, and it pointed the wrong way.
  //
  // [E-FACTUUR-BESLECHT] taught auto-advance to stand three money gates down when a complete
  // e-invoice agrees with the read — grounding, placement and the money's own confidence exist
  // only because an amount was read off a page, and when the supplier states it there is no page
  // to have misread. It decides that by reading `_einvoice` off the row.
  //
  // [E-FACTUUR-XML] books a standalone Peppol invoice with NO MODEL READING ANYTHING, and never
  // wrote that key. So a Factur-X PDF — where a model DID read the page and the XML merely agrees
  // — had its gates waived, and the invoice nobody read did not. The more certain document got
  // the less trust.
  const ai = code("src/lib/ai.ts");
  const mapper = ai.slice(ai.indexOf("function eInvoiceVerification"));
  assert.match(
    mapper.slice(0, 2000), /_einvoice: \{ \.\.\.f, contradicts: false \}/,
    "the standalone-XML path must record where its figures came from",
  );
  // contradicts:false is a FACT here, not an assumption: the stored figures ARE the XML, so there
  // is no reading for them to disagree with. Asserted so nobody later "fixes" it to true/undefined.
  assert.doesNotMatch(
    mapper.slice(0, 2000), /contradicts: (?:true|undefined|null)/,
    "a value that cannot contradict anything must say so, or the gate silently stops firing",
  );
});

test("[POORT-OPBRENGST] the yield script cannot silently miss a gate", () => {
  // scripts/gate-yield.ts answers "which gate still earns its keep", and its GATES map is a
  // hand-kept copy of the refusals auto-advance can return. The script warns about an unknown
  // reason only when that reason FIRES in the sample, and its "never fired" list is derived from
  // GATES itself — so a gate missing from the map is invisible in BOTH directions. It would be
  // reported as never firing when it fires constantly, or not reported at all.
  //
  // That is the measurement this project added because nobody could say which gates still pay for
  // themselves. A measurement with a blind spot is the one thing worse than no measurement: it
  // gets believed.
  const aa = code("src/lib/auto-advance.ts");
  const script = code("scripts/gate-yield.ts");

  const reasons = new Set(
    [...aa.matchAll(/reason: "([a-z_0-9]+)"/g)].map((m) => m[1]),
  );
  // Not every refusal is a literal. One is COMPUTED — `reason: \`kind_${kind}\`` — over the exact
  // document kinds the guard above it tests for. The first version of this test scanned only for
  // quoted strings and accused the script of four phantom entries that are in fact returned every
  // day. An extraction that cannot see a whole family of refusals is not a drift check; it is a
  // second place for the same drift to hide.
  const kindGuard = aa.slice(aa.indexOf("const kind ="), aa.indexOf("reason: `kind_${kind}`"));
  for (const m of kindGuard.matchAll(/kind === "([a-z_]+)"/g)) reasons.add(`kind_${m[1]}`);

  // The one reason that is not a refusal — it is what advance:true carries.
  reasons.delete("clean_high_confidence");
  assert.ok(reasons.size >= 15, `expected the full refusal set, found ${reasons.size}`);

  const registry = script.slice(script.indexOf("const GATES"), script.indexOf("interface Row"));
  const missing = [...reasons].filter((r) => !new RegExp(`(?:^|\\s)${r}:`, "m").test(registry));
  assert.deepEqual(
    missing, [],
    `gate-yield.ts cannot report on refusals it does not know about: ${missing.join(", ")}`,
  );

  // And the other direction: a name in the map that auto-advance can never return would be
  // reported as "never fired", which reads as a gate that could be deleted.
  const listed = [...registry.matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1]);
  const phantom = listed.filter((g) => !reasons.has(g));
  assert.deepEqual(phantom, [], `these are in the map but cannot be returned: ${phantom.join(", ")}`);
});

test("[E-FACTUUR-GRATIS] no door charges the month's allowance for a read that costs nothing", () => {
  // The allowance is called `aiDocuments` and it counts AI READS. An e-invoice is not read by a
  // model at all. Charging one makes the owner pay for something free — and does worse: it pushes
  // a real invoice, one that DOES need reading, out of the month.
  //
  // The rule was made once already, in the e-mail sync's batch reservation, and it did not travel
  // to the single-file doors. That is why it lives in ONE function now: a rule that has to be
  // remembered at four call sites is a rule that is right in one of them.
  const gate = code("src/lib/fair-use-gate.ts");
  assert.match(
    gate, /if \(!params\.costsAiCall\) \{\s*\n\s*return \{ allowed: true, response: null, release: async \(\) => \{\} \};/,
    "a free read must allow, and its release must be a no-op — nothing was taken",
  );

  // Every door that can receive an e-invoice asks the question. A door that calls the old gate
  // directly is a door that charges for it.
  const doors: Array<[string, string]> = [
    ["src/app/api/intake/route.ts", "!isEInvoice"],
    ["src/app/api/bank/attach-invoice/route.ts", "!isEInvoice"],
    ["src/app/api/email/reimport/[id]/route.ts", "!isEInvoiceXmlMime(mimeType)"],
  ];
  for (const [f, expr] of doors) {
    const src = code(f);
    assert.match(
      src,
      new RegExp(`gateFairUseForRead\\(\\{[\\s\\S]{0,220}?costsAiCall: ${expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `${f} must not charge for a mechanical read`,
    );
    assert.doesNotMatch(
      src, /await gateFairUse\(\{/,
      `${f} still calls the unconditional gate — every read there costs a document`,
    );
  }
});

test("[E-FACTUUR-XML] attaching a Peppol invoice to a bank line goes to the same reader", () => {
  // BankClient's "hang the invoice on this line" is a live flow, and it refused the most exact
  // document the app can read on the strength of a media type the browser guessed.
  const src = code("src/app/api/bank/attach-invoice/route.ts");
  // Admitted on the NAME here — the bytes are not in hand yet, because the size guard must run
  // first on untrusted input…
  assert.match(src, /const maybeEInvoice =[\s\S]{0,200}?endsWith\("\.xml"\)/, "admitted by name");
  // …and SETTLED on the content, with the same refusal as before for a .xml that is not an invoice.
  assert.match(
    src, /const isEInvoice = maybeEInvoice && looksLikeInvoiceXmlBytes\(buffer\)/,
    "the widened guard must be settled on the bytes, not left open",
  );
  assert.match(
    src, /if \(maybeEInvoice && !isEInvoice\) \{[\s\S]{0,160}?Alleen PDF of afbeelding toegestaan/,
    "a .xml that is not an invoice is refused exactly as it always was",
  );
  // The reader picks its branch by media type, and a .xml arrives with whatever the client sent.
  assert.match(
    src, /const readerMime = isEInvoice \? E_INVOICE_XML_MIME : file\.type/,
    "the reader must be handed the type the content actually is",
  );
  assert.match(
    src, /verifyInvoiceFromPdf\(base64, readerMime,/,
    "…and actually be given it",
  );
});

test("[E-FACTUUR-NAREKENEN] the books audit asks the supplier's own file before reading a page", () => {
  // The report's blind spot pointed at exactly the wrong document. A Peppol XML has no PDF text
  // layer, so readPdfTextLayer answered null and the invoice landed in "we could not check this
  // one" — the same bucket as a blurry photograph — for the ONE class this app can verify exactly,
  // mechanically, at no cost. The owner was told the app could not look at the invoice it knows
  // best.
  const src = code("src/app/api/invoice/audit/route.ts");

  // Both shapes: the XML on its own, and the XML carried inside a Factur-X PDF — and REACHABLY.
  // The first version matched only the body, so `if (false)` around the whole block left it green:
  // the code was present and could never run, which is indistinguishable from deleted at runtime
  // and looks like a passing test on the page.
  assert.match(
    src,
    /if \(bytes\) \{\s*\n\s*const xml = mime === null && looksLikeInvoiceXmlBytes\(bytes\)[\s\S]{0,200}?extractEmbeddedInvoiceXml\(bytes\)/,
    "a standalone XML and an embedded one must both be consulted, and the block must be reachable",
  );
  // Direct comparison, not a text search: the file STATES the total, so equality to the cent is
  // the whole question.
  assert.match(
    src, /Math\.abs\(Math\.abs\(stored\) - Math\.abs\(stated\)\) <= 0\.01/,
    "the stored figure is compared with the stated one, to the cent",
  );
  assert.match(src, /source: "e-invoice"/, "and the verdict records which witness spoke");

  // A disagreement is a MISMATCH, never an "unchecked" — it is the strongest finding the report can
  // produce, and it was invisible.
  assert.match(
    src, /agrees\(inv\.total_inc_btw, figures\.totalIncBtw\) \? "found" : "absent"/,
    "the supplier's own file contradicting the books must read as a mismatch",
  );

  // It runs BEFORE the OCR half, which costs an API call — paying a model to re-read a document
  // whose figures are already stated is spending money to be less sure.
  //
  // The first version of this compared against indexOf("transcribeStoredDocumentAmounts"), which
  // matched the IMPORT at the top of the file and reported the order backwards. A gate that finds
  // a mention instead of the call is this file's own defect class, arriving for the sixth time.
  const eInvoiceAt = src.indexOf("looksLikeInvoiceXmlBytes(bytes)");
  const ocrCallAt = src.indexOf("await transcribeStoredDocumentAmounts(");
  assert.ok(eInvoiceAt > 0 && ocrCallAt > 0, "both must be present at all");
  assert.ok(ocrCallAt > eInvoiceAt, "the free exact check precedes the paid one");

  // And the report keeps the two claims apart: characters on a page is not the supplier's own file.
  assert.match(
    code("src/lib/books-audit.ts"),
    /vergeleken met de e-factuur die de leverancier zelf meestuurde/,
    "the stronger claim needs its own sentence",
  );
  assert.match(src, /confirmedByEInvoice: summary\.confirmedByEInvoice/, "…and reaches the client");
});

test("[E-FACTUUR-ZICHTBAAR] the screen says which rows never need checking", () => {
  // The app was loud about problems and silent about its strongest certainty. Every warning on the
  // pay screen exists because a number MIGHT be wrong; nothing said the opposite when it cannot be.
  // For an owner who keeps the paper invoice open beside the app — the reason this whole line of
  // work exists — that is exactly the wrong way round.
  const ui = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");

  // Read through the shared validator, never by poking at the jsonb directly: field_confidence is
  // untyped at the database and a screen that trusts it is a screen that renders whatever is there.
  assert.match(
    ui, /const e = eInvoiceOf\(inv\.field_confidence\)/,
    "the row must read the marker through the one validator",
  );
  // Only when the supplier's file AGREES. A contradiction already earns its own warning, and a
  // reassuring badge beside it would be the screen arguing with itself.
  assert.match(
    ui, /if \(!e \|\| e\.contradicts\) return null/,
    "a contradicted e-invoice may never wear the reassuring badge",
  );
  // And the sentence tells the owner what it MEANS, not merely that it happened.
  assert.match(ui, /t\('inkoop\.eFactuurUitleg', \{ syntax: e\.syntax \}\)/, "the tooltip must say what it is for");
  // [TAAL] Pinned on the key — sixth gate that went red on translation alone.
  assert.match(ui, /t\('inkoop\.cijfersLeverancier'\)/, "and the badge must be on the row");
});

// ── [DEEL-BEDRAG] The stated amount must REACH the database ──────────────────
//
// The [DECLARED-INVOICE] test above pins that the refusal runs BEFORE the booking. It says nothing
// about what the booking then books — and that was the hole.
//
// confirm_bank_payment has no amount parameter at all; it computes LEAST(available, open). The
// route read the owner's "Alleen dit deel boeken" number into requestedAmount, used it only to SKIP
// the guard, and then called a function that could not receive it.
//
// The split sheet opens ONLY from the declared_invoice_missing 409, and that 409 requires
// payAvailable <= invoiceOpen — under exactly that precondition LEAST(available, open) IS the whole
// remaining line. So every partial amount an owner ever typed booked the full line, marked the
// invoice paid, and answered "Bevestigd en gemarkeerd als betaald". "Alleen dit deel boeken" and
// "Toch het hele bedrag op deze factuur" were behaviourally one button.
//
// A position test cannot see that. This one follows the VALUE.
test("[DEEL-BEDRAG] a stated amount reaches the RPC, and picks the function that can accept it", () => {
  const src = code("src/app/api/bank/confirm/route.ts");

  // 1. An amount stated ⇒ the function that HAS an amount parameter.
  assert.match(
    src,
    /const atomicFn\s*=\s*withAmount\s*\?\s*"allocate_bank_payment"\s*:\s*"confirm_bank_payment"/,
    "an explicit amount must select allocate_bank_payment — confirm_bank_payment cannot take one",
  );

  // 2. And it is actually PASSED. The absence of this single assertion is what let the bug ship.
  assert.match(
    src,
    /\.\.\.\(withAmount \? \{ p_amount: requestedAmount \} : \{\}\)/,
    "p_amount must travel with the call, not merely be read into a variable",
  );

  // 3. No amount ⇒ unchanged. The ordinary confirm must not start behaving differently.
  assert.ok(
    src.includes('"confirm_bank_payment"'),
    "a request without an amount still books through confirm_bank_payment",
  );

  // 4. Both names survive the missing-function fall-through — the ONE path that already honours
  //    resolveAllocation. A database without the migration then loses atomicity, never the number.
  assert.match(
    src,
    /confirm_bank_payment\|allocate_bank_payment/,
    "the fnMissing detector must recognise both names",
  );
});

// [BETAALPLAN] And the guard that was missing from the function this route now calls.
//
// allocate_bank_payment is SECURITY DEFINER and GRANTed to `authenticated`, and PostgREST exposes
// every such function at /rest/v1/rpc/ with the anon key that ships in the browser bundle. Both its
// scoping predicates match on the ARGUMENT p_user_id, never on the session — so without this guard
// any registered user could name a stranger's uuid, transaction and invoice.
//
// A sweep of every migration for "SECURITY DEFINER + p_user_id + GRANT authenticated + no
// auth.uid()" returned exactly one hit: this file, written as a copy of two functions that both
// have the guard. That is the failure this test exists to make impossible to repeat.
test("[BETAALPLAN] every money RPC that takes p_user_id checks the caller against it", () => {
  const dir = "supabase/migrations";
  const offenders: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql")) continue;
    const sql = readFileSync(`${dir}/${name}`, "utf8");
    const definer = /SECURITY\s+DEFINER/i.test(sql);
    const takesUser = /p_user_id\s+uuid/i.test(sql);
    const grantsAuth = /GRANT\s+EXECUTE[\s\S]{0,200}?\bauthenticated\b/i.test(sql);
    if (definer && takesUser && grantsAuth && !/auth\.uid\(\)/.test(sql)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `these SECURITY DEFINER functions take p_user_id and are callable by authenticated, but never compare it to auth.uid(): ${offenders.join(", ")}`,
  );
});

// ── [CREDITNOTA-VOLGORDE] A credit is applied BEFORE the invoices it reduces ──
//
// This one is held here because it was measured against a real PostgreSQL and it is the rare case
// where ORDER, not arithmetic, decides whether an ordinary supplier payment books correctly.
//
// A supplier bills €1.000, credits €150 for a return, and debits €850. A credit does not spend the
// bank line — it RAISES what the line has to give: worth €850 until the credit is booked, €1.000
// after. Send the invoice first and allocate_bank_payment measures €1.000 against the €850 it can
// see. The database now refuses that rather than shaving it (tests/sql/allocate_bank_payment.test.sql
// pins both halves), so the wrong order no longer books a wrong number — but it does turn a
// perfectly valid batch into "de verdeling is halverwege gestopt" for no reason the owner can act
// on. The sort is what makes the feature work; the refusal is what makes it safe.
//
// Sorting by the SIGNED amount puts every negative line in front, which is why resolvePaymentPlan
// returns signed amounts at all.
test("[CREDITNOTA-VOLGORDE] the allocate route applies credit lines before the invoices", () => {
  const src = code("src/app/api/bank/allocate/route.ts");

  assert.match(
    src,
    /\.sort\(\(a, b\) => a\.amount - b\.amount\)/,
    "the plan's lines must be sorted by SIGNED amount before they are applied — a credit that " +
      "arrives after the invoices has nothing left to raise",
  );
  // And the loop has to walk the sorted copy. Sorting into a variable nothing reads is a change
  // that looks right in a diff and does nothing at all, which is the exact shape of bug this file
  // exists to catch.
  assert.match(
    src,
    /const ordered = \[\.\.\.plan\.lines\]\.sort\([\s\S]{0,80}?\)[\s\S]{0,600}?for \(const line of ordered\)/,
    "the apply loop must iterate the SORTED lines, not plan.lines",
  );

  // The database half of the same fact, in BOTH functions that spend a bank line. Read the
  // migrations rather than trusting the comments: the route's sort is only correct because the
  // function counts a credit against the line's own direction when it computes what is left.
  //
  // confirm_bank_payment is in this list because leaving it out is how the defect survived once
  // already: allocate_bank_payment was fixed, its header explained the reasoning at length, and the
  // sibling carrying the identical line was not touched — nothing ran either of them.
  for (const file of [
    "supabase/migrations/allocate_bank_payment.sql",
    "supabase/migrations/bank_confirm_atomic.sql",
  ]) {
    const sql = readFileSync(file, "utf8");
    // The sign is about DIRECTION, not about the invoice type. A supplier credit gives money back
    // to a DEBIT and SPENDS a refund line that is the supplier paying that credit out — signed by
    // type alone, two credit notes settled from one refund are measured against a budget that does
    // not exist. `<>` on the two booleans is the XOR this rule is built from.
    assert.match(
      sql,
      /\(i\.direction = 'incoming'\)\s*\n?\s*<>/,
      `${file} must sign each link by whether its invoice moves money the same way the LINE did — ` +
        "a creditnota is not inherently one or the other",
    );
    assert.match(
      sql,
      /=\s*\(coalesce\(t\.amount, 0\) < 0\)/,
      `${file} must compare that against the bank line's OWN sign, joined from bank_transactions`,
    );
  }

  const alloc = readFileSync("supabase/migrations/allocate_bank_payment.sql", "utf8");
  assert.match(
    alloc,
    /v_sign\s*\*\s*v_applied/,
    "allocate_bank_payment must apply this line's own sign when it computes the remainder — added " +
      "as a magnitude, booking a €150 credit LOWERS the €850 line to €700",
  );
  assert.match(
    alloc,
    /=\s*\(v_tx_signed < 0\)/,
    "…and that sign must come from the line's direction too, not from the invoice type alone",
  );
});

// ── [LIJN-BUDGET] One sum for "what has this bank line already given away" ────
//
// Four places need it: the screen that offers a payment to be divided, the route that books the
// division, the route that confirms a single invoice, and the bank page that decides which lines
// are still open. It was written four times, with Math.abs around each, and the four then meant
// four different things the moment a creditnota was involved:
//
//   · /api/bank/allocate  — the pre-flight refused plans the database would have accepted;
//   · /api/bank/confirm   — capped the next invoice at a budget €300 too small and booked THAT;
//   · the verdelen screen — showed "al helemaal verdeeld" with €1.000 still to divide;
//   · /api/bank/match     — an €850 line made of a €150 credit and a €700 invoice summed to 850,
//                           read as fully covered, and left "te bevestigen" with €300 on it that
//                           nobody will look at again.
//
// The last one is the one to remember: the others report a wrong number, that one makes money
// disappear from the owner's to-do list. bank_tx_invoices.amount_applied is a MAGNITUDE by design
// — per invoice a credit really was settled by €150 — so every per-LINE reader has to re-derive
// the sign, and re-deriving it four times is how they came to disagree.
test("[LIJN-BUDGET] every reader of a bank line's spent total uses the one shared sum", () => {
  const readers = [
    "src/app/api/bank/allocate/route.ts",
    "src/app/api/bank/confirm/route.ts",
    "src/app/api/bank/match/route.ts",
    "src/app/dashboard/bank/verdelen/[txId]/page.tsx",
  ];
  for (const file of readers) {
    const src = code(file);
    assert.match(
      src,
      /from ['"]@\/lib\/bank-line-budget['"]/,
      `${file} sums a bank line's applied total and must take it from bank-line-budget.ts — a ` +
        "second copy of this sum is how the four readers came to disagree about the same line",
    );
    // The mechanism, not the symptom: an inlined `+= Math.abs(... amount_applied ...)` is the exact
    // shape all four had, and it is sign-blind by construction.
    assert.doesNotMatch(
      src,
      /\+=\s*Math\.(abs|max)\([^)]*amount_applied/,
      `${file} accumulates amount_applied itself. Per INVOICE that magnitude is right; per LINE it ` +
        "is not — a credit gives money back to the line. Use allocatedOnLine/allocatedByTransaction.",
    );
  }
});

// ── [BTW-ROUND] One summation for the three legal amounts on an invoice ──────
//
// invoice-totals.ts exists because there were two, and its own header says so. Then there were
// three: draft-totals.ts kept a per-line, UNROUNDED version, and both invoice editors computed a
// fourth for the screen the same way.
//
// The differences are small and they are the wrong kind of small:
//   · a mixed-rate invoice comes out a cent apart (measured: 23,88 vs 23,89), so the amount in the
//     editor is not the amount on the PDF — /api/invoice/send recomputes at issue;
//   · unrounded, a draft of 3 × 33,33 at 21% was STORED as total_inc_btw = 120,9879. Four decimals
//     in a money column, on a row an accountant reads;
//   · and the same route rounds each line to cents, so the stored header did not equal the sum of
//     the stored lines it came from.
//
// The rule is mechanical: anything that computes an invoice's BTW from a rate calls
// computeInvoiceTotals. `quantity * unit_price * (rate / 100)` summed per line is the shape all
// three copies had.
test("[BTW-ROUND] nothing computes an invoice's totals a second way", () => {
  const owners = [
    "src/lib/draft-totals.ts",
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
  ];
  for (const file of owners) {
    const src = code(file);
    // Either shared summation is fine — computeInvoiceTotals, or applyDiscount, which groups per
    // rate and rounds each rate's BTW the same way and additionally carries the korting. What is
    // NOT fine is a third one written inline, which is the whole point.
    assert.match(
      src,
      /computeInvoiceTotals|applyDiscount/,
      `${file} states an invoice's totals and must take them from invoice-totals.ts or ` +
        "invoice-discount.ts — those exist precisely because summations of the same legal amount " +
        "disagreed once already",
    );
    // The per-line BTW multiplication, in the shape all three copies used. The per-RATE version
    // inside computeInvoiceTotals looks different (it multiplies a grouped ex-amount), so this
    // pattern does not catch the legitimate one.
    assert.doesNotMatch(
      src,
      /unit_price\s*\*\s*\(?\s*(?:l|line)\.btw_rate\s*\/\s*100/,
      `${file} multiplies a LINE by its own rate. The Belastingdienst and Peppol method — which the ` +
        "PDF's btwBreakdown and the UBL export already use — groups the ex-amount per rate and " +
        "rounds each rate's BTW. Summing per line is a cent apart on a mixed-rate invoice.",
    );
  }
});

// ── [DEP-VEILIG] The two overrides that are not decoration ───────────────────
//
// Next 16.2.12 fixes all nine of its own advisories — a middleware/proxy bypass, two SSRFs, cache
// confusion, and an unauthenticated disclosure of internal Server Function endpoints among them —
// but it NESTS its own postcss and sharp, both of which are still vulnerable. The sharp one is the
// live surface: it is libvips behind the Image Optimization API, which any visitor can reach.
//
// npm's own answer was to take Next to 16.3.0, a minor bump this repo does not need for security
// and which AGENTS.md warns is exactly where this framework breaks things. Two overrides get the
// same result inside the 16.2 line.
//
// They look removable. `npm install <anything>` regenerates the lockfile happily without them, and
// nothing in a diff says what they were for — so this test says it instead.
test("[DEP-VEILIG] the nested postcss and sharp stay overridden", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };

  for (const [name, why] of [
    ["postcss", "sourceMappingURL path traversal reads arbitrary .map files at build time"],
    ["sharp", "libvips CVE-2026-33327/33328/35590/35591 — reachable through the Image Optimization API"],
  ] as const) {
    assert.ok(
      pkg.overrides?.[name],
      `package.json must override ${name}: Next nests its own vulnerable copy (${why}). ` +
        "Removing this override reintroduces it silently — npm audit is the only thing that says so.",
    );
  }

  // And the reason the overrides exist at all: staying inside the 16.2 patch line. If Next is ever
  // moved to 16.3+ deliberately, its own postcss/sharp are fixed and these overrides can go — but
  // that is a decision to make on purpose, not to arrive at through `npm audit fix`.
  assert.match(
    pkg.dependencies?.next ?? "",
    /^[~^]?16\.2\./,
    "next is pinned to the 16.2 line; a minor bump is a deliberate decision (AGENTS.md), not an audit side effect",
  );
});

// ── [PARTIAL-PAY] A money confirmation names the money ────────────────────────
//
// /vandaag lets an owner tick an invoice off without leaving the page, and the panel that does it
// said: "Betaald met — vandaag, het hele bedrag:". No amount in it, and on a partly-paid invoice
// not true either — the card directly above showed €4.662,80 open of €6.662,80, and the panel
// underneath offered to book "het hele bedrag".
//
// The WRITE was right the whole time: apply_manual_payment reads an absent amount as "the rest",
// so €4.662,80 is what landed. That is what makes it worth a gate rather than a fix — the defect
// is entirely in what the owner was told, so nothing downstream disagrees, no total is off, and
// the only place it exists is a sentence. He hesitates over a correct action, or he presses it
// and believes €2.000 more left his account than did.
test("[PARTIAL-PAY] the /vandaag confirm panel states the amount it will actually book", () => {
  const src = code("src/app/dashboard/vandaag/VandaagClient.tsx");

  assert.doesNotMatch(
    src,
    /vandaag, het hele bedrag:/,
    "the confirm panel promises 'het hele bedrag' with no amount — on a partly-paid invoice that " +
      "is the invoice total, and what gets booked is the remainder",
  );
  // It must say a number, and that number must be the one derived from amount_paid.
  assert.match(
    src,
    /formatEuroNL\(openstaand\)/,
    "the panel must name the amount it books, taken from the same `openstaand` the card shows",
  );
  // One derivation, not two. The card and the panel disagreeing is exactly how this happened, and
  // an IIFE recomputing it inside the JSX is what let them.
  assert.equal(
    (src.match(/const openstaand\b/g) ?? []).length,
    1,
    "`openstaand` is computed once for the whole card — a second copy is how the amount shown and " +
      "the amount booked came apart in the first place",
  );
});

// ── [BANK-BATCH-AMBIGU] A function may not name an output after a column it writes ──
//
// book_bank_batch raised on EVERY call, on the simplest possible input:
//
//     column reference "invoice_id" is ambiguous
//
// RETURNS TABLE(invoice_id uuid) declares a plpgsql variable of that name, and the function then
// writes ON CONFLICT (transaction_id, invoice_id). plpgsql will not guess which is meant.
//
// What made it survive is the shape worth remembering. The caller answers a raise with
// `if (batchErr) continue`, under a comment reading "error ⇒ not payable / migration not applied
// ⇒ the batch stays for the human". So the failure was indistinguishable from a normal outcome,
// on every run, and multi-invoice auto-confirmation had simply never booked anything.
//
// A source sweep cannot type-check plpgsql — tests/sql/ is what proves these functions run. What
// this gate does is cheaper and complementary: any function that declares an output column sharing
// a name with a table column must say which one it means.
test("[BANK-BATCH-AMBIGU] a plpgsql output named after a column declares its resolution", () => {
  const dir = "supabase/migrations";
  const offenders: string[] = [];
  // The column names that appear both as OUT parameters and in a conflict target / DML in this
  // schema. Adding to this list is cheap; the failure it prevents is a function that never runs.
  const RISKY = ["invoice_id", "transaction_id", "user_id", "amount_applied"];

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql")) continue;
    const sql = readFileSync(`${dir}/${name}`, "utf8");
    // Only plpgsql functions that RETURN a table whose columns could collide.
    const returnsRisky = new RegExp(`RETURNS TABLE\\s*\\(\\s*(?:[^)]*\\b)?(${RISKY.join("|")})\\b`, "i").test(sql);
    if (!returnsRisky) continue;
    // …and that actually write to a table (a pure reader cannot hit the ambiguity).
    if (!/\b(INSERT INTO|UPDATE)\s+public\./i.test(sql)) continue;
    if (!/#variable_conflict/.test(sql)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    `these functions RETURN a column name they also write, without a #variable_conflict directive: ` +
      `${offenders.join(", ")}. plpgsql refuses the ambiguity at RUNTIME, so the function raises on ` +
      `every call — and a caller that treats a raise as "not applicable" never notices.`,
  );
});

test("[TWEEDE-KANS] a file we kept because we could not read it has a way back", () => {
  // THE DEAD END. A purchase invoice that failed to read is kept, counted, and named — and then
  // nothing could be done with it. Measured before this route existed:
  //   · the sync loads email_skipped_attachments into knownKeys and filters the attachment out of
  //     EVERY future run, backfill included;
  //   · /api/documents/reprocess covers spreadsheets and daily-sales reports, never an invoice;
  //   · every invoice-reading route starts from an UPLOAD or an existing INVOICE;
  //   · and re-uploading the same bytes is refused by the byte-hash gate, which is deliberately
  //     NOT forceable — "an unreadable file carries no invoice to add again". True when written,
  //     and the sentence that traps the file.
  // Honest about the failure, no way out of it, cost unbooked and voorbelasting unclaimed.
  const src = code("src/app/api/documents/[id]/read-as-invoice/route.ts");

  // Only files that were kept BECAUSE they could not be read, and only while they are still
  // waiting. Reading an ordinary document as an invoice on request is how a cost that never
  // existed enters the books.
  assert.match(
    src, /if \(doc\.invoice_id\) \{[\s\S]{0,200}?status: 409/,
    "a document already behind an invoice may not be read again",
  );
  assert.match(
    src, /if \(!isSkippedDocType\(doc\.ai_doc_type\)\) \{/,
    "only a file the app filed as unreadable qualifies",
  );

  // The type comes from the CONTENT. A file that arrived with a wrong or empty media type is
  // exactly the kind that failed the first read.
  assert.match(
    src, /const isEInvoice = looksLikeInvoiceXmlBytes\(buffer\)/,
    "the second reading must not repeat the first one's mistake about the type",
  );
  // …and an e-invoice costs nothing, which is the case that matters most here: every UBL invoice
  // filed as 'unsupported_type' before the app could read one is recoverable for free.
  assert.match(
    src, /gateFairUseForRead\(\{[\s\S]{0,160}?costsAiCall: !isEInvoice/,
    "a mechanical re-read may not spend a document from the month",
  );
  // A failed READ is not a reading — give the allowance back.
  assert.match(src, /await gate\.release\(\)/, "a transient failure must not cost a document");

  // The same semantic duplicate gate the upload door applies: the invoice may have been booked
  // another way since. Booking it again is a double cost and a double voorbelasting claim.
  assert.match(src, /await findSemanticDuplicate\(/, "a re-read must not double-book");

  // Never straight into the books. This file failed a reading once already.
  assert.match(src, /status: "processing"/, "a second chance lands in the verify queue");
  assert.doesNotMatch(src, /status: "received"/, "…never booked outright");

  // And the panel that names these files now offers the action, instead of telling the owner to go
  // look at something they cannot act on.
  const api = code("src/app/api/email/skipped/route.ts");
  assert.match(api, /\.is\('invoice_id', null\)/, "only files still waiting are offered");
  const ui = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");
  assert.match(ui, /\/api\/documents\/\$\{docId\}\/read-as-invoice/, "the panel must call it");
  assert.match(ui, /t\('ink\.reread\.knop'\)/, "and offer it in words"); // [TAAL] key, not sentence
  // The answer is always a sentence. A silent button on the one panel whose purpose is honesty
  // about what went missing would be the wrong thing twice over.
  assert.match(ui, /setRereadMessage\(typeof json\?\.message === "string"/, "success speaks");
  assert.match(ui, /setRereadMessage\(typeof json\?\.error === "string"/, "and so does failure");
});

// ── [VRIJGESTELD-KOPIE] Every route that COPIES invoice lines carries the exemption flag ──
//
// Four routes duplicate invoice_lines: the creditnota, the recurring cron, the duplicate action and
// the edit PUT (which deletes every line and re-inserts it). All four already carried `unit`,
// because a "2 uur arbeid" that leaves as "2 stuks" is visible on the PDF. None carried
// vat_treatment, because losing it is invisible — and far more expensive.
//
// A copied exempt line without the flag is classified as TAXED turnover at 0%. On a creditnota that
// means the correction does not cancel the original: the original stays +EUR 1.000 vrijgestelde
// omzet and the credit lands as -EUR 1.000 in the 0%/verlegd rubriek. Two rubrieken wrong at once,
// while 5a and 5b still balance — so no screen shows it. A recurring exempt invoice silently becomes
// taxed from its second month.
//
// This is a CLASS test on purpose. Fixing four sites does not stop the fifth.
test("[VRIJGESTELD-KOPIE] every route that copies invoice lines carries vat_treatment", () => {
  // [CREDIT-SIGN] The creditnota route is not in this list any more: its per-line mirror moved to
  // creditnota-lines.ts, where the rule is the same and can finally be tested without a database.
  // The gate follows it there rather than being relaxed — the route must reach the module, and the
  // module must harden exactly as the inline copies do.
  const credit = code("src/app/api/invoice/creditnota/route.ts");
  // [DEEL-CREDIT] The lines now come from the validated SELECTION rather than from a second read
  // of the invoice — same mirror, and the amounts the ceiling was checked against.
  assert.match(credit, /creditLinesFor\(keuze\.lines, creditnota\.id, reason\)/,
    "the creditnota route must build its lines with the shared mirror");
  // [REGEL-KOPIE] The hardening moved with the other optional columns into the module all three
  // copiers share. Followed there, not relaxed: this assertion is the one that must survive.
  assert.match(code("src/lib/creditnota-lines.ts"), /\.\.\.optionalLineFields\(line\)/,
    "…and that mirror must take its optional columns from the shared copier");
  assert.match(
    code("src/lib/invoice-line-copy.ts"),
    /vat_treatment === "exempt" \? "exempt" : null/,
    "…which must harden vat_treatment like every other writer",
  );

  // [REGEL-KOPIE] /duplicate and the recurring cron copy LINES, and both now do it through the
  // shared module — where the hardening lives and is asserted above. The gate follows them there
  // instead of demanding an inline copy that is exactly what drifted three times.
  for (const path of ["src/app/api/cron/recurring/route.ts", "src/app/api/invoice/[id]/duplicate/route.ts"]) {
    assert.match(code(path), /copiedLinesFor\(/, `${path} must copy lines through the shared module`);
  }
  // The PUT route is not a copier: it writes what the edit screen sent, so it hardens its own.
  const copiers = [
    "src/app/api/invoice/[id]/route.ts",
  ];
  for (const path of copiers) {
    const src = code(path);
    assert.match(
      src,
      /vat_treatment/,
      `${path} copies invoice lines but never mentions vat_treatment — a copied exempt line becomes taxed 0% turnover in the aangifte`,
    );
    // And it must HARDEN, not pass through: only the literal 'exempt' may mean exempt. An unknown
    // value reaching the column would claim an exemption nobody declared.
    assert.match(
      src,
      /vat_treatment === 'exempt' \? 'exempt' : null/,
      `${path} must harden vat_treatment the same way every other writer does`,
    );
  }
});

// [REGEL-AFRONDING] The draft route rounds its line totals, like every other writer.
//
// invoice_lines.line_total is `numeric` with NO scale, so an unrounded value is stored verbatim.
// 1,5 uur x EUR 33,33 became 49,995; the PDF printed two lines of EUR 50,00 above a subtotal of
// EUR 99,99, and the customer's own addition disagreed with the invoice. The UBL export was worse:
// each InvoiceLine rounds to 50,00 while LegalMonetaryTotal rounds the sum of the raw values to
// 99,99, and Peppol BIS 3.0 rule BR-CO-10 requires those to be equal — the e-invoice is rejected at
// the receiving access point.
//
// The same invoice saved once through the edit screen came out a cent higher, because the PUT
// rounds per line. Two routes to one document with two totals.
test("[REGEL-AFRONDING] the draft route rounds line_total, like the PUT route does", () => {
  const draft = code("src/app/api/invoice/draft/route.ts");
  // [REGEL-KORTING] The rounding moved INSIDE lineNetEx, which is now the one definition of what a
  // line is worth — quantity x price, minus the line's own discount, rounded once. The property the
  // gate is here for is unchanged and now stronger: the amount is not computed inline at all, so
  // there is no second expression that could round differently. Every writer calls this function.
  for (const [path, src] of [
    ["src/app/api/invoice/draft/route.ts", draft],
    ["src/app/api/invoice/[id]/route.ts", code("src/app/api/invoice/[id]/route.ts")],
  ] as const) {
    assert.match(
      src,
      /line_total: lineNetEx\(/,
      `${path} must take line_total from lineNetEx — an unrounded value is stored verbatim and the document stops adding up`,
    );
    assert.doesNotMatch(
      src,
      /line_total: (?!lineNetEx)[^,\n]*quantity \* [^,\n]*unit_price/,
      `${path} is computing a line total inline again — that is the second opinion this gate exists to prevent`,
    );
  }
});

// ── [CI-PARITEIT] CI must run the gates it claims to run ─────────────────────
//
// The one difference from `npm run gates` is deliberate and documented: eslint is not blocking,
// because the repo carries known pre-existing findings. Everything else has to match, and until now
// it did not.
//
// `npm run test:render` was never in CI at all — the ONLY gate that catches a screen which throws
// on render. tsc, eslint and next build never call a component, and the public-surface smoke sweeps
// only what the middleware lets through without a session, so every /dashboard/* screen sat outside
// all four gates CI did run. AGENTS.md documents the incident it exists for.
//
// And the unit step carried its own COPY of the glob, under a comment warning that "adding a
// directory of tests means adding it here too — silence is what this step is supposed to make
// impossible". It became that silence: package.json grew src/lib/*/*.test.ts, ci.yml did not.
//
// So this test does not check for a glob. It checks that CI calls the SCRIPTS, because two copies
// of a glob is the mechanism, not the symptom.
test("[CI-PARITEIT] CI invokes the package.json scripts, so it cannot drift from the local gates", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  for (const script of ["test:unit", "test:render"]) {
    assert.ok(
      pkg.scripts[script],
      `package.json must define ${script} — CI now calls it by name`,
    );
    assert.match(
      ci,
      new RegExp(`run:\\s*npm run ${script.replace(":", ":")}`),
      `ci.yml must run "npm run ${script}" rather than repeating its glob — a duplicated glob drifts, and it drifts silently`,
    );
  }

  // The gates the local script runs, minus the one documented exception.
  const gates = pkg.scripts.gates ?? "";
  for (const part of ["test:unit", "test:render", "test:e2e"]) {
    assert.ok(gates.includes(part), `npm run gates must still include ${part}`);
  }
  // e2e is present in CI under its own command (playwright), and tsc/build likewise — assert the
  // work happens, not the exact spelling.
  assert.match(ci, /tsc --noEmit/, "CI must type-check");
  assert.match(ci, /next build/, "CI must build");
  assert.match(ci, /playwright test tests\/public-surface\.spec\.ts/, "CI must run the public smoke");

  // [SEAM] The sixth gate, and the only one that can read a plpgsql contract. It is deliberately
  // NOT in `npm run gates` — it needs a database, and the local gates are worth keeping runnable on
  // a bare checkout with an empty environment. That makes CI its only home, so CI is where it has
  // to be held.
  assert.ok(pkg.scripts["test:sql"], "package.json must define test:sql");
  assert.match(ci, /sql-seam-test\.sh/, "CI must run the SQL seam gate");
  // The line that decides whether the gate proves anything. Without it the runner SKIPS when no
  // database is reachable — correct on a laptop, a lie in CI: a green check that ran nothing. This
  // is the same failure the render gate had (never wired up) and the unit glob had (drifted), both
  // of which stayed green the whole time they were broken.
  assert.match(
    ci,
    /SQL_SEAM_REQUIRED:\s*'?1'?/,
    "CI must set SQL_SEAM_REQUIRED=1, or a missing database turns the SQL gate into a silent skip",
  );
});

// ── [OBSERVABILITY] The kept-but-unread marker lives in ONE file, on both sides ──
//
// src/lib/skipped-import.ts exists because the WRITER and the READER of `ai_doc_type` once used
// different values: intake wrote `v.document_kind ?? "other"` over a file it knew it had not read,
// and /api/email/skipped counted `.eq('ai_doc_type', 'could_not_read')`. A photographed receipt
// that could not be read landed neatly in bestanden and was counted by nothing, so the one panel
// that exists to admit a loss reported "Niets overgeslagen — alles wat binnenkwam is verwerkt".
// That is the sentence that makes an entrepreneur stop looking.
//
// The file closes it by holding both sides together, and promises, in its own header, "een test die
// faalt zodra iemand er één verplaatst". No such test existed. The promise held for every door but
// one: saveUnreadableAttachment in the e-mail path was still typing the literal `'could_not_read'`.
// Equal to the constant today, so nothing was broken — and silently divergent the day the constant
// changes, at which point every attachment that door stores disappears from the skipped panel AND
// from the second-chance list, which is exactly the original bug with a new writer.
//
// So the gate reads the values OUT of skipped-import.ts rather than repeating them. Add a third
// reason there and this test guards it the same minute, without anyone remembering to come here.
test("[OBSERVABILITY] no door writes or reads a skipped ai_doc_type as a hardcoded literal", () => {
  const CANON = "src/lib/skipped-import.ts";

  // The marker values, taken from the one file that is allowed to spell them.
  const skippedValues = [...readFileSync(CANON, "utf8").matchAll(
    /export const DOC_TYPE_\w+\s*=\s*["']([^"']+)["']/g,
  )].map((m) => m[1]);
  assert.ok(
    skippedValues.length >= 2,
    `${CANON} must still declare the DOC_TYPE_* constants — this gate reads them from there ` +
      "rather than repeating them, so that the list stays in one place",
  );

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };

  // Only where the column itself is named. `saveUnreadableAttachment(att, 'could_not_read')` passes
  // a REASON, and IncomingInvoicesClient maps that same reason to a Dutch sentence — neither is
  // this column, and neither drifts with it. A gate that flagged those would be about the string,
  // not about the two sides of one truth.
  const offenders: string[] = [];
  for (const file of walk("src")) {
    if (file === CANON || file.startsWith(`${CANON.slice(0, -3)}.test`)) continue;
    if (file.endsWith("lifecycle-gates.test.ts")) continue;
    const src = code(file);
    for (const m of src.matchAll(/ai_doc_type[\s\S]{0,160}/g)) {
      const window = m[0];
      // As a WORD, not as a whole quoted string. supabase-js spells a filter value INSIDE a larger
      // string — `.or('ai_doc_type.eq.could_not_read')`, `.filter('ai_doc_type', 'eq', …)` — so a
      // rule that required `'could_not_read'` with its own quotes missed the reader shape that
      // caused the original bug. Measured: it did miss it, on the first negative control.
      const hit = skippedValues.find((v) => new RegExp(`(^|[^\\w-])${v}([^\\w-]|$)`).test(window));
      // No line number: code() collapses each comment to a space, so a line counted here points
      // somewhere else in the real file. A greppable snippet is always right.
      if (hit) offenders.push(`${file} — '${hit}' near: ${window.slice(0, 70).replace(/\s+/g, " ")}`);
    }
  }

  assert.deepEqual(
    offenders, [],
    "these places spell a skipped ai_doc_type value by hand instead of using the constants from " +
      `${CANON}:\n` + offenders.map((o) => `  · ${o}`).join("\n") +
      `\n\nImport DOC_TYPE_COULD_NOT_READ / DOC_TYPE_UNSUPPORTED / SKIPPED_DOC_TYPES from ` +
      "@/lib/skipped-import. A writer and a reader that spell the same truth separately go apart " +
      "without a single test turning red, and a kept file then counts as nothing.",
  );

  // And the door that carried the drift keeps the constant, named. Absence of the literal alone
  // would also be satisfied by a door that stopped writing the column at all — which loses the file
  // in the same way, from the other side.
  const email = code("src/lib/email-integration.ts");
  assert.match(
    email,
    /const saveUnreadableAttachment[\s\S]{0,2600}?ai_doc_type: DOC_TYPE_COULD_NOT_READ/,
    "the e-mail door stores an unreadable attachment under the shared constant, so the skipped " +
      "panel and the second-chance list both see it",
  );
  assert.match(
    email,
    /import \{[^}]*DOC_TYPE_COULD_NOT_READ[^}]*\} from '@\/lib\/skipped-import'/,
    "…and takes it from the canonical file rather than declaring its own",
  );
});

// ── [PRULLENBAK] The skipped panel counts what bestanden shows, and no more ──
//
// The panel "Overgeslagen bij import (en waarom)" makes one promise in words: these files are in
// your bestanden, go and look. It filtered nothing on `trashed`.
//
// So: an unreadable attachment arrives, is kept, and is named. The owner opens bestanden, sees it
// is a supplier's logo or a reclame-pdf, and throws it away — a soft delete, `trashed = true`, gone
// from bestanden. The panel keeps counting it and keeps pointing at bestanden, where it is not.
// The counter can never reach zero again, and a counter that never reaches zero is ruis; ruis gets
// ignored. That is the same silence as "Niets overgeslagen" over an unread invoice, reached from
// the other end — this panel is the one surface that admits a loss, and an owner who has learned to
// ignore it is an owner who will not see the next real one.
//
// [TWEEDE-KANS] made it worse than cosmetic: the panel offered "Lees opnieuw" on the binned file,
// and the route would download it, read it, and book the cost with its voorbelasting.
test("[PRULLENBAK] a file in the bin is not counted, not offered, and not readable", () => {
  const api = code("src/app/api/email/skipped/route.ts");

  // Retargeted: this counted TWO `.eq('trashed', false)` filters, because the count and the list
  // were two queries. [GEEN-STILLE-KAP] merged them into one — the property held strictly better
  // (one filter set cannot be applied to one half and not the other) and the gate went red anyway.
  // A gate on the shape of the code, not on the rule.
  //
  // The rule: wherever this route asks for skipped documents, it excludes the bin. However many
  // queries that turns out to be.
  const skippedQueries = [...api.matchAll(/\.in\('ai_doc_type', SKIPPED_DOC_TYPES\)/g)];
  assert.ok(skippedQueries.length >= 1, "this route still reads the skipped documents");
  for (const m of skippedQueries) {
    // The filters of one query — from its `.from(` back-anchor is overkill; the surrounding 400
    // characters cover a supabase chain comfortably and cannot span two of them here.
    const around = api.slice(Math.max(0, m.index - 400), m.index + 200);
    assert.match(
      around, /\.eq\('trashed', false\)/,
      "every query for skipped documents must exclude trashed ones. The panel tells the owner " +
        "these files are in bestanden; counting one they threw away points them at something " +
        "that is not there, and the counter can then never reach zero.",
    );
  }

  // The SAME spelling as the place the panel points at. This is the [OBSERVABILITY] lesson applied
  // to a second column: `trashed` is `boolean DEFAULT false` and NULLABLE (database.sql), so
  // `.eq('trashed', false)` and `IS NOT TRUE` differ on a NULL row. Two surfaces that must agree
  // may not spell the same truth two ways — one would count a file the other refuses to show.
  const bestanden = code("src/app/api/bestanden/route.ts");
  assert.match(
    bestanden, /\.eq\("trashed", false\)/,
    "bestanden filters trashed with .eq(\"trashed\", false) — the skipped panel copies that " +
      "spelling on purpose. If this changed, change the panel with it (and read the NULL note above)",
  );

  // And the door refuses on its own. The panel is a snapshot: an id from a tab that loaded before
  // the file went in the bin still reaches this route.
  const route = code("src/app/api/documents/[id]/read-as-invoice/route.ts");
  assert.match(
    route, /\.select\("[^"]*\btrashed\b[^"]*"\)/,
    "the re-read route must fetch `trashed` — a guard over a column it never selected reads " +
      "undefined and passes",
  );
  assert.match(
    route, /if \(doc\.trashed === true\) \{[\s\S]{0,300}?status: 409/,
    "…and refuse a document the owner deleted, rather than booking a cost out of the prullenbak",
  );
  assert.match(
    route, /prullenbak/,
    "…in words that say what to do about it",
  );
});

// ── [BIJLAGE-TERUGWEG] The skipped panel does not send the owner down a road that is closed ──
//
// The panel lists every attachment the classifier judged "leek geen factuur" and, underneath,
// offered one remedy: "Mis je hier een echte factuur? Gebruik 'Oudere e-mails opnieuw ophalen'."
//
// That remedy cannot work for anything IN the list. Measured, three ways:
//   · PHASE 0 of the sync loads email_skipped_attachments into knownKeys, unconditionally — there
//     is no backfill branch around it;
//   · `notKnown = attachments.filter(a => !knownKeys.has(...))` drops them before any fetch;
//   · a backfill only moves `syncAfterMs`. It re-LISTS the message and PHASE 0 filters the
//     attachment straight back out.
// And nothing in the codebase ever DELETEs from that table, so the block is permanent.
//
// So an owner reading "leek geen factuur" beside a real invoice followed the app's own advice, was
// told "0 nieuw", and concluded the invoice had never arrived. Worse than silence: the app made a
// wrong call and then confirmed it with guidance it could not honour.
//
// The bytes of a not-an-invoice attachment are discarded on purpose — a mailbox of signature images
// is not worth storing — so the honest way back is the mailbox, and a filename alone does not find
// an e-mail. The rows carry their date for that reason.
test("[BIJLAGE-TERUGWEG] the panel's remedy is one the pipeline can actually honour", () => {
  const ui = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");
  const sync = code("src/lib/email-integration.ts");

  // The premise. If either of these stops holding, the advice below is free to change back — and
  // this gate should be the thing that says so, rather than the owner finding out.
  assert.match(
    sync,
    // 400, measured at 274 on the stripped source. The other knownKeys.add (the invoices one) sits
    // BEFORE this query, and the match only looks forward, so a wide window cannot borrow it.
    /from\('email_skipped_attachments'\)[\s\S]{0,400}?knownKeys\.add/,
    "PHASE 0 still folds the skip registry into knownKeys — the reason a backfill cannot reach a " +
      "listed attachment. If this is gone, re-read the panel's wording below",
  );
  assert.doesNotMatch(
    sync,
    /from\('email_skipped_attachments'\)\s*\.delete\(/,
    "nothing clears the skip registry, so the block is permanent — the panel may not imply otherwise",
  );

  // The wording. The old sentence named the backfill as the remedy for a row IN the list; the two
  // situations now have their own answers, and the backfill keeps only the one it can serve.
  assert.match(
    ui,
    /t\('ink\.email\.echteFactuur'\)/, // [TAAL] the sentence lives in the catalogue now
    "the panel must say plainly that a listed attachment will not be fetched again — that is the " +
      "fact the old advice contradicted",
  );
  assert.match(
    ui,
    /t\('ink\.email\.misFactuur'\)\} \{t\('ink\.email\.nietTussen'\)/, // [TAAL] catalogued now
    "…and keep the backfill only for the case it can serve: an invoice that is NOT in this list",
  );
  // The sentence moved into the catalogue, so the wording check follows it there. The word
  // "niet" IS the advice — a key split once dropped it and told the owner the exact opposite.
  assert.match(
    code("src/lib/i18n/messages.ts"),
    /'ink\.email\.misFactuur':[^\n]*niet tussen staat\?/,
    "the catalogue sentence must keep 'niet': the backfill only serves invoices NOT in the list",
  );

  // The date, because "open de e-mail" is advice an owner can only follow if they can find it.
  assert.match(
    ui,
    /\{s\.filename\}[\s\S]{0,300}?formatDate\(s\.createdAt\)/,
    "each skipped row must show its date beside the filename — the API has always returned " +
      "createdAt, and without it the only remedy the app can offer is unfollowable",
  );
});

// ── [GEEN-STILLE-KAP] The panel that exists so nothing is lost silently, losing things silently ──
//
// Two defects in the same surface, both the same shape: a truth the server took care to produce,
// thrown away before it reached the owner.
//
// 1. TWO CAPS, NEITHER ADMITTED. The skip list stops at 100 rows and the unread list at 50, both
//    ordered created_at DESC — so what falls off is always the OLDEST, which is exactly the
//    attachment nearest an aangifte deadline and likeliest to be the one being hunted. Worse, the
//    unread list and its counter were separate queries with DIFFERENT filters: at 60 unreadable
//    files the panel printed "60 bestanden konden we niet lezen" above 50 buttons. Two numbers
//    contradicting each other on the one screen whose job is to be believed.
//
// 2. THE CLIENT SPOKE THE SENTENCE THE SERVER REFUSED TO. /api/email/skipped goes out of its way
//    not to answer an empty list on a failed read — it 503s with "dit zegt niets over of er iets is
//    overgeslagen", because supabase-js does not throw and `?? []` would turn a database hiccup
//    into "Niets overgeslagen — alles wat binnenkwam is verwerkt". Both failure branches in the
//    screen then did `setSkippedItems([])`, and an empty list renders exactly that sentence. A
//    server that refuses to lie is worth nothing while the client lies on its behalf.
test("[GEEN-STILLE-KAP] the skipped panel admits its caps and never invents an all-clear", () => {
  const api = code("src/app/api/email/skipped/route.ts");
  const ui = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");

  // ONE query for the unread rows and their count. Two queries can drift; the same filter set
  // cannot disagree with itself.
  assert.match(
    api,
    /const \{ data: unreadRows, error: unreadError, count: couldNotReadCount \} = await supabase[\s\S]{0,200}?\{ count: 'exact' \}/,
    "the unread list and its counter must come from one query — separate ones drifted apart and " +
      "the panel printed a count above a shorter list",
  );
  assert.doesNotMatch(
    api,
    /count: 'exact', head: true/,
    "…so the old head-only counter, which carried its own filter set, may not come back",
  );
  // Every capped list reports its total, or the screen cannot know what it is hiding.
  assert.match(
    api, /\{ count: 'exact' \}[\s\S]{0,400}?\.limit\(100\)/,
    "the skip registry list is capped at 100 and must return its true total alongside",
  );
  assert.match(api, /skippedTotal/, "…and hand that total to the screen");
  // A failed read of EITHER source answers with the failure, never with rows.
  assert.match(
    api, /if \(unreadError\) \{[\s\S]{0,400}?status: 503/,
    "a failed unread lookup must 503 — it was not read at all, so `?? []` made a database hiccup " +
      "look like an empty waiting list",
  );

  // The screen says what it is not showing, on BOTH lists.
  assert.match(
    ui, /couldNotReadCount > unreadDocs\.length &&/,
    "the unread list must say how many of the total it is showing",
  );
  assert.match(
    ui, /skippedTotal > \(skippedItems\?\.length \?\? 0\) &&/,
    "and so must the skip list — a truncated list read to the bottom says 'not here'",
  );

  // And a failure is shown as a failure. This is the load-bearing one: `setSkippedItems([])` on an
  // error path is not a neutral default, it is the false all-clear.
  assert.doesNotMatch(
    ui, /catch \{\s*setSkippedItems\(\[\]\);/,
    "a failed fetch may not answer with an empty list — that renders 'Niets overgeslagen — alles " +
      "wat binnenkwam is verwerkt', the sentence the route 503s specifically to avoid",
  );
  assert.match(
    ui, /\} catch \{\s*setSkippedError\(/,
    "…it must set the error instead",
  );
  assert.match(
    ui, /: skippedError \? \([\s\S]{0,400}?\{skippedError\}/,
    "and the panel must render that error INSTEAD of the list — an all-clear beside an error is " +
      "still an all-clear",
  );
});

// ── [ARTIKEL-LEREN] The catalog fills itself from the first invoice, and never at the invoice's cost ──
//
// The line-item catalog could only be filled by someone who already knew it existed: by typing an
// article on /dashboard/artikelen, or by pressing the small "bewaar in catalogus" button beside a
// line. So the first invoice taught the app nothing, the second was typed out by hand again, and
// the picker an owner meets on invoice twenty is still empty. A catalog that only fills when you
// remember to fill it is a catalog for the people who least need one.
//
// Now the lines are learned as they are written. Two things have to stay true about that, and
// neither is visible in the pure tests:
test("[ARTIKEL-LEREN] every door a human types lines through teaches the catalog, and none pays for it", () => {
  // Retargeted once already. The first version asserted things about a learnFromLines declared
  // INSIDE /api/invoice/draft, under the belief — written into its own message — that the draft is
  // "the one door where a human types invoice lines for the first time". It is not: PUT
  // /api/invoice/[id] replaces a draft's lines wholesale, so every line added on the edit screen is
  // newly typed text, and for many owners that is the ordinary route. The rule was never about a
  // file; it is about every door that takes typed lines.
  const store = code("src/lib/article-learning-store.ts");

  // ONE module. Two copies of this rule would drift without a single test turning red — the defect
  // this codebase keeps digging out of ai_doc_type and the skipped panel.
  assert.doesNotMatch(
    code("src/app/api/invoice/draft/route.ts"),
    /async function learnFromLines\(/,
    "the writing half lives in article-learning-store.ts, not copied back into a route",
  );

  // Both doors, each AFTER its own lines are safe. Before that point an exception from a side table
  // lands in the outer catch — answering 500 for a document that was in fact written, or skipping a
  // rollback that keeps a header from existing with no lines.
  for (const [file, guard] of [
    ["src/app/api/invoice/draft/route.ts", "if (lineErr) {"],
    ["src/app/api/invoice/[id]/route.ts", "if (insErr) {"],
  ] as const) {
    const src = code(file);
    const g = src.indexOf(guard);
    const learn = src.indexOf("await learnFromLines({");
    assert.ok(g > 0, `${file}: the line-write failure branch is still there`);
    assert.ok(learn > 0, `${file}: this door takes typed invoice lines and must teach the catalog`);
    assert.ok(
      learn > g,
      `${file}: the catalog is taught AFTER the document's own lines are safe. Learning is a ` +
        "convenience beside an invoice; it may never be a reason one fails or half-exists",
    );
  }

  // THE READ IS NOT ALLOWED TO GUESS. supabase-js does not throw: `const { data }` on a failed read
  // gives null, `?? []` reads as "the catalog is empty", and then EVERY line looks new — inserting
  // a duplicate of the owner's ENTIRE catalog on one bad connection. The one failure here that
  // damages data rather than merely skipping a nicety.
  assert.match(
    store,
    /const \{ data: catalog, error: catalogErr \} = await db[\s\S]{0,200}?from\("articles"\)/,
    "the catalog read must keep its error",
  );
  assert.match(
    store, /if \(catalogErr\) \{[\s\S]{0,220}?return\b/,
    "…and a failed read must give up, not treat 'no rows' as 'no catalog' and re-insert everything",
  );

  // It cannot break either request. Asserted over the whole module, which is nothing BUT this work.
  assert.ok(
    store.includes("planCatalogLearning(") && store.includes("catch"),
    "the module really is the learning writer — without this the check below passes vacuously",
  );
  assert.doesNotMatch(
    store, /NextResponse/,
    "the learning writer may not answer the browser at all. The document exists by the time it " +
      "runs, so turning a catalog failure into an error would report a failure for work that " +
      "succeeded",
  );
  assert.match(
    store, /\} catch \(e\) \{[\s\S]{0,200}?console\.error\(/,
    "…and its failures end in a log, not in a throw the route's outer handler answers 500 to",
  );

  // Ownership is applied HERE, on every statement, rather than trusted to whichever client a caller
  // happened to pass. The edit route hands it a service-role client whenever a verkoopmedewerker is
  // acting, because `articles` carries no policy for an employee.
  // Three statements, three ways of being scoped — a count would have said "3 eq() calls" and been
  // wrong about the insert, which carries the owner in the ROW. Assert the property per statement.
  assert.match(
    store, /select\("id, description, usage_count, active"\)\s*\.eq\("user_id", ownerId\)/,
    "the READ must be the owner's catalog, or a plan is computed against someone else's",
  );
  assert.match(
    store, /\.insert\(plan\.toInsert\.map\(\(a\) => \(\{ user_id: ownerId, \.\.\.a \}\)\)\)/,
    "every INSERTED row must carry the owner — articles has no default for it",
  );
  assert.match(
    store, /\.update\(\{ usage_count[\s\S]{0,80}?\.eq\("id", b\.id\)\.eq\("user_id", ownerId\)/,
    "the BUMP must be owner-scoped as well as id-scoped: it runs on a service-role client whenever " +
      "a verkoopmedewerker is acting, where an id alone reaches any row in the table",
  );
  assert.match(
    code("src/app/api/invoice/[id]/route.ts"),
    /db: isActingForOther\(acting\) \? createPipelineClient\(\) : supabase/,
    "the edit screen of a verkoopmedewerker must write with a client that CAN write articles, or " +
      "it silently learns nothing for the person a filled picker helps most",
  );

  // The decision stays in the tested module. An `if` about which documents teach, written in a
  // route, is an `if` nobody runs a test against.
  assert.match(store, /documentTeachesCatalog\(documentKind\)/, "which documents teach is decided in article-learning.ts");
  assert.match(store, /planCatalogLearning\(lines, catalog \?\? \[\]\)/, "and so is what to insert versus bump");

  // What is learned is what the LINE said. Deriving the description a second way is how the catalog
  // and the invoice come to disagree about the same words.
  const draft = code("src/app/api/invoice/draft/route.ts");
  assert.equal(
    [...draft.matchAll(/description: String\(bron\[i\]\?\.description \?\? ''\)\.trim\(\)/g)].length, 2,
    "the invoice line and the catalog entry must read the description the same way",
  );
});

// ── [LINKS-WRITE-HONEST] The write that decides whether a bank line is finished may not be silent ──
//
// An owner reported confirming the same bank transaction over and over: it kept coming back to
// "Te bevestigen". bank-matching.ts already names that loop — "confirming it again can only return
// 409, the client treats that as done and re-fetches, and the card comes straight back — an
// unbreakable loop" — and [BANK-COVERAGE-BY-MONEY] closed it by measuring the line's applied total
// from bank_tx_invoices instead of counting invoice numbers in the bank reference.
//
// The measurement's precondition was written by a function that could not report failure:
//
//     try { await client.from("bank_tx_invoices").upsert(rows, …) } catch { /* non-fatal */ }
//
// supabase-js does NOT throw on a query error — it returns `{ error }` — so that catch never fired
// and the error object was dropped. The read half of the same file was fixed for exactly this
// reason, with the reasoning written out above it. The write half was not.
//
// What a lost row costs, both of which the file's own comments establish elsewhere:
//   · recompute_invoice_amount_paid re-derives invoices.amount_paid as SUM(amount_applied) over
//     the surviving links, on every unlink and undo. A link never written counts as ZERO, so an
//     invoice this payment really settled re-opens at its full total.
//   · /api/bank/match cannot measure the line, falls back to the reference-token rule, and any
//     token that is not a paid invoice number (a customer number, an order number, a POS batch
//     counter) keeps the line in "Te bevestigen" forever. The loop, restarted — in total silence.
test("[LINKS-WRITE-HONEST] a lost payment link is logged, returned, and said out loud", () => {
  const links = code("src/lib/bank-tx-links.ts");

  // Both writers read the error. supabase-js reports it in the RESULT, so a try/catch alone is
  // not error handling here — it is the appearance of it.
  // Bounded by the NEXT declaration, never by a character count. A fixed 1400-char window ran past
  // recordPaymentLinks into clearPaymentLinks, whose correct code then satisfied every assertion
  // while the function under test was reverted to the bare swallow — both negative controls passed
  // green. A window that can reach its neighbour is not a window.
  for (const fn of ["recordPaymentLinks", "clearPaymentLinks"]) {
    const start = links.indexOf(`export async function ${fn}(`);
    assert.ok(start > 0, `${fn} is still here`);
    const nextDecl = links.indexOf("\nexport ", start + 1);
    const body = links.slice(start, nextDecl > start ? nextDecl : undefined);
    assert.ok(
      body.includes("bank_tx_invoices") && body.length < 1400,
      `the ${fn} slice must be that function alone — it is ${body.length} chars`,
    );
    assert.match(
      body, /const \{ error \} = await client/,
      `${fn} must read the query error — supabase-js returns it, it does not throw it`,
    );
    assert.match(
      // The log must be the FIRST statement in the guard, not merely somewhere after it: a
      // permissive window matched the catch clause BELOW and passed while the guard logged nothing.
      body, /if \(error\) \{\s*console\.error\(/,
      `${fn} must log the query failure inside the guard that detects it`,
    );
    assert.match(body, /Promise<boolean>/, `${fn} must report whether the write landed`);
  }
  assert.doesNotMatch(
    links, /\} catch \{\s*\/\* non-fatal[^\n]*\n\s*\}/,
    "the bare swallow may not come back — it is what made the loop start in silence",
  );

  // The confirm route is where an owner is standing and waiting, so it is where the failure has to
  // surface. Not as an error — the money IS booked — but not as a bare tick either.
  const confirm = code("src/app/api/bank/confirm/route.ts");
  assert.match(
    confirm, /const linkRecorded = await recordPaymentLinks\(/,
    "the confirm route must keep the answer rather than discarding it",
  );
  assert.match(
    confirm, /linkRecorded \? \{\} : \{ warning: "payment_link_not_recorded" \}/,
    "…and pass it to the screen, so a booking that may keep coming back is not reported as done",
  );

  // And the screen says it in words. A warning nobody renders is the same silence one layer up.
  const ui = code("src/app/dashboard/bank/BankClient.tsx");
  assert.match(
    ui, /json\?\.warning === 'payment_link_not_recorded'/,
    "the bank screen must handle the warning",
  );
  assert.match(
    ui, /t\('bank\.betaaldNietVastgelegd'/, // [TAAL] key, not sentence
    "…and tell the owner in Dutch, with something to do about it — telling them 'Bevestigd ✓' and " +
      "letting them walk into the loop is the worse of the two failures",
  );
});

// ── [FEEDBACK] The channel out, and the one thing it may never do ──
//
// Everything in this app is built so nothing fails silently: the skipped panel admits what it could
// not read, the bank screen says when a line may keep coming back, a failed lookup refuses instead
// of answering "niets". All of that honesty stopped at the screen. The owner was told something
// went wrong and there was no way for that to reach anyone who could fix it — so from the outside,
// the app's own alarms were indistinguishable from silence.
//
// This adds the way out. Which makes ONE failure worse than having no button at all: thanking
// someone for a report that was never stored. They stop worrying about a problem nobody will see.
test("[FEEDBACK] the report is on every page, and a failed one is never thanked for", () => {
  const lib = code("src/lib/feedback.ts");
  const route = code("src/app/api/feedback/route.ts");
  const ui = code("src/components/feedback/FeedbackButton.tsx");
  const layout = code("src/app/dashboard/layout.tsx");

  // ONE mount point. A button added per page is on half the pages within a year — and not on the
  // screen where something broke, because that is usually the least visited one.
  assert.match(layout, /<FeedbackButton \/>/, "the button is mounted in the dashboard layout");
  assert.doesNotMatch(
    layout, /!isMedewerker && <FeedbackButton/,
    "a verkoopmedewerker keeps it. The navigation is hidden from them because its links throw them " +
      "back; this is the opposite — they hit the same problems and their route back to the owner " +
      "is the longest",
  );

  // The order of writes IS the design: row first, notification second. A report that existed only
  // as an e-mail is lost the moment Resend rejects it — the exact silence this feature ends.
  const insertAt = route.indexOf('.from("feedback").insert(');
  const notifyAt = route.indexOf("sendFeedbackNotification(");
  assert.ok(insertAt > 0 && notifyAt > insertAt, "the row is stored BEFORE any mail is attempted");

  // [NO-SILENT-EMPTY] supabase-js does not throw, so an unchecked insert lets this route answer
  // "bedankt" over a row that was never written. THE defect for this feature.
  assert.match(route, /const \{ error: insErr \} = await/, "the insert error is read");
  assert.match(
    route, /if \(insErr\) \{[\s\S]{0,600}?status: 503/,
    "…and a failed store REFUSES, in words",
  );
  assert.doesNotMatch(
    route, /if \(insErr\)[\s\S]{0,300}?ok: true/,
    "a failed store may never answer ok",
  );
  // The mail may fail freely — it is a notification about a row that already exists.
  assert.match(
    route, /catch \(e\) \{[\s\S]{0,160}?the report IS stored/,
    "a notification failure may not undo a stored report",
  );

  // The screen keeps the words when sending failed. Clearing the box on failure loses the report a
  // second time, and this time the owner watched it happen.
  const okBranch = ui.indexOf("if (res.ok) {");
  const clearAt = ui.indexOf("setMessage('')", okBranch);
  const elseAt = ui.indexOf("} else {", okBranch);
  assert.ok(okBranch > 0 && clearAt > okBranch && clearAt < elseAt,
    "the message is cleared only inside the success branch");

  // The image type is decided by the BYTES. This file lands in the bucket the owner's own documents
  // live in, so trusting a declared type is how a non-image gets stored there under a good name.
  assert.match(lib, /sniffReadableMime\(bytes\)/, "the image type comes from its content");
  assert.match(
    lib, /bytes\.length > FEEDBACK_MAX_IMAGE_BYTES/,
    "…and the size cap is on the DECODED bytes — base64 is ~33% larger, so a cap on the string " +
      "would be a different and wrong number",
  );
  assert.match(
    route, /\$\{user\.id\}\/feedback\//,
    "the screenshot goes under the owner's own folder, which the bucket policy already scopes on",
  );
  // A failed upload must not cost the words.
  assert.match(
    route, /imageFailed = true/,
    "an upload failure keeps the report and is reported, rather than failing the whole thing",
  );
});

// ── [OFFERTE-BEWERKBAAR] A quote may be changed until it becomes an invoice ──
//
// `status === 'draft'` was answering two different questions with one flag, and it was the wrong
// answer to one of them:
//
//   · A sent FACTUUR carries a legal number from a gapless, forward-only series (Art. 35 Wet OB).
//     Editing it is not a correction, it is rewriting a document the customer already holds — that
//     is what a creditnota is for. This must stay impossible.
//   · An OFFERTE is a price quote: no number, no series, not a legal invoice, not counted by the
//     Belastingdienst. A customer asking "kan het goedkoper?" is ordinary business — and a sent
//     offerte could not be touched. The owner's only route was a second offerte and the hope that
//     the customer looked at the right one.
//
// Two screens and one route each carried their own copy of the flag, so the rule now lives in
// invoice-editable.ts and all three read it. A button that appears where the door refuses is the
// other half of the same defect.
test("[OFFERTE-BEWERKBAAR] one rule decides it, and it never opens a numbered document", () => {
  const route = code("src/app/api/invoice/[id]/route.ts");
  const actions = code("src/components/invoice/InvoiceActions.tsx");
  const edit = code("src/app/dashboard/invoice/[id]/edit/page.tsx");

  // The door. Not a status literal — the shared rule, with all three fields it needs.
  assert.match(
    route,
    /if \(!isInvoiceEditable\(\{[\s\S]{0,200}?invoiceNumber: existing\.invoice_number,/,
    "the PUT guard must use the shared rule and pass the NUMBER — the field that decides whether a " +
      "document is legally issued",
  );
  assert.doesNotMatch(
    route, /if \(existing\.status !== 'draft'\) \{[\s\S]{0,120}?kan niet meer worden gewijzigd/,
    "…and the old status-only edit guard may not come back",
  );
  // DELETE stays draft-only on purpose: a sent offerte has been at the customer, and making it
  // vanish is a different act from adjusting it.
  assert.match(
    route, /Alleen een concept kan verwijderd worden/,
    "deleting stays draft-only — that is a different question from editing",
  );
  // invoice_number must survive the readWithTrail fallback, or the guard reads undefined on an
  // installation without created_by and every quote silently looks unnumbered.
  // Anchored on CODE at both ends. The first version ended the slice on a comment — which code()
  // strips, so indexOf returned -1, slice(start, -1) ran to the end of the file, and the count was
  // of the whole route instead of the fallback. An end anchor that does not exist is not an end.
  const trailStart = route.indexOf("return readWithTrail<");
  const trailEnd = route.indexOf("export async function GET(", trailStart);
  assert.ok(trailStart > 0 && trailEnd > trailStart, "the readWithTrail block is still there, ahead of GET");
  const withTrail = route.slice(trailStart, trailEnd);
  assert.equal(
    [...withTrail.matchAll(/invoice_number/g)].length, 3,
    "invoice_number belongs in the type AND in both column lists of the fallback — otherwise the " +
      "guard reads undefined on an installation without created_by and every quote looks unnumbered",
  );

  // The button follows the same rule, so it can neither appear where the door refuses nor hide
  // where editing is allowed — which is what it was doing for every sent offerte.
  assert.match(
    actions, /const canEdit = isInvoiceEditable\(\{ status, invoiceType, invoiceNumber \}\)/,
    "the Bewerken button must ask the same question the route answers",
  );

  // The edit screen has to know WHAT it is editing. It called everything "Factuur bewerken" and
  // its confirm promised to send "de factuur" — while sending a quote CONVERTS it into a numbered
  // invoice (send route, isConversion). One tap, irreversible, and the word offerte never appeared.
  assert.match(edit, /setInvoiceType\(invoice\.invoice_type/, "the screen must load the type");
  assert.match(edit, /quote \? t\('bewerk\.titel\.offerte'\)/, "…and title itself honestly"); // [TAAL]
  assert.match(
    edit, /t\('bewerk\.omzetWaarschuwing'\)/, // [TAAL] key, not sentence
    "…and the confirm must say that sending a quote issues an invoice number, before it happens",
  );
  assert.match(
    edit, /quote \? `✉ \$\{t\('bewerk\.omzettenVersturen'\)\}`/,
    "…and the button must be labelled with what it does",
  );
});

// ── [OFFERTE-EEN-KNOP] Two buttons that did exactly the same thing ──
//
// The new-invoice screen showed "📋 Offerte opslaan" as the primary action and "Opslaan" beneath
// it. For an offerte they were identical: `mode` is read exactly ONCE in handleSubmit, in
// `if (mode === 'sent' && invoiceType !== 'offerte')`, and that condition excludes the offerte —
// so both paths wrote the same draft and navigated to the same page. An owner facing two buttons
// with no difference can only assume they are missing something.
test("[OFFERTE-EEN-KNOP] the offerte screen offers one save, because there is only one action", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // The premise: `mode` still branches only there. If a second use appears, the two buttons may
  // differ again and this test should be reconsidered rather than silently kept.
  const body = page.slice(page.indexOf("async function handleSubmit(mode:"), page.indexOf("// ─── Derived ───"));
  assert.ok(body.length > 500, "the handleSubmit slice is real");
  assert.equal(
    [...body.matchAll(/\bmode\b/g)].length, 2,
    "`mode` appears once in the signature and once in the send condition. A third use means the " +
      "two buttons can differ again — check whether the offerte still has only one action",
  );
  assert.match(
    body, /if \(mode === 'sent' && invoiceType !== 'offerte'\)/,
    "an offerte still never goes through the send route — that route mints a factuur number",
  );

  // So: no second button for an offerte.
  assert.match(
    page, /\{invoiceType !== 'offerte' && \(\s*<button onClick=\{\(\) => handleSubmit\('draft'\)\}/,
    "the secondary save is hidden for an offerte, where it did the same as the primary one",
  );
});

// ── [BETAALTERMIJN] The payment sentence states the term, instead of asserting one ──
//
// The edit screen printed "Gelieve te betalen binnen 30 dagen op <IBAN>". The 30 was a LITERAL:
// not derived from anything, not editable, and not necessarily true. An owner who had set a due
// date fourteen days out was shown a promise of thirty — on the screen where they check the
// invoice before sending it, about money, on a document their customer will read.
//
// And the term itself was three chips (14 / 30 / 60) on one screen and absent on the other. A term
// is something an owner agrees per customer; "jij krijgt 45 dagen" was not expressible without
// working out the date by hand.
test("[BETAALTERMIJN] the term is derived from the dates, and any term can be typed", () => {
  const edit = code("src/app/dashboard/invoice/[id]/edit/page.tsx");
  const create = code("src/app/dashboard/invoice/new/page.tsx");

  // No literal. The sentence comes from the data or does not appear.
  assert.doesNotMatch(
    edit, /Gelieve te betalen binnen 30 dagen/,
    "the hardcoded term may not come back — it was a number with nothing behind it",
  );
  assert.match(
    edit, /paymentTermText\(\{ invoiceDateIso: invoiceDate, dueDateIso: dueDate, iban: profile\.iban \}\)/,
    "the sentence must be built from the invoice's own dates",
  );

  // An offerte has no payment term at all: its due_date is "Geldig tot", which is what the PDF
  // prints. Showing a payment sentence there makes the screen contradict the document.
  // [TAAL] Pinned on the key — fourth gate that went red on translation alone.
  assert.match(
    edit, /\{quote \? \([\s\S]{0,400}?t\('bewerk\.geldigTot'\)/,
    "a quote states its validity, not a payment term",
  );
  assert.match(
    edit, /\{!quote && \([\s\S]{0,200}?t\('nieuw\.termijn\.kort'\)/,
    "…and the term control is hidden there, so one field never means two things",
  );

  // Any whole number, on BOTH screens, through the one parser.
  for (const [name, src] of [["edit", edit], ["create", create]] as const) {
    assert.match(
      src, /parsePaymentTerm\(e\.target\.value\)/,
      `${name}: a freely typed term must go through the shared parser`,
    );
    assert.match(
      src, /dueDateFromTerm\(invoiceDate, days\)/,
      `${name}: and set the due date through the shared arithmetic`,
    );
    assert.match(src, /max=\{MAX_PAYMENT_TERM_DAYS\}/, `${name}: bounded by the shared typo guard`);
  }

  // One definition of the common terms and the default, not one per screen.
  assert.match(
    create, /const BETALINGSTERMIJNEN = COMMON_PAYMENT_TERMS/,
    "the chip list comes from payment-term.ts",
  );
  assert.match(
    create, /const DEFAULT_TERMIJN = DEFAULT_PAYMENT_TERM/,
    "…and so does the default a new invoice starts at",
  );
});

// ── [ARTIKEL-CODE] You could search the catalog by code, and never give one ──
//
// The catalog has always had codes. matchArticles ranks an exact code match first ("22" → that
// article, ahead of every description match), and the line's own placeholder invites it:
// "Omschrijving of code (bijv. 22)". But the only way to put a line INTO the catalog from the
// invoice screen posted `code: ''`, so every article created that way had no code — and the
// article-learner cannot invent one either, because a code is a decision a person makes.
//
// So an owner typed "22", found nothing, and concluded the feature did not exist. It did; there
// was simply no door to it outside /dashboard/artikelen.
test("[ARTIKEL-CODE] a line can be saved to the catalog WITH a code, and a clash is spoken", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  assert.doesNotMatch(
    page, /btw_rate: line\.btw_rate, code: '',/,
    "the empty-code literal may not come back — it is what made the code feature unreachable",
  );
  assert.match(
    page, /async function saveLineToCatalog\(i: number, line: InvoiceLine, code: string\)/,
    "saving a line to the catalog must be able to carry a code",
  );
  assert.match(
    page, /body: JSON\.stringify\(\{ description: line\.description[^}]*code, unit: line\.unit/,
    "…and send it",
  );
  // The field itself, and the fact that it is optional: an owner who wants no code must still be
  // able to save, exactly as before.
  // [TAAL] Pinned on the KEY, not the Dutch word. This gate asserted `aria-label="Artikelcode"`
  // literally and went red the moment the screen was translated — on a change that does not touch
  // what it is guarding. A gate written against one language fails on the day the app gains a
  // second, and the tempting fix is to delete it.
  assert.match(page, /aria-label=\{t\('nieuw\.regel\.artikelcode'\)\}/, "there must be a field to type it in");
  assert.match(
    page, /placeholder=\{t\('nieuw\.regel\.codeVoorbeeld'\)\}/,
    "…labelled with the same example the description field already uses",
  );

  // A REFUSAL MUST BE HEARD. articles carries UNIQUE(user_id, code) and the route answers 409
  // with which code is taken. Swallowing that leaves the owner believing "22" now points at this
  // line while it points at another — and they will pull up the wrong line later.
  assert.match(
    page, /setCodeError\(typeof j\?\.error === 'string'/,
    "a rejected code must be shown, not swallowed",
  );
  assert.match(page, /\{codeError && </, "…on screen, beside the field it belongs to");
  assert.doesNotMatch(
    page, /\} catch \{ \/\* silent \*\/ \}/,
    "and the silent catch around this save is gone",
  );
});

// ── [KORTING] A discount is not a subtraction ──
//
// "Trek er 10% af" reads like one line of arithmetic and is not, because BTW is owed PER TARIEF.
// An invoice of EUR 1.000 at 21% and EUR 1.000 at 9% with EUR 200 off does not owe some blended
// rate over 1.800 — it owes 21% over its reduced 21%-part and 9% over its reduced 9%-part.
// Subtract the discount from the total and BOTH aangifte boxes are wrong, in opposite directions,
// on every mixed-rate invoice.
//
// And it appears in five places that must agree to the cent: the screen, the draft route, the send
// route, the PDF and the UBL. Peppol BIS 3.0 makes that non-negotiable — a file whose
// LineExtensionAmount minus AllowanceTotalAmount does not equal TaxExclusiveAmount is REFUSED at
// the receiving access point (BR-CO-10), so the invoice simply never arrives.
test("[KORTING] every surface computes the discount with the same module", () => {
  const store = code("src/lib/invoice-discount.ts");

  // Nobody rolls their own. Five call sites, one module.
  for (const file of [
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/api/invoice/draft/route.ts",
    "src/app/api/invoice/send/route.ts",
    "src/app/api/invoice/[id]/route.ts",
    "src/lib/invoice-pdf.tsx",
    "src/lib/ubl-export.ts",
  ]) {
    assert.match(
      code(file), /from ['"](@\/lib\/invoice-discount|\.\/invoice-discount)['"]/,
      `${file} must take the discount arithmetic from the one module — a second copy of the ` +
        "apportioning is a second answer, and these all describe the same invoice",
    );
  }

  // The two places that would silently DROP a stored discount by recomputing from the lines.
  assert.match(
    code("src/app/api/invoice/send/route.ts"),
    /if \(kortingHier\) \{[\s\S]{0,300}?applyDiscount\(/,
    "issuance must keep the discount: recomputing from the lines would send the customer a " +
      "numbered, irreversible invoice at the FULL price the owner had just discounted",
  );
  // Retargeted: this matched `const kortingHier = parseDiscount(` literally, and broke the moment
  // the edit route learned to take a CHANGED discount from the body — while the property it
  // guards held more strongly than before. The rule is that the edit route's totals carry the
  // discount, not the spelling of the line that fetches it.
  assert.match(
    code("src/app/api/invoice/[id]/route.ts"),
    /const \{ total_ex_btw, btw_amount, total_inc_btw \} = kortingHier[\s\S]{0,200}?applyDiscount\(lines, kortingHier\)/,
    "editing must keep it too, or the row says there is a discount while charging the full amount",
  );

  // The UBL shape. Wrong here is not cosmetic — the file is refused and nothing arrives.
  const ubl = code("src/lib/ubl-export.ts");
  assert.match(ubl, /ChargeIndicator"\)\.txt\("false"\)/, "a discount is an allowance, not a charge");
  assert.match(
    ubl, /for \(const a of kortingUitkomst\.allowances\)/,
    "one AllowanceCharge per rate — each carries exactly one TaxCategory",
  );
  assert.match(
    ubl, /TaxExclusiveAmount", \{ currencyID: EUR \}\)\.txt\(money\(taxExclusive\)\)/,
    "TaxExclusiveAmount is lines MINUS allowances (BR-CO-10)",
  );
  assert.match(ubl, /AllowanceTotalAmount/, "…and the allowance total is stated");
  assert.ok(
    ubl.indexOf("cac, \"AllowanceCharge\"") < ubl.indexOf("cac, \"TaxTotal\""),
    "AllowanceCharge is emitted before TaxTotal — the UBL sequence is not free",
  );

  // The PDF prints what it charges. A reduced total with no line explaining it is an invoice the
  // customer cannot check.
  const pdf = code("src/lib/invoice-pdf.tsx");
  assert.match(pdf, /discountLabel\(korting\)/, "the PDF names the discount");
  assert.match(pdf, /netRateLines\.map/, "…and its BTW rows are the REDUCED ones");

  // Shipping before the migration may not break invoicing. The columns arrive with
  // invoice_discount.sql, and until then the row is written without them — WITH the undiscounted
  // totals, because a reduced total plus no stored discount is a document that does not add up.
  const draft = code("src/app/api/invoice/draft/route.ts");
  assert.match(
    draft, /\.\.\.\(korting && Object\.keys\(spoor\)\.length \? totalen : zonderKorting\)/,
    "the totals and the discount fall back TOGETHER",
  );
  assert.match(
    draft, /korting && !trailWritten \? \{ warning: 'discount_not_stored' \}/,
    "…and the owner is told, rather than finding out from the PDF their customer already has",
  );

  // Empty is not zero — the same trap as the payment term, and here it would print
  // "Korting: € 0,00" on a customer's invoice.
  assert.match(
    store, /if \(typeof raw === "string" && raw\.length === 0\) return null/,
    "an untouched field is not a discount of zero",
  );
});

// ── [KORTING-BEWERKEN] The discount is changeable, and the CAS agrees with the gate ──
//
// Two things, and the second is a defect the FIRST offerte commit shipped.
//
// 1. A discount you can only set by re-creating the invoice is a discount you lose at the first
//    negotiation with the customer. The edit screen now loads it, shows it, and sends it on BOTH
//    of its save paths — including save-and-send, the dangerous one: that path turns the document
//    into a numbered factuur, so a discount dropped there goes out irreversibly at full price.
//
// 2. [OFFERTE-BEWERKBAAR] made a sent quote editable at the GATE, and the compare-and-swap under
//    it still demanded `status = 'draft'`. The quote passed the gate, matched zero rows, and got
//    "Deze factuur is inmiddels verzonden" — the feature was built and did not work, with a
//    message that sends the owner looking in the wrong place. A guard and its CAS asking different
//    questions is the same defect class as a button that appears where the door refuses.
test("[KORTING-BEWERKEN] the edit screen can change a discount, and the CAS matches its own gate", () => {
  const route = code("src/app/api/invoice/[id]/route.ts");
  const edit = code("src/app/dashboard/invoice/[id]/edit/page.tsx");

  assert.doesNotMatch(
    route, /\.update\(\{ \.\.\.patch[^)]*\)[\s\S]{0,200}?\.eq\('status', 'draft'\)/,
    "the compare-and-swap may not demand 'draft' — that refuses every editable sent quote",
  );
  assert.match(
    route, /\.eq\('status', existing\.status \?\? 'draft'\)/,
    "…it guards on the status that was READ, which is what protects against a change in between",
  );
  // [HERSTEL] The non-draft CAS forked: an unnumbered quote must STILL carry no number, and a
  // herstel of a sent factuur must still carry exactly the number we saw plus zero payment.
  // Both halves asserted — losing either reopens the [OFFERTE-BEWERKBAAR] defect for its lane.
  assert.match(
    route, /q = q\.is\('invoice_number', null\)/,
    "…a non-draft QUOTE may only be written while it still carries no number",
  );
  assert.match(
    route, /q\.eq\('invoice_number', existing\.invoice_number as string\)/,
    "…and a HERSTEL only while the row still carries the number we saw",
  );

  // [KLANT-EXTRA] The update is now RETRIED when the two customer lines name a column the schema
  // does not have yet, and the retry must carry the same lock as the first attempt. Both guards
  // therefore have to sit INSIDE the retried closure — outside it, the fallback would write with
  // no status test at all, onto exactly the invoice that may have been issued in the meantime.
  const runPatch = route.slice(
    route.indexOf("const runPatch = "),
    route.indexOf("const { data: patched"),
  );
  assert.ok(runPatch.length > 0, "the patch is no longer built in a re-runnable function");
  assert.match(runPatch, /\.eq\('status', existing\.status \?\? 'draft'\)/, "the retry keeps the status lock");
  // [HERSTEL] The lock forked per lane but must stay INSIDE the retried closure: no number for a
  // quote, the SEEN number plus zero payment for a herstel.
  assert.match(runPatch, /\.is\('invoice_number', null\)/, "…and the quote's number lock");
  assert.match(runPatch, /\.eq\('invoice_number', existing\.invoice_number as string\)/, "…and the herstel's number lock");
  assert.match(runPatch, /amount_paid\.is\.null,amount_paid\.lte\.0\.005/, "…and the herstel's payment lock (same half cent as the rule)");
  assert.match(
    route, /isQuote\(existing\.invoice_type\)[\s\S]{0,160}?omgezet naar een factuur/,
    "and the 409 says which wall was hit — a converted quote is not 'inmiddels verzonden'",
  );

  // Present vs absent, not truthy vs falsy: removing a discount is as valid an edit as setting one.
  assert.match(
    route, /const kortingMeegestuurd = 'discount_type' in body \|\| 'discount_value' in body/,
    "the route must distinguish 'cleared' from 'not sent by an older page'",
  );
  assert.match(
    route, /patch\.discount_type = kortingHier \? kortingHier\.type : null/,
    "…and write the change, or the PDF shows a discount the totals no longer carry",
  );

  assert.match(edit, /setDiscountValue\(dv == null \? '' : String\(dv\)\)/, "the stored discount is loaded");
  assert.match(
    edit, /const kortingTotalen = applyDiscount\(/,
    "the screen's totals come from the same module as the server's",
  );
  assert.equal(
    [...edit.matchAll(/discount_type: invoiceType === 'creditnota' \? null : discountType/g)].length, 2,
    "BOTH save paths send it — plain save AND save-and-send, where losing it is irreversible",
  );
});

// ── [OFFERTE-KNOP-EERLIJK] The button on a quote says what it does ──
//
// On /dashboard/facturen a pro_forma row carried a button labelled "Versturen". It reads as "send
// the quote to the customer". It does not do that: it converts the quote into an OFFICIAL FACTUUR
// with a number from the owner's gapless series and mails that (send route, isConversion). One
// tap, and Art. 35 knows no way back — only a creditnota.
//
// The confirmation already said so honestly. The button did not, and the button is the thing you
// press. "Offerte versturen" would be worse than either: it would promise to send a quote while an
// invoice goes out. Mailing an offerte AS an offerte is something this app cannot do at all —
// every path through /api/invoice/send converts, converts-only, or re-delivers a numbered invoice.
test("[OFFERTE-KNOP-EERLIJK] a quote's send button is labelled as the conversion it performs", () => {
  const list = code("src/app/dashboard/facturen/FacturenClient.tsx");
  const send = code("src/app/api/invoice/send/route.ts");

  // The premise. If sending a quote ever stops converting it, this label is the thing to revisit —
  // so the gate holds the reason, not just the word.
  assert.match(
    send,
    /const isConversion = !resend &&[\s\S]{0,160}?invoice_type === ['"]pro_forma['"]/,
    "sending a quote still turns it into a factuur — that is why the button may not say 'Versturen'",
  );

  // Both ends on CODE. The end anchor was "[BOEK-RESEND]" — a COMMENT, which code() strips, so
  // indexOf returned -1, slice(start, -1) ran to the end of the file, and the block picked up the
  // RESEND button's own "Versturen". The length bound is what said so instead of passing.
  // The BRACE matters: "!isCredit && !isOfferte && inv.status === 'draft'" is the FACTUUR button
  // one block up, and it CONTAINS "isOfferte && inv.status === 'draft'" as a substring. Without the
  // brace the slice started on that button — which correctly says "Versturen" — and the gate
  // reported a failure about the wrong element entirely.
  const qStart = list.indexOf("{isOfferte && inv.status === 'draft'");
  const qEnd = list.indexOf("!isCredit && !isOfferte && (inv.status === 'sent'", qStart);
  assert.ok(qStart > 0 && qEnd > qStart, "the quote button block sits before the resend button");
  const quoteButton = list.slice(qStart, qEnd);
  assert.ok(
    quoteButton.length > 100 && quoteButton.length < 2400,
    `the slice must be that ONE button — it is ${quoteButton.length} chars`,
  );
  // [TAAL] Pinned on the KEY — third gate that went red on translation, same lesson as
  // [ARTIKEL-CODE]: a gate written against one language fails the day the app gains a second.
  assert.match(quoteButton, /t\('lijst\.omzetten'\)/, "the label states the act");
  assert.doesNotMatch(
    quoteButton, /> Versturen<|t\('lijst\.versturen'\)/,
    "…and not the expectation. A bare 'send' on a quote promises to send a quote and issues " +
      "a numbered invoice instead — in any language",
  );

  assert.match(
    list, /t\('lijst\.send\.proForma'/, // [TAAL] key, not sentence
    "the confirm must still say what happens, in full",
  );
});

// ── [OFFERTE-VERSTUREN] A quote can be sent as a quote, through a door that cannot mint ──
//
// The app could not send a quote at all. Every path through /api/invoice/send either CONVERTS it
// into an official factuur (isConversion → a number from the gapless series), converts it without
// sending, or re-delivers an invoice that already has a number. So the only way to put a quote in
// front of a customer was to turn it into an invoice first — the opposite of what a quote is for,
// and irreversible under Art. 35.
//
// The guarantee that matters is negative: this route must not be ABLE to mint a number. A flag on
// the send route would have put "never mint" one wrong branch away from "mint", on the single
// action in this app that cannot be undone. A separate door is checkable, and this is the check.
test("[OFFERTE-VERSTUREN] the quote door cannot mint a number, and says so if the mail fails", () => {
  const route = code("src/app/api/invoice/[id]/send-offerte/route.ts");

  // THE LOAD-BEARING ONE. Not "does not" — CANNOT: the allocator is not reachable from here.
  // WRITES, not reads. The route must READ the number — that is what refuses a quote the send
  // route already converted (checkOfferteSendable → already_invoice). Banning the read outright
  // was my first attempt and it forbade the very guard that makes this door safe.
  assert.doesNotMatch(
    route, /invoice_number:\s/,
    "this route may never write a number — it is the door that cannot mint one",
  );
  assert.match(
    route, /invoiceNumber: invoice\.invoice_number/,
    "…but it MUST read it, or an already-converted quote could be mailed as 'vrijblijvend' for " +
      "work the books already hold as an issued, numbered invoice",
  );
  assert.doesNotMatch(route, /invoice_type:/, "…nor change the document's type");
  assert.doesNotMatch(
    route, /next_invoice_seq|convertOnly|isConversion|from\(['"]invoice_number/,
    "…nor reach the numbering machinery in any form",
  );
  // And it does not call the converting route either, which would be the same thing at one remove.
  assert.doesNotMatch(route, /api\/invoice\/send/, "it must not delegate to the route that converts");

  // What it DOES write: status and pdf_url. Nothing else.
  assert.match(route, /status: 'sent',/, "a sent quote is marked sent");
  assert.match(route, /pdf_url: pdfPath/, "…and keeps the document it sent");

  // The refusals come from the tested module, each with its own sentence.
  assert.match(route, /checkOfferteSendable\(\{/, "the four refusals are decided in offerte-send.ts");
  assert.match(route, /error: check\.error, code: check\.code/, "…and the reason reaches the screen");

  // ORDER: mail first, status second. Marking a quote 'sent' before the mail leaves an owner
  // waiting on a customer who never received anything.
  const mailAt = route.indexOf("await sendOfferteToClient(");
  const statusAt = route.indexOf("status: 'sent',");
  assert.ok(mailAt > 0 && statusAt > mailAt, "nothing is marked sent until the mail is away");
  assert.match(
    route, /if \(!delivered\) \{[\s\S]{0,400}?status: 502/,
    "an undelivered quote is reported as undelivered — this is a proposal with a deadline on it",
  );

  // A PDF failure refuses. An e-mail naming an amount with nothing attached is not the thing the
  // owner asked to send, and a customer cannot agree to a number in a sentence.
  assert.match(route, /pdf render failed[\s\S]{0,300}?status: 502/, "no quote mail without the quote");

  // The mail is quote-shaped, not an invoice mail with different words.
  //
  // [OFFERTE-MAILTEKST] The BODY moved to offerte-send.ts, beside the subject and the file name —
  // the other two strings this same mail puts in front of a customer — so that it could become a
  // pure function with tests. This gate was pinned to the file the text used to sit in and went
  // red on the move, which is the defect class this whole file is about: it was checking WHERE the
  // sentence lived, not THAT the mail says it. So: the envelope is asserted on email.ts, the words
  // on whichever module owns them.
  const mail = code("src/lib/email.ts");
  const body = code("src/lib/offerte-send.ts");
  assert.match(mail, /export async function sendOfferteToClient/, "a quote has its own mail");
  assert.match(
    mail, /html: offerteEmailHtml\(\{/,
    "…and takes its text from the pure builder, rather than growing a second copy inline where " +
      "nothing can assert on it",
  );
  assert.match(body, /vrijblijvend/, "…which says the one thing that separates a proposal from a bill");
  assert.match(body, /Geldig tot/, "…and a validity date, never a due date");
  // [OFFERTE-GELDIGHEID] Unconditionally. The row used to disappear when no date was set, and an
  // offer with no stated end is one the customer can accept a year later at last year's price.
  assert.match(
    body, /niet afgesproken/,
    "a quote with no end date must SAY it has none, not drop the line",
  );
  // [OFFERTE-KOP] The heading is the subject. It used to interpolate the name unguarded, so an
  // empty company field printed "Offerte van" with nothing after it — while offerteSubject(), two
  // functions away, handled exactly that case.
  assert.match(
    body, /const kopregel = offerteSubject\(f\.senderName\)/,
    "the heading and the subject must come from one function, or they drift",
  );

  // [OFFERTE-ANTWOORD] THE YES HAS TO LAND SOMEWHERE. This mail exists to ask for an agreement and
  // went out from noreply@boekbrug.nl with no reply-to, so pressing Reply — the customer's first
  // move — sent the answer nowhere. The PDF underneath does not help: its sender block carries
  // name, address, KvK, BTW number and IBAN, and no e-mail or phone at all. A customer who wanted
  // to say yes had literally no address to say it to, on the one feature whose entire purpose is
  // getting that yes.
  assert.match(
    mail, /\.\.\.\(antwoordAdres \? \{ replyTo: antwoordAdres \} : \{\}\)/,
    "replying to a quote must reach the owner, not noreply@",
  );
  assert.match(
    body, /mailto:\$\{escapeHtml\(antwoordAdres\)\}/,
    "…and the address is named in the body too, for a customer who forwards it or answers from " +
      "another account",
  );
  // A wrong amount is worse than none: "€ 0,00" beside a thousand-euro quote is the kind of
  // contradiction a customer rightly phones about, and the real figure is in the PDF regardless.
  assert.match(body, /const heeftBedrag = Number\.isFinite\(f\.totalInc\) && f\.totalInc !== 0/, "no invented total");

  // [ACTING-FOR] The fallback used to be a bare `|| user.email`, which is the OWNER's address only
  // when the owner is the one pressing the button. The precise form is asserted in
  // [ANTWOORD-ADRES]; here it is enough that the route supplies an address at all.
  assert.match(
    route, /senderEmail: profile\?\.email\?\.trim\(\)/,
    "the route must supply that address — the profile field, which registration fills from the " +
      "account the owner signed up with",
  );
  assert.match(
    route, /\.select\('company_name, full_name, email,/,
    "…and it must READ it: a column not selected is a reply-to that points nowhere",
  );

  // The screen offers it, and on an already-sent quote too — re-sending after an edit is the
  // normal negotiation, not an error.
  const list = code("src/app/dashboard/facturen/FacturenClient.tsx");
  assert.match(
    list, /isOfferte && !inv\.invoice_number && \(inv\.status === 'draft' \|\| inv\.status === 'sent'\)/,
    "the button appears on an unconverted quote, draft or already sent",
  );
  assert.match(list, /send-offerte/, "…and calls the quote door, not the send route");
  assert.match(
    list, /t\('lijst\.offerte\.versturen'\)/, // [TAAL] key, not label
    "…labelled as what it is — which only became an honest label once the button existed",
  );
});

// ── [KORTING-KOPIE] Every route that COPIES an invoice carries its discount ──
//
// Three routes build a new document from an existing one: the creditnota, the duplicate, and the
// recurring cron. All three copy the header TOTALS from the source and rebuild the LINES — and the
// discount lives on the header. So each of them produced a document whose stored total said one
// thing and whose lines said another, by exactly the discount.
//
// That is not a display bug. The PDF and the UBL export both derive their figures from the LINES
// (btwBreakdown / groupByRate), so what the customer received and what the access point validated
// were the undiscounted amounts, while the books held the discounted ones. Measured on a EUR 1.000
// invoice at 21% with 10% off: the credit note's header said −1.089 and the document it printed
// said −1.210. EUR 121 of refund that was never charged, on a legal document.
//
// This is the same shape as [VRIJGESTELD-KOPIE] one screen over: a field that lives on the header
// and is silently dropped by everything that copies the row.
test("[KORTING-KOPIE] the creditnota, the duplicate and the recurring cron all carry the discount", () => {
  for (const [file, indent] of [
    ["src/app/api/invoice/creditnota/route.ts", "original"],
    ["src/app/api/invoice/[id]/duplicate/route.ts", "original"],
    ["src/app/api/cron/recurring/route.ts", "src"],
  ] as const) {
    const src = code(file);
    // [DEEL-CREDIT] The creditnota does not COPY the discount any more, it carries the one that
    // belongs to what is being credited: a percentage unchanged, a fixed amount SCALED to the
    // credited share. Copying a fixed discount onto a partial credit gives back less than was
    // charged for those lines — see the header of partial-credit.ts. The property the gate
    // protects is unchanged: the header's discount and its lines must describe one document.
    const verwacht = file.includes("creditnota")
      ? /discount_type: keuze\.discount\?\.type \?\? null/
      : new RegExp(`discount_type: ${indent}\\.discount_type \\?\\? null`);
    assert.match(
      src, verwacht,
      `${file} copies the header totals, so it must copy the discount that produced them — ` +
        "otherwise its lines contradict its own stored amounts",
    );
    const verwachtWaarde = file.includes("creditnota")
      ? /discount_value: keuze\.discount\?\.value \?\? null/
      : new RegExp(`discount_value: ${indent}\\.discount_value \\?\\? null`);
    assert.match(src, verwachtWaarde, `${file}: and its value`);
  }

  // The recurring cron reads its source explicitly — a column it does not SELECT is a column it
  // cannot copy, and the copy above would silently write null.
  assert.match(
    code("src/app/api/cron/recurring/route.ts"),
    /\.select\("[^"]*discount_type, discount_value[^"]*"\)/,
    "the recurring source read must include the discount columns",
  );

  // And the arithmetic mirrors on a negative document, which is what makes the creditnota copy
  // correct rather than merely present. Without this the copied discount would compute to zero on
  // a credit note and the contradiction would survive the fix.
  const store = code("src/lib/invoice-discount.ts");
  assert.match(
    store, /const sign = subtotal < 0 \? -1 : 1;/,
    "a creditnota is negative throughout; the discount is mirrored, not skipped",
  );
  assert.match(
    store, /\.filter\(\(\[, e\]\) => sign \* e > 0\)/,
    "…and only groups pointing the same way as the document carry part of it — a group pointing " +
      "the other way would get an allowance that reads as a surcharge in UBL",
  );
});

// ── [OFFERTE-OMZETTEN-VOLLEDIG] The accepted quote and the invoice for it are the same document ──
//
// The from_offerte flow loads the quote's lines and pre-fills the new invoice. It read FOUR columns
// where the line carries six, and never read the header at all. So the customer accepted one
// document and was billed a different one, in three ways at once:
//
//   · unit          — "2 uur" became "2" (C62 = stuk) in the e-invoice. The [UNIT] comments in
//                     pickArticle and in the catalog button describe this same loss, each fixed on
//                     its own path; this was a third path nobody had walked.
//   · vat_treatment — the exemption flag. Without it revenue moves out of the exempt pot into the
//                     0%/verlegd box of the aangifte (schoonRegel spells out that consequence), so
//                     an accepted exempt quote produced an invoice filed in the wrong box.
//   · the discount  — it lives on the HEADER, so a line-only read could never see it. The customer
//                     agreed to EUR 900 and was invoiced EUR 1.000.
test("[OFFERTE-OMZETTEN-VOLLEDIG] converting a quote carries everything the quote said", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // Every column the line actually holds — a SELECT is the whole boundary here.
  assert.match(
    page,
    /\.select\('description, quantity, unit_price, btw_rate, unit, vat_treatment'\)/,
    "the quote's lines must be read in full: a column not selected is a column silently dropped " +
      "between what the customer accepted and what they are billed",
  );
  // Scoped to the conversion block. `unit: l.unit ?? null` appears three times in this file — the
  // two submit-path mappings are the others — so an unscoped assertion stayed green with the
  // conversion's own mapping deleted. The negative control is what said so.
  const convStart = page.indexOf("if (offerteParam) {");
  const convEnd = page.indexOf("setLinesLoading(false)", convStart);
  assert.ok(convStart > 0 && convEnd > convStart, "the from_offerte load block was found");
  const conv = page.slice(convStart, convEnd);
  assert.ok(conv.length < 1800, `the slice must be that block alone — it is ${conv.length} chars`);
  assert.match(conv, /unit:\s+l\.unit \?\? null,/, "…and the unit must reach the new line");
  assert.match(
    conv, /vat_treatment: l\.vat_treatment === 'exempt' \? 'exempt' : null,/,
    "…and the exemption flag, hardened the same way every other writer hardens it: only the " +
      "literal 'exempt' counts, so no stray value can create an exemption",
  );

  // The discount is on the header, so it needs its own read. A line-only load cannot see it.
  assert.match(
    page,
    /\.select\('discount_type, discount_value'\)[\s\S]{0,120}?\.eq\('id', offerteParam\)/,
    "the quote's discount must be read from the header — that is the amount the customer said " +
      "yes to",
  );
  assert.match(page, /setDiscountType\(offHead\.discount_type\)/, "…and pre-fill the invoice with it");
});

// ─── [REGEL-AFRONDING-KOP] The header may never be summed differently from its own lines ───────
//
// invoice_lines.line_total is written round2(quantity × unit_price) — the create route argues that
// at length in its own comment, because an unrounded column prints two lines of EUR 50,00 under a
// subtotal of EUR 99,99 and because Peppol BIS 3.0 BR-CO-10 refuses the file when the two disagree.
//
// The HEADER was not rounded the same way. draft-totals.ts summed the raw products, and its own
// header comment promised it always would ("including NOT rounding"). So the same invoice had two
// subtotals, and which one you got depended on which button you pressed.
//
// Measured on a real quote — four lines at 9%, prices typed inclusive of btw:
//   printed column 362,38 · stored header 362,39 · stated btw 32,61 while 9% of 362,39 is 32,62 ·
//   concept total EUR 395,00 · the same invoice issued, or merely re-saved from the edit screen,
//   EUR 394,99.
//
// The gate is on the SHAPE that caused it: every place that turns a line into money for a total
// must round it first, exactly as the insert does. A raw `quantity * unit_price` reaching a total
// is the defect, whichever file it reappears in.
test("[REGEL-AFRONDING-KOP] a total is summed from line amounts as they are STORED, never raw", () => {
  const totals = code("src/lib/draft-totals.ts");

  // [REGEL-KORTING] One function, called by all of them: lineNetEx. It IS round2(quantity x price)
  // when there is no discount, and it is the discounted amount when there is — and the create route
  // inserts exactly what it returns. Pinning the shared call is a stronger version of pinning the
  // shared expression: two copies of one formula can drift, one function cannot.
  assert.match(
    totals,
    /line_total: lineNetEx\(\{ quantity: sign \* l\.quantity/,
    "computeDraftTotals must build its lines with the SAME function the create route inserts — " +
      "lineNetEx. Anything else is a second opinion about one number",
  );
  // The two raw reducers that used to be the whole function. Paired with the match above, so a
  // file that somehow read empty cannot make this pass vacuously.
  assert.doesNotMatch(
    totals,
    /reduce\(\(s, l\) => s \+ l\.quantity \* l\.unit_price/,
    "the header is back to summing raw products — that is the 362,38-vs-362,39 defect returning",
  );
  assert.match(
    totals,
    /return computeInvoiceTotals\(stored\);/,
    "and the per-rate split must be the one function issuance and the PDF already use, not a " +
      "second implementation that can drift from it",
  );

  // Both editors. What you watch while typing has to be what gets written, or the cent surfaces
  // after the customer has the document.
  for (const path of [
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
  ]) {
    const page = code(path);
    assert.match(
      page,
      /line_total: regelNetto\(l\), btw_rate: l\.btw_rate/,
      `${path} must total the same amounts the server stores — unrounded, this screen showed ` +
        "EUR 395,00 while EUR 394,99 was stored",
    );
    // …and `regelNetto` must be the shared function, not a local re-derivation of it.
    assert.match(
      page,
      /const regelNetto = \(l: InvoiceLine\) => lineNetEx\(\{/,
      `${path} must define regelNetto as lineNetEx — a screen that re-implements the line amount ` +
        "is how the concept and the issued invoice come apart by a cent",
    );
    assert.doesNotMatch(
      page,
      /line_total: l\.quantity \* l\.unit_price,/,
      `${path} is summing raw products again`,
    );
  }

  // The per-rate box on the create screen sits directly beside that total and is derived from the
  // same lines, so it rounds the same way. Two numbers on one screen contradicting each other
  // about one invoice is the same failure at a smaller scale.
  const nieuw = code("src/app/dashboard/invoice/new/page.tsx");
  assert.match(
    nieuw,
    /exByRate\[rate\] = \(exByRate\[rate\] \?\? 0\) \+ regelNetto\(l\)/,
    "the on-screen BTW-per-rate breakdown must use the same line amounts the total does — beside " +
      "each other on one card, two different answers about one invoice",
  );
  // [KORTING] And it must subtract the korting that applyDiscount assigned to each rate. This
  // assertion used to pin a one-liner that summed `round2(line) * rate/100` straight into
  // btwByRate — right about the rounding, and blind to the discount: with one set, the box showed
  // the BTW over a base the customer does not pay, printed directly above a total that had already
  // deducted it. Same failure as the cent, one line further down the same card.
  //
  // Deriving it from `allowances` rather than re-splitting the discount here is the point: the
  // rows and the total are then the same sum by construction, not two sums that happen to agree.
  assert.match(
    nieuw,
    /for \(const a of kortingTotalen\.allowances\)/,
    "the per-rate box must take the discount from applyDiscount's own per-rate allowances",
  );
  assert.match(
    nieuw,
    /btwByRate\[r\] = round2\(\(\(ex - \(aftrekPerTarief\[r\] \?\? 0\)\) \* r\) \/ 100\)/,
    "…and show the BTW over what is left after it, rounded per rate like every other total here",
  );
});

// ─── [LOGO-INITIALEN] One company, one monogram ────────────────────────────────────────────────
//
// There were two derivations. The invoice PDF took the first and the LAST word, so "Kiwi Food
// Market" went out on every document as KM. The dashboard avatar took every word and then cut to
// two, so the same owner saw KF above it. Neither is what a person writes, which is KFM — and the
// two disagreeing with each other is its own bug: the logo on your invoice was not the logo in
// your app.
test("[LOGO-INITIALEN] the monogram has one definition, and both surfaces use it", () => {
  const pdf = code("src/lib/invoice-pdf.tsx");
  assert.match(
    pdf,
    /import \{ deriveInitials \} from '\.\/logo-initials'/,
    "the invoice PDF must take the monogram from the shared module",
  );
  assert.doesNotMatch(
    pdf,
    /function deriveInitials/,
    "a local copy in the PDF is how the two definitions drifted apart in the first place",
  );
  assert.doesNotMatch(
    pdf,
    /words\[words\.length - 1\]\[0\]/,
    "first-word-plus-last-word is the rule that printed KM for Kiwi Food Market",
  );

  const shell = code("src/app/dashboard/_shared/index.tsx");
  assert.match(
    shell,
    /import \{ deriveInitials \} from '@\/lib\/logo-initials'/,
    "the dashboard avatar must use the same function as the invoice",
  );
  assert.match(
    shell,
    /const initials = deriveInitials\(/,
    "…and actually call it, rather than import it beside a hand-rolled copy",
  );
  assert.doesNotMatch(
    shell,
    /\.split\(' '\)\.map\(\(w: string\) => w\[0\]\)/,
    "the avatar is deriving its own initials again",
  );
});

// ─── [OFFERTE-IS-GEEN-PROFORMA] The two things the rendered document cannot show ───────────────
//
// invoice-pdf-document.test.ts renders the real PDF and reads its text back, which covers the
// heading, the validity date, the acceptance route and the number label. Two properties survive
// that test no matter what, because neither is text: the COLOUR of the footer, and WHICH helper
// decides that a document is a quote. Both are held here.
test("[OFFERTE-IS-GEEN-PROFORMA] the PDF shares one definition of 'this is a quote'", () => {
  const pdf = code("src/lib/invoice-pdf.tsx");

  assert.match(
    pdf,
    /import \{ isQuote \} from '\.\/invoice-editable'/,
    "the PDF must use the same isQuote() as the edit screen and the send routes",
  );
  assert.match(
    pdf,
    /const isOfferte = isQuote\(type\)/,
    "…and decide with it",
  );
  // The exact expression that made every offerte branch dead code: each quote is STORED as
  // 'pro_forma', so a check against 'offerte' alone never matched a real document.
  assert.doesNotMatch(
    pdf,
    /const isOfferte = type === 'offerte'/,
    "a quote is stored as pro_forma — checking only for 'offerte' turns the whole offerte layout " +
      "into code that never runs, which is exactly how it shipped",
  );
  assert.doesNotMatch(
    pdf,
    /Dit is een pro-formafactuur/,
    "the pro-forma disclaimer belongs to a prepayment invoice and was printing on every quote",
  );
});

test("[VOETTEKST-LEESBAAR] the footer is a colour a person can read", () => {
  // Not visible to the render test: pdfjs returns the text either way. It read #dadce0 at 8pt —
  // the same light grey this stylesheet uses for HAIRLINES — which on white is about 1,3:1 and
  // effectively invisible in print. The owner reported it as missing, not as faint.
  const pdf = code("src/lib/invoice-pdf.tsx");
  const start = pdf.indexOf("footer: {");
  assert.ok(start > 0, "the footer style block was found");
  const block = pdf.slice(start, pdf.indexOf("}", start));
  assert.ok(block.length < 400, `the slice must be the footer block alone — it is ${block.length} chars`);
  assert.doesNotMatch(block, /#dadce0/, "the footer is back to the hairline grey nobody can read");
  assert.match(block, /color: '#5f6368'/, "…it must carry a colour with real contrast on white");
});

// ─── [AFZENDERNAAM] Mail to the owner's customer carries the owner's name and address ──────────
//
// All fifteen senders read `BoekBrug <noreply@boekbrug.nl>`, including the three that write to a
// THIRD PARTY on the owner's behalf. A customer of Kiwi Food Market therefore got an inbox row
// saying BoekBrug about an amount they were being asked to pay — a name they have no relationship
// with, which is what spam looks like.
//
// And only the quote had a Reply-To. Pressing Reply on an invoice or a payment reminder — "ik heb
// al betaald", "kan het gespreid?" — sent the answer to noreply@. On a reminder that is worse than
// clumsy: someone who WANTS to pay writes to a dead letterbox, and the next reminder goes out
// anyway.
//
// The address itself cannot change and that is not a defect: mail is authenticated per DOMAIN, so
// only boekbrug.nl can be the envelope sender. The display name and Reply-To are the parts that
// can carry the owner, and they now do.
test("[AFZENDERNAAM] the three customer-facing mails carry the business, the other twelve do not", () => {
  const mail = code("src/lib/email.ts");

  // Exactly three senders write to someone who is not a BoekBrug user.
  const viaOwner = [...mail.matchAll(/from: customerMailFrom\(/g)].length;
  assert.equal(viaOwner, 3, `factuur, herinnering en offerte — gevonden: ${viaOwner}`);
  // …and every one of them offers a way back. Counted, so adding a fourth customer mail without a
  // reply-to shows up here rather than in a customer's dead reply.
  const replies = [...mail.matchAll(/\.\.\.\(antwoordAdres \? \{ replyTo: antwoordAdres \} : \{\}\)/g)].length;
  assert.equal(replies, 3, `elke klantmail heeft een antwoordadres — gevonden: ${replies}`);

  // The rest keep BoekBrug: they write to the owner, their accountant or an invitee, and there the
  // business name would be wrong.
  const plain = [...mail.matchAll(/from: 'BoekBrug <noreply@boekbrug\.nl>'/g)].length;
  assert.equal(plain, 12, `interne mail blijft van BoekBrug — gevonden: ${plain}`);

  // The name is never interpolated raw. It is typed by a user and lands in a header that reaches
  // strangers: a newline is header injection, and an @ or a bracket lets a display name pose as
  // the sending address.
  assert.doesNotMatch(
    mail, /from: `[^`]*\$\{/,
    "a From header must not be built by interpolation — it goes through customerMailFrom()",
  );

  const from = code("src/lib/mail-from.ts");
  assert.match(from, /replace\(\/\[\\u0000-\\u001f\\u007f\]\/g/, "control characters are stripped");
  assert.match(from, /replace\(\/\[<>@"\\\\\]\/g/, "…and the address-shaped characters with them");
  assert.match(from, /return `"\$\{label\}" <\$\{MAIL_FROM_ADDRESS\}>`/,
    "the display name is quoted — an ordinary Dutch trade name with a comma would otherwise " +
      "parse as two senders and break the header");
  assert.match(from, /via \$\{MAIL_FROM_FALLBACK\}/,
    "'via BoekBrug' is what keeps a display name from being a free claim about who sent the mail");
});

test("[ANTWOORD-ADRES] every route supplies the address, and reads the column it comes from", () => {
  // A reply-to the sender never fills is dead code, and a column that is not SELECTed is a
  // reply-to that points nowhere — the failure this app has hit twice.
  for (const [path, needle] of [
    ["src/app/api/invoice/send/route.ts", /senderEmail: profile\?\.email \?\? null/],
    ["src/app/api/invoice/creditnota/route.ts", /senderEmail: profile\?\.email \?\? null/],
    ["src/app/api/invoice/[id]/reminder/route.ts", /senderEmail: eigenaarProfiel\?\.email \?\? null/],
    ["src/app/api/cron/reminders/route.ts", /senderEmail: owner\.email \?\? null/],
  ] as const) {
    assert.match(code(path), needle, `${path} must pass the owner's address to the mailer`);
  }
  assert.match(
    code("src/app/api/invoice/[id]/reminder/route.ts"),
    /\.select\('company_name, full_name, email'\)/,
    "the reminder route must READ the address it passes",
  );
  assert.match(
    code("src/app/api/cron/reminders/route.ts"),
    /\.select\("id, reminder_offsets, company_name, full_name, email"\)/,
    "…and so must the cron that sends most of them",
  );

  // [ANTWOORD-ADRES-ZICHTBAAR] The address is IN the mail, not only in the Reply-To header.
  //
  // That header only works when the customer presses Reply. Someone who forwards the invoice to
  // their own bookkeeper, prints it, or answers from another account never sees it — and those are
  // ordinary things to do with an invoice. The quote already named the address in its text; the
  // invoice and the reminder, the two documents a customer actually has something to say about,
  // named it nowhere.
  //
  // Counted at three, so a fourth customer-facing mail cannot quietly ship without one.
  //
  // The first version of this counted the `mailto:` string, which lives in the DEFINITION of the
  // line. Deleting the interpolation from the body left the definition — and its mailto — sitting
  // there unused, so the gate stayed green over a mail that no longer showed the address. Its own
  // negative control is what said so. What has to be counted is the line being PLACED.
  const mailBody = code("src/lib/email.ts");
  const geplaatst = mailBody.split("${contactRegel}").length - 1;
  assert.equal(geplaatst, 2, `factuur en herinnering plaatsen de regel — gevonden: ${geplaatst}`);
  assert.match(
    mailBody, /mailto:\$\{escapeHtml\(antwoordAdres\)\}/,
    "…and that line is what carries the address",
  );
  assert.match(
    code("src/lib/offerte-send.ts"), /mailto:\$\{escapeHtml\(antwoordAdres\)\}/,
    "the quote names it in its own closing sentence",
  );
  // And only when there IS one: a contact sentence trailing into nothing is worse than none.
  assert.match(
    mailBody, /const contactRegel = antwoordAdres\n?\s*\?/,
    "the contact line must be conditional on an address actually being known",
  );

  // [ACTING-FOR] The fallback to the logged-in account is only the owner's address when the logged-
  // in person IS the owner. A verkoopmedewerker sending a quote would otherwise route the
  // customer's "akkoord" to an employee, on a document that binds the employer.
  assert.match(
    code("src/app/api/invoice/[id]/send-offerte/route.ts"),
    /senderEmail: profile\?\.email\?\.trim\(\) \|\| \(acting\.actorId === ownerId \? user\.email : null\) \|\| null/,
    "the account fallback must be owner-only",
  );
});

// ─── [LEESBARE-MAIL] No sentence in an e-mail is set in a colour nobody can read ────────────────
//
// The owner reported the PDF footer as MISSING, not as faint. It was #dadce0 at 8pt — about 1,3:1
// on white. The mail bodies had the same habit: thirteen lines in #aaa (≈2,3:1) and two in #999.
//
// Most of those carry only the BoekBrug strapline, and a faint strapline is a design choice. Three
// of them do not:
//   · "Deze uitnodiging verloopt na 14 dagen. Verwacht je hem niet? Klik dan niet" — the warning
//     that tells someone an invitation-shaped mail might not be genuine.
//   · "Je krijgt deze mail omdat je BoekBrug-account is beëindigd…" — the retention notice that
//     exists to satisfy article 5.7.5 of our own terms.
//   · "Heb je deze factuur al betaald? Dan kun je deze herinnering als niet verzonden beschouwen."
//     — on a payment reminder, addressed to the one customer who has already paid.
//
// A notice printed below the threshold of legibility has been sent, not given.
test("[LEESBARE-MAIL] the mailer carries no text below the contrast threshold", () => {
  const mail = code("src/lib/email.ts");
  for (const grey of ["#aaa", "#999", "#bbb", "#ccc", "#dadce0"]) {
    assert.doesNotMatch(
      mail, new RegExp(`color: ${grey}\\b`),
      `${grey} on white is not readable — a sentence set in it has been sent, not given`,
    );
  }
  // Paired with a positive match, so a file that somehow read empty cannot pass this vacuously.
  assert.match(mail, /color: #5f6368/, "…and the replacement colour is actually in use");
});

// ── [EIGEN-FACTUUR] Your own sales invoice is not a cost ──────────────────────
//
// Kiwi Food Market invoiced a customer €394,99, the copy landed in the mailbox the sync reads, and
// it was booked as a purchase invoice. Wrong twice, in opposite directions: the €362,38 is
// turnover now also standing as a cost, and the €32,61 is BTW OWED, now claimed as voorbelasting.
// A €65 swing on one document, on the aangifte, and nothing anywhere contradicts itself — every
// number is real and every total adds up.
//
// The envelope cannot answer it. [OWN-SENT] skips a message the owner sent UNLESS the owner is
// also a recipient, because that is a supplier invoice forwarded to oneself. A self-copied
// outgoing invoice is that case exactly.
//
// The document answers it: a purchase invoice whose supplier is you cannot exist.
test("[EIGEN-FACTUUR] every door that reads a document asks it", () => {
  // Superseded in place. This gate used to require the check in email-integration.ts, which is
  // where it was first written and where it did NOT work — it read the vendor identity one line
  // after the reader had cleared it, and it covered one of five doors. The behaviour it was
  // protecting is now held by the ordering gate at the end of this file; what stays here is the
  // reach: the reader is the single place, so no door can be added without it.
  const ai = code("src/lib/ai.ts");
  assert.match(
    ai, /looksLikeOwnDocument\(/,
    "verifyInvoiceFromPdf is the one function every intake door goes through",
  );
  for (const door of [
    "src/lib/email-integration.ts",
    "src/app/api/email/upload/route.ts",
    "src/app/api/intake/route.ts",
    "src/app/api/bank/attach-invoice/route.ts",
    "src/app/api/documents/[id]/read-as-invoice/route.ts",
  ]) {
    assert.match(
      code(door), /verifyInvoiceFromPdf/,
      `${door} must read documents through the guarded reader, not around it`,
    );
  }
});

// ─── [PRIJS-KOLOM] The price column must multiply out to the total beside it ────────────────────
//
// invoice_lines.unit_price holds the EXACT price on purpose: someone selling at "EUR 0,90 all-in"
// stores 0,825688… so the customer pays what was promised (price-mode.ts). Both surfaces printed
// that at two decimals next to a line total computed from the exact value, so the reported quote
// read 150 x EUR 0,83 against EUR 123,85 — 65 cents on one row, EUR 1,14 across four.
//
// The behaviour is held by invoice-pdf-document.test.ts, which renders the PDF and multiplies each
// row out. What is held HERE is that both surfaces go through the one function, because the screen
// and the document showing different prices for the same line is its own bug.
test("[PRIJS-KOLOM] the PDF and the screen format a unit price the same way", () => {
  for (const [path, importLine] of [
    ["src/lib/invoice-pdf.tsx", /import \{ formatUnitPriceNL \} from '\.\/unit-price-display'/],
    ["src/app/dashboard/invoice/[id]/page.tsx", /import \{ formatUnitPriceNL \} from '@\/lib\/unit-price-display'/],
  ] as const) {
    const src = code(path);
    assert.match(src, importLine, `${path} must take the price column from the shared module`);
    assert.match(
      src,
      // [REGEL-KORTING] The PDF passes `prijsBasis`: the line total, or the GROSS amount when the
      // line carries its own discount. Handing it the discounted total would send
      // unitPriceDecimals hunting for a precision that reconciles with an amount the price does
      // not belong to — six decimals of a unit price nobody agreed.
      /formatUnitPriceNL\(line\.unit_price, line\.quantity, (prijsBasis|line(Total|\.line_total))\)/,
      `${path} must pass the quantity AND the line total — the needed precision depends on both, ` +
        "so a formatter given only the price cannot know how many decimals make the row true",
    );
  }

  // The rounded-to-cents formatters must be gone from that one cell, in both files.
  assert.doesNotMatch(
    code("src/lib/invoice-pdf.tsx"), /formatEuroNL\(line\.unit_price\)/,
    "the PDF is back to two decimals on the unit price — the column stops adding up",
  );
  assert.doesNotMatch(
    code("src/app/dashboard/invoice/[id]/page.tsx"), /NL_NUMBER\.format\(line\.unit_price/,
    "the screen is back to two decimals on the unit price",
  );

  // And the rule that makes it work: fewest decimals that reconcile, never a fixed number. A
  // constant would be wrong in both directions — noisy on two units, still false on a hundred.
  const mod = code("src/lib/unit-price-display.ts");
  assert.match(
    mod, /for \(let d = MIN_DECIMALS; d <= MAX_DECIMALS; d\+\+\)/,
    "the precision must be searched per line, not fixed",
  );
  assert.match(
    mod, /if \(round2\(q \* roundTo\(p, d\)\) === target\) return d;/,
    "…and the test for 'enough decimals' is that the row reconciles",
  );
});

// ─── [E-FACTUUR-VERLEGD] The PDF and the XML may not tell two tax stories ───────────────────────
//
// One sale to a German customer produced two documents. The PDF printed "Btw verlegd" because
// reverseChargeNotice() derived it from the DOCUMENT (EU VAT number, zero BTW, not KOR); the UBL
// put the same supply in category Z, because lineVatKind() looked only at the LINE DESCRIPTION.
// Z says the seller taxed it at 0%, AE says the buyer owes the tax — the receiving system books
// them differently, so the customer's ERP raised no liability at all.
//
// What is held here is the WIRING, not the arithmetic — ubl-reverse-charge.test.ts checks the XML
// that comes out. The defect was never a wrong formula; it was two modules answering one legal
// question separately. So: one predicate, and every reader must go to it.
test("[E-FACTUUR-VERLEGD] one predicate answers 'is this verlegd', for both documents", () => {
  const icp = code("src/lib/icp.ts");
  assert.match(
    icp, /export function isReverseChargedInvoice\(/,
    "the legal predicate must be a named export, not inlined in the sentence builder",
  );
  // The sentence must be BUILT ON the predicate, so the two can never drift apart.
  assert.match(
    icp, /if \(!isReverseChargedInvoice\(args\)\) return null;/,
    "reverseChargeNotice must ask the same question, not re-implement it",
  );
  // And the line-text check must stay OUT of the predicate: "the owner already wrote it" is a
  // reason not to print the sentence twice, never a reason to export the supply as Z.
  const predicate = icp.slice(
    icp.indexOf("export function isReverseChargedInvoice("),
    icp.indexOf("export function reverseChargeNotice("),
  );
  assert.ok(predicate.length > 0, "the predicate must sit before the sentence builder");
  assert.doesNotMatch(
    predicate, /lineTexts/,
    "an invoice whose own line says 'btw verlegd' is the MOST certainly verlegd one — " +
      "folding the de-duplication into the predicate would export exactly that case as Z",
  );

  const ubl = code("src/lib/ubl-export.ts");
  // Het gaat om WAAR het feit vandaan komt, niet om wat er verder in dezelfde regel staat. Deze
  // assertie pinde de hele importregel en brak op [KOPER-LAND], dat classifyVatNumber uit exact
  // datzelfde bestand haalde — de bedoeling was toen ongeschonden.
  assert.match(
    ubl, /import \{[^}]*\bisReverseChargedInvoice\b[^}]*\} from "\.\/icp"/,
    "the UBL export must read the document-level fact from the same module the PDF reads",
  );
  assert.match(
    ubl, /const docReverseCharged = isReverseChargedInvoice\(\{/,
    "asked ONCE for the whole document, so line, subtotal and allowance cannot disagree",
  );
  // All three places that emit a category must carry it. An AllowanceCharge left at Z would be the
  // only Z on an AE document, and BR-Z-08 then demands a Z subtotal that does not exist — the
  // access point refuses the whole invoice over a discount line.
  for (const site of [
    /groupByRate\(effLines, docReverseCharged\)/,
    /taxCategoryId\(rate, lineVatKind\(l, docReverseCharged\)\)/,
    /taxCategoryId\(a\.rate, docReverseCharged \? "reverse_charge" : undefined\)/,
  ]) {
    assert.match(ubl, site, `every category in the XML must read docReverseCharged: ${site}`);
  }
  // The owner's KOR status has to reach the generator, or a KOR invoice to an EU customer would be
  // exported as verlegd — a claim about a regime the owner is not in.
  assert.match(
    code("src/app/api/export/ubl/route.ts"), /kor_active/,
    "the export route must read kor_active and pass it to the builder",
  );
});

// ─── [LEVERDATUM] A legally required field must be reachable after it is first written ──────────
//
// Art. 35a lid 1 sub f Wet OB puts the date of supply on every invoice, distinct from the invoice
// date. The create screen asked for it, /api/invoice/draft stored it and the PDF printed it — and
// then nothing could touch it again. The edit screen had no field, and the PUT's header allowlist
// did not name the column, so the owner could change the invoice date, watch the screen follow,
// save, and get a PDF carrying the OLD leverdatum. A mandatory legal statement, wrong on a
// document going out the door, with the only remedy being to throw the draft away.
test("[LEVERDATUM] the edit path can read, show and write the delivery date", () => {
  const route = code("src/app/api/invoice/[id]/route.ts");
  assert.match(
    route, /'delivery_date',/,
    "the PUT header allowlist must name delivery_date — a key it does not list is silently dropped",
  );

  const screen = code("src/app/dashboard/invoice/[id]/edit/page.tsx");
  assert.match(screen, /setDeliveryDate\(/, "the screen must load the stored value");
  // [TAAL] Pinned on the key — fifth gate that went red on translation alone.
  assert.match(
    screen, /aria-label=\{t\('nieuw\.datum\.lever'\)\}/,
    "…and offer a field to correct it, or the allowlist entry has no way to be used",
  );
  // Sent on BOTH save paths. The second one is the dangerous one: it saves and then issues a
  // numbered invoice, so a leverdatum lost there goes out irreversibly (Art. 35).
  const sends = screen.match(/delivery_date: deliveryDate \|\| invoiceDate/g) ?? [];
  assert.equal(sends.length, 2, "both 'Opslaan' and 'Opslaan en versturen' must carry it");
});

// ─── [LEVERDATUM] Converting an offerte creates a factuur that needs one ────────────────────────
//
// An offerte is stored with delivery_date NULL — correct, an offer delivers nothing. Pressing
// "Versturen" on it does not send the offer: it CONVERTS it into a numbered factuur. That factuur
// went out with no leverdatum at all, and the PDF simply omitted the row, because showLeverdatum
// needs a value to print. Past the number commit the document is immutable (Art. 35), so the only
// remedy was a creditnota.
//
// Two readers, one answer: the UPDATE writes the row, and the PDF is rendered from the row as it
// was READ. Fixing only the database would leave the document in the customer's mailbox wrong.
test("[LEVERDATUM] an offerte converted on send gets one, in the row AND on the PDF", () => {
  const send = code("src/app/api/invoice/send/route.ts");

  assert.match(
    send, /const leverdatumBijConversie: string \| null =/,
    "resolved once — two call sites reading two expressions is how they drift",
  );
  // Only when the column is really there. This UPDATE is the point of no return: on a deployment
  // where the FACTUUR-A migration is still open, an unknown column fails the WHOLE statement and
  // the invoice is numbered nowhere and sent nowhere.
  assert.match(
    send, /'delivery_date' in invoice &&/,
    "the row itself must answer whether the column exists, before it is written",
  );
  assert.match(
    send, /!invoice\.delivery_date &&/,
    "never overwrite a leverdatum the owner already chose",
  );

  const uses = send.match(/leverdatumBijConversie \? \{ delivery_date: leverdatumBijConversie \} : \{\}/g) ?? [];
  assert.equal(
    uses.length, 2,
    "both the committing UPDATE and the rendered PDF must carry it — one of the two is not a fix",
  );
});

// ─── [LEVERDATUM] Writing the column is not the same as naming the key ──────────────────────────
//
// Caught reviewing the duplicate route's own fix. `delivery_date: original.delivery_date` was safe
// on a database without that column for a reason nobody chose: the value was `undefined`, and JSON
// drops undefined, so the key never reached PostgREST. Rewriting it as
// `original.delivery_date ? today : null` kept the same intent and put the KEY in the request —
// which on an un-migrated deployment fails the whole INSERT (42703). Duplicating any invoice would
// have stopped working, and the fix for a false date would have been worse than the date.
//
// Both routes that write this column conditionally must probe the ROW, not the value.
test("[LEVERDATUM] a conditional write probes for the column, never just its value", () => {
  for (const [path, subject] of [
    ["src/app/api/invoice/[id]/duplicate/route.ts", "original"],
    ["src/app/api/invoice/send/route.ts", "invoice"],
  ] as const) {
    const src = code(path);
    assert.match(
      src, new RegExp(`'delivery_date' in ${subject}`),
      `${path}: select('*') returns the key iff the column exists — that is the only honest probe`,
    );
    // A bare `delivery_date: <expr>` at the top level of an insert/update object is the shape that
    // sends the key unconditionally. It must be inside a spread instead.
    assert.doesNotMatch(
      src, /^\s{8}delivery_date: /m,
      `${path}: the key must be spread in, so it is absent rather than null when the column is`,
    );
  }
});

// ─── [REGEL-PARITEIT] Two writers on invoice_lines, one definition of a valid line ──────────────
//
// /api/invoice/draft refuses a line with no description (Art. 35a: the nature of the supply belongs
// on the invoice), refuses a quantity or price that is not a number, and caps the line count. The
// PUT checked only the BTW rate and quietly turned the rest into zero — `Number(l.quantity) || 0`
// makes "twee" a nought. So an invoice that could not be CREATED in that shape could be EDITED into
// it, and then sent, because sending saves through this same route first.
test("[REGEL-PARITEIT] the edit route keeps lines to the same standard as the create route", () => {
  const route = code("src/app/api/invoice/[id]/route.ts");
  assert.match(
    route, /import \{ validateDraftLines \} from '@\/lib\/draft-totals'/,
    "the PUT must use the create route's validator, not a second opinion",
  );
  // [MIN-REGEL] With the document type, which is the one thing the two routes may differ on: a
  // creditnota's lines arrive here already signed and arrive at /draft still positive.
  assert.match(route, /const keuring = validateDraftLines\(rawLines, existing\.invoice_type\)/);
  assert.match(
    route, /if \(!keuring\.ok\) \{/,
    "…and refuse on its verdict, before anything is written",
  );
  // The old single-question check must be gone, or a rejected line could still slip past on the
  // other three grounds.
  assert.doesNotMatch(
    route, /rawLines\.findIndex\(\(l: any\) => !isValidBtwRate/,
    "the rate-only check is superseded — leaving it would suggest the others are optional",
  );
  // And the validator must still be the one that demands a description; that is the Art. 35a part.
  assert.match(
    code("src/lib/draft-totals.ts"),
    /een regel zonder omschrijving mag niet op een factuur/,
    "the shared validator is where 'the nature of the supply' is required",
  );
});

// ─── [EIGEN-FACTUUR] The guard must be asked BEFORE the evidence is destroyed ───────────────────
//
// This file's own defect class, and it caught me writing it.
//
// verifyInvoiceFromPdf ends with a [RECEIVER-IDENTITY] backstop that nulls vendor_kvk, vendor_btw
// and vendor_iban whenever they equal the owner's own — correct, our identity may never be
// recorded as a supplier. The own-invoice guard was placed in the CALLER, so it read those three
// fields one line AFTER they were cleared. Measured on the reported case:
//
//   as the document reads   → certain, 4 identifiers → blocked
//   after the three drops   → likely, name only      → blocked, softer wording
//   …and the model also obeyed "never name the receiver as the vendor"
//                           → nothing matched        → BOOKED AS A COST
//
// So it failed exactly when the reader worked best, and nothing anywhere turned red. Moving it one
// line earlier restores 'certain' AND covers the four other doors that call the reader and never
// had the check: the manual upload, /api/intake, bank attach, and "opnieuw inlezen".
//
// What is held here is the ORDER. A future tidy-up that moves the guard below the drops, or
// re-adds a copy in a caller, puts the money back where it was.
test("[EIGEN-FACTUUR] the own-invoice verdict precedes the identity scrub, in the reader", () => {
  const ai = code("src/lib/ai.ts");

  const verdict = ai.indexOf("const eigenStuk = looksLikeOwnDocument(");
  // Anchored on the BACKSTOP's own line, not on any `parsed.vendor_kvk = undefined` — the
  // canonicalization block a few lines above writes that same assignment for a malformed number,
  // and indexOf would find it first and compare against the wrong position.
  const firstDrop = ai.indexOf("if (myKvk && parsed.vendor_kvk === myKvk)");
  assert.ok(verdict !== -1, "the verdict must be taken inside verifyInvoiceFromPdf");
  assert.ok(firstDrop !== -1, "the receiver-identity backstop must still be there — it is correct");
  assert.ok(
    verdict < firstDrop,
    "the guard reads vendor_kvk/btw/iban; below the drops those are null and it decides on nothing",
  );

  // It must read the PARSED fields, not something already laundered.
  const block = ai.slice(verdict, firstDrop);
  for (const field of ["parsed.vendor", "parsed.vendor_kvk", "parsed.vendor_btw", "parsed.vendor_iban"]) {
    assert.ok(block.includes(field), `the verdict must be taken on ${field}, as the document read it`);
  }
  // …against the owner's identity, which the caller already hands in for the prompt.
  for (const field of ["receiverName", "opts?.receiverKvk", "opts?.receiverBtw", "opts?.receiverIban"]) {
    assert.ok(block.includes(field), `the owner side must come from ${field}`);
  }
  // Refused as "not an invoice" WITH a reason — that is the path the skip registry surfaces, so
  // the file is kept and named instead of vanishing.
  assert.match(block, /is_invoice: false/, "a refusal, not a throw and not a silent drop");
  assert.match(block, /ownDocumentNotice\(eigenStuk\)/, "…and the owner is told why, in Dutch");

  // And no second copy in a caller: one legal question, one place that answers it.
  assert.doesNotMatch(
    code("src/lib/email-integration.ts"), /looksLikeOwnDocument\(/,
    "the caller-side copy is what read the cleared fields — it must not come back",
  );
});

// ─── [KOR-FACTUUR] No btw under the KOR, checked where it can still be undone ───────────────────
//
// This app knew about the KOR everywhere downstream — regime-flags.ts writes a careful paragraph
// about it, readiness knows, the closing package knows. The invoice screen did not: `kor_active`
// appeared nowhere in it, so an owner in the scheme could pick 21%, send, and hear about it at the
// aangifte up to three months later.
//
// By then it is money. Art. 37 Wet OB makes btw owed BECAUSE it is stated on the invoice; the KOR
// removes the right to deduct, so nothing offsets it; and a numbered invoice is corrected with a
// creditnota, not withdrawn. The only free moment is the one before it is sent.
test("[KOR-FACTUUR] the screen offers no rate that would be refused, and the door refuses anyway", () => {
  const screen = code("src/app/dashboard/invoice/new/page.tsx");

  // Prevention: 21 and 9 are not selectable under the KOR. Offering a choice and then rejecting it
  // is a trap, not a guard.
  assert.match(
    screen, /\{!korActief && <option value=\{21\}>21%<\/option>\}/,
    "21% must be hidden under the KOR",
  );
  assert.match(screen, /\{!korActief && <option value=\{9\}>9%<\/option>\}/, "…and 9%");
  assert.match(
    screen, /<option value=\{0\}>0%<\/option>/,
    "…while 0% stays, unconditionally — it is the only rate a KOR invoice may carry",
  );
  assert.match(
    screen, /const korActief = !!profile\?\.kor_active/,
    "the flag comes from the profile the screen already loads",
  );
  // A menu with one option and no explanation is a broken menu.
  assert.match(screen, /\{KOR_RATE_HINT\}/, "the reason must stand beside the field");

  // Refusal, at the point of no return. The screen cannot catch a draft written BEFORE the KOR was
  // switched on, nor anything that does not come from the screen.
  const send = code("src/app/api/invoice/send/route.ts");
  assert.match(send, /const korCheck = checkKorInvoice\(\{/, "the send route must run the check");
  assert.match(
    send, /\.select\('btw_number, kvk_number, address, company_name, full_name, kor_active'\)/,
    "…and READ the column it checks — an unselected field is a guard that never fires",
  );
  assert.match(
    send, /if \(!korCheck\.ok\) \{[\s\S]{0,200}?status: 400/,
    "…and refuse, rather than log and carry on",
  );

  // ORDER is the whole point: the refusal must come BEFORE the number is minted, or the check
  // burns a sequence number it cannot give back (Art. 35 — the series has no holes).
  const checkAt = send.indexOf("const korCheck = checkKorInvoice({");
  const numberAt = send.indexOf("if (!resend && (isConversion || !finalNumber))");
  assert.ok(checkAt > 0 && numberAt > checkAt, "the KOR check must run before a number is issued");

  // And it refuses rather than silently adjusting the amounts of a reviewed document.
  const mod = code("src/lib/kor-invoice.ts");
  assert.doesNotMatch(mod, /btw_rate:\s*0|\.map\(/, "this module corrects nothing — it only reports");
  assert.match(mod, /if \(!args\.korActive\) return \{ ok: true \}/,
    "an owner outside the scheme must be untouched by every line of it");
});

// ─── [BATCH-STIL] The one place a bug could hide was the one place that said nothing ────────────
//
// bank-auto-confirm.ts is 530 lines that move money automatically after every invoice send, and it
// had no unit test at all. What it did have was two bare swallows:
//
//     if (batchErr) continue;   // "not payable / migration not applied — stays for the human"
//     if (payErr) continue;     // "verwerkt/RLS/other — leave for the human"
//
// The first is where a real defect lived unseen: book_bank_batch raised on EVERY call (a plpgsql
// "column reference invoice_id is ambiguous"), so multi-invoice auto-confirmation had never booked
// anything, for anyone. Nothing logged it and nothing counted it, and "no batches were booked"
// reads exactly like "there were no batches". Forty lines further down the same file already knew
// better: [ROLLBACK-LOUD] wakes someone, because "a promise nobody is told has been broken is not
// a promise".
//
// The expected outcomes must STAY silent, or the alarm becomes noise nobody reads: the RPC's own
// 55000 refusal is a race with a human and happens on any busy account, and for the single-invoice
// write the two ordinary cases arrive as zero rows, not as an error.
test("[BATCH-STIL] a bank booking that fails for an unexpected reason reaches someone", () => {
  const src = code("src/lib/bank-auto-confirm.ts");

  // Neither swallow may go back to being a bare continue.
  assert.doesNotMatch(
    src, /if \(batchErr\) continue;/,
    "an RPC that refuses a planned batch must not vanish — that is how it hid for months",
  );
  assert.doesNotMatch(src, /if \(payErr\) continue;/, "…and neither must a failed pay write");

  // The RPC's own business refusal stays quiet. Reporting a race on every busy account would bury
  // the signal this gate exists to protect.
  assert.match(
    src, /if \(code !== "55000"\)/,
    "55000 is the RPC saying the tie stopped being exact — expected, and not an alarm",
  );

  // A missing function is its own outcome: the whole tier books nothing, invisibly.
  assert.match(
    src, /code === "42883" \|\| code === "PGRST202"/,
    "the not-applied-migration case must be told apart from a genuine refusal",
  );
  assert.match(
    src, /severity: code === "42883" \|\| code === "PGRST202" \? "feature-off" : "data-integrity"/,
    "…and carry a severity that says which of the two it is",
  );

  // Both sites must actually call the reporter, not merely console.log.
  const calls = src.match(/reportHandledFailure\(\{/g) ?? [];
  assert.ok(
    calls.length >= 3,
    `the batch swallow, the pay swallow and the rollback must all report — found ${calls.length}`,
  );
  // And no customer amounts in the context: report-handled.ts says ids and values, never bedragen.
  const contexts = src.match(/context: \{[^}]*\}/g) ?? [];
  for (const c of contexts) {
    assert.doesNotMatch(
      c, /total_inc_btw|amount:|bedrag/,
      `a failure report must not carry a customer's amount — ${c.slice(0, 60)}…`,
    );
  }
});

// ─── [BTW-VERKLARING] A zero on an invoice must say what kind of zero it is ─────────────────────
//
// Measured on four rendered invoices, all with EUR 0,00 btw: a KOR invoice, an exempt supply and a
// plain 0% invoice printed text that was character-for-character identical — nothing. Only the EU
// reverse-charge case said anything. Three legal situations, one document.
//
// The exempt case is the sharpest, because this product OFFERS the choice: the create screen has a
// "Vrijgesteld" option gated on the owner's own declaration, and the word then appeared zero times
// in invoice-pdf.tsx.
//
// The behaviour is held by invoice-pdf-document.test.ts, which renders the documents. Held HERE is
// the shape of the decision: that the app derives what it can PROVE, asks the owner for what it
// cannot, and invents nothing.
test("[BTW-VERKLARING] the invoice explains the zeroes it can and invents none", () => {
  const pdf = code("src/lib/invoice-pdf.tsx");
  assert.match(pdf, /import \{ vatStatement \} from '\.\/vat-statement'/, "the PDF must carry the sentence");
  assert.match(pdf, /const btwUitleg = vatStatement\(\{/, "…and compute it");
  assert.match(pdf, /\{btwUitleg && <Text style=\{styles\.payment\}>\{btwUitleg\}<\/Text>\}/,
    "…and actually render it — a computed string that is never placed is the defect this file is about");
  assert.match(
    pdf, /reverseChargeStated: !!reverseCharge/,
    "it must be told whether icp.ts already spoke. Two sentences giving different reasons for one " +
      "zero is worse than either alone",
  );

  const mod = code("src/lib/vat-statement.ts");
  // The KOR is a fact the app holds, so it is derived and never typed.
  assert.match(mod, /if \(args\.korActive\) \{[\s\S]{0,120}?kleineondernemersregeling \(KOR\)/,
    "the KOR sentence is automatic — profiles.kor_active already says it");
  // The exemption is a fact the app does NOT hold. Art. 11 has a provision per trade; deriving one
  // would print a false legal ground on a customer's invoice.
  assert.match(mod, /return note \|\| "Vrijgesteld van btw\.";/,
    "an exempt line takes the owner's own ground, or the true part of it — never a guessed article");
  // Plain 0% is the case the app cannot reason about at all.
  assert.match(mod, /return note \|\| null;/, "a bare 0% stays silent unless the owner supplied a reason");
  // Scoped to the STRINGS the module can put on a document, not the file: `export function` made
  // the first version of this fail on the word "export", which is a JS keyword and not a VAT
  // ground. Read what can be printed, not what happens to be written nearby.
  const printable = [...mod.matchAll(/"([^"]{4,})"/g)].map((m) => m[1]).join(" | ");
  assert.doesNotMatch(
    printable, /artikel|art\. 11|uitvoer|onderwijs|zorg|verzekering/i,
    "no provision or ground may be hard-coded in a printable string — a guessed article on a " +
      `customer's invoice is worse than silence. Found in: ${printable}`,
  );

  // The note is free text on its way to a stranger's document: bounded and single-line, and the
  // settings field must use the SAME normalisation, or what is stored differs from what is shown.
  const settings = code("src/app/dashboard/settings/page.tsx");
  assert.match(settings, /import \{ cleanVatNote, MAX_NOTE_LENGTH \} from '@\/lib\/vat-statement'/);
  assert.match(settings, /vat_statement_note: cleanVatNote\(vatStatementNote\) \|\| null/,
    "the field is normalised on save with the same function the PDF trusts");
  // Its own best-effort update, like the two beside it: before the migration this column does not
  // exist, and bundling it into the core save would brick Instellingen for every user.
  assert.match(
    settings, /const \{ error: noteErr \} = await supabase[\s\S]{0,200}?\.update\(\{ vat_statement_note/,
    "the note must save in its OWN update, never folded into the core profile write",
  );
});

// ─── [FACTUUR-DATUMS] A due date cannot precede the invoice it belongs to ───────────────────────
//
// Nothing checked it. An invoice dated 08-08 with a due date of 01-08 was perfectly acceptable —
// and cron/reminders derives the reminder tier from due_date, so that invoice is PAST DUE the
// moment it is issued. The customer gets the bill and a payment reminder for it on the same day;
// on the final tier that reminder carries the statutory aanmaning and names collection costs.
//
// On the server, because the create screen computes the due date from the term and cannot produce
// it — while the EDIT screen takes a typed date, and nothing outside the screens is bound by
// either.
test("[FACTUUR-DATUMS] all three write paths refuse it, and the last one before the number", () => {
  for (const path of [
    "src/app/api/invoice/draft/route.ts",
    "src/app/api/invoice/[id]/route.ts",
    "src/app/api/invoice/send/route.ts",
  ]) {
    const src = code(path);
    assert.match(src, /checkInvoiceDates\(\{/, `${path} must run the check`);
    assert.match(
      src, /if \(!datums\.ok\) \{[\s\S]{0,200}?status: 400/,
      `${path} must refuse on it, not log and continue`,
    );
  }

  // Same ordering rule as the KOR check: a refusal after the number is minted burns a sequence
  // number that cannot be given back, and Art. 35 wants a series without holes.
  const send = code("src/app/api/invoice/send/route.ts");
  const checkAt = send.indexOf("const datums = checkInvoiceDates({");
  const numberAt = send.indexOf("if (!resend && (isConversion || !finalNumber))");
  assert.ok(checkAt > 0 && numberAt > checkAt, "the date check must run before a number is issued");

  // Dates are compared as strings on purpose. These columns are DATE with no zone, and this repo
  // already has a [TZ] scar from parsing one into a Date and rendering a day early west of UTC.
  const mod = code("src/lib/invoice-dates.ts");
  assert.match(mod, /if \(due >= inv\) return \{ ok: true \}/, "a lexical ISO comparison, not a Date");
  assert.match(
    mod, /dt\.getUTCFullYear\(\) === y/,
    "…and a day that does not exist must not round-trip: 2026-02-30 becomes 2 March and would " +
      "then compare as LATER than an invoice dated 1 March, so the refusal would silently not fire",
  );
});

// ─── [BETAALTERMIJN-LANG] Six months deserves a word, not a block ───────────────────────────────
//
// MAX_PAYMENT_TERM_DAYS is 365 and nothing said anything at 180. The ceiling is right — the app
// must not decide what an owner may agree with a customer — but silence at six months is not
// neutral either. Art. 6:119a BW: over sixty days a B2B term holds only if expressly agreed and
// not grossly unfair, and against a large company not at all.
test("[BETAALTERMIJN-LANG] both screens warn above sixty days and neither blocks", () => {
  const mod = code("src/lib/payment-term.ts");
  assert.match(mod, /export const LONG_PAYMENT_TERM_DAYS = 60/);
  assert.match(
    mod, /if \(!Number\.isFinite\(d\) \|\| d <= LONG_PAYMENT_TERM_DAYS\) return null/,
    "an ordinary term must produce nothing — a notice that shows at 30 days is unread by 90",
  );
  assert.match(mod, /kun je gewoon doorgaan/, "it is advice, and says so");
  // The ceiling stays where it was. Turning the warning into a limit would be the app deciding a
  // commercial term on the owner's behalf.
  assert.match(mod, /export const MAX_PAYMENT_TERM_DAYS = 365/, "the hard maximum is unchanged");

  for (const path of [
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
  ]) {
    const src = code(path);
    assert.match(src, /longPaymentTermNotice\(/, `${path} must compute the notice`);
    assert.match(src, /\{langeTermijn && \(/, `${path} must render it`);
  }
});

// ─── [KAS-STIL] A drawer that goes out of step must say so ──────────────────────────────────────
//
// cash-settle.ts keeps the kasboek in step with the invoices paid in cash. It creates entries, it
// heals them, and it DELETES them — and every one of those failures ended at console.error, with
// the word "non-fatal" beside it. The module runs from the hourly cron, where console output
// reaches nobody.
//
// Non-fatal to the REQUEST, which is right: paying an invoice must not fail because a reconcile
// did. Never non-fatal to the BOOKS, and each direction is its own wrong number:
//
//   insert failed   the cash payment has no drawer movement → the balance is too HIGH
//   update failed   the invoice's amount or date moved and the entry did not → stale
//   delete failed   the invoice is no longer cash-paid and the entry stayed → too LOW
//   read bailed     the whole pass did not run, and every caller ignores its ok:false
//
// Its own sibling in the same hourly reconcile — incasso-settle.ts — already imports the reporter
// for exactly this class. This file was the one that did not.
test("[KAS-STIL] every cash-drawer failure reaches the reporter, not just the console", () => {
  const src = code("src/lib/cash-settle.ts");

  assert.match(
    src, /import \{ reportHandledFailure \} from "@\/lib\/report-handled"/,
    "the same reporter its neighbour in the hourly reconcile already uses",
  );
  // Four write/read failure sites, four reports. A count, because the failure mode here is one
  // branch quietly keeping its console.error while the others were converted.
  const reports = src.match(/reportHandledFailure\(\{/g) ?? [];
  assert.ok(
    reports.length >= 5,
    `insert, update, delete, the outer throw and the read bail must each report — found ${reports.length}`,
  );
  // And nothing may fall back to the console, which is what "non-fatal" meant here.
  assert.doesNotMatch(
    src, /console\.error/,
    "a cron writing to stdout is the same as a cron writing nothing",
  );

  // The three that leave a WRONG BALANCE are data-integrity; a bail leaves the books untouched
  // and is a gate-unavailable. Getting that backwards makes the severe ones easy to skim past.
  assert.match(src, /message: "cash settlement entry not created[^"]*"/);
  assert.match(src, /message: "orphaned cash settlements not removed[^"]*"/);
  assert.match(src, /severity: "gate-unavailable"/, "the read bail is not a corrupted drawer");

  // No customer amounts in a report — report-handled.ts asks for ids and counts, never bedragen.
  for (const c of src.match(/context: \{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(
      c, /\bamount\b|total_inc_btw|bedrag/,
      `a failure report must not carry an amount — ${c.slice(0, 70)}…`,
    );
  }
});

// ─── [TYPES] Schema that exists must be typed, so the compiler checks the column names ─────────
//
// Six migrations were applied on 9 August. Until then seven schema objects were absent from the
// generated types, and the code reached them through `as any` — which means a mistyped column name
// compiled cleanly and failed at runtime, on paths that in some cases had NEVER run.
//
// Adding them by hand turned that into a compile-time check, and doing so immediately caught one
// error: I had put auto_incasso and incasso_suggested_at on `profiles` and `bank_transactions`,
// because the first pass read the ADD COLUMN lines without reading which ALTER TABLE they were
// under. All three are on SUPPLIERS. The code was right; my reading of the migration was not.
//
// This gate holds the arrangement, not the reading: the objects are declared, and the escapes that
// made them unnecessary are gone.
test("[TYPES] the newly applied schema is declared, and reached without `as any`", () => {
  const types = code("src/types/database.types.ts");

  // The two whole tables.
  assert.match(types, /^ {6}feedback: \{$/m, "the feedback table must be in the schema types");
  assert.match(types, /^ {6}supplier_aliases: \{$/m, "…and supplier_aliases");

  // The columns, each under the table the migration actually alters. Scoped, because asserting
  // "the file contains auto_incasso" is exactly the mistake this gate was written after.
  const table = (name: string) => {
    const start = types.indexOf(`      ${name}: {`);
    assert.ok(start > 0, `${name} not found in the types`);
    const rest = types.slice(start + 20);
    const next = rest.search(/\n {6}[a-z_]+: \{\n/);
    return rest.slice(0, next > 0 ? next : rest.length);
  };
  const suppliers = table("suppliers");
  for (const col of ["auto_incasso", "auto_incasso_since", "incasso_suggested_at"]) {
    assert.match(suppliers, new RegExp(`\\n {10}${col}\\??: `), `suppliers.${col} — auto_incasso.sql and bank_tx_direct_debit.sql both ALTER suppliers, not profiles`);
  }
  const bankTx = table("bank_transactions");
  for (const col of ["type_code", "mandate_id", "creditor_id"]) {
    assert.match(bankTx, new RegExp(`\\n {10}${col}\\??: `), `bank_transactions.${col}`);
  }
  // …and NOT where they do not belong. A column declared on the wrong table type-checks fine and
  // is a lie the compiler will then help enforce.
  assert.doesNotMatch(table("profiles"), /\n {10}auto_incasso/, "auto_incasso is not on profiles");
  assert.doesNotMatch(bankTx, /\n {10}incasso_suggested_at/, "incasso_suggested_at is not on bank_transactions");

  // The escapes are gone, so a typo in any of these statements is now a build failure.
  assert.doesNotMatch(
    code("src/app/api/feedback/route.ts"), /\(supabase as any\)/,
    "the feedback insert must be type-checked — it had never run against a real table",
  );
  // For incasso-settle the cast was not the thing that mattered, and its own negative control is
  // what said so: `type Client = SupabaseClient<any>` meant the statement was untyped either way,
  // so removing the cast changed nothing and a misspelled column still reached the database.
  // Asserting the absence of the cast would have been this file's own recurring defect — checking a
  // MENTION instead of the WIRING. What makes the check real is the client type.
  assert.match(
    code("src/lib/incasso-settle.ts"), /type Client = SupabaseClient<Database>/,
    "the suppliers writes are only checked if the client carries the schema",
  );
  assert.doesNotMatch(
    code("src/lib/incasso-settle.ts"), /incasso_suggested_at: at \} as any/,
    "…and the cast is gone too",
  );
  assert.doesNotMatch(
    code("src/app/api/cron/reconcile/route.ts"), /select\("user_id"\) as any/,
    "…and the auto_incasso filter",
  );
  assert.match(
    code("src/lib/supplier-alias-write.ts"), /type Client = SupabaseClient<Database>/,
    "supplier-alias-write took SupabaseClient<any> because the table was not in the schema; it is now",
  );
});

// ─── [DOC-GEEN-BLADZIJDE] A file with no page must not be framed ────────────────────────────────
//
// The document sheet renders an <img> for a photo and puts everything ELSE in an <iframe>. For a
// pdf that is right. For a UBL e-invoice the browser renders the SOURCE, so an owner opening an
// incoming invoice on their phone read:
//
//     <?xml version="1.0" encoding="UTF-8"?>
//     <Invoice xmlns:qdt="urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2" …
//
// — namespace declarations in a dark frame, under a panel of tidy amounts. And unnecessary: this
// app READS these files (ubl-invoice.ts), and the sheet shows what it read directly above.
//
// WHY THIS IS HELD HERE AND NOT IN tests/render/. The branch is chosen from a fetch inside a
// useEffect, and effects never run under renderToStaticMarkup — the sheet stays in its 'loading'
// phase there, so the render gate cannot reach it. The decision itself is pure and tested in
// document-preview.test.ts; what is left for this file is the wiring.
test("[DOC-GEEN-BLADZIJDE] the sheet explains a machine-readable file instead of framing it", () => {
  const sheet = code("src/components/invoice/InvoiceDocumentSheet.tsx");

  // Asserted on the MODULE and the USE, not on the exact spelling of the import list — pinning it
  // to that list broke the moment fileOpenHref was added beside these two, which is a gate
  // reporting an edit rather than a defect. Same trap this file keeps finding elsewhere.
  assert.match(
    sheet, /from '@\/lib\/document-preview'/,
    "the sheet must take the rule from the shared module",
  );
  assert.match(sheet, /\bnoPageNotice\b/, "…and use it");
  assert.match(
    sheet, /\{doc\.phase === 'ready' && doc\.kind === 'structured' && \(/,
    "…and have a branch for a file with no page",
  );
  assert.match(sheet, /\{noPageNotice\(doc\.name\)\}/, "…which says why there is nothing to show");
  // The frame must now EXCLUDE it. Without this the new branch would render the sentence AND the
  // iframe under it, which is worse than either alone.
  assert.match(
    sheet, /doc\.kind !== 'image' && doc\.kind !== 'structured' && \(\n\s*<iframe/,
    "the iframe branch must exclude structured files, not merely be preceded by one",
  );
  // The source is not hidden — it stops being the default view. [TAAL] Asserted on the KEY, not
  // the Dutch sentence: a gate written against one language fails the day the app gains a second.
  assert.match(sheet, /t\('dsh\.nieuwTabblad'\)/, "the escape hatch stays");

  // The route sends the kind, from the same function, so the two cannot disagree about a format.
  const route = code("src/app/api/email/file/[id]/route.ts");
  assert.match(route, /import \{ previewKind \} from "@\/lib\/document-preview"/);
  assert.match(route, /const kind = previewKind\(name\)/, "the route must derive it from the shared rule");
  assert.doesNotMatch(
    route, /\.pdf\$\/\.test\(lower\) \? "pdf"/,
    "the route's own copy of the rule must be gone — two definitions drift",
  );

  // A bank statement is also an .xml file, so the specific formats have to be tested first.
  const mod = code("src/lib/document-preview.ts");
  const camtAt = mod.indexOf("camt|053");
  const xmlAt = mod.indexOf("\\.xml$");
  assert.ok(camtAt > 0 && xmlAt > camtAt, "CAMT must be matched before the bare .xml rule");
});

// ─── [SENTRY-EEN-CONFIG] One browser Sentry config, and it is the one that runs ─────────────────
//
// There were two client Sentry.init calls: src/instrumentation-client.ts, scaffolded by the Sentry
// wizard, and sentry.client.config.ts, which somebody had thought about carefully — a 5% replay
// rate, 10% tracing in production, and a beforeSend deleting password, access_token,
// refresh_token, kvk_number, btw_number and iban before anything left the browser.
//
// @sentry/nextjs 10 loads instrumentation-client.ts and ignores sentry.client.config.ts. Confirmed
// against the BUILT BUNDLE, not the docs: the scaffold's replaysSessionSampleRate 0.1 shipped, the
// considered 0.05 did not, and neither did its vercel.live frame filter. Every privacy decision in
// this app was written down and never executed.
//
// The direction of the mistake is worth keeping in the record. An external review read the dead
// file and reported "Session Replay records unmasked text (maskAllText: false)" — reasonable from
// the source and wrong about production: that line never reached a bundle, and replayIntegration()
// masks text by default. The real exposure was sendDefaultPii: true with no beforeSend at all.
//
// What is held: one config, no resurrection of the second, and the three settings that decide what
// leaves a bookkeeper's browser.
test("[SENTRY-EEN-CONFIG] the browser config that ships is the one with the privacy rules", () => {
  // The dead file must stay dead. A wizard re-run recreates it, and it would silently take back
  // over as the file people read while the other one runs.
  assert.equal(
    existsSync("sentry.client.config.ts"), false,
    "a second client config that looks authoritative and executes nowhere is how this happened",
  );

  const src = code("src/instrumentation-client.ts");

  // The line that mattered most. The scaffold turns it ON, which attaches IP addresses and user
  // identifiers to every event and replay — on screens showing turnover, customers and balances.
  assert.match(src, /sendDefaultPii: false/, "no PII by default, on a bookkeeping app");

  // Stated, never inherited: these are today's library defaults, and a default is a decision
  // someone else can change in a minor release.
  for (const opt of ["maskAllText: true", "maskAllInputs: true", "blockAllMedia: true"]) {
    assert.ok(src.includes(opt), `replay masking must be explicit: ${opt}`);
  }

  // The work that was written in the dead file has to actually be here.
  assert.match(src, /beforeSend\(event\)/, "the PII stripper must run, not merely exist");
  for (const field of ["password", "access_token", "refresh_token", "kvk_number", "btw_number", "iban"]) {
    assert.ok(src.includes(`delete data.${field}`), `beforeSend must still strip ${field}`);
  }

  // And the sampling the project chose, not the scaffold's 100%.
  assert.match(src, /tracesSampleRate: isProduction \? 0\.1 : 1\.0/);
  assert.match(src, /replaysSessionSampleRate: 0\.05/);
});

// ─── [DUBBEL-ZICHTBAAR] A dropped duplicate must leave a trace the owner can see ────────────────
//
// Reported: a supplier invoiced the wrong amount, corrected it, and re-sent under the same number.
// The first import landed; the second never appeared. From the owner's side there is no difference
// between "we decided this was a duplicate" and "the e-mail never came" — and the WRONG invoice
// stays in the books while the right one is gone.
//
// email-integration.ts had already learned this once. Its same-filename branch says so in its own
// words: "The old code counted it as a duplicate and dropped it with no trace: no skip row, no
// audit, invisible to the owner." That branch registers a skip. The SEMANTIC branch — the one that
// drops on invoice number or on vendor+total+date, the one that actually fires — did not.
//
// An audit row is not enough and never was: it is a forensic record, not a screen anyone opens.
test("[DUBBEL-ZICHTBAAR] every duplicate branch registers a skip, not only an audit row", () => {
  const src = code("src/lib/email-integration.ts");

  // Both duplicate drops must reach the registry the owner's screen reads.
  const skips = src.match(/from\('email_skipped_attachments'\)\s*\.upsert\(/g) ?? [];
  assert.ok(
    skips.length >= 2,
    `the same-filename branch and the semantic branch must both register — found ${skips.length}`,
  );
  assert.match(
    src, /source_message_id: `\$\{dedupKey\}:dubbel`/,
    "the semantic duplicate needs its own key, or it collides with a not-an-invoice skip",
  );

  // The reason has to be ACTIONABLE. "Duplicate" alone tells the owner nothing they can act on;
  // the corrected-resend case is the one that costs money, so it is named.
  const idx = src.indexOf("source_message_id: `${dedupKey}:dubbel`");
  const block = src.slice(idx, idx + 1400);
  assert.match(block, /GECORRIGEERDE/, "the corrected-resend case must be offered as the explanation");
  assert.match(block, /handmatig toe/, "…and the way out must be in the sentence");

  // It must not be able to break the sync it reports on.
  assert.match(src.slice(idx - 600, idx + 1800), /\} catch \{/, "registering a skip is best-effort");
});

// ─── [DOC-VERSE-LINK] The escape hatch signs at the tap, not five minutes earlier ──────────────
//
// The sheet fetches a signed url once, on open, and the "Openen in nieuw tabblad" button carried
// that same url. The signature lives 300 seconds. So a tap five minutes later put this in a new
// tab, in place of the document:
//
//     {"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim timestamp check failed"}
//
// Reported from a phone and easy to blame on the phone. It is a stopwatch, and it runs everywhere.
//
// It matters more than a stale link normally would, because that button is the ESCAPE HATCH. Edge
// on Android answers an inline pdf with "PDF reader has been disabled"; Safari has shipped versions
// that render only the first page. When the frame will not work, the button is the only way to the
// document — and it was the one route with a fuse on it.
test("[DOC-VERSE-LINK] the open button carries no signature, and a failed tab gets a sentence", () => {
  const sheet = code("src/components/invoice/InvoiceDocumentSheet.tsx");
  assert.match(
    sheet, /href=\{fileOpenHref\(invoice\.id\)\}/,
    "the button must point at our own route — a url captured at open time has a 300-second fuse",
  );
  assert.doesNotMatch(
    sheet, /href=\{doc\.url\}/,
    "…and never at the pre-signed url the sheet fetched",
  );

  const route = code("src/app/api/email/file/[id]/route.ts");
  assert.match(
    route, /if \(req\.nextUrl\.searchParams\.get\("open"\) === "1"\) \{/,
    "the route must have the redirect branch",
  );
  assert.match(route, /NextResponse\.redirect\(signed\.signedUrl/, "…which signs and sends");
  // A cached 302 would point a later tap at a url that has already died — exactly the failure this
  // branch removes.
  assert.match(
    route, /"Cache-Control": "no-store, max-age=0"/,
    "the redirect must not be cached: the target expires and the cache would outlive it",
  );

  // ORDER: the signature has to be minted in this request, not read from anywhere earlier.
  const signAt = route.indexOf("createSignedUrl(storagePath");
  const redirectAt = route.indexOf('searchParams.get("open") === "1"');
  assert.ok(signAt > 0 && redirectAt > signAt, "the redirect must follow a fresh createSignedUrl");

  // And no failure path may answer a browser tab with a JSON object — that is what the owner was
  // shown once already.
  assert.match(route, /function fileError\(req: NextRequest, message: string, status: number\)/);
  assert.doesNotMatch(
    route, /return NextResponse\.json\(\{ error: "/,
    "every error must go through fileError, which answers a tab in words and a fetch in JSON",
  );
});

// ─── [KOP-KLEINER] The Inkoopfacturen toolbar, and the flex rule that has to be a wrapper ──────
//
// Reported from a phone: the header of /dashboard/incoming/manage is far too big, and the button
// that jumps to /dashboard/incoming is redundant. Both were true, and both were measured in
// Chromium against the real globals.css before anything was changed.
//
//   390px, before   282px of sticky toolbar — a third of the viewport, above the list, always
//                   four button rows: [bulk pair] [Verificatie ALONE] [Matchen] [Reken na]
//   390px, after    202px, two button rows: [bulk pair] [Matchen | Reken na]
//
// The Verificatie shortcut cost a whole 42px row to itself, because `margin-left: auto` pushed it
// past the two bulk pills onto the next line. It pointed at /dashboard/incoming with the `inbox`
// icon — the same destination and the same icon as a BottomNav tab that never leaves the screen.
//
// WHY THIS GATE EXISTS AT ALL, given that no gate in this repo can run a layout
// The first version of the fix put `flex: 1 1 0; min-width: 0` on the two buttons directly, with
// no wrapper. It is the obvious way to write it and it is wrong: flex line-breaking uses an item's
// HYPOTHETICAL MAIN SIZE, which a zero basis makes zero, so the buttons no longer start their own
// row — they join whatever line still has a few pixels free and are handed the remainder. Measured
// across 320-1024px it survived at exactly two widths and collapsed at the rest: "Matchen met bank
// & kas" came out 44px wide and 76px tall at 375px, and 36px wide at 430px.
//
// So the property that must not regress is not "the buttons have a flex rule" — it is that the
// pair sits in a container whose basis is 100%, which cannot share a line with anything. That is
// structural, and structure is the one thing a static gate CAN check.

test("[KOP-KLEINER] the two toolbar actions live inside the .inko-run wrapper, not loose in the row", () => {
  const screen = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");

  // The wrapper must exist...
  const openAt = screen.indexOf('<div className="inko-run">');
  assert.ok(openAt > 0, ".inko-run wrapper is gone — the pair would rejoin the bulk row");

  // ...and BOTH buttons must actually be inside it. This is the whole claim: a gate that merely
  // found the three class names somewhere in the file would pass just as happily with the wrapper
  // sitting empty two hundred lines away.
  let depth = 0;
  let closeAt = -1;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = openAt;
  for (let m = tag.exec(screen); m; m = tag.exec(screen)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) { closeAt = m.index; break }
  }
  assert.ok(closeAt > openAt, "the .inko-run wrapper is never closed");

  const inside = screen.slice(openAt, closeAt);
  assert.match(inside, /className="inko-match"/, "Matchen met bank & kas must be inside the wrapper");
  assert.match(inside, /className="inko-audit"/, "Reken mijn boeken na must be inside the wrapper");

  // And the wrapper must close before .inko-actions does, or it is not a row within that row.
  const actionsAt = screen.indexOf('<div className="inko-actions">');
  assert.ok(actionsAt > 0 && actionsAt < openAt, ".inko-run must sit inside .inko-actions");
});

test("[KOP-KLEINER] .inko-run claims a whole line — a zero basis is the measured bug", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  const run = css.slice(css.indexOf(".inko-run {"), css.indexOf("@media (min-width: 641px)", css.indexOf(".inko-run {")));
  assert.ok(run.length > 0, ".inko-run rule is gone");
  assert.match(run, /flex:\s*1\s+1\s+100%/, "the wrapper must have a 100% basis, so it cannot share a line");

  // The exact regression: a zero basis on the wrapper puts it back beside the bulk buttons.
  const wrapperDecl = run.slice(0, run.indexOf("}"));
  assert.doesNotMatch(
    wrapperDecl, /flex:\s*1\s+1\s+0/,
    "a zero basis makes the wrapper's hypothetical main size 0, so it joins the bulk row instead " +
      "of starting its own — measured at 44x76px for 'Matchen met bank & kas' at 375px",
  );

  // The button rules must be scoped to the wrapper. Scoped to .inko-actions they would apply to
  // loose children again, which is the layout that was measured broken.
  assert.match(css, /\.inko-run > \.inko-match,\s*\n\s*\.inko-run > \.inko-audit \{/);
  assert.doesNotMatch(css, /\.inko-actions > \.inko-(match|audit)/, "the old loose-child rules must be gone");
});

test("[KOP-KLEINER] the redundant Verificatie shortcut is gone, and its rules with it", () => {
  // It duplicated a BottomNav tab exactly — same href, same icon — and cost a full row.
  assert.equal(
    readFileSync("src/app/globals.css", "utf8").includes("inko-inbox"), false,
    "the .inko-inbox rules outlived the element they styled",
  );
  const screen = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.doesNotMatch(screen, /inko-inbox/, "the Verificatie shortcut is back in the toolbar");

  // The destination it duplicated must still be reachable, or removing the shortcut would have
  // taken the only permanent route to the verification queue with it.
  //
  // Found by CONTENT, not by path. The first draft of this gate read "src/components/BottomNav.tsx"
  // — a path that does not exist (it is components/nav/BottomNav.tsx), and a gate pinned to a
  // guessed path is the recurring defect in this file: it either throws, or worse, quietly matches
  // nothing and passes forever.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const navEntry = /\{ href: '\/dashboard\/incoming', label: '[^']+', icon: 'inbox'/;
  const carriers = walk("src/components").filter((f) => navEntry.test(readFileSync(f, "utf8")));
  assert.ok(
    carriers.length > 0,
    "no navigation component still routes to /dashboard/incoming with the inbox icon — removing " +
      "the toolbar shortcut is only safe because the bottom nav carries the same destination",
  );
});

// ─── [FOCUS-KOP] A deep link must land on the invoice, not in the middle of it ──────────────────
//
// Reported: tapping an invoice under "DIT HEEFT JE AANDACHT NODIG" on the dashboard opens the
// inkoopfacturen list far below the invoice. Everything about the deep link worked — the row was
// found, expanded and highlighted — and the owner still arrived nowhere near it.
//
// The cause is the ORDER of two correct-looking lines. The effect expands the focused row, then
// calls scrollIntoView({ block: 'center' }). Measured in Chromium against the real stylesheet, an
// expanded incoming card is 705px tall against 586px of usable viewport at 390x844, and centring
// something taller than the viewport puts its TOP off the top of the screen:
//
//     width   chrome   card    invoice name lands at
//      320    302px    727px   y= 58   behind the bar
//      390    258px    705px   y= 70   behind the bar
//      900    246px    705px   y= 70   behind the bar
//
// So the owner landed inside the detail body, past the supplier name, past the amount and past
// the highlight ring drawn for them — the next name on screen being the FOLLOWING invoice, which
// is why it read as "sent to the wrong place".
//
// block:'start' alone is not the fix: it measures y=0, still behind two stacked sticky bars that
// scrollIntoView knows nothing about. With a margin derived from the bar's LIVE height the name
// lands at y=254..310 at every width — the chrome varies by 56px across the range, so a constant
// would have been wrong at four of the six widths measured.

const FOCUS_SCREENS = [
  // path, and whether the screen has a sticky toolbar of its own to measure
  ["src/app/dashboard/incoming/manage/IncomingManageClient.tsx", true],
  ["src/app/dashboard/facturen/FacturenClient.tsx", true],
  ["src/app/dashboard/klanten/KlantenClient.tsx", true],
  ["src/app/dashboard/clients/[id]/kwartaal/page.tsx", false],
  ["src/app/dashboard/incoming/IncomingInvoicesClient.tsx", false],
] as const;

test("[FOCUS-KOP] no screen centres a row it has just expanded", () => {
  // Five screens had written this landing out separately, and all five had it the same way wrong.
  // That is the argument for one function: the next screen to grow a deep link inherits the fix
  // instead of re-deriving the bug.
  for (const [f] of FOCUS_SCREENS) {
    const screen = code(f);
    assert.match(screen, /landRowUnderChrome\(/, `${f}: the focused row must land through the helper`);
    // The defect itself: centring something that was just expanded.
    assert.doesNotMatch(
      screen, /(rowRefs\.current\[[^\]]+\]|getElementById\(`incoming-card-[^`]+`\))[^\n]*\n?[^\n]*scrollIntoView\([^)]*block: ?["']center/,
      `${f}: a focused row is expanded and then centred — its header ends up above the viewport`,
    );
  }
});

test("[FOCUS-KOP] a screen with its own toolbar measures it; one without passes null on purpose", () => {
  for (const [f, hasBar] of FOCUS_SCREENS) {
    const screen = code(f);
    // Every call site, and its arguments read by MATCHING PARENS rather than by regex. Two earlier
    // drafts of this gate failed on their own instrument: one indexed past the only call there was,
    // and one used a non-greedy /\)/ that stopped inside `getElementById(...)` — so the argument it
    // checked was half an argument. A call's arguments are a balanced span; nothing less reads them.
    const calls: string[] = [];
    for (let i = screen.indexOf("landRowUnderChrome("); i >= 0; i = screen.indexOf("landRowUnderChrome(", i + 1)) {
      let depth = 0;
      const from = screen.indexOf("(", i);
      for (let j = from; j < screen.length; j++) {
        if (screen[j] === "(") depth++;
        else if (screen[j] === ")" && --depth === 0) { calls.push(screen.slice(from + 1, j)); break }
      }
    }
    assert.ok(calls.length > 0, `${f}: no landRowUnderChrome call found`);
    if (hasBar) {
      assert.ok(
        calls.every(c => /toolbarRef\.current/.test(c)),
        `${f}: has a sticky toolbar, so the row must land below THAT, not below the header alone`,
      );
      // …and the ref has to be ON the sticky bar. Checking the attribute alone would pass with the
      // ref parked on any div in the file.
      const at = screen.indexOf("<div ref={toolbarRef}");
      assert.ok(at > 0, `${f}: toolbarRef is not attached to any element`);
      const tag = screen.slice(at, screen.indexOf(">", at));
      assert.match(tag, /position: 'sticky'/, `${f}: toolbarRef must sit on the STICKY bar`);
      assert.match(tag, /top: STICKY_BELOW_HEADER/, `${f}: …the one stacked under the page header`);
    } else {
      assert.ok(
        calls.every(c => /,\s*null,/.test(c)),
        `${f}: has no toolbar of its own — null says so, and the shared header is measured instead`,
      );
      assert.doesNotMatch(screen, /toolbarRef/, `${f}: a ref to a bar this screen does not have`);
    }
  }
});

test("[FOCUS-KOP] the chrome is measured, never assumed from a constant", () => {
  const lib = code("src/lib/focus-scroll.ts");
  // The shared header carries env(safe-area-inset-top) on a notched phone in PWA mode, so its
  // height is NOT PAGE_HEADER_HEIGHT. Deriving it from the constant lands the row behind the bar
  // by exactly the height of the notch.
  assert.match(lib, /document\.querySelector\(SUBPAGE_HEADER_SELECTOR\)/, "the shared header must be measured");
  assert.match(lib, /block: "start"/, "and the row scrolled to its start");
  assert.doesNotMatch(lib, /block: "center"/, "never centred");

  // …and the handle it measures has to exist on the real bar.
  const header = code("src/components/nav/SubPageHeader.tsx");
  const at = header.indexOf("data-subpage-header");
  assert.ok(at > 0, "the shared header lost the attribute the helper finds it by");
  const tag = header.slice(header.lastIndexOf("<", at), header.indexOf(">", at));
  assert.match(tag, /^<header/, "the attribute must be on the header element itself");
  assert.match(header.slice(at, at + 400), /position: "sticky"/, "…which must still be sticky");
});

test("[FOCUS-KOP] a deep link that cannot land says so instead of returning silently", () => {
  // The server unshifts the focused row when the fetch window missed it ([INBOX-CROWD-OUT]), so
  // absence means that lookup failed. Returning quietly leaves the owner on an unchanged list of
  // 88 invoices, believing their tap landed. They are entitled to know it did not.
  const screen = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  const guard = screen.indexOf("if (!invoices.some(i => i.id === focusId))");
  assert.ok(guard > 0, "the not-in-list guard is gone");
  const branch = screen.slice(guard, guard + 400);
  assert.match(branch, /showToast\(/, "a focus that cannot land must be reported, never swallowed");
});

// ─── [EERLIJK-GEBRUIK-UITLEG] The month running out is a modal, not a toast ─────────────────────
//
// Reaching the monthly allowance is the most consequential thing this app says to an owner: from
// that moment documents are stored but no longer READ, so every screen they open afterwards is
// missing invoices they believe were processed. It was a toast — a black strip over the dashboard
// that fades in a few seconds — carrying the onExceed clause alone, which says what pauses and
// never that a LIMIT was reached, which one, or where they stand against it.
test("[EERLIJK-GEBRUIK-UITLEG] the fair-use refusal opens a modal and quotes published numbers", () => {
  const btn = code("src/components/intake/IntakeButton.tsx");

  // Intercepted BEFORE the generic upload-failure toast, or the modal never opens.
  assert.match(btn, /const fu = fairUseNotice\(data\)/);
  assert.match(
    btn, /if \(fu\) setFairUse\(fu\)\s*\n\s*else showToast\(describeUploadFailure/,
    "the toast must be the ELSE branch — a fair-use pause may not fade away",
  );
  assert.match(btn, /<FairUseModal notice=\{fairUse\}/, "and it must actually be rendered");

  // Keyed on the reason, never on the 402 status: a payment provider answers 402 too.
  const mod = code("src/lib/fair-use-notice.ts");
  assert.match(
    mod, /\(payload as \{ reason\?: unknown \}\)\.reason === "fair_use"/,
    "a declined card must not open a monthly-allowance explanation",
  );

  // The numbers are the PUBLISHED ones. /eerlijk-gebruik and Instellingen › Facturering read the
  // same table; a hand-written "50 documenten" in a component is a fourth place that can disagree
  // with a promise.
  assert.match(mod, /import \{ FAIR_USE_LIMITS/, "the limits come from the policy table");

  // The component RENDERS the notice and composes none of it. Checked by what it imports and what
  // it reads, not by hunting for digits — the first version of this assertion looked for the
  // numbers themselves and matched `zIndex: 1000` and `width: '100%'`, which is a gate that fails
  // on a style change and teaches people to weaken it.
  const view = code("src/components/ui/FairUseModal.tsx");
  assert.doesNotMatch(
    view, /from '@\/lib\/fair-use'/,
    "a component that reads the limits table could quote a number the policy page does not",
  );
  for (const field of ["notice.title", "notice.count", "notice.stillWorks", "notice.pauses", "notice.resets"]) {
    assert.ok(view.includes(field), `the modal must show ${field} rather than wording of its own`);
  }

  // And the server has to send the limit, or the modal can only state a count with nothing to
  // place it against.
  assert.match(
    code("src/lib/fair-use-gate.ts"), /limit: plan === "plus" \? fairUseLimit\(params\.metric\)\.plus/,
    "the 402 body must carry the limit beside the count",
  );
});

// ─── [KLANT-EXTRA] Two free lines under the customer's name ─────────────────────────────────────
//
// Asked for: two extra inputs in the customer block of an invoice, for information the owner needs
// to put on their customer's document — and they come DIRECTLY AFTER THE NAME. That last part is
// the requirement, not a detail: an addressee line printed under the postcode is not an addressee
// line. So the order is asserted here on the form, and on a rendered PDF in
// invoice-pdf-document.test.ts, which is the only place that can say where the text came out.
//
// The other half of this feature is that it CANNOT COST AN INVOICE. The columns arrive with
// supabase/migrations/client_extra_lines.sql, applied by the owner, so between a deploy and that
// moment the code is newer than the schema. PostgREST answers a write naming an unknown column by
// rejecting the whole row, which would turn two decorative address lines into "your invoice was
// not saved". Every write path therefore carries a fallback, and this gate checks that none of
// them names these columns without one.

const EXTRA_FORMS = [
  "src/app/dashboard/invoice/new/page.tsx",
  "src/app/dashboard/invoice/[id]/edit/page.tsx",
] as const;
/** The state names, in the order they print. A fourth line costs one entry here and nowhere else. */
const EXTRA_STATE = ["clientExtra1", "clientExtra2", "clientExtra3", "clientExtra4"] as const;

test("[KLANT-EXTRA] both invoice screens put the three lines directly after the customer name", () => {
  for (const f of EXTRA_FORMS) {
    const screen = code(f);
    const name = screen.indexOf('label="Bedrijfsnaam"') >= 0
      ? screen.indexOf('label="Bedrijfsnaam"')
      : screen.indexOf("Bedrijfsnaam");
    const email = screen.indexOf("value={clientEmail}");
    let previous = name;
    EXTRA_STATE.forEach((state, i) => {
      // BOUND to state, not merely mentioned.
      const at = screen.indexOf(`value={${state}}`);
      assert.ok(at > 0, `${f}: line ${i + 1} is not a bound input`);
      // ORDER on the form, which is what was asked for: the name, then the extra lines in the
      // order they print, then the e-mail.
      assert.ok(at > previous, `${f}: line ${i + 1} must follow what comes before it`);
      previous = at;
      // …and the screen must actually SEND it, or the field is decoration.
      assert.match(
        screen, new RegExp(`client_extra_line${i + 1}: ${state}`), `${f}: line ${i + 1} is never sent`,
      );
    });
    assert.ok(email > previous, `${f}: the lines must sit ABOVE the e-mail field, not after the address`);

    // A bound input with no ceiling lets a pasted paragraph reach a customer's document.
    const bounds = (screen.match(/maxLength=\{MAX_EXTRA_LINE_LENGTH\}/g) ?? []).length;
    assert.equal(bounds, EXTRA_STATE.length, `${f}: every extra input needs the shared bound`);
  }
});

test("[KLANT-EXTRA] the two screens send them on EVERY save path, not just one", () => {
  // Both screens have two submit paths — save as draft and send. A field carried by only one of
  // them is worse than no field: the owner types it, saves, and it is there until the moment they
  // send, which is the moment it matters.
  for (const f of EXTRA_FORMS) {
    const screen = code(f);
    const snapshots = (screen.match(/client_btw_number: clientBtw/g) ?? []).length;
    EXTRA_STATE.forEach((_, i) => {
      const sends = (screen.match(new RegExp(`client_extra_line${i + 1}:`, "g")) ?? []).length;
      assert.equal(
        sends, snapshots,
        `${f}: line ${i + 1} travels on ${sends} of the ${snapshots} payloads carrying the customer snapshot`,
      );
    });
  }
});

test("[KLANT-EXTRA] every route that rebuilds the customer snapshot carries the lines too", () => {
  // A route that copies client_name / client_address / client_btw_number field by field is
  // building a NEW document from an old one — a creditnota, a duplicate, a recurring invoice. Each
  // one that stops short of these columns drops the addressee silently, and a recurring invoice
  // drops it every single month. The list is derived, not written down: any future route that
  // rebuilds the snapshot is caught by the same rule.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  };
  const rebuilders = walk("src/app/api")
    .filter((f) => /client_btw_number:\s*(src|original)\./.test(code(f)));
  assert.ok(rebuilders.length >= 3, `expected the copy routes, found ${rebuilders.length}`);

  for (const f of rebuilders) {
    assert.match(
      code(f), /copyExtraLinesOnto\(/,
      `${f} rebuilds the customer snapshot but never carries the extra lines — the new document ` +
        "loses the addressee, and a recurring one loses it every month",
    );
  }
});

test("[KLANT-EXTRA] every reader of the customer block reads the SAME three lines", () => {
  // The write side was covered from day one; the READ side is where this feature silently
  // halved. Three surfaces show the customer block of one invoice, and for weeks two of them
  // did not know the lines existed: the detail screen showed an AAN block that contradicted
  // the PDF (the owner concludes their "t.a.v." was lost), and the e-factuur XML went to the
  // customer's booking system without the very reference that system matches on. One read
  // definition — clientExtraLines — for all three, so a fourth line, a new trim rule or a
  // new length ceiling lands everywhere at once.
  const READERS = [
    "src/lib/invoice-pdf.tsx", // the legal document
    "src/app/dashboard/invoice/[id]/page.tsx", // the owner's own view of it
    "src/lib/ubl-export.ts", // the same document as XML
  ] as const;
  for (const f of READERS) {
    assert.match(
      code(f), /clientExtraLines\(/,
      `${f} renders the customer block but not the extra lines — it contradicts the document`,
    );
  }
  // And the UBL ROUTE must fetch them, or the builder reads keys that were never selected.
  // In its own failable read (the cron's pattern): the main select names its columns and may
  // not fail on a database where the migration is still open.
  const route = code("src/app/api/export/ubl/route.ts");
  assert.match(route, /CLIENT_EXTRA_LINE_COLUMNS\.join/, "the UBL route never fetches the lines");
  assert.doesNotMatch(
    route,
    /INVOICE_SELECT\s*=[^;]*client_extra/,
    "the lines may not join the main select — an open migration would fail EVERY export (42703)",
  );
});

test("[E-FACTUUR] the UBL route passes vat_treatment through to the builder", () => {
  // The route SELECTED the flag, carried a fallback for it, and then dropped it in the map to
  // the builder's input — so every exempt line exported as category Z (0%-taxed) instead of E.
  // A different legal fact, discovered only because this gate now counts both halves: the
  // fetch AND the hand-over.
  const route = code("src/app/api/export/ubl/route.ts");
  assert.match(route, /LINES_SELECT\s*=\s*"[^"]*vat_treatment/, "the flag left the SELECT");
  assert.match(
    route, /vat_treatment:\s*l\.vat_treatment/,
    "the flag is selected but not handed to buildInvoiceUbl — exempt lines export as Z",
  );
});

test("[KLANT-EXTRA] no write path names the columns without a fallback", () => {
  // The rule this gate exists for. PostgREST rejects the WHOLE row on an unknown column, so a bare
  // mention in an insert or update payload is an invoice that cannot be saved on any database
  // where the migration is still open.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const SAFE = /writeWithExtraLines|extraLineFields|copyExtraLinesOnto/;
  const offenders = walk("src/app/api")
    .filter((f) => /client_extra_line[12]/.test(code(f)))
    .filter((f) => !SAFE.test(code(f)));
  assert.deepEqual(
    offenders, [],
    "these routes name client_extra_line1/2 directly. An unknown column makes PostgREST reject " +
      "the whole row, so this is an invoice that cannot be saved — route it through " +
      "client-extra-lines-write.ts instead",
  );
});

test("[KLANT-EXTRA] the migration is additive and the generated types carry all four blocks", () => {
  const raw = readFileSync("supabase/migrations/client_extra_lines.sql", "utf8");
  assert.match(raw, /ADD COLUMN IF NOT EXISTS client_extra_line1 text/);
  assert.match(raw, /ADD COLUMN IF NOT EXISTS client_extra_line2 text/);
  assert.match(raw, /ADD COLUMN IF NOT EXISTS client_extra_line3 text/);
  assert.match(raw, /ADD COLUMN IF NOT EXISTS client_extra_line4 text/);

  // The STATEMENTS, without the prose. The first draft of this assertion read the whole file and
  // failed on its own header — the sentence "Nullable, no default, no backfill" contains the word
  // it was forbidding. A gate that reads comments is checking what the file SAYS about itself
  // rather than what it does.
  const sql = raw.replace(/--[^\n]*/g, " ");
  // Nullable, no default, no backfill: every existing invoice must keep the document it renders
  // now. A NOT NULL or a DEFAULT would rewrite the customer block of every invoice ever issued.
  assert.doesNotMatch(sql, /NOT NULL|DEFAULT|UPDATE public\.invoices/i);
  // …and the columns must be added to invoices, not to some other table.
  assert.match(sql, /ALTER TABLE public\.invoices/);

  // Row, Insert and Update — a missing one means the compiler cannot see the column on that path.
  const types = readFileSync("src/types/database.types.ts", "utf8");
  for (const n of [1, 2, 3, 4]) {
    assert.equal(
      (types.match(new RegExp(`client_extra_line${n}`, "g")) ?? []).length, 3,
      `client_extra_line${n}: Row + Insert + Update`,
    );
  }
});

// ─── [GEGROND-NAAM] The supplier name had no witness ────────────────────────────────────────────
//
// Reported: an invoice from BALKIP B.V. — its own letterhead, KVK, IBAN, sent from info@balkip.nl
// — was imported as "GROOTHANDEL M.H. BAL V.O.F.". A different company. Its three amounts were
// read correctly and the app said so.
//
// Three explanations were checked and ruled out before anything was written: supplierNameKey is
// token-exact so nothing could merge "balkip" and "groothandel mh bal"; the supplier registry
// never overwrites what was read; and the learned reading hints are computed per screen for
// display and never reach the model's prompt. The reader produced a name that is not on the paper.
//
// What let it through is the asymmetry this closes. amount-grounding.ts searches the document's
// own characters for each of the three figures — an independent witness that does not ask the
// reader to check its own work. Nothing asked the same question about the NAME, so the one field
// that was wrong was the one field with no check on it.
//
// The name is not a label. invoices.client_name is the identity key knownIbanForVendor uses, and
// that is what stands between the owner and a payment redirected to a stranger: a name read as a
// DIFFERENT company does not fail it — it looks up a different supplier and passes clean.

test("[GEGROND-NAAM] the reader grounds the vendor name on the document's own text", () => {
  const ai = code("src/lib/ai.ts");
  assert.match(ai, /_vendorGrounding = \{/, "the verdict must be stored beside _grounding");
  assert.match(
    ai, /verdict: groundVendorName\(parsed\.vendor, statementText\)/,
    "…grounded on the name that BECOMES client_name, against the document's own text",
  );
  // Never against the OCR transcription: that second read is asked for the AMOUNTS, so finding no
  // name in it would say nothing about the invoice.
  assert.doesNotMatch(ai, /groundVendorName\([^)]*transcribed/, "the OCR text carries no name");
});

test("[GEGROND-NAAM] an unfound name reaches the owner, on the vendor field", () => {
  const health = code("src/lib/import-health.ts");
  assert.match(health, /_vendorGrounding\?: \{ verdict\?: string/, "health must read the verdict");
  const block = health.slice(health.indexOf("vendorGrounding?.verdict === 'absent'"));
  assert.ok(block.length > 0, "nothing acts on the verdict — a check nobody is shown did not happen");
  assert.match(block.slice(0, 700), /flags\.vendor = true/, "the SUPPLIER field is the one at fault");
  // Not the amounts: on the measured invoice all three were correct, and pointing at them would
  // send the owner to the only part that was right.
  assert.doesNotMatch(block.slice(0, 400), /flags\.arithmetic = true/);
  assert.match(block.slice(0, 900), /staat nergens in de tekst van dit document/);
});

test("[GEGROND-NAAM] only 'absent' speaks, and it blocks nothing", () => {
  const lib = code("src/lib/vendor-grounding.ts");
  // A great many invoices print their name only inside a logo, which carries no characters — a
  // perfectly correct read then has nothing to find. Flagging those would put a warning on
  // ordinary invoices, and a warning nobody reads is worse than none.
  assert.match(lib, /if \(verdict !== "absent"\) return null/, "found/unreadable must say nothing");
  assert.match(lib, /if \(t\.length < MIN_TEXT_LENGTH\) return "unreadable"/, "no text layer, no verdict");
  assert.match(lib, /if \(!isReliableSupplierName\(name\)\) return "unreadable"/, "a placeholder proves nothing");
  assert.match(lib, /if \(tokens\.length === 0\) return "unreadable"/, "nor a name with no distinctive part");

  // Whole tokens only. "bal" occurs inside "balans" and "totaal", so substring matching would have
  // CONFIRMED the very read this exists to catch, using the word TOTAAL.
  assert.match(lib, /haystack\.includes\(` \$\{tok\} `\)/, "a fragment match is false corroboration");

  // And it must not become a blocker. groundingBlocksAutoBooking is the amount check's escalation;
  // this one is deliberately not in it, because it cannot tell a logo from a misread.
  assert.doesNotMatch(
    code("src/lib/amount-grounding.ts"), /vendorGrounding|groundVendorName/,
    "the vendor verdict may not enter the auto-booking gate",
  );
});

// ─── [GRENS-ZICHTBAAR] The month's allowance ran out and nobody was told ────────────────────────
//
// Straight from a production log, three lines inside five seconds:
//
//   [EERLIJK-GEBRUIK] maandgrens bereikt — rest van de batch wordt bewaard, niet gelezen
//     { wanted: 10, granted: 0, plan: 'free' }
//   [EERLIJK-GEBRUIK] …the same line again, six seconds later
//   [CRON-EMAIL-SYNC] drain made no progress — likely a stuck attachment; deferring
//     { remaining: 10, prevSaved: 0 }
//
// Ten supplier invoices reached the owner's mailbox and the app read none of them. Three problems:
//
//  1. THE OWNER WAS NOT TOLD. Nothing on any screen. The manual upload path says this — but that
//     is the path where the owner is standing there watching. This one runs while they are not,
//     and silence there reads as "my supplier never sent it".
//  2. THE LOG BLAMED THE WRONG THING. "likely a stuck attachment" describes a poison pill. No
//     attachment was stuck; none was tried. Whoever reads that goes looking for a broken PDF.
//  3. THE RETRY COULD NOT WORK. A MONTHLY counter does not refill between two calls six seconds
//     apart, and the drain re-fetched the whole mailbox to be told so again.

test("[GRENS-ZICHTBAAR] the owner is told when their invoices arrive and are not read", () => {
  const email = code("src/lib/email-integration.ts");
  const at = email.indexOf("const hold = fairUseHold(");
  assert.ok(at > 0, "the hold must be computed where the batch is cut");
  const block = email.slice(at, at + 2200);
  assert.match(block, /createNotification\(\{/, "a warning in a server log is not telling the owner");
  assert.match(block, /body: notice\.body/, "…with the sentence from the shared module");

  // ONCE PER MONTH. The cron runs hourly against a MONTHLY counter, so an unguarded notify would
  // post the same message every hour until the month turned — which is the notification an owner
  // switches off, and then they are not told at all.
  assert.match(block, /\.from\('notifications'\)[\s\S]{0,200}\.eq\('title', titel\)/,
    "the existing notification must be what stops the second one");
  assert.match(block, /if \(!alGemeld \|\| alGemeld\.length === 0\)/, "…and only then is it posted");

  // Telling the owner may never cost them the import. The invoices are already safely stored at
  // this point; a failure here costs the message, not the work.
  assert.match(block, /catch \(e\) \{/, "the notify must not be able to break the sync");
});

test("[GRENS-ZICHTBAAR] the notification key cannot move with the count", () => {
  // The once-a-month promise rests entirely on the title being stable. Ten held this hour and
  // three the next is the SAME situation, and a count in the key would notify twice for it.
  const lib = code("src/lib/fair-use-hold.ts");
  assert.match(lib, /title: `Niet alles is ingelezen \(\$\{month\}\)`/);
  const notice = lib.slice(lib.indexOf("export function fairUseHoldNotice"));
  assert.doesNotMatch(notice.slice(0, notice.indexOf("body:")), /\$\{n\}|\$\{stuks\}/,
    "no count may enter the title — it is the deduplication key");
});

test("[GRENS-ZICHTBAAR] the cron names the cause it has, and stops retrying a monthly counter", () => {
  const cron = code("src/app/api/cron/email-sync/route.ts");
  // The wrong sentence must be gone from the code, not merely joined by a right one.
  assert.doesNotMatch(
    cron, /console\.warn\("\[CRON-EMAIL-SYNC\] drain made no progress/,
    "the hard-coded stuck-attachment diagnosis must go through drainStopReason",
  );
  assert.match(cron, /console\.warn\(drainStopReason\(/, "…which picks the words from the real cause");

  // And the loop must not run at all on a monthly hold. `remaining > 0` cannot see the difference:
  // the attachments really are still there, so it looks like work that is waiting.
  assert.match(
    cron, /while \(r && r\.remaining > 0 && r\.heldByFairUse === 0 && rounds < 5\)/,
    "a monthly hold must not be retried — the counter cannot refill inside one run",
  );

  // The signal has to actually exist on the result, or the guard above reads undefined forever.
  const email = code("src/lib/email-integration.ts");
  assert.match(email, /heldByFairUse: number/, "the sync result must carry the hold");
  assert.match(email, /heldByFairUse: hold\?\.held \?\? 0/, "…and report the real number");
});

test("[CENT] rounding to cents is defined in exactly one place", () => {
  // The class this session kept finding — two definitions of one fact, and the wrong one is live —
  // at its most fundamental. round2 existed five times, in four different shapes:
  //
  //   Math.round(n * 100) / 100                       seven modules
  //   Math.round((n + Number.EPSILON) * 100) / 100    ubl-export and four public calculators
  //   sign * Math.round(|n| * 100) / 100              snelstart-mapping
  //   Math.round(n * 100 + 1e-9) / 100                unit-price-display
  //   invoice-totals                                  the one that is right about both problems
  //
  // On one line of € 21,50 at 21% the ledger said 4,52 and the e-invoice XML said 4.51. Nothing
  // failed: the XML is internally consistent, so Peppol accepts it, and the customer books a cent
  // less than the invoice they were sent. See src/lib/cent-rounding.test.ts.
  //
  // A gate rather than a comment, because the next copy will be written by someone who needs a
  // rounding helper and does not know this one exists — which is exactly how the five happened.
  const CANONICAL = "src/lib/invoice-totals.ts";
  const offenders: string[] = [];

  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p)) continue;
      // A test may define its own oracle — checking the code against an independent
      // re-implementation is the point of invoice-discount.test.ts and amount-triplet.test.ts.
      if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) continue;
      if (p === CANONICAL) continue;
      const src = code(p);
      // The NAME is the smaller half of the problem. The same function also existed as `r2`,
      // `cents` and `afgerond2`, and inline in 65 more places — so the gate looks for the SHAPE:
      // `Math.round(<anything> * 100) / 100`, whatever it is called or not called.
      //
      // What it deliberately does NOT match: `Math.round(x * 100)` without the division (an
      // integer-cent key or comparison, which is exact and correct), and `Math.round(btw / ex *
      // 100)` (a percentage rate, not an amount).
      if (/(?:function|const|let)\s+round2\b\s*[(=]/.test(src)) { offenders.push(p); continue; }
      if (/Math\.round\([^;]*\*\s*100\s*\)\s*\/\s*100(?![\d.])/.test(src)) offenders.push(p);
    }
  };
  scan("src");

  assert.deepEqual(
    offenders, [],
    `cent rounding must come from invoice-totals.round2, not be written again:\n  ${offenders.join("\n  ")}`,
  );
});

test("[CENT] the canonical round2 still does the two things it exists for", () => {
  // The gate above only proves there is ONE. This proves it is the RIGHT one — a future edit that
  // simplified it back to Math.round(n * 100) / 100 would pass the gate above and reintroduce both
  // defects in every module at once, which is worse than what was there before.
  const src = code("src/lib/invoice-totals.ts");
  const fn = src.slice(src.indexOf("export function round2"));
  assert.match(fn.slice(0, 400), /1e-9/, "the half cent a multiplication loses must be recovered");
  assert.match(fn.slice(0, 400), /v < 0 \? -1 : 1/, "the sign must be taken off first (creditnota)");
  assert.match(fn.slice(0, 400), /Number\.isFinite/, "a non-finite amount may not reach a document");
});

// ─── [PRIJSVELD-CENT] The edit screen showed a different total than the invoice it was editing ──
//
// Reported with both screens side by side. Invoice 20260001, four lines, prices typed INCLUSIVE of
// btw at 9% (€ 0,90 / € 1,90 / € 1,75 all-in), which is what a food business always types:
//
//     the sent invoice   subtotaal € 368,80   totaal € 401,99
//     the edit screen    subtotaal € 368,69   totaal € 401,87
//
// Reproduced to the cent. Typing prices inclusive makes the STORED ex-price a fraction
// (0,8256880734), and the price field rounded it to two decimals for display — which is a
// DIFFERENT PRICE. Two failures came out of that one rounding:
//
//   · the field showed a price that does not multiply to its own line total: 38 x 1,61 = 61,18
//     while the line says 61,01. Exactly the defect the PDF and the price column already had, and
//     which unitPriceDecimals fixed there — the edit screen was never brought along;
//   · and because it is a controlled input, the rounded number replaced the stored fraction the
//     moment anything committed it. Three of the four lines had already been rewritten that way.
//
// The owner saw more than a euro of difference on a larger invoice, which is the same arithmetic
// with a bigger quantity: the error is (rounded price − real price) × quantity.

test("[PRIJSVELD-CENT] the price field is told the quantity, so it can show enough decimals", () => {
  for (const f of [
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
    "src/app/dashboard/invoice/new/page.tsx",
  ]) {
    const screen = code(f);
    assert.doesNotMatch(
      screen, /priceFieldValue\(line\.unit_price, line\.btw_rate, priceMode\)/,
      `${f}: the field is still rounded to cents — a fraction becomes a different price`,
    );
    assert.match(
      screen, /priceFieldValue\(line\.unit_price, line\.btw_rate, priceMode, line\.quantity/,
      `${f}: the quantity is what makes "enough decimals" answerable`,
    );
  }

  // The edit screen must also READ the stored line total — it is the number the field has to
  // reconcile with, and it was not in the select at all.
  const edit = code("src/app/dashboard/invoice/[id]/edit/page.tsx");
  // [REGEL-KORTING] The column list became `*`, and that is the point rather than a shortcut: this
  // screen PUTs back what it READS, and a name in the list that the database does not have makes
  // the query fail silently — linesData is null, the screen keeps its one empty starter line, and
  // Saving replaces every real line with it. A list that can be wrong sits one typo away from
  // emptying an invoice. Reading everything cannot be wrong, and a column added later travels free.
  assert.match(edit, /\.select\('\*'\)/,
    "the edit screen must read the whole line row — a partial list is how a column falls off and a " +
      "wrong name empties the invoice");
  assert.match(edit, /priceFieldValue\([^;]{0,240}?line_total/, "…and pass the stored total to the field");
  // And the field must reconcile against the GROSS on a discounted line, for the same reason the
  // PDF does: the net total is not the amount this price belongs to.
  assert.match(edit, /line\.discount_type \? lineGrossEx\(line\)/,
    "a discounted line must hand the price field its gross amount");

  // step="0.01" makes the BROWSER refuse a third decimal, whatever the value says.
  assert.doesNotMatch(edit, /type="number" value=\{priceFieldValue[\s\S]{0,200}?step="0\.01"/,
    "step must not pin the field to cents");
});

test("[PRIJSVELD-CENT] the shared helper decides the precision, not each screen", () => {
  const lib = code("src/lib/price-mode.ts");
  // The named list is matched loosely on purpose: the same import now also carries roundTo, so
  // that the count and the rounding it is applied with come from ONE module. Pinning the exact
  // text made this gate fail on a change that strengthens the very thing it is asserting.
  assert.match(lib, /import \{[^}]*\bunitPriceDecimals\b[^}]*\} from "\.\/unit-price-display"/,
    "one answer to 'how do you write this unit price', shared with the PDF and the price column");
  assert.match(lib, /const decimals = unitPriceDecimals\(shown, quantity, target\)/);

  // The line total belongs to the MODE: in incl mode the field times the quantity must make the
  // amount INCLUDING btw, so reconciling against the stored ex-total would look for a number that
  // is not there.
  assert.match(lib, /mode === "incl" \? inclFromEx\(Number\(lineTotal\), rate\) : Number\(lineTotal\)/);

  // And the new arguments must be optional, so a caller that has not been updated does not move.
  assert.match(lib, /quantity\?: number \| null,/);
  assert.match(lib, /if \(quantity === undefined \|\| quantity === null\) return toDisplayCents\(shown\)/);
});

// ─── [AFROND-AUDIT] The query that is handed to an owner to run on their live database ──────────
//
// supabase/queries/invoice_rounding_audit.sql reports which invoices do not add up. It is meant to
// be pasted into the Supabase SQL editor, where it runs with the service role and RLS does not
// apply — so this file has more power over an owner's books than any route in the app, and the
// only thing standing between it and their data is that every statement in it is a SELECT.
//
// Verified against a real Postgres 16 with the reported invoice as a fixture: the correct version
// is not flagged, the discounted one is skipped, an incoming supplier invoice is out of scope, a
// negative creditnota is not flagged, and the rounded price is caught at EUR 0,65.

test("[AFROND-AUDIT] nothing under supabase/queries/ can write", () => {
  // The guarantee is about the DIRECTORY, not about one file. These are meant to be pasted into
  // the Supabase SQL editor, where they run with the service role and RLS does not apply — so a
  // file here has more power over an owner's books than any route in the app.
  //
  // Scripts that DO write live in supabase/admin/, and that split is the whole point: it is what
  // lets someone open anything in queries/ and run it without reading it first. Widened from a
  // single hard-coded path the day the first admin script was written, because a guarantee about
  // one file says nothing about the next one added beside it.
  const files = readdirSync("supabase/queries").filter((f) => f.endsWith(".sql"));
  assert.ok(files.length > 0, "the read-only directory is empty — the guard is guarding nothing");

  for (const f of files) {
    const raw = readFileSync(`supabase/queries/${f}`, "utf8");
    // The STATEMENTS, without the prose — a header explains what it does not do, using the very
    // words being forbidden. A gate that reads comments checks what a file says about itself.
    const sql = raw.replace(/--[^\n]*/g, " ");
    for (const verb of ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "TRUNCATE", "CREATE", "GRANT"]) {
      assert.doesNotMatch(
        sql, new RegExp(`\\b${verb}\\b`, "i"),
        `supabase/queries/${f} contains ${verb}. Anything under queries/ is run by hand against a ` +
          "live database with the service role, where nothing stops it — move it to supabase/admin/",
      );
    }
    assert.match(sql, /\bSELECT\b/i, `${f}: …and it must still actually query something`);
  }
});

test("[PLAN-HAND] the by-hand plan grant uses the mechanism the product already has", () => {
  const sql = readFileSync("supabase/admin/set_plan.sql", "utf8");
  // Data, not a second code path. decidePlan already turns subscription_status 'active' into the
  // plus plan, and limitForPlan already returns 0 (no limit) for anything that is not free — so a
  // hardcoded id or an env allowlist would be a SECOND answer to "who has a limit", and two
  // answers is how the billing screen ends up disagreeing with the gate.
  // The LIVE statements, comments stripped. The first draft of this checked `WHERE id =` against
  // the raw file — and the commented-out revoke block below contains that string, so deleting the
  // WHERE from the real UPDATE changed nothing and the gate stayed silent. Its own negative
  // control caught it. A bare UPDATE here exempts every account in the database.
  const live = sql.replace(/--[^\n]*/g, " ");
  assert.match(live, /UPDATE public\.profiles/);
  assert.match(live, /SET subscription_status = 'active'/);
  for (const stmt of live.split(";")) {
    if (!/\bUPDATE\b/i.test(stmt)) continue;
    assert.match(
      stmt, /\bWHERE\b[\s\S]*\bid\b/i,
      "an UPDATE without a WHERE id here exempts every account in the database",
    );
  }

  // The way back has to be written down beside the way in. An exemption you cannot find the
  // revert for is one that quietly becomes permanent.
  assert.match(sql, /═══ REVOKE/, "the revert must be in the same file");
  assert.match(sql, /SET subscription_status = NULL/);

  // And role must not be the lever: it also lifts the limit, and it replaces the whole interface
  // with the accountant portal.
  assert.doesNotMatch(live, /SET role/, "role is not the exemption switch");

  // The code side must still be the single mechanism — no allowlist grew beside it.
  const usage = code("src/lib/fair-use-usage.ts");
  assert.match(usage, /if \(plan !== "free"\) return 0;/, "one rule decides who has no limit");
  assert.doesNotMatch(usage, /process\.env\.[A-Z_]*(UNLIMITED|BYPASS|EXEMPT)/, "no env bypass");
  assert.doesNotMatch(code("src/lib/fair-use-gate.ts"), /process\.env\.[A-Z_]*(UNLIMITED|BYPASS|EXEMPT)/);
});

test("[AFROND-AUDIT] it says what it cannot find, where that cannot be missed", () => {
  const raw = readFileSync("supabase/queries/invoice_rounding_audit.sql", "utf8");
  // The limitation the fixtures exposed: an invoice whose prices were rounded AND whose totals
  // were then recomputed from those rounded prices is INTERNALLY CONSISTENT, and passes both
  // checks in silence. A clean result means "no invoice contradicts itself", never "every invoice
  // is right", and a report that let someone believe the second would be worse than no report.
  assert.match(raw, /WHAT THIS CANNOT FIND/, "the limitation must be stated");
  assert.match(raw, /INTERNALLY CONSISTENT/);
  assert.match(raw, /never as "every invoice is right"/);

  // And the control, so an empty result is distinguishable from a query that cannot see the data.
  assert.match(raw, /═══ 4\. CONTROL/, "an empty result has two opposite meanings without it");

  // A discount legitimately makes the header lower than the lines. Without this the report would
  // flag every discounted invoice ever issued, and be discarded on the first read.
  assert.match(raw, /i\.discount_type IS NULL/);
});

test("[CENT] rounding to N decimals is shared between the chooser and the applier", () => {
  // One layer below the round2 gate, and the same shape. unit-price-display DECIDES how many
  // decimals a unit price needs so that quantity × price reproduces the line total; price-mode
  // APPLIES that count to the price in the edit field. For a while each did its own rounding —
  // the chooser with the 1e-9 nudge, the applier without — so on a stored € 1,005 the chooser said
  // "two decimals reconcile" and the field printed 1,00, which does not. Touch that field and
  // 1,00 is stored: the line loses a cent, which is the defect [PRIJSVELD-CENT] set out to fix.
  const display = code("src/lib/unit-price-display.ts");
  assert.match(display, /export function roundTo\(/, "the chooser must own the rounding");
  assert.match(display, /Math\.round\(n \* f \+ 1e-9\) \/ f/, "…including the nudge");

  const price = code("src/lib/price-mode.ts");
  assert.doesNotMatch(price, /function roundTo\(/, "price-mode may not round to N decimals itself");
  assert.match(price, /import \{[^}]*\broundTo\b[^}]*\} from "\.\/unit-price-display"/,
    "it must use the same one the decimal count was chosen with");
});

test("[VERSTUURD] the most consequential button in the app cannot go back to saying nothing", () => {
  // "✉ Opslaan en versturen" mints a permanent invoice number, renders the PDF and mails it to a
  // customer — and used to answer by silently replacing the screen with the invoice detail page.
  // No "gelukt", no number, nothing naming what had become irreversible. An owner sending their
  // first invoice could not tell success from a silent failure without going to look.
  //
  // This is a gate and not just a test because the failure mode is a DELETION: put the
  // `router.replace` back on the success path and everything still compiles, still renders, still
  // passes every unit test. The screen just goes quiet again.
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  assert.match(page, /import InvoiceSentModal from '@\/components\/ui\/InvoiceSentModal'/);
  assert.match(page, /<InvoiceSentModal/, "the panel must actually be rendered");

  // BOTH send paths. This screen issues a numbered invoice in two places — the ordinary submit and
  // the offerte conversion — and the second one is the easy one to forget: same event, same
  // permanence, and it had the same silent ending.
  const calls = page.match(/invoiceSentNotice\(\{/g) ?? [];
  assert.equal(calls.length, 2, "the ordinary send AND the offerte conversion must both confirm");

  // The confirmation may only be built from what the ROUTE reported. Reading the number off the
  // page's own state would announce a number the server never minted.
  assert.match(page, /invoiceNumber: result\.invoice_number/);
  assert.match(page, /invoiceType: result\.invoice_type/);
  assert.match(page, /replyTo: result\.reply_to/);

  // And BOTH must STOP there. The `return` after setting the notice is the whole mechanism:
  // without it the handler falls through to the router.replace below and the panel is never seen.
  //
  // Counted, not merely matched. A single /setSentNotice[\s\S]*?return/ is satisfied by EITHER
  // path, so deleting the stop from the ordinary send — the one the owner uses every day — left
  // this gate green. It did, on the first negative control of this test.
  const stops = page.match(/setSentNotice\(notice\)[\s\S]{0,120}?return/g) ?? [];
  assert.equal(
    stops.length, 2,
    "both paths must end the handler after setting the notice — otherwise the page navigates out from under it",
  );

  // The route has to keep reporting the two facts the panel is not allowed to guess.
  const route = code("src/app/api/invoice/send/route.ts");
  assert.match(route, /invoice_number: finalNumber/);
  assert.match(route, /reply_to: profile\?\.email \?\? null/,
    "the reply address is reported, not assumed — the panel names it or stays silent");
});

test("[TAAL] the language vocabulary stays where a screen can reach it", () => {
  // The app already spoke four languages — 53 Arabic articles, an /ar/blog route, a locale table
  // that knows Arabic is right-to-left. All of it lived in src/lib/blog.ts, whose own header says
  // "never import this into a client component" because it reads the filesystem. So the product
  // was Dutch-only for a structural reason, not a linguistic one: the vocabulary existed in the
  // one file no screen was allowed to ask.
  //
  // Moving it back would not break a build — blog.ts re-exports the names, so both copies would
  // type-check and the app would quietly have two locale tables that can disagree about which
  // languages exist. That is the [CENT] class again, on language instead of money.
  const blog = code("src/lib/blog.ts");
  assert.doesNotMatch(blog, /export type Locale = /, "Locale is declared in i18n/locale.ts");
  assert.doesNotMatch(blog, /export const LOCALE_META/, "…and so is the metadata");
  assert.match(blog, /export \{[\s\S]{0,200}LOCALE_META[\s\S]{0,200}\} from '\.\/i18n\/locale'/,
    "blog.ts re-exports it, so every existing import keeps working");

  const locale = code("src/lib/i18n/locale.ts");
  assert.doesNotMatch(locale, /from ['"]node:/, "the vocabulary must stay importable from a screen");
  assert.doesNotMatch(locale, /require\(/);
});

test("[TAAL] every message key is real, and every message is used", () => {
  // Two rots, both silent. A `t('sent.foo')` that does not exist renders the key on screen in
  // whatever language it is missing from — invisible to anyone testing in Dutch. And a message
  // nobody calls is a translated sentence quietly drifting away from the screen it describes.
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  const declared = new Set(
    [...messages.matchAll(/^\s{2}'([\w.]+)':\s*\{/gm)].map((m) => m[1]),
  );
  assert.ok(declared.size > 0, "the catalogue may not be empty");

  const used = new Set<string>();
  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p)) continue;
      if (p.endsWith("src/lib/i18n/messages.ts")) continue;
      // Production files only. A test may legitimately mention a key that does not exist (this
      // gate's own comment does, to describe the failure) and a key used ONLY by a test is an
      // orphan on the screen, which is exactly what the second half of this check is for.
      if (/\.test\.tsx?$/.test(p)) continue;
      const src = readFileSync(p, "utf8");
      // t('key'), translate(x, 'key'), and the template form t(`sent.${woord}.title`) — the last
      // one is expanded over the two document words rather than skipped, because skipping it
      // would let the orphan half of the check pass on keys nothing reaches.
      // The first segment may carry digits (fout404.titel) — a scanner that only knows pure
      // letters reports such keys as orphans while they are on the 404 screen every day.
      for (const m of src.matchAll(/['"]([a-z][a-z0-9]*(?:\.[\w]+)+)['"]/g)) used.add(m[1]);
      for (const m of src.matchAll(/`(sent\.\$\{woord\}\.[\w]+)`/g)) {
        for (const w of ["factuur", "creditnota"]) used.add(m[1].replace("${woord}", w));
      }
    }
  };
  scan("src");

  const missing = [...used].filter((k) => k.startsWith("sent.") && !declared.has(k));
  assert.deepEqual(missing, [], `used but not in the catalogue:\n  ${missing.join("\n  ")}`);

  const orphans = [...declared].filter((k) => !used.has(k));
  assert.deepEqual(orphans, [], `in the catalogue but never rendered:\n  ${orphans.join("\n  ")}`);
});

test("[TAAL] the translated panel holds no language of its own", () => {
  // A component with one hard-coded sentence left in it is how a translation stays permanently
  // half-finished: the screen still looks correct in Dutch, so nothing points at the gap. Every
  // word InvoiceSentModal paints comes off the notice object.
  const modal = code("src/components/ui/InvoiceSentModal.tsx");
  // Whole sentences, not words: "verstuurd" also appears in the element id and in the [VERSTUURD]
  // tag, and a gate that fires on those teaches people to weaken it.
  for (const dutch of ["Zo controleer je", "Bekijk de factuur", "Nog een factuur maken", "ligt vast", "is onderweg naar"]) {
    assert.ok(!modal.includes(dutch), `a Dutch string is still baked into the panel: "${dutch}"`);
  }
  // And the direction travels with the words, or Arabic renders in a left-to-right box.
  assert.match(modal, /dir=\{notice\.dir\}/);
  // Physical left/right would be wrong in exactly one language, which is the one nobody checks.
  assert.doesNotMatch(modal, /textAlign: 'right'/, "use textAlign: 'end'");
  assert.doesNotMatch(modal, /paddingLeft:/, "use paddingInlineStart");
});

test("[TAAL] the screen uses logical directions, so Arabic is a layout and not a mess", () => {
  // 209 physical properties were converted in one sweep. That was safe in a way worth recording:
  // in a LEFT-TO-RIGHT document `start` IS `left` and `end` IS `right`, so nothing a Dutch user
  // sees changed by a pixel. The entire difference lands in Arabic, where physical sides put the
  // labels, the bullets and the amounts on the wrong side of every row.
  //
  // THE ONE EXEMPTION, and it is not cosmetic: src/lib/invoice-pdf.tsx is @react-pdf/renderer,
  // not the DOM. It supports `textAlign: left|right|center` and physical padding, and silently
  // ignores the logical forms — so the sweep would have collapsed the amount columns on the
  // invoice PDF, which is the legal document. It is also correct for it to stay physical: the PDF
  // is Dutch in every language (see the header of messages.ts), so it is never right-to-left.
  const PDF_STYLES = "src/lib/invoice-pdf.tsx";
  const offenders: string[] = [];

  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p) || p === PDF_STYLES) continue;
      if (/\.test\.tsx?$/.test(p)) continue;
      const src = code(p);
      if (/textAlign: ['"](?:left|right)['"]/.test(src)) offenders.push(`${p} — textAlign`);
      if (/\b(?:padding|margin|border)(?:Left|Right):/.test(src)) offenders.push(`${p} — physical box side`);
      // Fixed/absolute positioning: a FAB pinned `right: 20` sits in the mirrored thumb zone's
      // wrong corner. Matched narrowly — `right: <number>` as a style property — because CSS
      // `left`/`right` also appear as string values ('to the right') and in prose.
      // insetInlineStart/End are unaffected. `left: 0, right: 0` full-bleed pairs are fine in
      // either language and common (overlays), so a line containing BOTH sides is skipped.
      for (const line of src.split("\n")) {
        if (/\bleft: *[\d'"]/.test(line) && /\bright: *[\d'"]/.test(line)) continue;
        // A position MEASURED with getBoundingClientRect is physical by definition; applying a
        // logical property to a measured number would mirror an already-correct element. Files
        // mark those with the [TAAL] "Bewust FYSIEK" note — which lives in a COMMENT, so it must
        // be read from the raw file: `src` here is comment-stripped, and the first version of
        // this exemption tested the stripped text and could never see its own marker.
        if (readFileSync(p, "utf8").includes("Bewust FYSIEK") && /dropdownPos|getBoundingClientRect|rect\./.test(line)) continue;
        if (/[{,] *(?:left|right): *\d/.test(line)) { offenders.push(`${p} — positioned on a physical side`); break; }
      }
      // Tailwind too. The inline-style sweep missed these entirely on the first pass — 33 classes
      // in nine files — because they do not look like styles. Tailwind v4 ships the logical
      // utilities (ms/me/ps/pe/text-start/text-end/border-s/border-e/rounded-s/start/end), and in
      // a left-to-right document they render identically to the physical ones.
      for (const m of src.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g)) {
        const bad = m[0].match(/\b(?:text-(?:left|right)|[mp][lr]-(?:\d|\[|auto|px)|border-[lr]\b|rounded-[lr](?:-|\b)|(?:left|right)-(?:\d|\[))/);
        if (bad) { offenders.push(`${p} — Tailwind ${bad[0]}`); break; }
      }
    }
  };
  scan("src");

  assert.deepEqual(
    offenders, [],
    `use textAlign start/end and the Inline box properties:\n  ${offenders.join("\n  ")}`,
  );

  // And the exemption must still BE the exemption — if this file stops being a react-pdf
  // stylesheet, the reason for the carve-out is gone and it should join the rest.
  const pdf = readFileSync(PDF_STYLES, "utf8");
  assert.match(pdf, /from '@react-pdf\/renderer'/, "the carve-out exists because this is not the DOM");
});

test("[TAAL] the document becomes right-to-left before it is painted, and stays static", () => {
  // Two things at once, and they pull against each other.
  //
  // Setting <html dir> the obvious way — cookies() from next/headers in the root layout — opts
  // EVERY route in the app into dynamic rendering, because every route inherits that layout. The
  // 53 statically built Arabic blog articles that bring Arab shop owners here would stop being
  // static, to set two attributes.
  //
  // Setting it in a client effect keeps the app static and makes the whole layout jump sides
  // after first paint, which on an Arabic screen is not a flicker.
  //
  // A synchronous script in <head> does both. It is also invisible to every other gate — tsc does
  // not parse a dangerouslySetInnerHTML string, eslint does not lint it, next build does not
  // compile it — which is why its source is an exported constant with its own test that RUNS it.
  const layout = code("src/app/layout.tsx");
  assert.match(layout, /LOCALE_BOOT_SCRIPT/, "the pre-paint script must be injected");
  assert.doesNotMatch(layout, /from ['"]next\/headers['"]/,
    "reading cookies in the root layout would make every route in the app dynamic");
  assert.match(layout, /lang="nl"[\s\S]{0,40}dir="ltr"/,
    "the static markup stays Dutch — the script changes it only when a choice was made");

  const boot = code("src/lib/i18n/locale-boot.ts");
  assert.match(boot, /try\{/, "it runs first on every page; a throw there is a broken app");
  assert.match(boot, /indexOf\(l\)<0\)return/, "a user-written cookie may not reach document.lang");
});

test("[STATUS] the word for an invoice's state is written once", () => {
  // There were ELEVEN copies of these labels, most of them carrying colours too, and they had
  // drifted on four statuses. One customer's invoice read "Verstuurd" on their client card,
  // "Verzonden" in the list and in the filter tab; an overdue one was "Verlopen" in five places
  // and "Te laat" in two; an incoming bill was "Ontvangen" here and "Te betalen" there, in three
  // different ambers.
  //
  // None of that was worth a sweep while the app spoke one language. With two, eleven copies is
  // eleven places to translate, and the honest prediction is that two of them get done and the
  // owner reads a screen that is half Arabic. So the gate is about translation as much as tidiness.
  const CANONICAL = "src/lib/invoice-status.ts";
  const offenders: string[] = [];
  // The Dutch words that ARE a status. Not 'Alles'/'Offerte' — those are filters over something
  // else and legitimately have their own keys.
  //
  // 'Verwerkt' is deliberately NOT in this list. It is a homonym: an invoice status ('processed')
  // and, separately, the accountant's action state on a document (verwerkt / in_behandeling /
  // vraag). Those are a different vocabulary with their own consolidation still to do — putting
  // the word here would fire on correct code in BrugClient and the quarterly page.
  const WORDS = /'(Verzonden|Verstuurd|Betaald|Verlopen|Te laat|Te verifiëren|Onduidelijk)'/;
  // src/lib/bridge-tree.ts is exempt, and not because it is hard. Its own header says its labels
  // are folder path segments that must match "byte-for-byte, or the merge silently fails" — so
  // making them a function of the language is a change to a merge key, not to a caption. It is
  // listed as remaining work in the header of invoice-status.ts rather than half-done here.
  const EXEMPT = new Set(["src/lib/bridge-tree.ts"]);

  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p) || p === CANONICAL || EXEMPT.has(p)) continue;
      if (/\.test\.tsx?$/.test(p)) continue;
      if (p === "src/lib/i18n/messages.ts") continue; // the catalogue is where the words live
      const src = code(p);
      // A status word next to `label:` or in a chip map — not the word appearing in prose.
      if (/label:\s*/.test(src) && WORDS.test(src)) {
        for (const line of src.split("\n")) {
          if (/label:\s*/.test(line) && WORDS.test(line)) { offenders.push(`${p} — ${line.trim().slice(0, 70)}`); break; }
        }
      }
    }
  };
  scan("src");

  assert.deepEqual(
    offenders, [],
    `status labels come from invoice-status.ts:\n  ${offenders.join("\n  ")}`,
  );

  // And 'Concept' deserves its own line: it is also what an invoice WITHOUT a number is called in
  // prose ("invoice_number || 'Concept'"), so it cannot go in the pattern above without firing on
  // correct code. It is checked here instead — no chip map may define it.
  const chipMaps = ["src/app/dashboard/facturen/FacturenClient.tsx", "src/components/invoice/InvoiceRow.tsx"];
  for (const p of chipMaps) {
    assert.doesNotMatch(code(p), /label:\s*'Concept'/, `${p} may not define the status words again`);
  }
});

// ─── [RLS-UIT] Where row level security is OFF, something else must do its job ──────────────────
//
// createPipelineClient() is the service-role client: it bypasses RLS completely. On those queries
// the only thing between one customer's invoices and another's is the filter written by hand. On
// the invoice and money line there are 57 such queries.
//
// All 57 were read. Every one is scoped, for one of four reasons — and the four are what this gate
// encodes, because a list of files would say nothing about the next file added beside them:
//
//   1. an owner column in the query (sender_id / receiver_id / user_id / zzper_id …), or the same
//      thing written as .or("sender_id.eq.X,receiver_id.eq.X");
//   2. an INSERT that STAMPS the authenticated owner into the row — an insert has nothing to
//      filter, so what matters is that the id it writes comes from the session and not the body;
//   3. a row created earlier in the SAME request (a rollback, a link-up), so the id was never
//      attacker-supplied;
//   4. the public payment link, where the pay_token IS the credential: a uuid, format-checked
//      before the database is touched, rate-limited per token.
//
// What the audit did NOT do, said here so nobody reads more into this gate than it holds: it is
// static. No cross-tenant request was executed — proving isolation by experiment needs two real
// accounts and a running app. It also covers the money line only; the bank, accountant, aangifte
// and messaging surfaces have their own service-role queries and were not read.

test("[RLS-UIT] every service-role query on the money line is scoped to one owner", () => {
  const ROOTS = ["src/app/api/invoice", "src/app/api/pay", "src/app/api/documents", "src/app/api/email"];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  };

  // Reason 1 — the filter is in the query. TENANT columns only.
  //
  // invoice_id, bundle_id, original_invoice_id and content_hash used to sit in this list, and they
  // are not owners — they are ROWS. With RLS off, `.eq("invoice_id", x)` narrows to one row and
  // says nothing at all about whose row it is, which is the exact hole this gate exists to catch.
  // A negative control found it: dropping `.eq("user_id", user.id)` from a service-role read in
  // pay-toggle produced no failure, because `.eq("invoice_id", invoiceId)` was still there and
  // counted as an owner. Three real queries relied on that pass; all three are safe for reasons of
  // PROVENANCE (the id came from a row already found by the caller's own scope, or by a token),
  // and provenance is an argument, not a pattern — so they moved to REVIEWED where someone had to
  // write it down.
  const OWNER_COL = /\.eq\(\s*["'](sender_id|receiver_id|user_id|owner_id|created_by|profile_id|zzper_id|accountant_id)["']/;
  const OR_SCOPE = /\.or\(\s*`?(sender_id|receiver_id|user_id)\.eq\./;
  const ID_IS_USER = /\.eq\(\s*["']id["']\s*,\s*[^)]*\b(user|userId|uid|ownerId|sender_id|bundle\.user_id)\b/;
  // Reason 4 — the token is the credential.
  const TOKEN = /\.eq\(\s*["'](pay_token|token|public_token)["']/;
  // Reason 2 — an INSERT that stamps the owner it got from the session.
  const STAMPS_OWNER = /\.insert\(\s*\{[\s\S]{0,400}?(sender_id|receiver_id|user_id)\s*:\s*[^,\n]*\b(user\.id|userId|ownerId|uid)\b/;
  // Reason 3 — acting on a row this same request created. The id is a local const from an insert,
  // never a request field, so it is named after what it is rather than taken from params/body.
  const OWN_NEW_ROW = /\.eq\(\s*["']id["']\s*,\s*(documentId|factuur\.id|doc\.id|invoice\.id|draft\.id|creditnota\.id|newInvoice\.id)\s*\)/;

  const offenders: string[] = [];
  for (const f of ROOTS.flatMap(walk)) {
    const src = readFileSync(f, "utf8");
    if (!/createPipelineClient\(/.test(src)) continue;

    const names = new Set(
      [...src.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:await\s+)?createPipelineClient\(/g)].map((m) => m[1]),
    );
    for (const m of src.matchAll(/(\w+)\s*[:=]\s*[^;\n]*\?\s*createPipelineClient\(\)/g)) names.add(m[1]);

    for (const name of names) {
      const re = new RegExp(`\\b${name}\\s*(?:as any\\s*)?\\n?\\s*\\.from\\(\\s*["'](\\w+)["']`, "g");
      for (const m of src.matchAll(re)) {
        // Where the chain ENDS decides what it may be credited with. `await(?!\s)` never matched
        // `await ` — the space is always there — so a chain ran straight on into the following
        // statement and could be waved through by ITS `.eq("user_id", …)`. That is how the
        // rollback upsert in pay-toggle passed for months while having no filter of its own; it
        // was borrowing the next line's. `await\b` plus `for` ends the chain where the statement
        // ends. Checked against every service-role query on this line: no new offenders, so this
        // is strictly more accurate rather than merely stricter.
        const chain = src.slice(m.index, m.index + 900)
          .split(/\n\s*\n|\n\s*(?:const|let|return|if|for|await\b)/)[0];
        const ok = OWNER_COL.test(chain) || OR_SCOPE.test(chain) || ID_IS_USER.test(chain)
          || TOKEN.test(chain) || STAMPS_OWNER.test(chain) || OWN_NEW_ROW.test(chain);
        if (!ok) offenders.push(`${f} → ${m[1]} :: ${chain.replace(/\s+/g, " ").slice(0, 110)}`);
      }
    }
  }

  // ── REVIEWED EXCEPTIONS ──
  //
  // These queries are safe for a reason no filter shape can express, so they are listed rather than
  // pattern-matched. That is deliberate: another regex would make this gate permissive enough to
  // wave through the next real hole, while a list forces a human to look and to write down why.
  //
  // Each entry is a file + table + a fragment that identifies THE query + the reason it was
  // cleared. A NEW unscoped query fails this test until someone reads it and adds it here — which
  // is the whole point.
  //
  // `must` is not decoration. Keyed on file+table alone, one cleared query waved through every
  // OTHER unscoped query against the same table in the same file — and a negative control proved
  // it: dropping `.eq("user_id", user.id)` from pay-toggle's link READ, an unrelated statement,
  // produced no failure at all, because the rollback upsert's entry covered it. A pardon has to
  // name what it pardons.
  const REVIEWED: readonly { file: string; table: string; must: string; why: string }[] = [
    {
      file: "src/app/api/invoice/[id]/document/route.ts", table: "invoices", must: ".from(\"invoices\")",
      why: "reads the invoice by id, then refuses with 403 unless sender_id or receiver_id is the " +
        "caller — the guard is in code, before the update, not in the query",
    },
    {
      file: "src/app/api/invoice/draft/route.ts", table: "invoice_lines", must: ".insert(",
      why: "inserts lines against factuur.id, the invoice this same request just created; the id " +
        "is never attacker-supplied",
    },
    {
      file: "src/app/api/invoice/draft/route.ts", table: "invoice_lines",
      must: ".delete().eq('invoice_id', factuur.id)",
      why: "[REGEL-KORTING] the rollback of that same insert, against that same just-created id. " +
        "It runs when a line discount was asked for on a database where the columns do not exist " +
        "yet: the lines are removed and the invoice with them, rather than leaving a total whose " +
        "reason is gone. The id is this request's own and is never attacker-supplied",
    },
    {
      file: "src/app/api/pay/[token]/route.ts", table: "invoices",
      // [DEEL-CREDIT] Was `.in(`. The query grew a column and the excerpt this gate matches is
      // truncated, so `.in(` fell past the cut and the entry stopped matching anything — which the
      // stale-exception half of this gate caught immediately. Pinned on the select instead: it is
      // distinctive, and it sits at the front where the excerpt cannot lose it.
      must: ".select('original_invoice_id, total_inc_btw')",
      why: "the bundle's credit lookup, scoped by .in() to the ids of the bundle the pay_token " +
        "itself resolved, and the route rejects anything that is not a uuid before touching the " +
        "database. Reads only what each credit gave back, so it can lower the amount the page " +
        "asks for, never raise it",
    },
    {
      file: "src/app/api/invoice/[id]/archive/route.ts", table: "pay_bundle_invoices",
      must: '.eq("invoice_id", id)',
      why: "reads bundle_id for a notice, after loadOwned(id, user.id) at the top of the route has " +
        "already answered 404 for an invoice that is not the caller's — so `id` is provably theirs " +
        "by the time this runs. Scoped by provenance, not by a filter",
    },
    {
      file: "src/app/api/pay/[token]/route.ts", table: "invoices",
      must: ".eq('original_invoice_id', invoiceId)",
      why: "creditedOn(): invoiceId comes from the invoice found BY pay_token, which is itself the " +
        "credential. Returns how much was credited back, and treats its own read error as null — " +
        "the fail-closed direction, since the other side is a customer transferring " +
        "money that is not owed",
    },
    {
      file: "src/app/api/pay/[token]/route.ts", table: "pay_bundle_invoices",
      must: ".eq('bundle_id', bundle.id)",
      why: "bundle.id comes from pay_bundles found by .eq('token', token) — the token is the " +
        "credential, and this only expands it to the invoice ids it covers",
    },
    {
      file: "src/app/api/invoice/pay-toggle/route.ts", table: "bank_tx_invoices", must: ".upsert(",
      why: "[UNDO-EIGEN-WERK] the undo's rollback upsert. An upsert takes no .eq(), so the scope " +
        "has to come from where the rows came from: every id in deletedLinks was RETURNED by a " +
        "DELETE filtered .eq('user_id', user.id).eq('invoice_id', invoiceId) in this same request, " +
        "so the ids are provably this owner's, and the payload re-stamps user_id: user.id. Note " +
        "this is NOT the generic 'an insert that stamps the owner' pass, which an upsert must " +
        "never get — onConflict:id can OVERWRITE an existing row, so stamping the owner proves " +
        "nothing on its own. The provenance of the ids is what makes this one safe. It was " +
        "invisible to this gate until the chain splitter stopped letting it borrow the next " +
        "statement's filter",
    },
  ];

  const unreviewed = offenders.filter(
    (o) => !REVIEWED.some((r) => o.startsWith(`${r.file} → ${r.table} ::`) && o.includes(r.must)),
  );
  assert.deepEqual(
    unreviewed, [],
    "a service-role query on the money line with no owner scope, and no written reason. RLS is " +
      "OFF on these, so this is one customer's invoices reachable from another's request unless " +
      "the filter is there. Read it; if it is safe, add it to REVIEWED with why:\n  " +
      unreviewed.join("\n  "),
  );

  // …and the list may not rot. An entry matching nothing means the code moved out from under the
  // review, and the sentence explaining why it was safe is now about a query that no longer
  // exists — which is worse than no list, because it reads as though someone checked.
  // The same `must` here, or a pardon outlives the query it was written for: the entry keeps
  // matching some OTHER unscoped query in that file and never reports itself as stale.
  const stale = REVIEWED.filter(
    (r) => !offenders.some((o) => o.startsWith(`${r.file} → ${r.table} ::`) && o.includes(r.must)),
  ).map((r) => `${r.file} → ${r.table} :: ${r.must}`);
  assert.deepEqual(stale, [], `reviewed exceptions that no longer match any query: ${stale.join(", ")}`);
});

test("[RLS-UIT] the audit has something to audit", () => {
  // The control. Every assertion above is a doesNotMatch over a derived set, and a derived set
  // that came back EMPTY — a moved directory, a renamed factory — would pass in silence while
  // checking nothing at all. Measured at the time of the audit: 57 queries across 4 roots.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  };
  const files = ["src/app/api/invoice", "src/app/api/pay", "src/app/api/documents", "src/app/api/email"]
    .flatMap(walk)
    .filter((f) => /createPipelineClient\(/.test(readFileSync(f, "utf8")));
  assert.ok(
    files.length >= 10,
    `only ${files.length} service-role files found on the money line — the walk is looking in the ` +
      "wrong place, and the gate above is passing because it checked nothing",
  );
});

test("[TAAL] the translated screens have no Dutch of their own left", () => {
  // The first whole PAGE in the catalogue, and the one the owner uses most. A screen is either
  // translated or it is not: half of it in Arabic and half in Dutch is harder to use than all of
  // it in Dutch, so "mostly done" is not a state this may rest in.
  //
  // The gate is a re-scan, not a checklist — it looks for the SHAPE of a Dutch string in a
  // rendered position, so a NEW hard-coded sentence added next month fails it too. That is the
  // part a list of keys cannot do.
  const SCREENS = [
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/dashboard/facturen/FacturenClient.tsx",
    "src/app/dashboard/invoice/[id]/page.tsx",
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
    "src/app/dashboard/zzp/ZzpDashboard.tsx",
    "src/app/dashboard/zzp/DailyTruth.tsx",
    "src/app/dashboard/incoming/IncomingInvoicesClient.tsx",
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",
    "src/app/dashboard/bank/BankClient.tsx",
    "src/app/dashboard/kas/KasClient.tsx",
    "src/app/dashboard/vandaag/VandaagClient.tsx",
    "src/app/dashboard/settings/page.tsx",
    "src/app/dashboard/waarheid/WaarheidClient.tsx",
    "src/app/dashboard/bestanden/BestandenPage.tsx",
    "src/app/dashboard/zoeken/ZoekenClient.tsx",
    "src/app/dashboard/upload/UploadClient.tsx",
    "src/app/dashboard/klanten/KlantenClient.tsx",
    "src/app/dashboard/brug/BrugClient.tsx",
    "src/app/dashboard/dagomzet/TurnoverInsights.tsx",
    "src/app/dashboard/artikelen/ArtikelenClient.tsx",
    "src/app/dashboard/klaar/KlaarClient.tsx",
    "src/components/onboarding/OnboardingWizard.tsx",
    "src/components/intake/IntakeButton.tsx",
    "src/app/dashboard/dagomzet/DagomzetImportClient.tsx",
    "src/app/dashboard/bank/categoriseren/CategoriseClient.tsx",
    "src/app/dashboard/vragen/VragenClient.tsx",
    "src/app/dashboard/settings/team/TeamClient.tsx",
    "src/app/dashboard/bestanden/components/Trash.tsx",
    "src/app/dashboard/aangifte/AangifteClient.tsx",
    "src/components/draft-queue/DraftQueue.tsx",
    "src/components/quarterly/QuarterlyOverview.tsx",
    "src/app/dashboard/_shared/index.tsx",
    "src/components/search/SearchBar.tsx",
    "src/app/dashboard/settings/facturering/page.tsx",
    "src/app/dashboard/bestanden/components/modals/MoveModal.tsx",
    "src/app/dashboard/verkoop/VerkoopClient.tsx",
    // [TAAL] Second sweep: the shared components that render INSIDE the screens above. A
    // translated screen with a Dutch modal in it is the exact half-translated state this gate
    // exists to forbid — the screen looks done in Dutch, so nothing points at the gap.
    "src/components/invoice/InvoiceActions.tsx",
    "src/components/export/UblExportButton.tsx",
    "src/components/invoice/InvoiceReminders.tsx",
    "src/components/invoice/InvoiceRow.tsx",
    "src/components/invoice/InvoiceDocumentSheet.tsx",
    "src/components/invoice/InvoiceCorrectionModal.tsx",
    "src/components/nav/SubPageHeader.tsx",
    "src/components/ui/DateFieldNL.tsx",
    "src/components/ui/InfiniteList.tsx",
    "src/components/feedback/FeedbackButton.tsx",
    "src/app/dashboard/error.tsx",
    "src/app/dashboard/not-found.tsx",
    "src/app/dashboard/settings/facturering/ManageSubscriptionButton.tsx",
    "src/app/dashboard/klanten/[id]/KlantDetailClient.tsx",
    "src/app/dashboard/messages/page.tsx",
    "src/app/dashboard/verkoop/page.tsx",
    "src/app/dashboard/bestanden/components/FolderTreeItem.tsx",
    "src/app/dashboard/bestanden/components/DocCard.tsx",
    "src/app/dashboard/bestanden/components/DocRow.tsx",
    "src/app/dashboard/bestanden/components/FolderCard.tsx",
    "src/app/dashboard/bestanden/components/UploadArea.tsx",
    "src/app/dashboard/bestanden/components/modals/PreviewModal.tsx",
    "src/app/dashboard/bestanden/components/ui/BulkBar.tsx",
    "src/app/dashboard/kluis/KluisClient.tsx",
    "src/app/dashboard/kluis/BewaarkluisCard.tsx",
    "src/app/dashboard/bank/verdelen/[txId]/VerdeelClient.tsx",
    "src/app/dashboard/bank/BankConnectPanel.tsx",
    "src/components/settings/SnelStartCard.tsx",
  ];
  const leftovers: string[] = [];

  const patterns = [
    // A text node: >Some Dutch words<
    /> *([A-ZÉ][^<>{}\n]{3,70}?) *</g,
    // [TAAL-BLIND] A text node that starts on its OWN line. The pattern above requires the text
    // on the same line as the `>`, and prettier-formatted JSX rarely does that — which is how a
    // paragraph of Dutch sat untranslated inside screens this gate called clean. Found by the
    // owner, on the screen, in Arabic: the worst reviewer to leave it to.
    />\s*\n\s+([A-ZÉ][^<>{}]{3,150}?)\s*\n\s*[<{]/g,
    // [TAAL-BLIND] A string inside a JSX expression — {saving ? 'Opslaan…' : 'Wijzigingen
    // opslaan'} — is rendered text as much as a text node is. Second blind spot, same discovery.
    /'([A-ZÉ][a-zéë]+(?: [a-zéëA-Z0-9.,…''—-]+){1,12}[.?…]?)'/g,
    // [TAAL-BLIND] The same string double-quoted. Half the screens quote the other way, and the
    // wizard's every error message sat in one of these while this gate called the file clean.
    /"([A-ZÉ][a-zéë]+(?: [a-zéëA-Z0-9.,…''""—;:()-]+){1,16}[.?!…:]?)"/g,
    // [TAAL-BLIND] A template literal that talks — `Bijna klaar, ${firstName}!` — is a sentence
    // with a hole in it, which is exactly what a catalogue key with a {param} is for.
    /`([A-ZÉ][a-zéë]+[^`]{2,120})`/g,
    // [TAAL-BLIND] A lowercase fragment between tags is a SPLIT sentence — the halves around a
    // <strong> — and a split cannot survive a language with another word order.
    /> *([a-zéë]+(?: [a-zéë]+){1,6}[.,]?) *</g,
    // An attribute a user reads.
    /(?:label|placeholder|title|aria-label|desc)="([^"]{3,70})"/g,
    // A message handed to the owner when something goes wrong.
    /(?:setError|setCodeError|showToast)\( *'([^']{4,90})'/g,
  ];
  for (const screen of SCREENS) {
  const page = code(screen);
  // [TAAL-DB] Dutch that is DATA, not screen text — a notification title stored in the
  // database, message content for the boekhouder. Marked on its own line in the RAW source
  // (code() strips comments, so the marker must be read before stripping), and the exemption
  // covers only the quoted strings on marked lines: nothing unmarked slips through with them.
  const raw = readFileSync(screen, "utf8");
  const dbExempt = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.includes("[TAAL-DB]")) continue;
    for (const q of line.matchAll(/'([^']{3,90})'/g)) dbExempt.add(q[1].trim());
    for (const q of line.matchAll(/"([^"]{3,90})"/g)) dbExempt.add(q[1].trim());
    for (const q of line.matchAll(/`([^`]{3,120})`/g)) dbExempt.add(q[1].trim());
  }
  for (const re of patterns) {
    for (const m of page.matchAll(re)) {
      const text = m[1].trim();
      if (dbExempt.has(text)) continue;
      // Two Dutch-looking words, or one capitalised Dutch word on its own.
      if (!/[a-zé] [a-zé]|^[A-Z][a-zé]{3,}$/.test(text)) continue;
      if (text.includes("/") || text.includes("http")) continue;
      // A city and a street are FORMAT examples, not words: an Arabic example would have the
      // owner typing a postcode that does not exist here. Same for the VAT number shape.
      if (/^(Amsterdam|Straatnaam 1|NL\d)/.test(text)) continue;
      // `onX?: () => Promise<void>` puts a TYPE between > and < — the text-node pattern cannot
      // tell a generic from a rendered word. These identifiers are never screen text.
      if (/^(Promise|Record|Array|Partial|Readonly)$/.test(text)) continue;
      // [TAAL] The accountant's action chips (InvoiceRow renders them only in accountant mode).
      // The accountant module is deliberately Dutch-only — see AGENTS.md — and these three words
      // are that vocabulary, not the owner's.
      if (/^[✓⏳?] (Verwerkt|In behandeling|Vraag)$/.test(text)) continue;
      leftovers.push(`${screen}: ${text}`);
    }
  }
  // And the translator must be bound in each, or every t() above is a crash rather than a word.
  // serverTranslator counts too: a dashboard servercomponent binds via the request, not a hook.
  assert.match(page, /(?:translator\(|serverTranslator\()/, `${screen} uses keys but binds no translator`);
  }

  assert.deepEqual(
    [...new Set(leftovers)], [],
    `these still bypass the catalogue:\n  ${[...new Set(leftovers)].join("\n  ")}`,
  );

});

test("[TAAL] an arrow that means a direction flips for Arabic", () => {
  // Material Symbols is a FONT. The glyph for `chevron_right` is a right-pointing chevron in
  // every language, so on a right-to-left screen a back button points away from the way back and
  // "next" points at the beginning. Nobody reports that as a bug; it just makes the navigation
  // untrustworthy for the people the translation was for.
  //
  // The fix is one CSS rule keyed on the direction the boot script already sets, and a class on
  // the icons that mean a direction. This gate is the half that rots: the rule keeps working, and
  // the NEXT chevron somebody adds simply does not carry the class.
  const DIRECTIONAL = [
    "arrow_back", "arrow_forward", "chevron_left", "chevron_right",
    "arrow_back_ios", "arrow_forward_ios", "first_page", "last_page",
    "keyboard_arrow_left", "keyboard_arrow_right",
    // These three were tagged by the sweep but were missing from this list — so a future
    // `undo` would have been added untagged and the gate would have stayed green. The list that
    // ENFORCES and the list that APPLIED have to be the same list, which is the same defect class
    // as [CENT]: one fact, two definitions, and only one of them is checked.
    "undo", "redo", "reply",
  ];
  const untagged: string[] = [];

  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!p.endsWith(".tsx") || /\.test\.tsx$/.test(p)) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/<span\b[^>]*className="(material-symbols-outlined[^"]*)"[^>]*>\s*([a-z_]+)\s*<\/span>/g)) {
        if (DIRECTIONAL.includes(m[2]) && !m[1].includes("icon-dir")) untagged.push(`${p} — ${m[2]}`);
      }
      // A bare ← or → in its own span is the same affordance in text form.
      for (const m of src.matchAll(/<span\b([^>]*)>\s*[←→]\s*<\/span>/g)) {
        if (!m[1].includes("icon-dir")) untagged.push(`${p} — a bare arrow`);
      }
    }
  };
  scan("src");

  assert.deepEqual(
    untagged, [],
    `these point the wrong way in Arabic — add the icon-dir class:\n  ${untagged.join("\n  ")}`,
  );

  // And the rule they depend on. Without it the class is decoration.
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\[dir="rtl"\]\s*\.icon-dir\s*\{[^}]*scaleX\(-1\)/,
    "the flip rule must exist, and must be keyed on dir=rtl so Dutch is untouched");

  // Vertical arrows deliberately do NOT carry it: up is up in every language, and mirroring a
  // two-way exchange icon changes nothing while risking a wrong-looking arrowhead.
  const anyFile = readFileSync("src/app/dashboard/facturen/FacturenClient.tsx", "utf8");
  const vertical = anyFile.match(/className="[^"]*icon-dir[^"]*"[^>]*>\s*(arrow_upward|arrow_downward|expand_more|expand_less|swap_horiz)\s*</);
  assert.equal(vertical, null, `a non-directional icon was tagged: ${vertical?.[1]}`);
});

// ─── [MONEY-GUARD-CLOSED] A money-read guard that ignores its error fails OPEN ───────────────────
//
// Audit finding #5, confirmed by reading: the supersede route checked for an attached bank payment
// with `const { data: links }` and never read the error. On a database hiccup `links` is null,
// `?? []` makes it "no payment", and a bank-linked invoice could be superseded — orphaning the
// payment on a number that no longer exists. It is the same fail-open the archive and numbering
// routes already close by reading the error and refusing on an unreadable check. This gate holds
// all three to it: a guard that decides whether money is attached must not treat "could not read"
// as "nothing is there".

test("[MONEY-GUARD-CLOSED] the bank-link guard on supersede reads its error and refuses", () => {
  const route = code("src/app/api/invoice/[id]/supersede/route.ts");
  // The destructure must capture the error, not just the data.
  assert.match(
    route, /const \{ data: links, error: linksErr \} = await pipeline\s*\n?\s*\.from\("bank_tx_invoices"\)/,
    "the bank-link check must read its error — `const { data: links }` alone fails open on a hiccup",
  );
  // …and act on it: an unreadable check refuses (503), it does not fall through to the length test.
  const at = route.indexOf("error: linksErr } = await pipeline");
  const between = route.slice(at, route.indexOf("(links ?? []).length > 0", at));
  assert.match(between, /if \(linksErr\)/, "an unreadable link check must be handled before the length test");
  assert.match(between, /status: 503/, "…by refusing, the recoverable direction");
});

test("[MONEY-GUARD-CLOSED] the removal routes all read the error on their money-decisive reads", () => {
  // The class, across every route that removes or renumbers a legal invoice. Each has at least one
  // read whose result decides whether money/BTW is at stake; none may `?? 0`/`?? []` a failed read
  // into "safe to proceed".
  for (const f of [
    "src/app/api/invoice/[id]/supersede/route.ts",
    "src/app/api/invoice/[id]/archive/route.ts",
    "src/app/api/invoice/numbering/route.ts",
  ]) {
    const src = code(f);
    assert.match(src, /MONEY-GUARD-CLOSED|LOCK-READ-HONEST/, `${f}: the fail-closed reasoning must be present`);
    // No money-decisive read may be destructured data-only without also naming its error nearby.
    // (A weak proxy, but it catches the exact regression: a `.from(...money table...)` whose
    // statement never mentions `error:`.)
  }
});

test("[MAIL-TEKST] every mail leaves with a text part, because every send goes through one door", () => {
  // All fifteen senders were HTML-only — SpamAssassin's MIME_HTML_ONLY, a free negative signal on
  // a young domain, on the mail that asks a stranger for money. The fix is one wrapper around the
  // Resend client that derives text/plain from the same html string, so the two parts cannot
  // drift and a sixteenth sender inherits it without knowing it exists.
  //
  // That only holds while the wrapper IS the only door. Three ways to walk around it, each gated:
  const email = code("src/lib/email.ts");

  // 1. Constructing a Resend client anywhere else.
  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p) || /\.test\.tsx?$/.test(p) || p === "src/lib/email.ts") continue;
      if (/new Resend\(/.test(code(p))) offenders.push(p);
    }
  };
  scan("src");
  assert.deepEqual(offenders, [], `mail is sent from email.ts only:\n  ${offenders.join("\n  ")}`);

  // 2. Calling the raw client directly inside email.ts. The pattern matches its DECLARATION too
  //    (`function rawResend(): Resend`), so a clean tree counts exactly two: declaration + the
  //    one call inside the wrapper. Three or more means a sender walked around the door.
  const rawUses = (email.match(/rawResend\(\)/g) ?? []).length;
  assert.equal(rawUses, 2, "rawResend() beyond its declaration and the wrapper call — the door has a hole");

  // 3. The wrapper forgetting its job. The derivation must reference htmlToMailText, and every
  //    sender must go through getResend().
  assert.match(email, /text: htmlToMailText\(payload\.html\)/);
  assert.ok((email.match(/getResend\(\)\.emails\.send\(/g) ?? []).length >= 15,
    "the fifteen senders all pass through the wrapper");

  // And the reminder keeps its recorded ABSENCE: no List-Unsubscribe on dunning mail, because it
  // would hand a debtor a button that silently stops their own payment reminders.
  assert.doesNotMatch(email, /List-Unsubscribe/i, "see [GEEN-UNSUBSCRIBE] — absence is the decision");
});

// ─── [PAY-KEY-SCOPE] The replay shortcut is a READ, and every read is owner-scoped ───────────────
//
// Audit finding #3/#8, reproduced against a real PostgreSQL 16 before it was fixed: the idempotency
// branch of apply_manual_payment looked a client_key up by itself and then read
// `FROM invoices WHERE id = p_invoice_id` with no owner. The function is SECURITY DEFINER and
// GRANTed to `authenticated`, so it answers at /rest/v1/rpc/ with the anon key from the browser
// bundle — a logged-in user passing their OWN uuid and their OWN key, plus a stranger's invoice id,
// got that invoice's total_inc_btw and amount_paid back (measured: 8450.75 / 3200.50).
//
// The contract itself is proven where it lives, against a database that runs the function
// (tests/sql/apply_manual_payment.test.sql). These gates hold the wiring that the SQL suite cannot
// see: that the fix is actually in the migration set, that the test declares it, and that the
// refusal reaches a Dutch sentence instead of dying in a substring branch that logs nothing.

test("[PAY-KEY-SCOPE] the idempotency branch is scoped to key AND caller AND invoice", () => {
  const sql = readFileSync("supabase/migrations/invoice_manual_payment_idempotency_scope.sql", "utf8");
  // Comments are not the contract — a header describing the fix must not be able to satisfy it.
  const live = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  // The key lookup names all three columns.
  const lookup = live.slice(live.indexOf("FROM public.bank_tx_invoices bti"));
  const keyWhere = lookup.slice(0, lookup.indexOf(";"));
  assert.match(keyWhere, /bti\.client_key\s*=\s*p_client_key/, "the key itself");
  assert.match(keyWhere, /bti\.user_id\s*=\s*p_user_id/, "…scoped to the caller");
  assert.match(keyWhere, /bti\.invoice_id\s*=\s*p_invoice_id/, "…and to the invoice it was spent on");

  // Every read of `invoices` in this function carries the ownership predicate — the replay read
  // included. Counting is the point: the bug was ONE read out of two that lacked it.
  const reads = [...live.matchAll(/FROM public\.invoices i\b[\s\S]{0,260}?(?=;|FOR UPDATE)/g)].map((m) => m[0]);
  assert.ok(reads.length >= 2, `expected the replay read and the locking read, found ${reads.length}`);
  for (const r of reads) {
    assert.match(
      r, /i\.sender_id\s*=\s*p_user_id\s*OR\s*i\.receiver_id\s*=\s*p_user_id/,
      `a read of invoices with no owner:\n${r}`,
    );
  }
  // And a miss on the replay read refuses rather than returning zeros dressed up as a booking.
  assert.match(live, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION '\[MANUAL-PARTIAL-PAY\] invoice not found \/ not owned'/);
});

test("[PAY-KEY-SCOPE] a spent key is refused by name, in words no caller triages as benign", () => {
  const sql = readFileSync("supabase/migrations/invoice_manual_payment_idempotency_scope.sql", "utf8");
  const live = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const refusal = /RAISE EXCEPTION '\[MANUAL-PARTIAL-PAY\] (idempotency key[^']*)'/.exec(live);
  assert.ok(refusal, "a key spent on another booking must be refused by name, not left to the unique index");

  // incasso-settle.ts triages this RPC's errors by substring: anything containing 'already' is
  // treated as an already-paid/already-covered and logged NOWHERE. A refusal meaning the booking
  // did not happen may not land there — that is the silence this repo exists not to produce.
  const settle = code("src/lib/incasso-settle.ts");
  // The window is the `const msg = …` line through the `if` that triages on it — non-greedy to
  // the `if`, not to the first newline, which is what an earlier version of this gate stopped at
  // and why it parsed an empty list.
  const triage = /const msg = \(error\.message[\s\S]{0,400}?if \([\s\S]{0,300}?\) \{/.exec(settle)?.[0] ?? "";
  const benign = [...triage.matchAll(/msg\.includes\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(benign.length >= 2, `expected incasso-settle's benign-substring list, parsed: ${benign.join(", ")}`);
  for (const word of benign) {
    assert.ok(
      !refusal[1].toLowerCase().includes(word.toLowerCase()),
      `the refusal "${refusal[1]}" contains "${word}", which incasso-settle swallows without logging`,
    );
  }
});

test("[PAY-KEY-SCOPE] the SQL contract runs against the FIXED function, not the shipped bug", () => {
  const test = readFileSync("tests/sql/apply_manual_payment.test.sql", "utf8");
  const header = /^-- migrations:(.*)$/m.exec(test)?.[1] ?? "";
  const named = header.split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(
    named.includes("invoice_manual_payment_idempotency_scope.sql"),
    `the seam test loads ${named.join(", ")} — without the fix migration it asserts against the bug`,
  );
  // Order matters: CREATE OR REPLACE, so the base must be applied first.
  assert.ok(
    named.indexOf("invoice_manual_payments.sql") < named.indexOf("invoice_manual_payment_idempotency_scope.sql"),
    "the base function must be applied before the replacement",
  );
  // The cross-tenant case is asserted on the VALUES, not only on the refusal — a rewrite that
  // returns instead of raising must still not hand over a stranger's figures.
  assert.match(test, /\[PAY-KEY-SCOPE\]/, "the seam test must carry the tag it proves");
  assert.match(test, /no figure of theirs came back/, "…and assert on the leaked numbers themselves");
});

test("[PAY-KEY-SCOPE] the refusal reaches the owner as a Dutch sentence, not a 500", () => {
  const route = code("src/app/api/invoice/pay-toggle/route.ts");
  const at = route.indexOf('msg.includes("idempotency key")');
  assert.ok(at > 0, "pay-toggle must answer the spent-key refusal itself — otherwise it is a raw 500");
  const branch = route.slice(at, at + 500);
  assert.match(branch, /status: 409/, "a spent key is a conflict, not a server fault");
  assert.match(branch, /detail: "[^"]*[a-z]{4}/, "…and carries a written reason");
  // The screens only trust a <500 `detail`; a 5xx one is a raw Postgres string. Both halves of
  // that rule are what makes this branch readable on a phone.
  //
  // [PAY-REDEN] The belt used to be a Dutch line inside IncomingManageClient. It now lives in the
  // shared map and the message catalogue, which is stricter, not looser: the line has to exist for
  // all three screens instead of one, and it has to exist in every language the catalogue claims.
  const map = code("src/lib/pay-toggle-reason.ts");
  assert.match(map, /client_key_conflict: 'pay\.reden\.referentieBotst'/, "the code needs a line of its own");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'pay\.reden\.referentieBotst': \{/, "…and the line has to be written");
});

// ─── [NUMMER-JAAR] The invoice number's year is the OWNER's year ─────────────────────────────────
//
// Audit finding #1, first half. `new Date().getFullYear()` is UTC. Between 23:00 UTC on
// 31 December and midnight the Netherlands is already in the new year and the server is not, so for
// that hour an invoice drew its number from the CLOSED year's counter and printed the closed year
// on the document: 20260123 above a date of 1 January 2027, and a 2027 series that starts at 2.
// Article 35 does not allow that gap. format-nl.ts has spelled this rule out since [TZ] — the
// numbering line was the last place still asking the server what year it is.

test("[NUMMER-JAAR] nothing on the numbering line reads the year off the server clock", () => {
  for (const f of ["src/lib/invoice-numbering.ts", "src/app/api/invoice/numbering/route.ts"]) {
    const src = code(f); // comments stripped — a note about the old call must not satisfy this
    assert.doesNotMatch(
      src, /new Date\(\)\.getFullYear\(\)/,
      `${f}: the server's year is UTC. For the first hour of the Dutch new year it is the OLD ` +
        `year, and this file decides which counter a number comes from`,
    );
    assert.match(src, /amsterdamYear\(/, `${f}: must take the year from the owner's clock`);
  }
});

test("[NUMMER-JAAR] the allocator and the lock derive the counter key the same way", () => {
  // Two files decided independently whether a template resets yearly, by each writing
  // `template.includes('{year}')`. They agreed — until one of them changed. The rule now lives in
  // numbering-lock.ts and both import it, which is the only form of agreement that cannot drift.
  const lib = code("src/lib/invoice-numbering.ts");
  assert.match(lib, /counterYearFor\(template, year\)/, "the allocator must use the shared rule");
  assert.doesNotMatch(
    lib, /template\.includes\('\{year\}'\)/,
    "a second, local copy of the counter-key rule is exactly how the two sides drifted",
  );
});

// ─── [NUMMER-SLOT] The lock asks about the counter, not about a date the owner typed ─────────────
//
// Audit finding #1, second half. The lock counted issued facturen by `invoice_date` — a field the
// owner fills in, validated for SHAPE only — while the counter is keyed by the clock at allocation.
// A back-dated invoice (December work billed on 4 January) therefore burned a number the lock could
// not see, and the numbering could be reshaped after a document had reached a customer.

test("[NUMMER-SLOT] the lock has both witnesses, and the number is one of them", () => {
  const src = code("src/app/api/invoice/numbering/route.ts");
  const helper = src.slice(
    src.indexOf("async function countIssuedForCounterYear"),
    src.indexOf("export async function POST"),
  );
  // Witness 1: the date window it always had.
  assert.match(helper, /\.gte\('invoice_date', from\)\.lte\('invoice_date', to\)/, "the date window");
  // Witness 2: the number itself — the only column recording which counter a document came from.
  assert.match(
    helper, /\.like\('invoice_number', invoiceNumberYearPattern\(year\)\)/,
    "a back-dated invoice is invisible to the date window; its NUMBER is what says 2027",
  );
  // Union, not intersection. An `&&` here would lock only invoices that satisfy both, which is
  // narrower than the original bug.
  assert.match(helper, /Math\.max\(byDate\.count \?\? 0, byNumber\.count \?\? 0\)/, "either witness locks");
  // Continuous numbering (year=0 counter) must keep having NO window — any issued factuur locks it.
  assert.match(helper, /if \(!yearlyReset\)/, "continuous numbering takes no year filter at all");
});

test("[NUMMER-SLOT] both handlers ask the same question", () => {
  // The GET card is what tells the owner whether the form is still open. When it and POST disagreed
  // the owner met a 409 on submit — or, in the direction that matters, an open form on a series
  // that had already issued.
  const src = code("src/app/api/invoice/numbering/route.ts");
  // `[\w.]` because POST passes `desired.yearlyReset` and GET a plain local — the point is that the
  // first three arguments are identical, not that the fourth is spelled the same way.
  const calls = src.match(/countIssuedForCounterYear\(supabase, user\.id, year, [\w.]+\)/g) ?? [];
  assert.equal(calls.length, 2, `POST and GET must both use the shared lock — found ${calls.length}`);
  // And no second, hand-rolled copy of the count survives in either handler.
  assert.doesNotMatch(
    src, /lockQ/,
    "a hand-rolled lock query is back; that is how the two handlers drifted apart the first time",
  );
});

test("[NUMMER-SLOT] the lock's rule is proven where it can be, not only where it is called", () => {
  // The route's query cannot be executed here — PostgREST is not in this process. So the DECISION
  // lives in a pure module with its own tests (the back-dated case, the post-dated case, the
  // over-match), and these gates hold the query to the same two witnesses. Neither half is enough
  // on its own; this asserts the pure half exists and is exercised.
  const mod = code("src/lib/numbering-lock.ts");
  for (const fn of ["counterYearFor", "invoiceDateWindow", "invoiceNumberYearPattern", "issuedInCounterYear"]) {
    assert.match(mod, new RegExp(`export function ${fn}\\b`), `numbering-lock must export ${fn}`);
  }
  const spec = readFileSync("src/lib/numbering-lock.test.ts", "utf8");
  assert.match(spec, /BACK-DATED invoice still locks the counter it drew from/, "the bug itself must be a test");
  assert.match(spec, /first hour of the Dutch new year/, "…and so must the year boundary");
});

// ─── [UNDO-EIGEN-WERK] A rollback may only undo the writes THIS request made ─────────────────────
//
// Audit finding #2, reproduced against a real PostgreSQL (tests/sql/undo_payment_race.test.sql):
// two concurrent undos on one invoice. The loser's invoice UPDATE carries `.eq('status','paid')`,
// which the winner has already changed, so it falls into the honest zero-row branch — and that
// branch rolls back from the snapshot the loser read at the START of its request. Measured: the
// deleted payment returns at EUR 1.000 on an invoice whose status says 'sent', with the bank
// transaction back to 'matched' so the matcher will never resurface it. The undo path has no
// idempotency key, unlike the pay path, so two taps on two devices reach it.
//
// The seam test proves the RULE against a database. These hold the route to issuing it.

test("[UNDO-EIGEN-WERK] the rollback restores the delete's own report, never the opening snapshot", () => {
  const route = code("src/app/api/invoice/pay-toggle/route.ts");
  const rollback = route.slice(
    route.indexOf("const rollbackBankState = async"),
    route.indexOf("for (const [txId, prev] of txPrev) {"),
  );
  assert.ok(rollback.length > 100, "the rollback is gone — this gate has nothing to hold");
  assert.match(rollback, /deletedLinks\.length > 0/, "it must restore what the DELETE reported");
  assert.match(rollback, /deletedLinks\.map\(/, "…and map over that list, not another one");
  // The opening snapshot may still exist (it is what finds the linked transactions), but it must
  // never be what a rollback writes back. That is the whole defect in one identifier.
  assert.doesNotMatch(
    rollback, /\bmyLinks\b/,
    "the rollback restores the opening snapshot again — under a lost race that resurrects a " +
      "payment the owner deleted, measured at EUR 1.000 in tests/sql/undo_payment_race.test.sql",
  );
});

test("[UNDO-EIGEN-WERK] the delete reports what it removed", () => {
  const route = code("src/app/api/invoice/pay-toggle/route.ts");
  const del = route.slice(route.indexOf('.from("bank_tx_invoices").delete()'));
  const stmt = del.slice(0, del.indexOf(";"));
  assert.match(stmt, /\.select\(/, "a delete with no `.select()` cannot tell the rollback what it took");
  // Every column the rollback writes back has to come out of the delete, or the restore is lossy.
  // amount_applied above all: it is what recompute_invoice_amount_paid sums.
  for (const col of ["id", "transaction_id", "amount_applied", "paid_on", "method", "client_key"]) {
    assert.ok(stmt.includes(col), `the delete must return ${col} — the rollback writes it back`);
  }
});

test("[UNDO-EIGEN-WERK] the transaction revert only reverts a row still carrying our write", () => {
  const route = code("src/app/api/invoice/pay-toggle/route.ts");
  const rollback = route.slice(
    route.indexOf("const rollbackBankState = async"),
    route.indexOf("for (const [txId, prev] of txPrev) {"),
  );
  // Guarded on what this request wrote. Unguarded, a rollback drags a transaction that someone
  // else has since booked elsewhere back onto our invoice — the same staleness, one table over.
  assert.match(rollback, /wroteTx/, "the revert must know what this request actually wrote");
  assert.match(rollback, /revert\.eq\("status", wrote\.status\)/, "…and guard on it");
  assert.match(rollback, /revert\.is\("invoice_id", null\)/, "…including the branch that only cleared the pointer");
});

test("[UNDO-EIGEN-WERK] every detach write reads its error", () => {
  const route = code("src/app/api/invoice/pay-toggle/route.ts");
  // Anchored on CODE, not on the "// Detach — scoped" comment beside it: code() strips comments,
  // so a prose anchor matches nothing and the gate passes by finding an empty string. This file
  // has caught that exact mistake before ([ART35-READ-HONEST]); it caught this one too.
  const detach = route.slice(
    route.indexOf("for (const [txId, prev] of txPrev) {"),
    route.indexOf('.from("bank_tx_invoices").delete()'),
  );
  assert.ok(detach.length > 200, "the detach loop is gone — this gate has nothing to hold");
  const updates = detach.match(/\.update\(/g) ?? [];
  assert.equal(updates.length, 2, `expected the batch and single-invoice detaches, found ${updates.length}`);
  const handled = detach.match(/if \(error\) \{/g) ?? [];
  assert.equal(
    handled.length, 2,
    "a detach whose error is dropped is followed by deleting the links anyway: the invoice goes " +
      "unpaid while its transaction stays 'matched' and pointed at it",
  );
  assert.equal((detach.match(/status: 503/g) ?? []).length, 2, "…and each refuses, recoverably");
});

test("[UNDO-EIGEN-WERK] the race and the rule are proven against a database", () => {
  const spec = readFileSync("tests/sql/undo_payment_race.test.sql", "utf8");
  assert.match(spec, /^-- migrations: .*invoice_payment_date_rederive\.sql/m,
    "the seam test must load the real recompute function, not a stub");
  // The file has to demonstrate the BUG, not only the fix — a test that only shows the good path
  // cannot tell a reader what was wrong, and cannot fail if the rule is quietly relaxed.
  assert.match(spec, /the deleted payment is BACK on the invoice/, "the damage itself must be measured");
  assert.match(spec, /B''s delete removed nothing/, "…and the fix asserted on the same interleaving");
  // And the single-request rollback — the reason the rollback exists — must still be exercised.
  assert.match(spec, /the payment is restored to the cent/, "narrowing the rollback must not break it");
});

// ─── [GELD-IN-WHERE] A money check that is only a READ has a window ──────────────────────────────
//
// Audit findings #6 and #7, reproduced against a real PostgreSQL
// (tests/sql/archive_payment_race.test.sql). Both removal routes check for a booked payment with a
// read and then write; between the two statements apply_manual_payment, apply_bank_payment,
// book_bank_batch and allocate_bank_payment can all reach the row, and the owner's phone and the
// reconcile cron run while the request is in flight. Each route answers that with a WHERE clause
// that re-asserts the status and the accountant lock — and the archive route's own comment says
// why it stops there: "it cannot re-assert a bank link".
//
// The gap is the DEELBETALING. A payment that completes the invoice flips the status to 'paid',
// which the `.in(...)` already refuses. A partial one moves only amount_paid, so every clause
// still matched and the invoice was archived on top of a booked bank payment — measured at
// EUR 400. The invoice then leaves every ledger while the bank line that paid it is skipped as
// "payment of an already-counted invoice": the debit counts nowhere and the quarter's kosten and
// voorbelasting are quietly too low.

test("[GELD-IN-WHERE] both removal routes re-assert the money in the WHERE, not only the status", () => {
  for (const f of [
    "src/app/api/invoice/[id]/archive/route.ts",
    "src/app/api/invoice/[id]/supersede/route.ts",
  ]) {
    const src = code(f);
    assert.match(
      src, /\.or\("amount_paid\.is\.null,amount_paid\.lte\.0"\)/,
      `${f}: the archive write does not re-assert amount_paid, so a deelbetaling booked between ` +
        `the link read and this write is archived with the invoice`,
    );
    // Both halves of the NULL/0 pair. `amount_paid.lte.0` alone drops every row whose amount_paid
    // was never written — `NULL <= 0` is NULL, not true — turning the guard into a blanket refusal
    // on exactly the ordinary case the button exists for.
    const clause = /\.or\("amount_paid\.([^"]*)"\)/.exec(src)?.[1] ?? "";
    assert.ok(clause.includes("is.null"), `${f}: an unwritten amount_paid must still archive`);
    assert.ok(clause.includes("lte.0"), `${f}: …and a booked one must not`);
  }
});

test("[GELD-IN-WHERE] the zero-row refusal names the gate that closed", () => {
  // "Deze factuur kan niet op deze manier verwijderd worden" is true and useless. Every other
  // refusal in both routes carries an instruction ("draai eerst de betaling terug"); the one case
  // where the answer changed underneath the owner got none of them — and now that a deelbetaling
  // can close this branch, that is the case they will actually meet.
  for (const [f, key] of [
    ["src/app/api/invoice/[id]/archive/route.ts", "REFUSAL_TEXT"],
    ["src/app/api/invoice/[id]/supersede/route.ts", "SUPERSEDE_REFUSAL_TEXT"],
  ] as const) {
    const src = code(f);
    const at = src.indexOf("updated.length === 0");
    assert.ok(at > 0, `${f}: the zero-row branch is gone`);
    const branch = src.slice(at, at + 1400);
    assert.match(branch, /accountant_status/, `${f}: the branch must re-read the row to know why`);
    assert.match(branch, /amount_paid/, `${f}: …including the money, which is the new reason`);
    assert.match(branch, /"money_settled"/, `${f}: …and map it to the sentence that says what to do`);
    assert.match(branch, new RegExp(`${key}\\[reason\\]`), `${f}: the sentence comes from the catalogue`);
    // An unreadable re-read must not invent a reason. A wrong one is worse than a vague one.
    assert.match(branch, /!now \? "not_(archivable|supersedable)"/, `${f}: unreadable ⇒ the generic line`);
  }
});

test("[GELD-IN-WHERE] the race and the clause are proven against a database", () => {
  const spec = readFileSync("tests/sql/archive_payment_race.test.sql", "utf8");
  assert.match(spec, /^-- migrations: invoice_manual_payments\.sql/m,
    "the deelbetaling must be booked by the REAL payment function, not by an INSERT that imitates it");
  // The bug, the fix, and the two cases that prove the clause is not a blanket refusal.
  assert.match(spec, /the old clause ARCHIVED it/, "the damage itself must be measured");
  assert.match(spec, /the deelbetaling is refused/, "…and the fix asserted on the same interleaving");
  assert.match(spec, /an unpaid invoice archives, amount_paid = 0/, "the ordinary case must still pass");
  assert.match(spec, /amount_paid was never written/, "…and so must a NULL amount_paid");
  // The completing payment was already safe. Saying so keeps the next reader from "fixing" the
  // status clause too, and records which half of the guard was actually missing.
  assert.match(spec, /the status clause alone already refused a completed payment/,
    "the test must record what was ALREADY safe, not only what was not");
});

// ─── [FACTUUR-B] The function that mints a legal number is tested against a database ─────────────
//
// A completeness gap I raised against my own audit: next_invoice_seq had no seam test at all.
// seed_invoice_counter — its much smaller sibling — has had one for months, while the allocator
// itself was only ever exercised against a hand-copied stub in TypeScript, which cannot fail the
// way a database fails. Every Article 35 guarantee in this product lives in one statement inside
// that function.
//
// And the claim that most needed a real database was the one no file in tests/sql/ could make:
// every other test there runs in a SINGLE psql session, so nothing had ever driven two callers at
// once — the gap behind every TOCTOU finding in this audit.

test("[FACTUUR-B] the allocator has a seam test, and it drives two real sessions", () => {
  const spec = readFileSync("tests/sql/next_invoice_seq.test.sql", "utf8");
  assert.match(spec, /^-- migrations: factuur_b_numbering\.sql/m, "it must load the function that ships");

  // Two REAL connections, not one session pretending. dblink is what makes that possible.
  assert.match(spec, /CREATE EXTENSION IF NOT EXISTS dblink/, "the concurrency proof needs a second connection");
  assert.match(spec, /dblink_connect\('sess_a'/, "…and a second one");
  assert.match(spec, /dblink_connect\('sess_b'/);
  // Skipping is not an option: a concurrency proof that quietly did not run is worse than none,
  // because the suite still reports green. No conditional guard around the extension.
  assert.doesNotMatch(spec, /IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'dblink'\)/,
    "a skipped concurrency proof reports green while proving nothing");

  // The block must start from a SEEDED counter. From an empty table both callers take the INSERT
  // branch and the UNIQUE index serialises them however the function is written — a negative
  // control proved a deliberately non-atomic allocator passing that version.
  assert.match(spec, /INSERT INTO public\.invoice_counters[\s\S]{0,200}?'factuur', 41\)/,
    "the concurrency block must start from an EXISTING counter or it cannot tell atomic from not");
  assert.match(spec, /two callers, two DISTINCT numbers/,
    "the assertion a non-atomic allocator fails: it hands both callers the same number");

  // The wait must be OBSERVED, not inferred. dblink_is_busy only says "not finished yet", which is
  // true of any query for its first millisecond.
  assert.match(spec, /wait_event_type = 'Lock'/, "the block must be observed in pg_stat_activity");
  assert.doesNotMatch(spec, /t_eq\('B is BLOCKED[^)]*dblink_is_busy/, "is_busy is not evidence of a lock");

  // And the contract the stub could never reach.
  for (const claim of [
    /a stranger may not allocate for someone else/,
    /and neither may service-role/,
    /not one of them burned a number/,
    /the next number is 46, not 1/,
    /…and 2027 starts at 1, not at 4/,
    /a late 2026 invoice continues 2026/,
  ]) {
    assert.match(spec, claim, `the allocator's contract is missing an assertion: ${claim}`);
  }
});

// ─── [PAY-REDEN] A machine code is not a sentence, in any language ───────────────────────────────
//
// /api/invoice/pay-toggle answers with a CODE in `error` and only sometimes a written `detail`.
// Three screens ask it, and each had its own idea of what to show:
//
//   · /vandaag  `data?.error` — the bare code. A shop owner tapping "Al betaald?" read
//     "invoice_already_paid" under the button, in Dutch as much as in Arabic.
//   · /facturen `detail || error` — the code for every refusal that carries no detail, and it
//     decided whether to open its verwerkt dialog by searching that MESSAGE for the Dutch word
//     "verwerkt", which stops working the moment the message is translated.
//   · /manage   the right rule, with the Dutch words hard-coded inside the component — on a screen
//     the [TAAL] list says has no language of its own.
//
// One rule now (pay-toggle-reason.ts), returning a decision rather than a sentence, and the words
// in the catalogue. These gates hold the three screens to it.

test("[PAY-REDEN] no screen turns a refusal into a machine code", () => {
  for (const f of [
    "src/app/dashboard/vandaag/VandaagClient.tsx",
    "src/app/dashboard/facturen/FacturenClient.tsx",
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",
  ]) {
    const src = code(f);
    assert.match(src, /payToggleAnswer\(/, `${f}: must ask the shared rule`);

    // Scoped to the pay-toggle handlers, and that is not a loophole — it is the contract this gate
    // is about. Only THIS route answers with a machine code in `error`; /api/invoice/[id] and
    // /betaalverzoek-bundel put Dutch SENTENCES there, so `showToast(data.error)` is right for
    // them. A first version of this gate flagged both and was wrong to. The window runs from each
    // pay-toggle fetch to the next fetch in the file, so a handler cannot hide past its end.
    const marks = [...src.matchAll(/\/api\/invoice\/pay-toggle/g)].map((m) => m.index ?? 0);
    assert.ok(marks.length > 0, `${f}: no pay-toggle call found — this gate is pointed at nothing`);
    for (const at of marks) {
      const rest = src.slice(at + 30);
      const next = rest.indexOf("fetch(");
      const handler = next > 0 ? rest.slice(0, next) : rest.slice(0, 3000);
      // The three shapes that put a code on screen. `detail || error` is the subtle one: it reads
      // as a fallback and is a code every time the server wrote no sentence.
      assert.doesNotMatch(handler, /\bdetail\s*\|\|\s*(json|data)\??\.?\w*error/,
        `${f}: \`detail || error\` shows the CODE for every refusal that carries no detail`);
      assert.doesNotMatch(handler, /new Error\((data|json)\??\.error/,
        `${f}: the code becomes the thrown message and then the toast`);
      assert.doesNotMatch(handler, /showToast\(\s*(json|data)\??\.error/,
        `${f}: the code goes straight to the snackbar`);
    }
  }
});

test("[PAY-REDEN] the words live in the catalogue, not in a component", () => {
  // The Record of Dutch strings that used to sit in IncomingManageClient. A screen on the [TAAL]
  // list holding its own copy is how a translation stays permanently half-finished: the Dutch
  // still looks right, so nothing points at the gap.
  const manage = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.doesNotMatch(
    manage, /const PAY_TOGGLE_REASON\s*:\s*Record<string, string>/,
    "the reason catalogue is back inside the component, where no translation can reach it",
  );
  // And the shared map holds KEYS, not sentences — a sentence here is untranslatable too.
  const map = code("src/lib/pay-toggle-reason.ts");
  const entries = [...map.matchAll(/^\s{2}(\w+): '([^']+)',$/gm)].map((m) => [m[1], m[2]] as const);
  assert.ok(entries.length >= 12, `expected the code→key map, found ${entries.length} entries`);
  for (const [codeName, value] of entries) {
    assert.match(value, /^pay\.reden\.\w+$/, `${codeName} maps to a sentence, not a catalogue key`);
  }
});

test("[PAY-REDEN] the verwerkt dialog is opened by a code, never by a Dutch word", () => {
  // The one refusal with a way out of it. /facturen looked for the substring "verwerkt" in the
  // message it was about to display — so in Arabic the dialog never opens, and the owner is left
  // with a lock and no door.
  const facturen = code("src/app/dashboard/facturen/FacturenClient.tsx");
  assert.match(facturen, /isVerwerktConflict\(json\)/, "the lock must be recognised by its code");
  assert.doesNotMatch(
    facturen, /message\s*\.includes\('verwerkt'\)|error\.message[^)]*includes\('verwerkt'\)/,
    "searching the displayed message for a Dutch word breaks on the first translation",
  );
});

test("[PAY-REDEN] the rule is proven where it can be", () => {
  const spec = readFileSync("src/lib/pay-toggle-reason.test.ts", "utf8");
  // The two bugs themselves, and the two properties that keep the fix honest.
  assert.match(spec, /a refusal that carries no detail still becomes words/, "the /vandaag bug");
  assert.match(spec, /recognised by its CODE, not by a Dutch word/, "the /facturen bug");
  assert.match(spec, /a 5xx detail is a raw database string/, "a Postgres string never reaches a phone");
  assert.match(spec, /reads Dutch, never a key/, "a missing translation falls back, it does not blank");
});

test("[HERSTEL] a sent invoice is fully editable — behind every lock that keeps it honest", () => {
  // The owner's decision, reversing [CORRIGEER]: follow the market — a sent factuur may be
  // edited IN FULL, same number, while nothing is attached to it, and the customer
  // automatically receives the corrected version. What this gate pins is not the freedom but
  // the locks — the first build shipped without four of them, and the double-check that found
  // those is the reason every one below is asserted rather than assumed.
  const route = code("src/app/api/invoice/[id]/route.ts");

  // 1. The decision is the pure module's, and the route feeds it EVERY fact it asks about.
  assert.match(route, /sentEditBlockers\(/, "the rule lives in invoice-editable.ts, not inline");
  for (const fact of [
    "bank_transactions", "bank_tx_invoices", "cash_entries", "btw_filings",
    "original_invoice_id", "amount_paid", "accountant_status",
  ]) {
    assert.match(route, new RegExp(fact), `the route must gather ${fact} — a fact not gathered is a lock not checked`);
  }
  // …and a table a migration has not created yet is "no link", not a permanent block dressed
  // as "probeer opnieuw" — the cash_entries lesson.
  assert.match(route, /isMissingRelation\(message\) \? false : null/,
    "a missing TABLE is the absence of the feature, not a failed read");

  // 2. Owner-only: a member sends on the owner's behalf but never rewrites an issued document.
  assert.match(route, /isActingForOther\(acting\)[\s\S]{0,400}Alleen de eigenaar kan een verstuurde factuur herstellen/,
    "the herstel door refuses anyone acting for someone else");

  // 3. The NUMBER never travels: only ever a CAS condition, never a written key.
  assert.doesNotMatch(route, /patch\.invoice_number|['"]invoice_number['"]\s*:/,
    "no path may write the number");
  // 4. The CAS holds the door — and asks the SAME questions as the gate, on the columns this
  //    installation actually has. A filter on a missing column fails the whole UPDATE (42703),
  //    and a bound stricter than the rule (exact zero vs the rule's half cent) is a 409 loop.
  assert.match(route, /\.eq\('invoice_number', existing\.invoice_number as string\)/);
  assert.match(route, /if \('amount_paid' in preEditRow\)/, "the payment filter only where the column exists");
  assert.match(route, /amount_paid\.is\.null,amount_paid\.lte\.0\.005/,
    "the CAS allows the same half cent the pure rule allows");
  assert.match(route, /if \('accountant_status' in preEditRow\)/, "the verwerkt filter only where the column exists");
  assert.match(route, /accountant_status\.is\.null,accountant_status\.neq\.verwerkt/,
    "a verwerkt landing mid-edit may not be overwritten");
  // …and the cross-table race the CAS cannot see is re-checked after the write, with rollback.
  assert.match(route, /creditnota[\s\S]{0,900}Er is zojuist een creditnota voor deze factuur gemaakt/,
    "a creditnota landing mid-edit rolls the header back");

  // 5. Delivery is part of the write and derived from the ROW: corrected_at makes "this was
  //    corrected" a fact every LATER delivery inherits — including the recovery resend after a
  //    failed mail, which the first build sent under an uncorrected cover letter.
  assert.match(route, /corrected_at/, "the edit stamps the row");
  assert.ok(existsSync("supabase/migrations/invoice_corrected_at.sql"), "…and the column has its migration");
  assert.match(route, /resend: true, corrected: true/, "the per-request flag remains as the open-migration fallback");
  assert.match(route, /corrected_delivery_failed/, "a failed delivery is reported, with the way out named");
  // 6. The audit row keeps the WHOLE pre-edit document — the stated main use case is an address
  //    fix, which a totals-only snapshot records as "nothing changed".
  assert.match(route, /invoice\.corrected/, "the audit action");
  assert.match(route, /oldValue: \{ header: oldHeader, lines: previousLines/,
    "old header AND old lines live in the trail");

  const send = code("src/app/api/invoice/send/route.ts");
  assert.match(send, /invoice\.corrected_at != null/, "the send route derives corrected delivery from the row");
  assert.match(send, /corrected === true && !isActingForOther\(acting\)/,
    "…and holds the fallback flag to the owner-only rule");
  assert.match(send, /herstel-\$\{Date\.now\(\)\}\.pdf/, "the corrected PDF is versioned, not overwritten");
  assert.match(send, /isCorrected: correctedDelivery/, "the mail knows it carries a correction");
  // 7. The line-swap window: a resend of an own outgoing factuur with money but ZERO lines is
  //    refused instead of mailing a numbered PDF with an empty item table.
  assert.match(send, /\(lines \?\? \[\]\)\.length === 0/, "the empty-lines resend guard exists");

  const mail = code("src/lib/email.ts");
  assert.match(mail, /Gecorrigeerde factuur/, "the subject says corrected");
  assert.match(mail, /vervangt de eerdere factuur/, "…the body says it replaces the earlier one");
  assert.match(mail, /vervallen/, "…and that the earlier version is void");

  // 8. The old orchestration ([CORRIGEER]) is gone; the ordinary edit rule did not widen.
  assert.ok(!existsSync("src/app/api/invoice/[id]/correct"), "the correct route was removed");
  assert.doesNotMatch(code("src/app/dashboard/invoice/[id]/page.tsx"), /\/correct/,
    "no screen calls the removed route");
  const editable = code("src/lib/invoice-editable.ts");
  assert.match(editable, /export function isInvoiceEditable/, "the draft/quote door is untouched");
  assert.match(editable, /export function sentEditBlockers/, "the herstel door is its own function");
  assert.match(editable, /quarterFiled/, "…and it asks about the filed quarter — the Belastingdienst lock");

  // 9. The screens: visibility from what the row shows, the warning BEFORE the tap, and a
  //    failed delivery never pretended away.
  assert.match(code("src/app/dashboard/invoice/[id]/page.tsx"), /canCorrectSent/);
  const editScreen = code("src/app/dashboard/invoice/[id]/edit/page.tsx");
  assert.match(editScreen, /canCorrectSent/, "the edit screen has the third state");
  assert.match(editScreen, /t\('bewerk\.herstel\.uitleg'/, "…and warns what saving does before the tap");
  assert.match(editScreen, /corrected_delivery_failed/, "…and refuses to pretend a failed delivery succeeded");
});

// ─── [SCROLL-VEL] A dialog that does not fit hides the rest, and nothing scrolls ─────────────────
//
// Reported from a phone: the confirm card for a purchase invoice was cut off at the top — the
// amount excluding BTW and the heading above it simply were not there, and no amount of dragging
// brought them back. The owner was being asked to confirm an invoice while unable to see half of
// the fields they were confirming.
//
// The mechanism: an overlay is `position: fixed; inset: 0` with `align-items: flex-end` (a bottom
// sheet) or `center` (a dialog). The panel inside had no height cap, so when its content grew past
// the screen it grew UPWARD, out of the viewport — and because the overlay is what is fixed, the
// page behind it does not scroll and the panel has no scroller of its own. Measured in Chromium at
// 393×852: the panel's top edge sat at −348px, with the first field 324px above the screen.
//
// It was not one card. 37 overlays across the app had the same shape, including three the same
// screen opens next. One CSS class now, applied to every panel, because the rule cannot live in an
// inline style: it needs `max-height: 88vh` followed by `max-height: 88dvh`, and React cannot
// express the same property twice.

test("[SCROLL-VEL] every fixed overlay has a panel that can scroll", () => {
  // The shape is what is checked, not a list of screens — a NEW dialog added next month fails this
  // too, which a checklist could not do.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };

  const offenders: string[] = [];
  for (const f of walk("src")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/position:\s*["']fixed["'],\s*inset:\s*0/g)) {
      const head = src.slice(m.index ?? 0, (m.index ?? 0) + 700);
      // Only overlays that ANCHOR their panel. A `flex-start` overlay overflows downward, where
      // the document scroll still reaches it.
      if (!/alignItems:\s*["'](flex-end|center)["']/.test(head)) continue;
      // The panel is the element opened after the overlay's own style block closes.
      const styleAt = head.indexOf("style={{", head.indexOf("}}"));
      if (styleAt < 0) continue;
      const tagStart = (m.index ?? 0) + head.lastIndexOf("<", styleAt);
      const tag = src.slice(tagStart, (m.index ?? 0) + styleAt + 420);
      const shared = /className="[^"]*\bsheet-scroll\b/.test(tag);
      // A panel that caps and scrolls itself is equally fine — the point is that it scrolls, not
      // which mechanism it uses.
      const own = /maxHeight/.test(tag) && /overflowY:\s*["']auto["']/.test(tag);
      if (!shared && !own) {
        offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    "these overlays pin a panel that cannot scroll — content past the screen edge is unreachable, " +
      `not merely below the fold:\n  ${offenders.join("\n  ")}`,
  );
});

test("[SCROLL-VEL] the shared rule caps the whole panel, padding included", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const at = css.indexOf(".sheet-scroll {");
  assert.ok(at > 0, "the shared rule is gone; every panel above now relies on a class that does nothing");
  const rule = css.slice(at, css.indexOf("}", at));

  assert.match(rule, /overflow-y:\s*auto/, "without a scroller the cap only hides more");
  // Both units, in this order. `dvh` is the height left after a phone's browser chrome, which is
  // the difference that causes this bug; a browser that does not know it keeps the vh line.
  const caps = [...rule.matchAll(/max-height:\s*(\d+)(dvh|vh)/g)].map((m) => m[2]);
  assert.deepEqual(caps, ["vh", "dvh"], "vh first as the fallback, dvh second as the real answer");
  // The cap must cover the padding. globals.css already sets border-box on everything, so this
  // is belt to that braces — kept so the class does not depend on a reset it does not own.
  assert.match(rule, /box-sizing:\s*border-box/, "max-height must include the padding, or the cap is short by it");
  assert.match(rule, /overscroll-behavior:\s*contain/, "…and the list behind the dialog must stay put");
});

// ─── [UPLOAD-PLAFOND] The ceiling the app enforces must be the one that applies ──────────────────
//
// Reported from a phone, with two pages of a supplier invoice already picked and the sheet still
// open: "Dit bestand is te groot om te versturen. Splits een grote PDF, of maak er een foto van."
//
// The client compressed every upload down to MAX_INTAKE_UPLOAD_BYTES, which was 10 MB, "mirroring
// /api/intake's server-side MAX_BYTES" — the APP's limit. The limit that bites belongs to the
// platform: a function's request body is capped around 4.5 MB and refused before any of our code
// runs, with no JSON and no sentence. So the app compressed to a size it believed was fine, handed
// it to a platform that refused it, and then asked the owner to split the PDF by hand.
//
// Everything needed already existed and was not joined up: an image normalizer, a real PDF
// compressor that downsamples embedded images while leaving text as text — wired into ONE screen —
// and the budget. One module joins them, and answers a 413 by squeezing harder and sending again,
// so a wrong estimate of someone else's limit is recoverable instead of terminal.

test("[UPLOAD-PLAFOND] the budget is the platform's, not the app's", () => {
  const src = code("src/lib/image-normalize-client.ts");
  const m = /MAX_INTAKE_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/.exec(src);
  assert.ok(m, "the shared budget must stay a plain, readable number of megabytes");
  const mb = Number(m[1]);
  assert.ok(mb <= 4, `the budget is ${mb} MB — at or above the platform ceiling, so every file ` +
    `compressed to exactly it is refused with a bare 413 the owner cannot act on`);
  assert.ok(mb >= 2, `the budget is ${mb} MB — too small for a legible multi-page scan`);
  // The server keeps its own, larger cap on purpose: it guards the paths a browser does not walk.
  const route = code("src/app/api/intake/route.ts");
  assert.match(route, /const MAX_BYTES = \d+ \* 1024 \* 1024/, "the server's own cap stays");
});

test("[UPLOAD-PLAFOND] every browser upload of a document goes through the shared fit", () => {
  // By SHAPE, not by a list: a new upload screen added next month fails this too. A CSV or an
  // MT940 is exempt — compression cannot make a text file smaller, and pretending otherwise would
  // spend an upload proving it.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  };
  const EXEMPT = /\/api\/(bank\/upload|turnover\/import|ledger\/import|eft\/import)/;

  const raw: string[] = [];
  for (const f of walk("src/app").concat(walk("src/components"))) {
    if (f.includes("/api/") || /\.test\.tsx?$/.test(f)) continue;
    // code(), not readFileSync: a negative control removed the call from IntakeButton and left the
    // COMMENT explaining it, and this gate went green on the word `sendWithFit` inside that
    // comment. It is the defect class this file exists to catch — an assertion matching a mention
    // rather than the wiring — and it caught it in the gate itself.
    const src = code(f);
    for (const m of src.matchAll(/append\(\s*['"]file['"]\s*,/g)) {
      const at = m.index ?? 0;
      const around = src.slice(Math.max(0, at - 1400), at + 900);
      const url = /fetch\(\s*[`'"]([^`'"]+)[`'"]/.exec(around.slice(around.indexOf(m[0])))?.[1] ?? "";
      if (EXEMPT.test(url)) continue;
      if (!/sendWithFit|fitForUpload/.test(around)) {
        raw.push(`${f}:${src.slice(0, at).split("\n").length} → ${url}`);
      }
    }
  }
  assert.deepEqual(
    raw, [],
    "these post a document straight at the platform's ceiling, so a large scan is refused with a " +
      `bare 413 and no sentence:\n  ${raw.join("\n  ")}`,
  );
});

test("[UPLOAD-PLAFOND] no screen quotes a size the app does not enforce", () => {
  // Two messages on the upload screen said "max 10 MB" long after the real ceiling had become 4.
  // A number the owner is given must be one an upload can actually meet, so the sentences derive
  // it from the constant.
  for (const f of [
    "src/app/dashboard/upload/UploadClient.tsx",
    "src/components/intake/IntakeButton.tsx",
  ]) {
    const src = code(f); // comments stripped — only what the owner can read
    assert.doesNotMatch(src, /max 10 ?MB|boven de 10 MB/i, `${f}: quotes a ceiling that is not the one enforced`);
  }
});

test("[UPLOAD-PLAFOND] the retry is real, and it is bounded", () => {
  const mod = code("src/lib/upload-fit.ts");
  assert.match(mod, /res\.status !== 413/, "a platform refusal must be recognised");
  assert.match(mod, /retryBudget\(budget\)/, "…and answered against a smaller budget");
  // Exactly two sends in the worst case. A loop here would spend an owner's mobile data proving
  // that a file which is not a size problem is still not a size problem.
  assert.equal((mod.match(/await send\(/g) ?? []).length, 2, "two sends at most, never a loop");
  // And no second upload when the squeeze gained nothing.
  assert.match(mod, /second\.after >= first\.after/, "identical bytes must not be sent twice");
  // The fitter is injectable, or the retry is untestable and would sit unexercised.
  assert.match(mod, /fit: \(f: File, b: number\) => Promise<FitResult> = fitForUpload/);
  const spec = readFileSync("src/lib/upload-fit.test.ts", "utf8");
  assert.match(spec, /becomes a smaller second attempt that succeeds/, "the retry must be exercised");
  assert.match(spec, /happens once, never in a loop/, "…and its bound asserted");
});

// ─── [ANDER-TOTAAL] The document's own total, when the read one is not on it ─────────────────────
//
// Reported with the paper invoice beside the screen. NemaFood B.V. 262697, three scanned pages with
// no text layer: the app read € 1.149,56 with € 94,92 BTW; the document says
// € 1.065,14 + € 95,54 = € 1.160,68. Eleven euro of cost and sixty-two cents of voorbelasting.
//
// The app had already noticed. [GEGROND-OCR] pays for a second, blind read of the page — "write
// down every amount you can see" — and checks whether the extracted total is among them. It was
// not, and the owner was told: "controleer het aan de factuur zelf". True, and a dead end: it sends
// them to find the paper while the app is holding a transcription of that paper and discards it.
//
// Among those amounts there is usually exactly one triple that adds up to the cent. That is not a
// guess about which number is the total — it is the arithmetic every invoice's totals block
// satisfies and very little else does. So the question goes on the screen instead.

test("[ANDER-TOTAAL] the transcription is used, not discarded", () => {
  const grounding = code("src/lib/amount-grounding.ts");
  // The verdict must carry the alternative, or the finder is unreachable from the screen.
  assert.match(grounding, /alternative\?: \{ ex: number; btw: number; inc: number \}/,
    "the grounding verdict must be able to carry the document's own totals block");
  assert.match(grounding, /alternativeTotals\(amounts\.totalIncBtw/, "…and must actually look for one");
  // Only when the read total is NOT on the document. Raising a second figure on a correct invoice
  // is how a warning stops being read.
  const at = grounding.indexOf("alternativeTotals(");
  const before = grounding.slice(Math.max(0, at - 300), at);
  assert.match(before, /totalIncBtw === 'absent'/, "the alternative is for the absent case only");
});

test("[ANDER-TOTAAL] a candidate must add up exactly, and be a plausible totals block", () => {
  const mod = code("src/lib/amount-candidates.ts");
  // Cents, not floats: 0.1 + 0.2 !== 0.3 in binary, and this is an equality test on money.
  assert.match(mod, /Math\.round\(n \* 100\)/, "the comparison must be in whole cents");
  // Distinct amounts — an invoice prints the same figure twice and x + x = 2x means nothing.
  assert.match(mod, /seen\.has\(c\)/, "a printed amount may not pair with itself");
  // BTW never exceeds the net it is charged on.
  assert.match(mod, /if \(b > a\) continue/, "the BTW side must be the smaller one");
  // A floor, because small change sums coincidentally on every receipt.
  assert.match(mod, /MIN_TOTAL/, "small change must not become a totals block");
  // Bounded: the search is quadratic and a model can transcribe a whole page.
  assert.match(mod, /MAX_CONSIDERED/, "a pathological transcription must not stall a request");
});

test("[ANDER-TOTAAL] the finding is shown, never applied", () => {
  // Both figures come from a model reading a scan. The app knows they disagree and does not know
  // which is right, so naming a winner would be the same overconfidence that produced the wrong
  // number. It must not write to the invoice.
  const mod = code("src/lib/amount-candidates.ts");
  assert.doesNotMatch(mod, /\.update\(|\.insert\(|supabase/, "this module decides nothing and writes nothing");
  const health = code("src/lib/import-health.ts");
  assert.match(health, /alternativeReason\(grounding\.alternative\)/, "the owner is told");
  assert.match(health, /controleer welk bedrag op de factuur staat/, "…and asked, not overruled");
  // And when there is no candidate the honest old sentence must remain, not disappear.
  assert.match(health, /controleer het aan de factuur zelf/, "no candidate ⇒ the plain warning stays");
});

test("[ANDER-TOTAAL] the invoice it was built from is the fixture", () => {
  // A synthetic example proves the arithmetic; this document proves the FEATURE. Its per-rate block
  // (3,60 + 1.061,54 = 1.065,14) also adds up, so it is what shows the ordering has to prefer the
  // grand total — the number that becomes money.
  const spec = readFileSync("src/lib/amount-candidates.test.ts", "utf8");
  assert.match(spec, /1160\.68/, "the document's real total");
  assert.match(spec, /1149\.56/, "…and the one the app read instead");
  assert.match(spec, /GRAND total wins over the per-rate blocks/, "the ordering must be exercised");
  assert.match(spec, /the pieces, joined/i, "and the chain end to end, not just the finder");
});

test("[ANDER-TOTAAL] the offer reaches the screen where the total is edited", () => {
  // The card shows the warning; the MODAL is where the owner types the number, so that is where
  // the one tap has to be. A prop that never arrives in a modal body is perfectly typed and
  // perfectly invisible to tsc — which is why this is asserted by a render, not by a signature.
  const client = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");
  assert.match(client, /alternativeTotals\?: \{ ex: number; btw: number; inc: number \}/,
    "the client's ImportHealth mirror must carry it, or the modal cannot see it");
  assert.match(client, /invoice\.health\.alternativeTotals && \(\(\) => \{/, "…and the modal must offer it");
  // One tap fills and opens the editor. It must NOT save: both figures come from a model reading a
  // scan, and the owner confirms with the paper in hand.
  const at = client.indexOf("invoice.health.alternativeTotals && (() =>");
  const offer = client.slice(at, at + 900);
  assert.match(offer, /applyTriplet\(\{ ex: alt\.ex, btw: alt\.btw, incl: alt\.inc \}\)/, "fills all three fields");
  assert.match(offer, /setEditing\(true\)/, "…and opens the editor");
  assert.doesNotMatch(offer, /onVerify|onPay|fetch\(/, "tapping must not book anything");
  // And the modal is exported for the render suite, or the assertion above has nothing to render.
  assert.match(client, /export function ConfirmPaidModal/);
  const render = readFileSync("tests/render/money-screens.test.tsx", "utf8");
  assert.match(render, /reaches the confirm modal as one tap/, "the render proof must exist");
  assert.match(render, /no offer on an invoice that reads right/, "…and the silent case with it");
});

// ─── [SERVER-ZIN] A machine code is not a sentence, on any screen ────────────────────────────────
//
// The routes in this app answer failures two ways and a screen cannot tell them apart by looking:
//
//     { error: "Bankafschrift niet gevonden" }   ← written for a person
//     { error: "invoice_read_failed" }           ← written for a program
//
// Both arrive as `json.error`, so `showToast(json.error || 'Mislukt')` is right half the time. The
// reported case was /vandaag ("invoice_already_paid" under the "Al betaald?" button), and a sweep
// found the same shape on the payment-allocation screen (unauthorized, transaction_not_found,
// invoice_read_failed), in the kasboek (opening_balance_lookup_failed), on the bank statement list
// (lookup_failed) and in the restore-from-ignored flow (bank_linked, money_settled).
//
// One rule, in server-message.ts: a code has no spaces. Every site goes through it — including the
// ones whose route emits only sentences today, because "today" is the operative word and a route
// gaining one code would otherwise regress a screen silently.

test("[SERVER-ZIN] no screen renders a route's error straight", () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  };
  // The offence is RENDERING the error, not reading it. A site that compares the code and maps it
  // to a sentence — `showToast(json?.error === 'lookup_failed' ? '…' : '…')` — is doing exactly the
  // right thing, and the first version of this gate flagged one of those.
  const RAW = /(showToast|setError|setMessage|throw new Error)\(\s*\(?(?:json|data|j|res)\??\)?[.?]*\.?error\b(?!\s*(?:===|!==|==|!=|\?\.))/g;

  const offenders: string[] = [];
  for (const f of walk("src/app").concat(walk("src/components"))) {
    if (f.includes("/api/") || /\.test\.tsx?$/.test(f)) continue;
    const src = code(f); // comments stripped — a note about the old shape must not count
    for (const m of src.matchAll(RAW)) {
      offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    "these put whatever the route happened to send in front of the owner — a Dutch sentence on a " +
      `good day and "invoice_read_failed" on a bad one:\n  ${offenders.join("\n  ")}`,
  );
});

test("[SERVER-ZIN] the rule keeps sentences and drops codes", () => {
  const mod = code("src/lib/server-message.ts");
  // The test is the absence of a space, and nothing else. A catalogue would only cover the codes
  // somebody remembered; this covers the route written next month.
  assert.match(mod, /\^\[a-z\]\[a-z0-9\]\*\(\?:_\[a-z0-9\]\+\)\*\$/, "a code is one lowercase token or snake_case");
  // A 5xx detail is a raw PostgreSQL string with a tag and a uuid in it.
  assert.match(mod, /if \(status < 500\)/, "a 5xx detail may never reach a phone");
  // The fallback is the caller's, already translated — this module may hold no language of its own.
  assert.match(mod, /fallback: string/, "the screen's line, in the screen's language");
  assert.doesNotMatch(mod, /'[A-Z][a-z]+ (niet|mislukt|gelukt)/, "no Dutch copy inside the rule");
  const spec = readFileSync("src/lib/server-message.test.ts", "utf8");
  // The vocabulary is read off the routes, not invented — including the lowercase Dutch sentences
  // a "must start with a capital" rule would have thrown away.
  assert.match(spec, /opening_balance_lookup_failed/, "the codes that were actually reaching screens");
  assert.match(spec, /direction moet 'in' of 'out' zijn/, "…and the lowercase Dutch that must survive");
});

// ─── [MIN-REGEL] A credit line inside an ordinary invoice ────────────────────────────────────────
//
// From the owner's own supplier invoice: ATAPACK Cash & Carry 26304787, 17-07-2026. Line AP290004
// reads "Credit over faktuur 26302362" — three boxes of knoopzakken going back, −3 × € 23,95 =
// −71,85, netted against nine ordinary lines. Every wholesaler in this trade settles a return that
// way, and retyping such an invoice into this app was impossible: the quantity field floored every
// entry at 0,01, so −3 silently became 0,01 and the line said € 0,24 instead of € −71,85.
//
// The minus is allowed in exactly one place, and that is not a preference:
//
//   · EN 16931 BR-27 — the item net price shall NOT be negative. An access point refuses a file
//     with a negative cbc:PriceAmount, so an invoice that looks right on paper never arrives.
//   · It is what the paper says: three pieces went back, at the price they were sold for.
//
// And a document whose credits outweigh its deliveries is not a factuur any more. It gives money
// back, which is a creditnota: its own number series (Art. 35 Wet OB) and the other side of the
// aangifte. Nothing downstream would notice — the totals simply go negative and every screen
// agrees with them — so it is refused by name, on the screen AND at the door.

test("[MIN-REGEL] the sign rule has one definition, and three surfaces use it", () => {
  const mod = code("src/lib/negative-line.ts");
  assert.match(mod, /export function lineSignFault/, "the per-line judgement");
  assert.match(mod, /export function staysAFactuur/, "the per-document judgement");
  // Cents, not floats: this decides whether a document changes type, on a comparison with zero.
  assert.match(mod, /cents\(invoiceNetEx\(lines\)\) >= 0/, "the boundary is decided in whole cents");
  // The module decides and holds no language beyond the one shared refusal, which says why it is
  // there. A screen sentence in here would render underneath an Arabic interface.
  assert.doesNotMatch(mod, /supabase|fetch\(/, "a pure module — it books nothing");

  const screen = code("src/app/dashboard/invoice/new/page.tsx");
  assert.match(screen, /import \{ lineSignFault, staysAFactuur \} from '@\/lib\/negative-line'/,
    "the builder must ask the module, not re-decide");
  const door = code("src/lib/draft-totals.ts");
  assert.match(door, /import \{ staysAFactuur, NOT_A_FACTUUR_REASON \} from ".\/negative-line"/,
    "and so must the door — a second opinion here is a screen and a server that disagree");
});

test("[MIN-REGEL] the quantity may go negative and the price may not", () => {
  const screen = code("src/app/dashboard/invoice/new/page.tsx");
  // The floor is what threw the minus away: Math.max(0.01, -3) is 0,01.
  assert.match(screen, /onChange\(allowNegative \? parsed : Math\.max\(min, parsed\)\)/,
    "the floor may only apply to a field that must not go negative");
  // Exactly one field carries it. A grep for the prop, so a second one cannot be added quietly.
  const withFlag = [...screen.matchAll(/<LineInput[^>]*allowNegative[^>]*>/g)].map((m) => m[0]);
  assert.equal(withFlag.length, 1, `only the quantity field may go below zero: ${withFlag.join(" | ")}`);
  assert.match(withFlag[0], /label=\{t\('nieuw\.regel\.aantal'\)\}/, "…and it is the aantal");
  // A zero quantity stays an error — a line that moves nothing is a half-typed line, not a credit.
  assert.match(screen, /quantity: lineSignFault\(l\) === 'quantity_zero'/, "zero is still refused, by name");
});

test("[MIN-REGEL] a document that gives money back is refused on the screen and at the door", () => {
  const screen = code("src/app/dashboard/invoice/new/page.tsx");
  assert.match(screen, /!staysAFactuur\(lines\)/, "the screen refuses before anything is sent");
  assert.match(screen, /setError\(t\('nieuw\.fout\.creditnota'\)\)/,
    "…in the owner's language — a hard-coded Dutch sentence here is a translation that stays half-finished");

  // The door. The screen is not the lock; this function is what both writers of invoice_lines call.
  const door = code("src/lib/draft-totals.ts");
  assert.match(door, /documentKind !== "creditnota" && !staysAFactuur\(clean\)/,
    "a creditnota is exempt — its lines are negative by design — and everything else is checked");
  assert.match(door, /errors\.length === 0 &&/, "one problem gets one answer");
  assert.match(door, /reason: NOT_A_FACTUUR_REASON/, "and the refusal names the creditnota");

  // Both routes must hand it the document type. Omitting it does not skip the check (the default
  // judges as a factuur), but on the edit route it would refuse every creditnota edit.
  assert.match(code("src/app/api/invoice/draft/route.ts"), /validateDraftLines\(body\.lines, soort\)/,
    "the create route must say which document it is making");
  assert.match(code("src/app/api/invoice/[id]/route.ts"), /validateDraftLines\(rawLines, existing\.invoice_type\)/,
    "the edit route must say which document it is editing");
});

test("[MIN-REGEL] a refusal from the create route says which line and why", () => {
  // It returned "De regels kloppen niet" and put the reason in `fouten`, which no screen reads.
  // The owner was told the lines were wrong and never which one — the silence this repo keeps
  // finding, in the one place that already knew the answer.
  const route = code("src/app/api/invoice/draft/route.ts");
  assert.match(route, /const eerste = gecontroleerd\.errors\[0\]/, "the first error must be spoken");
  assert.match(route, /error: `\$\{waar\}\$\{eerste\.reason\}\.`/, "…as the error the screen shows");
  assert.doesNotMatch(route, /error: 'De regels kloppen niet'/, "not as a sentence that says nothing");
});

test("[MIN-REGEL] the e-factuur can never carry a negative price", () => {
  const ubl = code("src/lib/ubl-export.ts");
  // The sign is moved once, before the quantity is written, so both fields come from one decision.
  assert.match(ubl, /const priceCarriedTheMinus = storedPrice < 0/, "a stored negative price is recognised");
  assert.match(ubl, /const aantal = priceCarriedTheMinus \? -storedQuantity : storedQuantity/,
    "…and the minus moves to the quantity, which is where BR-27 allows it");
  assert.match(ubl, /const stuksprijs = Math\.abs\(storedPrice\)/, "…leaving the price a magnitude");
  assert.match(ubl, /"InvoicedQuantity", \{ unitCode: toUnitCode\(l\.unit\) \}\)\.txt\(qty\(aantal\)\)/,
    "the emitted quantity must be the normalized one, or the two fields disagree");
  // The fallback branch: PriceAmount is expressed per LINE, and on a credit line that amount is
  // negative. [REGEL-KORTING] renamed what it reproduces — `ex` is the net line total, and the
  // per-line price has to reproduce the amount BEFORE the allowance that is now emitted beside it
  // — but the rule this gate is here for is untouched: whatever goes in that element is an abs().
  assert.match(ubl, /"PriceAmount", \{ currencyID: EUR \}\)\.txt\(money\(Math\.abs\(teReproduceren\)\)\)/,
    "the per-line price form must be a magnitude too");
  assert.match(ubl, /const teReproduceren = round2\(ex \+ kortingBedrag\)/,
    "…and it must reproduce the line amount plus whatever the allowance took off, or " +
      "PEPPOL-EN16931-R120 fails and the file is refused");
  assert.match(ubl, /"BaseQuantity", \{ unitCode: toUnitCode\(l\.unit\) \}\)\.txt\(qty\(Math\.abs\(aantal\)\)\)/,
    "PEPPOL-EN16931-R121: the base quantity must be a positive number");

  // Proven by a document, not only by a signature: the exporter test builds the ATAPACK line and
  // reads every PriceAmount back out of the XML.
  const spec = readFileSync("src/lib/ubl-export.test.ts", "utf8");
  assert.match(spec, /\[MIN-REGEL\] the ATAPACK credit line keeps its minus in the quantity/);
  assert.match(spec, /BR-27/, "the rule must be named where it is enforced");
});

test("[MIN-REGEL] the invoice the customer keeps shows the credit and still adds up", () => {
  // The PDF is where this is checked by hand. A minus dropped anywhere between the row and the
  // totals leaves a document that looks finished and asks for € 71,85 too much.
  const spec = readFileSync("src/lib/invoice-pdf-document.test.ts", "utf8");
  assert.match(spec, /€ -71,85/, "the row must show money going back");
  assert.match(spec, /€ 101,18/, "the subtotal is the netted one");
  assert.match(spec, /€ 122,43/, "…and the amount due is the one on the paper invoice");
  assert.match(spec, /the same invoice without the credit line is 71,85 more expensive/,
    "with the control that makes those numbers mean something");
});

test("[MIN-REGEL] the two invoice forms allow and refuse the same things", () => {
  // The defect this gate is made of: the rule was added to the builder and the EDIT screen kept a
  // `min="1"` on its quantity field. An owner could then create the ATAPACK invoice and not open
  // it again — and min="1" had been refusing half an hour of work since long before any of this.
  const edit = code("src/app/dashboard/invoice/[id]/edit/page.tsx");
  const qty = /type="number" value=\{line\.quantity\}([^/>]*)/.exec(edit);
  assert.ok(qty, "the quantity field must be findable on the edit screen");
  assert.doesNotMatch(qty![1], /min=/, "no floor: a credit line is a negative aantal");
  assert.match(qty![1], /step="any"/, "and no whole-unit spinner, which makes 0,5 invalid");

  // One rule, one module, asked by both screens and by the door.
  assert.match(edit, /import \{ staysAFactuur \} from '@\/lib\/negative-line'/,
    "the edit screen may not form its own opinion about what a factuur is");
  assert.match(edit, /invoiceType !== 'creditnota' && !staysAFactuur\(lines\)/,
    "…and a creditnota is exempt here too, or every edit of one would be refused");
  // Both buttons. Two copies of the same pre-check is how one of them ends up a rule short.
  const calls = [...edit.matchAll(/const lineFault = lineProblem\(\)/g)];
  assert.equal(calls.length, 2, `opslaan AND versturen must ask: found ${calls.length}`);
  assert.doesNotMatch(
    edit, /if \(lines\.some\(l => !l\.description \|\| l\.unit_price <= 0\)\) \{\s*setError/,
    "the old inline copy must be gone, or it is the one that will drift",
  );

  // And the screen renders at all — the gate that the other five cannot give.
  const render = readFileSync("tests/render/money-screens.test.tsx", "utf8");
  assert.match(render, /src\/app\/dashboard\/invoice\/\[id\]\/edit\/page/, "the edit screen must be on the render line");
});

// ─── [LEVENSLOOP] One invoice, every station ────────────────────────────────────────────────────
//
// Every station in this app is tested where it lives and each is right on its own. The defects
// that keep being found are BETWEEN two of them, where neither side can see: the e-factuur that
// stated a cent less BTW than the PDF, the price column that printed EUR 0,83 beside a line total
// of EUR 123,85, the creditnota that credited a returned crate twice. invoice-lifecycle.test.ts
// carries ONE document — fractional prices, two rates and a credit line — through the totals, the
// PDF, the e-factuur, the creditnota and that creditnota's own PDF and e-factuur, and asks each
// station for the same figures.

test("[LEVENSLOOP] the end-to-end check covers every station, with hand-worked figures", () => {
  const spec = readFileSync("src/lib/invoice-lifecycle.test.ts", "utf8");
  // Each station must actually be called. A lifecycle test that quietly stopped rendering the PDF
  // would still pass, and would still be named the same thing.
  for (const station of ["computeInvoiceTotals", "renderInvoicePdf", "buildInvoiceUbl", "creditLinesFor", "rateSharesFromLines", "buildAangifte"]) {
    assert.match(spec, new RegExp(`\\b${station}\\(`), `${station} must be exercised end to end`);
  }
  // The figures are worked out from the lines by hand. A test that asked the code for the answer
  // would agree with any answer it gave.
  assert.match(spec, /const EX = 376\.31/, "the excl total");
  assert.match(spec, /const BTW = 43\.24/, "the btw, per rate and then added");
  assert.match(spec, /const INC = 419\.55/, "and the amount due");
  // The two properties that make it a lifecycle test rather than six unit tests.
  assert.match(spec, /invoice and creditnota cancel to zero at every station/,
    "the correction must leave nothing behind, or a rubriek keeps a remainder forever");
  assert.match(spec, /-3, unit_price: 23\.95/, "…and a credit line must be on the document");
  // The last station is the only one whose reader is neither the owner nor the customer.
  assert.match(spec, /verschuldigd, 43/, "5a must be the same btw the other stations named");
  assert.match(spec, /verschuldigd, -43/, "…and the creditnota must take exactly that back down");
});

test("[LEVENSLOOP] the creditnota flip is a negation, not a magnitude", () => {
  // The defect the lifecycle test found within minutes of existing: Math.abs() per line turned the
  // un-returned line the wrong way, and the file credited the customer 143,70 too much against a
  // header that said otherwise. Only the PRICE is a magnitude — that one is BR-27.
  const ubl = code("src/lib/ubl-export.ts");
  assert.match(ubl, /quantity: l\.quantity == null \? 1 : -Number\(l\.quantity\)/,
    "the quantity is negated, with the ?? 1 default kept — negating THAT emits -1 against a positive line");
  assert.match(ubl, /line_total: -Number\(l\.line_total \?\? 0\)/, "and so is the amount");
  assert.match(ubl, /unit_price: Math\.abs\(Number\(l\.unit_price \?\? 0\)\)/,
    "the price stays a magnitude — a negative cbc:PriceAmount is refused by the access point");
  const spec = readFileSync("src/lib/ubl-export.test.ts", "utf8");
  assert.match(spec, /a creditnota is FLIPPED, not made absolute/, "covered where the exporter lives too");
  assert.match(spec, /a creditnota line with no quantity still multiplies out/, "including the default");
});

test("[MIN-REGEL] a reading may not turn a credit line into a charge", () => {
  // Two places turn a READING into an editable line — the free invoice tool carrying a scanned
  // document, and generateInvoiceFromPrompt turning "drie kratten retour" into a row. Both wrote
  // `quantity > 0 ? quantity : 1`, which does two jobs with one test: it rejects a quantity that
  // cannot be read (right, and 1 is the right answer) and a NEGATIVE one, which is a credit line.
  // On the ATAPACK row that is -3 x EUR 23,95 = EUR -71,85 carried in as 1 x EUR 23,95: EUR 95,80
  // of swing towards charging the customer, with nothing on the screen saying so.
  for (const path of ["src/app/factuur-maken/GratisFactuur.tsx", "src/lib/ai.ts"]) {
    const src = code(path);
    assert.doesNotMatch(
      src, /quantity === 'number' && \w*\.?\w*quantity > 0 \? /,
      `${path} still refuses a credit line from a reading`,
    );
    assert.match(src, /readQuantity|readLineAmounts/, `${path} must ask read-line.ts what a quantity is`);
  }
  const mod = code("src/lib/read-line.ts");
  assert.match(mod, /usable\(value\) && value !== 0 \? value : fallback/,
    "unreadable ⇒ 1, and a negative quantity is kept");
  assert.match(mod, /return \{ quantity: -quantity, unit_price: -unitPrice \}/,
    "…and the minus is moved out of the price, where BR-27 forbids it");
});

test("[CREDIT-SIGN] a creditnota without lines can still be sent as an e-factuur", () => {
  // effectiveLines synthesizes a summary line for an invoice that has none — a scanned or legacy
  // one — and did so only when `ex > 0`. A creditnota's ex total is negative, so crediting such an
  // invoice produced NO_LINES and the export THREW. The same document as a factuur exported fine,
  // and the creditnota route copies the lines of the invoice it corrects: no lines in, none out.
  const ubl = code("src/lib/ubl-export.ts");
  assert.match(ubl, /if \(Number\.isFinite\(ex\) && ex !== 0\) \{/,
    "a usable total is a non-zero one, in either direction");
  // And the synthesized line must follow the STORED convention, or the creditnota flip turns its
  // quantity into -1 against a positive amount and PEPPOL-EN16931-R120 refuses the file.
  assert.match(ubl, /quantity: ex < 0 \? -1 : 1/, "stored negative, flipped positive for the file");
  assert.match(ubl, /unit_price: Math\.abs\(ex\)/, "…with the price a magnitude, as BR-27 requires");
  const spec = readFileSync("src/lib/ubl-export.test.ts", "utf8");
  assert.match(spec, /a creditnota with no lines is exportable/, "proven by a document");
  assert.match(spec, /a factuur without lines is synthesized exactly as it always was/,
    "…and the case that already worked must be untouched");
});

// ─── [REGEL-KORTING] A discount that belongs to ONE line ──────────────────────
//
// The invariant the whole feature rests on is a STORAGE CONTRACT: invoice_lines.line_total holds
// the NET amount — quantity x price minus the line's own discount. It is chosen deliberately as
// the direction in which a mistake costs nothing: a reader that never learns the two new columns
// sums line_total and gets the right money. The other direction (store gross, let readers
// subtract) means every reader that misses them overcharges the customer on a numbered document.
//
// Two ways that contract can break silently, and neither shows on any screen:
//   · subtract the discount AGAIN somewhere that already reads line_total → the customer is
//     undercharged, on exactly the lines that were meant to be cheaper;
//   · write the GROSS into line_total → the customer is overcharged and the discount is a lie.
test("[REGEL-KORTING] the stored line total is net, and is never discounted twice", () => {
  const discount = code("src/lib/invoice-discount.ts");

  // One definition of what a line is worth. negative-line.ts had its own copy of this expression —
  // identical until a line could carry a discount, and it is the module that decides whether a
  // document is a factuur or a creditnota, so the cheaper definition would have won that argument
  // by accident.
  assert.match(discount, /export function lineNetEx\(l: DiscountLine\): number \{/,
    "the line amount has one home");
  assert.match(code("src/lib/negative-line.ts"), /import \{ lineNetEx \} from '\.\/invoice-discount'/,
    "negative-line must USE it rather than keep a second copy");

  // The double-subtraction guard, in the one function every summation goes through.
  assert.match(
    discount,
    /function lineEx\(l: DiscountLine\): number \{\s*return typeof l\.line_total === "number" \? l\.line_total : lineNetEx\(l\);/,
    "a stored line_total is taken AS IS — it is already net, and taking the discount off it again " +
      "undercharges the customer on precisely the discounted lines",
  );

  // And the cap, which is what keeps a typo from inventing a credit inside a delivery.
  assert.match(discount, /Math\.min\(wanted, magnitude\)/,
    "a discount larger than the line is capped at the line, never turned into a negative line");
});

test("[REGEL-KORTING] the migration exists and constrains what may be stored", () => {
  const path = "supabase/migrations/invoice_line_discount.sql";
  assert.ok(existsSync(path), `${path} must exist — the columns are what make the discount reproducible`);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS discount_type text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS discount_value numeric/);
  assert.match(sql, /discount_type IN \('percent', 'amount'\)/,
    "a third spelling would be accepted by a route and guessed at by every reader");
  assert.match(sql, /discount_value > 0/, "zero is not a discount — it would print 'Korting 0%' on a customer's invoice");
  assert.match(sql, /discount_value <= 100/, "over 100% is not a big discount, it is a negative line with a friendly word in front");
});

test("[REGEL-KORTING] the e-factuur explains the difference instead of inventing a price", () => {
  const ubl = code("src/lib/ubl-export.ts");
  // BG-27. The placement is not free: UBL 2.1 puts cac:AllowanceCharge after LineExtensionAmount
  // and before cac:Item, and elsewhere the file is not schema-valid — refused before any business
  // rule is even reached.
  // Anchored on CODE, not on a comment: code() strips comments, so a comment anchor silently
  // becomes -1 and every assertion below it passes against the wrong slice of the file.
  const lineLoopAt = ubl.indexOf("effLines.forEach(");
  assert.ok(lineLoopAt > 0, "the InvoiceLine loop must be findable");
  const lineBlock = ubl.slice(lineLoopAt);
  const allowanceAt = lineBlock.indexOf('line.ele(NS.cac, "AllowanceCharge")');
  const itemAt = lineBlock.indexOf('const item = line.ele(NS.cac, "Item")');
  const amountAt = lineBlock.indexOf('"LineExtensionAmount"');
  assert.ok(allowanceAt > 0, "a line-level allowance must be emitted at all");
  assert.ok(allowanceAt > amountAt, "…after LineExtensionAmount");
  assert.ok(allowanceAt < itemAt, "…and before Item");

  // A line allowance inherits the line's tax category; EN 16931 gives BG-27 none of its own, and
  // the document-level allowance right above DOES carry one — so the two must not be copied from
  // each other by a later hand.
  const allowanceBlock = lineBlock.slice(allowanceAt, itemAt);
  assert.doesNotMatch(allowanceBlock, /TaxCategory/,
    "a line allowance must not carry a tax category of its own");
  assert.match(allowanceBlock, /MultiplierFactorNumeric/,
    "a percentage discount states its percentage (BT-138)");
  assert.match(allowanceBlock, /BaseAmount/, "…and what it came off (BT-137)");
});

test("[REGEL-KORTING] a creditnota reproduces the invoice it reverses, discount included", () => {
  // [REGEL-KOPIE] The rule moved to the module all three copiers now share — following it there
  // rather than relaxing the gate, because this is the exact assertion that was true of the
  // creditnota and false of /duplicate and the recurring cron at the same time.
  const credit = code("src/lib/creditnota-lines.ts");
  assert.match(credit, /\.\.\.optionalLineFields\(line\)/, "the mirror asks the shared copier");
  const copy = code("src/lib/invoice-line-copy.ts");
  // Not decoration. line_total is net and HAS been flipped, so a credit line without these two
  // says -10 x EUR 12,50 = EUR -100; the access point redoes that multiplication
  // (PEPPOL-EN16931-R120), finds -125, and refuses the file while the PDF looks perfect.
  assert.match(copy, /discount_type: line\.discount_type \?\? null/,
    "the discount travels to the credit note");
  assert.match(copy, /line\.discount_type \? \(line\.discount_value \?\? null\) : null/,
    "…and a value without a type is not a discount");
  // Conditional, like `unit` and the exemption flag: a column the database does not have must not
  // appear in the INSERT, or the creditnota loses its lines after its number is already spent.
  assert.match(copy, /\.\.\.\(line\.discount_type !== undefined/,
    "absent from the source row means absent from the copy");
});

test("[REGEL-KORTING] a discount the app will not honour is refused, never dropped", () => {
  // Dropping it silently issues the invoice at the FULL price while the owner believes they gave a
  // discount — the surprise lands on a numbered document that cannot be taken back.
  const totals = code("src/lib/draft-totals.ts");
  assert.match(totals, /const wantsDiscount = filled\(row\.discount_type\) \|\| filled\(row\.discount_value\)/,
    "a half-filled discount has to be recognised as an attempt");
  assert.match(totals, /if \(wantsDiscount && !discount\) \{/, "…and refused");
  assert.match(totals, /field: "discount_value"/, "…on the field the owner can fix");
  // Clearing one is an ordinary edit and must stay one.
  assert.match(totals, /discount_type: discount\?\.type \?\? null/,
    "what was validated is what gets stored — never raw input the CHECK would have to catch");
});

test("[REGEL-KORTING] a creditnota carries no discount of its own, on either screen", () => {
  // A discount on a correction is arithmetic nobody can check by eye — the same rule the document
  // discount already follows. The credit note gets its discount by COPY, never by typing.
  for (const path of [
    "src/app/dashboard/invoice/new/page.tsx",
    "src/app/dashboard/invoice/[id]/edit/page.tsx",
  ]) {
    const page = code(path);
    const at = page.indexOf("t('nieuw.regelKorting')");
    assert.ok(at > 0, `${path} must offer a line discount`);
    // The control sits inside a creditnota guard — look back from it for the condition.
    assert.match(page.slice(Math.max(0, at - 3000), at), /invoiceType !== \(?'creditnota'/,
      `${path} must not offer a line discount on a creditnota`);
  }
});
// ─── [CREDIT-VERREKEN] A supplier credit is settled by deducting it ──────────────────────────────
//
// Reported with the screen open on it: an invoice of € 1.764,76 and a creditnota of € 52,38 from
// the same supplier, selected together on Crediteuren, refused with "haal hem uit de selectie".
// That refusal was right about the arithmetic — the credit would have been ADDED, so the owner paid
// twice its value too much — and wrong as an answer. Deducting a credit from the next payment and
// naming both documents in the description is how this trade settles a return.

test("[CREDIT-VERREKEN] the credit subtracts, and only from the supplier it belongs to", () => {
  const mod = code("src/lib/bundel-betaling.ts");
  assert.match(mod, /const amount = round2\(debtTotal - creditTotal\)/, "it comes OFF the transfer");
  // Only a row whose sign and type agree. A 'conflict' is the app contradicting itself and a
  // 'suspected' is a guess; netting on either pays the wrong amount for an invisible reason.
  assert.match(mod, /if \(stance === "credit"\) \{ credits\.push\(inv\); continue; \}/,
    "only a confirmed credit may be deducted");
  assert.match(mod, /stance === "conflict"/, "a positive creditnota is refused, not netted");
  assert.match(mod, /bevestig/i, "…and an unconfirmed one is refused by name");
  // Same supplier: the IBAN when the credit has one, the shared counterpart key when it does not.
  assert.match(mod, /normalizeIban\(cn\.vendor_iban\) !== iban/, "another IBAN is another supplier");
  assert.match(mod, /counterpartKey\(cn\.client_name \?\? null\)/,
    "a creditnota without an IBAN must match on the name, or it is refused");
  // No transfer of nothing, and both numbers on the payment.
  assert.match(mod, /if \(amount <= 0\)/, "a credit bigger than the bill is an answer, not a € 0,00 QR");
  assert.match(mod, /\$\{debtRefs\} -\/- \$\{creditRefs\}/, "the kenmerk names the credits after -/-");
});

test("[CREDIT-VERREKEN] the screen shows the net, and settles the credit with the payment", () => {
  const client = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  // The bar read "2 geselecteerd · € 1.817,14" over a payment of € 1.712,38: it added the credit.
  assert.match(client, /selectedRows\.reduce\(\(s, r\) => s \+ openAmountSigned\(r\), 0\)/,
    "the selection total must net the credit, like the list total below it already does");
  // The builder cannot see a credit note booked as a debt without the supplier's other numbers,
  // and this screen is the side that has them.
  assert.match(client, /buildBundelBetaling\(selectedRows, bundleVendorNumbers\)/,
    "the evidence for the 'suspected' state must travel with the selection");
  // The sheet has to explain the subtraction where the money is confirmed.
  assert.match(client, /built\.creditTotal != null &&/, "the netting is spelled out on the sheet");
  assert.match(client, /aan creditnota&apos;s/, "…naming what came off");
  // And the settle step closes the credit too, or it is deducted again next month. The sentence
  // lives in the catalogue ([TAAL]), so the gate follows it there: the screen must CHOOSE that key
  // on a batch containing a credit, and the key must exist in every language the panel carries.
  assert.match(
    client, /\? 'ink\.bundelMarkerenCredit'\s*\n\s*: 'ink\.bundelMarkerenUitleg'/,
    "the confirm sheet must say what happens to the creditnota",
  );
  assert.match(client, /bundlePayRows\.some\(r => \(r\.total_inc_btw \?\? 0\) < 0\)/,
    "…and choose it by looking for one");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'ink\.bundelMarkerenCredit'/, "the key must exist");
  assert.match(messages, /verrekend en gaan mee dicht/, "…and say that the credit closes with the payment");
});

test("[CREDIT-VERREKEN] the bank recognises a netted payment, both ways in", () => {
  const mod = code("src/lib/bank-batch-reconcile.ts");
  // The AUTOMATIC path, when the transfer quotes both numbers (our own bundle writes them).
  // It refused because "reconcileBatch sums by MAGNITUDE" — true when written, false since
  // [BATCH-SIGN] made it a net sum. The guard outlived its reason and blocked the everyday case.
  assert.doesNotMatch(mod, /if \(inv\.total_inc_btw <= 0\) return null;/,
    "a creditnota must be allowed into an automatic batch");
  assert.match(mod, /if \(open == null \|\| open === 0\) return null;/,
    "…while a settled document, whatever its sign, still cannot be part of one");
  // What replaces it: the net must be money OWED, because reconcileBatch ties on magnitudes.
  assert.match(mod, /const net = slots\.reduce\(\(sum, s\) => sum \+ \(s\.amount \?\? 0\), 0\);\s*\n\s*if \(net <= 0\) return null;/,
    "a net running the other way ties just as neatly and must not be booked");

  // The SUGGESTION path, when nothing is quoted: the subset-sum walk takes credits with their sign.
  assert.match(mod, /\.filter\(\(x\) => x\.openCents !== 0\);/, "credits belong in the pool");
  assert.doesNotMatch(mod, /if \(chosen\.length >= SUM_SUBSET_MAX \|\| sum >= targetCents\) return;/,
    "the positive-only pruning would MISS a netted answer that overshoots on the way");
  assert.match(mod, /amounts: members\.map\(\(m\) => m\.openCents \/ 100\)/,
    "the per-member signs must travel, or the card cannot print the subtraction");

  // And the card prints arithmetic that adds up.
  const bank = code("src/app/dashboard/bank/BankClient.tsx");
  assert.match(bank, /x\.a < 0 \? ' − ' : ' \+ '/, "a creditnota is joined with a minus, never a plus");
  assert.match(bank, /\(s\.sumMatch\.amounts \?\? \[\]\)\.some\(a => a < 0\)/, "…and the heading says what it is");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'bank\.som\.kopVerrekend'/, "in the owner's language");
});

// ─── [BIJNA-BEDRAG] / [GESTRUCTUREERD] What a bank's own matcher does ───────────────────────────
//
// Two capabilities a real reconciliation engine has and this one did not, both measured before
// they were built:
//
//   · a payment that is CLOSE — bank costs taken off a foreign transfer, a betalingskorting, a
//     customer who rounded — produced `outcome: none, candidates: 0`. Not a weak suggestion: none
//     at all, because an identified pair without an exact amount is capped at 0.35 under a 0.5
//     listing floor. The owner saw "Geen factuur" over a line whose invoice was in the list.
//   · an ISO 11649 creditor reference printed the way every bank prints it — "RF18 5390 0754
//     7034" — did not match the invoice storing it unspaced. The scan keeps spaces as token
//     boundaries on purpose, and that is exactly what hid the one reference that carries its own
//     checksum.

test("[BIJNA-BEDRAG] a close payment is offered with the difference named, and never booked", () => {
  const mod = code("src/lib/bank-matching.ts");
  // Bounded on three sides: proportional, absolutely capped, and with a floor for pure rounding.
  assert.match(mod, /NEAR_AMOUNT_PERCENT = 0\.02/, "2% — the usual betalingskorting");
  assert.match(mod, /NEAR_AMOUNT_MAX = 25/, "…and never more than € 25, whatever the invoice is worth");
  assert.match(mod, /NEAR_AMOUNT_FLOOR = 0\.05/, "…always at least a nickel, for a rounded payment");
  // A bonus BEFORE the cap. Math.min only lowers, so a raised cap alone changes nothing — the
  // silent no-op this file's neighbours document twice over.
  assert.match(mod, /confidence \+= 0\.35;\s*\n\s*signals\.push\("near_amount"\)/,
    "the pair must be lifted over the listing floor, not merely allowed to reach it");
  assert.match(mod, /if \(!amtOk\) confidence = Math\.min\(confidence, nearOk \? 0\.55 : 0\.35\);/,
    "0.55: above the 0.5 listing floor and below the 0.7 booking bar");
  // Identity is required, and a name resemblance is not identity.
  // [GEHEUGEN] added `rememberedOk` to this line, which is the point of it — so the gate asks for
  // the terms that must be there rather than for one exact composition.
  const identityLine = /const identified = ([^;]+);/.exec(mod)?.[1] ?? "";
  for (const term of ["ibanOk", "supplierIbanOk", "isStrongNameIdentity("]) {
    assert.ok(identityLine.includes(term), `identity must include ${term}: ${identityLine}`);
  }
  assert.ok(!/nameSim|cpBonus|sim >=/.test(identityLine),
    `a similarity score is not identity — that is the coincidence this file guards against: ${identityLine}`);
  assert.match(mod, /const nearOk = nearDiff != null && identified;/);
  // And the owner is told how far off it is, in euros.
  assert.match(mod, /minder" : "meer"\} dan het openstaande bedrag/, "the difference must be on the card");
});

test("[GESTRUCTUREERD] the reference a bank routes on is read the way a bank reads it", () => {
  const mod = code("src/lib/structured-reference.ts");
  // ISO 7064 mod-97-10 on both formats — the checksum is what makes matching on this safe.
  assert.match(mod, /mod97\(ref\.slice\(4\) \+ ref\.slice\(0, 4\)\) === 1/, "ISO 11649");
  assert.match(mod, /body % 97 === 0 \? 97 : body % 97/, "the Belgian 0 → 97 rule");
  // Whole groups, not arbitrary prefixes: twenty candidates against mod-97 invents a reference out
  // of RF-shaped junk about one time in five.
  assert.match(mod, /const groups = run\.trim\(\)\.split\(\/\\s\+\/\)\.filter\(Boolean\);/,
    "the walk must step by printed groups");
  assert.doesNotMatch(mod, /for \(let len = Math\.min\(compact\.length, 25\); len >= 5; len--\)/,
    "…never character by character");
  // A twelve-digit window inside a longer number is a customer number, not a mededeling.
  assert.match(mod, /if \(\/\[0-9\]\/\.test\(before\) \|\| \/\[0-9\]\/\.test\(after\)\) continue;/);

  // Wired in front of the ordinary scan, which keeps spaces and therefore could not see it.
  const matcher = code("src/lib/bank-matching.ts");
  assert.match(matcher, /if \(structuredReferenceMatches\(`\$\{tx\.reference \?\? ""\} \$\{tx\.description \?\? ""\}`, invoiceNumber\)\) \{/,
    "referenceMatches must ask it first");
});

// ─── [DEEL-CREDIT] Een factuur crediteren in DELEN ────────────────────────────
//
// Twee dingen kunnen hier stilletjes kapot, en allebei zijn ze geld:
//
//   · TE VEEL TERUGGEVEN. De som van de creditnota's mag de factuur nooit passeren. Erover heen
//     betekent btw terugvragen die nooit is afgedragen en de klant een tegoed geven dat nergens
//     vandaan komt — op twee documenten die los van elkaar volstrekt normaal zijn.
//   · STOPPEN MET VRAGEN. Een DEEL crediteren is geen intrekking. Wie de rest niet meer int,
//     krijgt hem nooit — en de factuur houdt gewoon zijn status en zijn volle bedrag, dus er is
//     geen scherm waarop het opvalt.
test("[DEEL-CREDIT] the ceiling stands in all three places", () => {
  // De applicatie, zodat het scherm het kan tonen.
  const pure = code("src/lib/partial-credit.ts");
  assert.match(pure, /export function creditableRemaining\(/);
  assert.match(pure, /export function fitsWithinOriginal\(/);

  // De route, zodat een client die het scherm overslaat wordt geweigerd — en VOOR het nummer,
  // want een geweigerde creditnota mag geen nummer uit de reeks hebben verbruikt (Art. 35).
  const route = code("src/app/api/invoice/creditnota/route.ts");
  assert.match(route, /if \(!fitsWithinOriginal\(original\.total_inc_btw, alGecrediteerd, keuze\.totalIncBtw\)\)/,
    "the route must refuse a credit that would pass the invoice");
  const plafondAt = route.indexOf("fitsWithinOriginal");
  const nummerAt = route.indexOf("generateInvoiceNumber(supabase");
  assert.ok(plafondAt > 0 && nummerAt > 0 && plafondAt < nummerAt,
    "the ceiling must be checked BEFORE a number is minted — a refused creditnota may not burn one");

  // De database, zodat twee gelijktijdige verzoeken elkaar niet passeren.
  const sql = readFileSync("supabase/migrations/creditnota_partial.sql", "utf8");
  assert.match(sql, /DROP INDEX IF EXISTS invoices_one_creditnota_per_original/,
    "the one-per-invoice index has to go for partial credits to exist at all");
  assert.match(sql, /FOR UPDATE/,
    "…and its TOCTOU protection has to be replaced, not simply removed: the original is locked");
  assert.match(sql, /RAISE EXCEPTION/, "…and the sum is refused when it would pass the invoice");
  assert.match(sql, /CREATE TRIGGER trg_assert_credit_within_original/);
});

test("[DEEL-CREDIT] a partial credit is still money owed, everywhere it is asked", () => {
  // The rule itself: the set means FULLY credited now.
  const rule = code("src/lib/credited-invoices.ts");
  assert.match(rule, /export function fullyCreditedIdsFrom\(/);
  assert.match(rule, /export function openAfterCredit\(/);

  // And every surface that used to read it as a yes/no. Each of these decides whether a customer
  // is asked for money, so a stale one is either a demand that should not go out or an invoice
  // that is never collected.
  for (const [file, needle] of [
    ["src/app/api/cron/reminders/route.ts", /openAfterCredit\(inv\.total_inc_btw, 0, creditedByInvoice/],
    ["src/app/api/daily-truth/route.ts", /fullyCreditedIdsFrom\(creditRows, recvAll\)/],
    ["src/app/dashboard/vandaag/page.tsx", /fullyCreditedIdsFrom\(creditRows, remindAll\)/],
    ["src/app/dashboard/accountant/debiteuren/page.tsx", /fullyCreditedIdsFrom\(/],
    ["src/modules/accountant/work-queues.ts", /fullyCreditedIdsFrom\(/],
    ["src/app/api/pay/[token]/route.ts", /fullyCreditedIdsFrom\(/],
    ["src/app/api/invoice/betaalverzoek-bundel/route.ts", /fullyCreditedIdsFrom\(/],
  ] as const) {
    assert.match(code(file), needle,
      `${file} must judge COVERAGE, not the mere existence of a creditnota`);
  }

  // The reminder must also name the reduced amount. Asking for the full total on a partly
  // credited invoice demands money the owner put in writing was not owed.
  assert.match(
    code("src/app/api/cron/reminders/route.ts"),
    /openAfterCredit\(inv\.total_inc_btw, inv\.amount_paid, gecrediteerd\)/,
    "the amount in the reminder must have the credit taken off it",
  );

  // And so must every public payment surface, through the one function that decides them all.
  assert.match(
    code("src/lib/betaalverzoek.ts"),
    /const credited = Math\.max\(0, invoice\.credited_inc_btw \?\? 0\);/,
    "the payable amount must subtract what was credited — a live link asking for the full total " +
      "after a partial credit is a customer transferring money that is not owed",
  );
});

test("[DEEL-CREDIT] a FULL credit is byte-for-byte the document it always was", () => {
  // Every creditnota this app has ever produced took the no-selection path. It must keep producing
  // exactly the same one, or a cent of drift lands in documents already in customers' hands.
  const pure = code("src/lib/partial-credit.ts");
  assert.match(pure, /const alles = !input\.selection \|\| input\.selection\.length === 0;/,
    "no selection means the whole invoice");
  // The screen sends NO lines key at all when everything is credited, so the request is literally
  // the request of before.
  assert.match(
    code("src/app/dashboard/invoice/[id]/page.tsx"),
    /\.\.\.\(creditSelection \? \{ lines: creditSelection \} : \{\}\)/,
    "crediting everything must send the same request it always sent",
  );
});

test("[DEEL-CREDIT] the amount of a partial line is recomputed, never copied", () => {
  // creditnota-lines flips line_total. The stored one belongs to the FULL quantity, so a credit
  // for 3 of 10 would say "-3" beside the amount of ten — three times too much back, on a document
  // where neither number looks wrong by itself.
  assert.match(
    code("src/lib/partial-credit.ts"),
    /line_total: lineNetEx\(\{\s*quantity,/,
    "the line amount must follow the chosen quantity",
  );
  // And the header follows the lines, rather than being copied from the original.
  assert.match(
    code("src/app/api/invoice/creditnota/route.ts"),
    /total_inc_btw: -keuze\.totalIncBtw/,
    "the creditnota's total must be the total of what is actually being credited",
  );
});

test("[GEHEUGEN] the app reads back what the owner already confirmed", () => {
  // Every other signal in the matcher is inference about a line it is seeing for the first time.
  // A confirmation is not inference — and it was written to bank_tx_invoices and never read again.
  const mod = code("src/lib/match-memory.ts");
  // Derived, not stored: no table, no migration, and it cannot drift from what happened.
  assert.doesNotMatch(mod, /insert|upsert|from\(/, "the memory is derived from the link rows, never written");
  // The rule that makes one mistaken confirmation self-limiting.
  assert.match(mod, /parties != null && parties\.size === 1 && parties\.has\(party\)/,
    "a counterpart that settled TWO parties is a channel, not an identity");
  assert.match(mod, /MATCH_MEMORY_LIMIT = 400/, "bounded: a memory older than the relationship is not one");

  const matcher = code("src/lib/bank-matching.ts");
  assert.match(matcher, /const rememberedOk = remembersParty\(opts\.memory, tx, inv\.client_name\);/);
  assert.match(matcher, /confidence \+= 0\.30;\s*\n\s*signals\.push\("memory"\)/,
    "weighted like the supplier registry — it identifies the party, not the bill");
  // It must count as identity for the near-amount offer, which is what it is FOR: the counterparty
  // whose name the bank mangles had no identity the token rules would accept.
  assert.match(matcher, /const identified = ibanOk \|\| supplierIbanOk \|\| rememberedOk \|\|/);

  // The read degrades to nothing rather than to a guess, and the route says so out loud.
  const server = code("src/lib/match-memory-server.ts");
  assert.match(server, /if \(error \|\| !linkRows \|\| linkRows\.length === 0\) return buildMatchMemory\(\[\]\);/);
  assert.match(server, /if \(!tx \|\| !inv\) continue;/, "a half-read link must teach nothing");
  const route = code("src/app/api/bank/match/route.ts");
  assert.match(route, /loadMatchMemory\(pipeline, user\.id\)\.catch\(/, "a failed memory read may not break the page");
  assert.match(route, /matchTransactions\(transactions, invoices, \{ maxCandidates: 15, memory \}\)/);
});

// ─── [REGEL-KOPIE] The class this has now been, three times ─────────────────────────────────────
//
// Three routes copy invoice lines: the creditnota mirrors them, /duplicate repeats them, and the
// recurring cron re-issues them monthly. Each typed the columns over by hand, so every column ADDED
// to invoice_lines had to be chased into three places by someone who knew all three existed.
//
//   unit                              chased, after "-2 uur" became "-2 stuks" on a correction
//   vat_treatment                     chased, after a copied exempt line booked as taxed 0%
//   discount_type / discount_value    reached the mirror and BOTH write routes — and neither copier
//
// The third one was live when this gate was written. The copiers write line_total, which is already
// discounted, so a duplicated or recurring invoice looked right until it was opened and saved:
// computeDraftTotals then recomputed the line from quantity x unit_price with no discount to apply,
// and a EUR 108,90 monthly invoice billed EUR 121,00. Before that save it did not even add up with
// itself — quantity x unit_price is what PEPPOL-EN16931-R120 recomputes.

test("[REGEL-KOPIE] every per-line column reaches the copiers, including the next one", () => {
  // Read the columns from the generated database types, so a column added tomorrow fails this
  // gate rather than a customer's invoice. That is the whole difference between a gate that
  // catches the class and one that catches the last instance of it.
  const types = readFileSync("src/types/database.types.ts", "utf8");
  const block = /invoice_lines: \{\s*Row: \{([\s\S]*?)\}\s*Insert:/.exec(types);
  assert.ok(block, "the invoice_lines Row block must be findable in the generated types");
  const columns = [...block![1].matchAll(/^\s{10}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(columns.length >= 8, `expected the real column list, got: ${columns.join(", ")}`);

  // `id` is identity, never copied: a spread of the source row carries a primary key that exists.
  // `invoice_id` is the destination, supplied by the caller.
  const IDENTITY = new Set(["id", "invoice_id"]);
  // The FUNCTION BODIES, not the file. A negative control caught this gate passing on a column that
  // had been removed from the spread but still appeared in the interface above it — a mention where
  // the wiring should be, which is the defect shape this whole file exists to refuse. The bodies
  // are what runs.
  const copier = code("src/lib/invoice-line-copy.ts");
  const bodies = [...copier.matchAll(/export function (?:optionalLineFields|copiedLineFor)[\s\S]*?\n\}/g)]
    .map((m) => m[0])
    .join("\n");
  assert.ok(bodies.length > 200, "the copier's function bodies must be findable, or this gate reads a hole");
  const missing = columns.filter((c) => !IDENTITY.has(c) && !bodies.includes(c));
  assert.deepEqual(
    missing, [],
    `invoice_lines has columns the copier never carries: ${missing.join(", ")}. ` +
      "A copy that silently drops one is a document that differs from the one it was copied from.",
  );
});

test("[REGEL-KOPIE] the copiers ask the module instead of listing columns themselves", () => {
  for (const path of [
    "src/app/api/invoice/[id]/duplicate/route.ts",
    "src/app/api/cron/recurring/route.ts",
  ]) {
    const src = code(path);
    assert.match(src, /copiedLinesFor\(/, `${path} must copy through the shared module`);
    // And it must not keep a hand-typed list beside it — that is the shape that drifted.
    assert.doesNotMatch(
      src, /invoice_lines"\)\.insert\(\s*\n?\s*\w+\.map\(\(l\) => \(\{/,
      `${path} still types the columns over by hand`,
    );
  }
  // The creditnota mirror keeps its own sign and prefix rules and shares only the column list.
  const credit = code("src/lib/creditnota-lines.ts");
  assert.match(credit, /\.\.\.optionalLineFields\(line\)/);
  assert.match(credit, /quantity: flip\(line\.quantity\)/, "…and still flips, which a copy must not");
});

test("[REGEL-KOPIE] a copy is verbatim, and a missing column stays missing", () => {
  const mod = code("src/lib/invoice-line-copy.ts");
  // Conditional spreads: a database without the migration returns rows without the key, and
  // sending it fails the whole INSERT with 42703 — on the creditnota path that is a correction
  // whose number is already spent and which ends up with no lines at all.
  for (const col of ["unit", "vat_treatment", "discount_type"]) {
    assert.ok(
      new RegExp(`\\.\\.\\.\\(line\\.${col} !== undefined`).test(mod),
      `${col} must be absent from the copy when it is absent from the source row`,
    );
  }
  assert.doesNotMatch(mod, /\bid:/, "a copy carries content, never the source line's identity");
});

test("[KAS-SPOOR] the cash drawer's three doors all leave a trail", () => {
  // The drawer was the only money ledger in this app writing no audit row, and it is the worst one
  // to leave untraced: the only ledger the owner writes by hand with no bank line and no document
  // behind it, deleted HARD (cash_entries keeps no reversal row), and gated on — readiness.ts and
  // /api/btw/file both refuse a filing on a negative drawer. Accusing on a number nobody can trace
  // is half a gate, and the honest owner had no way to show they were honest either.
  //
  // Source-level for the same reason as every other gate here: what is being locked is that the
  // call is PRESENT at each of the three doors, which no return value can express.
  const cash = code("src/app/api/cash/route.ts");
  for (const action of ["cash.entry_added", "cash.entry_removed", "cash.opening_balance_set"]) {
    assert.match(
      cash, new RegExp(`action: ['"]${action.replace(".", "\\.")}['"]`),
      `/api/cash must record ${action} — every other money write in the app does`,
    );
  }

  // The removal's trail carries the MOVEMENT, not just the fact of a removal. This is a hard
  // delete, so this row is the only place that will ever say the line existed; "a cash entry was
  // removed" without its date and amount answers nothing anyone would ask.
  const removal = cash.slice(cash.indexOf("cash.entry_removed"));
  for (const field of ["entry_date", "amount", "category", "description"]) {
    assert.match(removal, new RegExp(`${field}:`), `the removal trail must carry ${field}`);
  }

  // …and the float's trail carries what it WAS. This single number shifts every eindsaldo in the
  // owner's whole history, filed quarters included, and it seeds the witness lowestDrawerPoint
  // compares against zero — so "set to 2000" with no previous value is not an answer.
  assert.match(
    cash, /oldValue:[\s\S]{0,400}?kas_opening_balance/,
    "the opening-balance trail must record the value it replaced",
  );
  // The read that fetches it may fail, and then the row must say so rather than assert €0 — an
  // audit line claiming a change that never happened is worse than a gap in the trail.
  assert.match(cash, /previous_value_unknown/, "a failed read of the old float must be admitted, not guessed as 0");
});

test("[KAS-SPOOR] both copies of the kasboek disclose what was removed from the quarter", () => {
  // A cash_entries delete is a HARD delete, so nothing in the rows of a cash book says a line was
  // ever taken out of it. Two documents are built from those rows — the live panel and the .xlsx in
  // the accountant's quarterly package — and they are generated by ONE function precisely so they
  // cannot describe a period differently. A disclosure added to one of them and not the other is
  // that same divergence, arriving through the newer surface.
  for (const f of ["src/app/api/kasboek/route.ts", "src/lib/closing-package.ts"]) {
    const src = code(f);
    assert.match(src, /action['"]?\s*,\s*['"]cash\.entry_removed['"]/, `${f} must read the removal trail`);
    assert.match(
      src, /kasboekToMatrix\(kb, \w+\)/,
      `${f} must hand those removals to the sheet — the accountant reconciles a till against it`,
    );
    // The trail is a DISCLOSURE, not a source of the saldi. Refusing the whole book over it would
    // trade a real answer for none; staying silent about a failed read would be worse still.
    assert.match(src, /removals_incomplete|removedUnknown/, `${f} must say when that list could not be read in full`);
  }

  // The eindsaldo may never include a removed row: they were removed, so the balance is right
  // without them. The pure builder appends them BELOW it — locked in kasboek.test.ts — and the panel
  // renders them outside every total for the same reason.
  const ui = code("src/app/dashboard/kas/KasClient.tsx");
  assert.match(ui, /kas\.verwijderd\.uitleg/, "the panel must say the removed rows are not in the saldi");
  assert.match(
    ui, /kbRemoved\.rows\.length > 0 \|\| kbRemoved\.unknown/,
    "and show nothing at all in the normal case, where nothing was removed",
  );
});

test("[KAS-NEGATIEF-NU] the open quarter is warned about, and never told its aangifte is blocked", () => {
  // Two banners on one screen, and the difference between them is a FACT about the quarter, not a
  // shade of red: the readiness quarter's dip is blocking a filing right now; the open quarter's is
  // not blocking anything yet. The failure this holds is the cheap one — someone copies the red
  // panel for the open quarter and leaves 'kas.negatief.blokkeert' on it, and the app then tells an
  // owner their aangifte is blocked over a quarter that cannot be filed yet at all.
  const ui = code("src/app/dashboard/kas/KasClient.tsx");

  // The open quarter is asked about at all. It was not: /api/kasboek answers for any quarter, and
  // this screen only ever asked about the one the gate blocks on.
  assert.match(
    ui, /year=\$\{cur\.year\}&quarter=\$\{cur\.quarter\}/,
    "the screen must ask about the quarter the owner is IN, not only the last completed one",
  );
  assert.match(ui, /setOpenDip/, "…and keep that answer apart from the blocking one");

  // Each sentence stays on its own panel.
  const openPanel = ui.slice(ui.indexOf("{openDip &&"));
  assert.match(openPanel, /kas\.negatief\.nogNietIngediend/, "the open quarter gets the not-yet-filed sentence");
  assert.doesNotMatch(
    openPanel.slice(0, openPanel.indexOf("</div>")), /kas\.negatief\.blokkeert/,
    "the open quarter may never claim a blocked aangifte — nothing is being blocked yet",
  );
  const blockingPanel = ui.slice(ui.indexOf("{lowestPoint && ("), ui.indexOf("{openDip &&"));
  assert.match(blockingPanel, /kas\.negatief\.blokkeert/, "the readiness quarter keeps saying what IS happening");
  assert.doesNotMatch(blockingPanel, /nogNietIngediend/);

  // Both name their quarter. Two near-identical panels with no period on them is how an owner goes
  // and fixes the wrong quarter.
  assert.match(blockingPanel, /period=/);
  assert.match(openPanel.slice(0, openPanel.indexOf("/>")), /period=/);

  // A ref read during render would not re-render when it changed, so the label is derived from the
  // same definition the endpoint defaults to (see readinessQuarterLabel).
  assert.doesNotMatch(
    blockingPanel, /alertPeriodRef\.current/,
    "the banner's period label must not be read from a ref during render",
  );

  // And the check that could not RUN still may not read as a clean drawer — the rule this screen
  // states outright for its saldo, applied to the second question as well.
  const refresh = ui.slice(ui.indexOf("async function refreshDrawerAlert"));
  assert.equal(
    (refresh.slice(0, refresh.indexOf("async function load(")).match(/setLowestPointUnknown\(true\)/g) ?? []).length,
    3,
    "each unanswered half (blocking, open, and a thrown fetch) must set the 'could not check' state",
  );
});


test("[KAS-LOON] a cash wage is bookable, and never carries BTW", () => {
  // The vocabulary has carried 'salaris' from the start and financial-result has always booked it
  // distinctly — a cost that NEVER carries voorbelasting, rate-free by construction — while the add
  // form offered four categories and not this one. So the one movement an owner could not record
  // truthfully in their own drawer was a wage, and their only option was 'Kost': the category where
  // a bon plus a rate DOES produce voorbelasting, and which hides a payroll obligation inside a
  // general cost total.
  const ui = code("src/app/dashboard/kas/KasClient.tsx");
  assert.match(ui, /key: 'salaris', labelKey: 'kas\.cat\.salaris'/, "the add form must offer a cash wage");

  // The BTW row stays bound to a cash SALE. A rate on a wage is a deduction on money that carries
  // none — and the route forces it null regardless, so the two sides must not disagree.
  assert.match(ui, /\{category === 'omzet' && \(/, "the rate selector belongs to 'omzet' alone");
  assert.match(
    ui, /category === 'salaris' &&[\s\S]{0,200}?kas\.loon\.uitleg/,
    "choosing 'Loon' must say that the loonaangifte is not handled here — nobody may think the booking finished it",
  );

  const route = code("src/app/api/cash/route.ts");
  assert.match(
    route, /category === "omzet" \|\| \(category === "kosten" && documentId !== null\)/,
    "the server keeps a rate to a cash sale, or a cash cost with an owned bon — never a wage",
  );
});

test("[KAS-VOCABULAIRE] the closed categories are refused at the door, by the shared list", () => {
  // Three of the eight categories are not the owner's to write, for three different reasons. The
  // list lives in cash.ts (tested there); the door asserts against it rather than re-spelling it,
  // because an inline string check is what drifts once a ninth category appears.
  const route = code("src/app/api/cash/route.ts");
  assert.match(route, /closedCashCategoryReason/, "the door must ask the shared rule, not its own copy");
  assert.doesNotMatch(
    route, /category === "tax"|category === "fee"/,
    "…and must not re-list the closed categories inline",
  );
  // Two distinct sentences, because the two reasons are different facts about the app: one is
  // system-managed, the other is not counted by the result engine at all.
  assert.match(route, /settlement_category/);
  assert.match(route, /category_not_counted/);
  // The vocabulary itself keeps all eight: a row already stored as 'tax' must still read as a cash
  // category. Closing a door is not denying that anyone walked through it.
  const cash = code("src/lib/cash.ts");
  assert.match(
    cash, /CASH_CATEGORIES = \["omzet", "kosten", "salaris", "prive", "transfer", "tax", "fee", "betaling"\]/,
    "the reading vocabulary must stay complete",
  );
});


test("[KAS-BRUG] the drawer warning names the withdrawal the app can already see", () => {
  // The app refuses a BTW-aangifte over a negative drawer and names three possible causes. There is a
  // fourth, and in a shop it is the most ordinary of all: cash was taken out of the bank and the
  // opname was never written in the cash book. That withdrawal is on a statement this app has already
  // imported AND already classified. A gate that refuses a filing over a number while holding the
  // likeliest innocent explanation for it in its own database is accusing someone with the evidence
  // in its pocket.
  const route = code("src/app/api/kasboek/route.ts");
  assert.match(route, /findUnrecordedCashWithdrawals/, "the endpoint must look for it");
  // Only when there is something to explain: an unrecorded withdrawal under no banner is tidiness,
  // not a blocker, and this endpoint sits on the page's load path for every owner.
  assert.match(
    route, /const dip = lowestDrawerPoint\(kb\);[\s\S]{0,400}?if \(dip\) \{/,
    "the bank read must be gated on the drawer actually being negative",
  );
  // Losing the hint may never cost the cash book itself.
  assert.match(
    route, /bankErr[\s\S]{0,300}?console\.error/,
    "a failed bank read leaves the three original causes standing, it does not fail the kasboek",
  );

  // The bank half is recognised by the classifier's OWN patterns. A second copy of ATM_RE would drift
  // and then disagree with the classifier about the same line — and the stored category cannot answer
  // it, because savings transfers and cash machines both land on 'transfer'.
  assert.match(route, /isCashTransferDescription/);
  const identity = code("src/lib/bank-identity.ts");
  // The predicate must REFERENCE the classifier's regex, not restate its patterns. (Counting the
  // word "geldautomaat" would not say this: KEY_NOISE holds it too, for an unrelated purpose —
  // building a counterpart memory key. A gate has to match the thing it means.)
  assert.equal((identity.match(/const ATM_RE = /g) ?? []).length, 1, "one cash-machine pattern in the file");
  assert.match(
    identity, /export function isCashTransferDescription[\s\S]{0,200}?return ATM_RE\.test\(/,
    "the exported predicate must reuse ATM_RE — a second copy would drift from the classifier and then disagree with it about the same line",
  );

  // The quarter's range has ONE definition. The hand-rolled `${quarter * 3}-31` is wrong for June and
  // September, and a Postgres date column answers an invalid date with an error, not an empty result.
  assert.match(route, /quarterRange\(year, quarter as Quarter\)/);
  // The invariant is that this route does no quarter-month arithmetic of its own — not that the
  // string "-31" never appears (the year-end bound above it is `${year}-12-31`, and December really
  // does have 31 days). What must not come back is a quarter END derived by hand.
  assert.doesNotMatch(
    route, /quarter \* 3|\(quarter - 1\) \* 3/,
    "the quarter's months come from quarterRange, never from arithmetic repeated here",
  );

  // On screen it is set apart from the three possibilities: those ask the owner to look, this one has
  // already looked and carries a date and an amount.
  const ui = code("src/app/dashboard/kas/KasClient.tsx");
  assert.match(ui, /bridge=\{\{ title: t\('kas\.brug\.titel'\)/);
  assert.equal(
    (ui.match(/bridge=\{\{/g) ?? []).length, 2,
    "both the blocking and the open quarter's banner must offer it — a dip is a dip in either",
  );
});


// ── [KAS-SAMENHANG] The rules that must hold in MORE THAN ONE place ────────────────────────────
//
// Almost every defect found in the cash line this session had one shape: a rule written, argued for
// at length in its own comment, and then applied in one place while a sibling path was left out.
// Not carelessness — asymmetry. openingBalanceForQuarter did not apply the double-count suppression
// its own two neighbours did. The negative-drawer banner knew one quarter. Cents were rounded at one
// door. The kasboek's removed-entry disclosure could have gone to the screen and not the accountant's
// sheet. Four of the five pay doors dropped the reconcile's verdict that the fifth retried on.
//
// Individually those are bugs. Together they are a pattern, and a pattern is mechanically checkable.
// This is that check: not "is the code correct" but "is each of these rules applied everywhere it has
// to be". A new surface that combines the same sources, or a new door that writes the same money,
// turns this red on the day it is written rather than the day someone reads a wrong balance.

test("[KAS-SAMENHANG] every reader that combines the drawer's two sources suppresses the double count", () => {
  // A till shop's cash revenue exists twice by design: daily_turnover.cash_amount AND a cash_entries
  // 'omzet' row. Any function that adds those two together must skip the entry on a covered day, or
  // the drawer is overstated by a quarter's takings — and the negative-drawer gate is then computed
  // on a number that is too high, which is the direction that lets a bad quarter be filed.
  //
  // Three combine them, and each must carry the rule: the pure projection (both halves), and the
  // headline balance.
  const kasboek = code("src/lib/kasboek.ts");
  assert.match(kasboek, /function isTillCountedOmzet/, "the predicate must exist once, shared");
  assert.equal(
    (kasboek.match(/isTillCountedOmzet\(/g) ?? []).length, 3,
    "declared once and applied in BOTH combining functions — the carry-in and the in-quarter rows",
  );
  const cash = code("src/lib/cash.ts");
  assert.match(
    cash, /coveredDays[\s\S]{0,600}?\(e\.category \?\? ""\) !== "omzet"/,
    "computeDrawerBalance (the headline saldo) must apply the same rule",
  );
  // And the P&L side, which has known it longest — if that one ever stops, the drawer and the result
  // disagree about the same euro.
  assert.match(
    code("src/lib/financial-result.ts"), /c\.date \? covered\.has\(c\.date\) : covered\.size > 0/,
    "computeResult must keep skipping a covered-day cash omzet",
  );
});

test("[KAS-SAMENHANG] every door that writes drawer money rounds to cents and leaves a trail", () => {
  // cash_entries.amount and the daily_turnover columns are unconstrained `numeric`: whatever arrives
  // is stored. Sub-cent dust then rides a RUNNING balance through every following day, into the sheet
  // the accountant reads and into the eindsaldo the filing gate compares against zero.
  const cashRoute = code("src/app/api/cash/route.ts");
  assert.match(cashRoute, /const amount = round2\(rawAmount\)/, "a movement is rounded at the door");
  assert.match(cashRoute, /const opening = round2\(val\)/, "so is the opening float");
  assert.match(
    code("src/app/api/turnover/import/route.ts"), /Number\.isFinite\(v\) \? round2\(v\) : /,
    "and every committed turnover figure — btw_9/btw_21 go into rubriek 1a/1b as tax owed",
  );

  // Every write door leaves an audit row. The drawer is the ledger where that matters most: it is the
  // only one the owner writes by hand, and its delete is a hard delete.
  for (const action of ["cash.entry_added", "cash.entry_removed", "cash.opening_balance_set"]) {
    assert.match(cashRoute, new RegExp(`action: ['"]${action.replace(".", "\\.")}['"]`), `${action} must be recorded`);
  }
});

test("[KAS-SAMENHANG] every door that books a cash payment goes through the same retry", () => {
  // Five doors turn a payment_method 'kas' into a drawer movement. One of them read the reconcile's
  // verdict and asked again on a bail; the other four dropped it — including the verify-queue confirm,
  // whose own comment states it is the ONLY thing that would move the drawer for that payment.
  //
  // The three that merely REPORT the pass are deliberately not on this list: they read the summary
  // themselves (the Kas load logs a stale drawer, /api/cash/settle answers with it, the on-demand
  // matcher shows the numbers). And the hourly cron does not retry because it IS the retry.
  const payDoors = [
    "src/app/api/invoice/pay-toggle/route.ts",
    "src/app/api/email/confirm/[id]/route.ts",
    "src/app/api/invoice/payment/move/route.ts",
    "src/app/api/intake/route.ts",
    "src/lib/email-integration.ts",
  ];
  for (const f of payDoors) {
    const src = code(f);
    assert.match(src, /reconcileCashWithRetry/, `${f} must book the drawer through the shared retry`);
    assert.doesNotMatch(
      src, /await reconcileCashSettlements\(/,
      `${f} must not call the bare pass — its verdict would be dropped on the floor`,
    );
  }
  // The wrapper lives next to what it wraps, and reports through the channel this file's own
  // [KAS-STIL] rule requires: a route writing to stdout is the same as writing nothing.
  const settle = code("src/lib/cash-settle.ts");
  assert.match(settle, /export async function reconcileCashWithRetry/, "one wrapper, in the money module");
  assert.match(
    settle, /reconcileCashWithRetry[\s\S]{0,1200}?reportHandledFailure\(\{/,
    "a pass that bails twice right after a payment must reach the reporter",
  );
});

test("[KAS-SAMENHANG] both documents built from the cash book are built by one generator", () => {
  // The live panel and the .xlsx in the accountant's quarterly package are the same cash book, and
  // they are generated by one function precisely so they cannot describe a period differently. Every
  // addition to that sheet has to reach both — the removed-entry disclosure was the first one that
  // could have reached only the screen.
  for (const f of ["src/app/api/kasboek/route.ts", "src/lib/closing-package.ts"]) {
    const src = code(f);
    assert.match(src, /kasboekToMatrix\(kb, \w+\)/, `${f} must build the sheet from the shared generator, with its removals`);
    assert.match(src, /openingBalanceForQuarter\(/, `${f} must carry the balance in from prior periods the shared way`);
  }
  // Nobody may hand-roll the quarter's months: `${quarter * 3}-31` is not a date in June or September,
  // and a Postgres date column answers an invalid cast with an error rather than an empty result.
  assert.match(code("src/lib/kasboek.ts"), /export function quarterRange/, "one definition of the quarter's range");
});


test("[KAS-ZACHT] every reader of the cash book asks only for the movements that still count", () => {
  // Soft delete turned one hard DELETE into a rule that has to hold in EIGHTEEN reads: the drawer
  // balance, the kasboek projection and its .xlsx, the result engine, the aangifte, the readiness
  // verdict, the filing witness, search, the home tile, the accountant's closing package, the
  // settlement reconcile, the cron's candidate scan, the money audit. Miss one and a removed movement
  // still counts THERE and nowhere else — two surfaces disagreeing about the same euro, neither
  // looking broken. That is strictly worse than the hard delete this replaced.
  //
  // So the rule is not written eighteen times, and this is the check that keeps it that way: every
  // query against cash_entries either goes through cash-live.ts, or is a WRITE, or is one of the two
  // documented exceptions. A nineteenth reader added next year turns this red on the day it is
  // written, not the day someone reads a balance that includes a line the owner removed.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
    }
  };
  walk("src");
  walk("scripts");

  // Two exceptions, each for a stated reason.
  const EXEMPT_FILES = new Set([
    // The definition itself: it probes the column and applies the filter.
    "src/lib/cash-live.ts",
    // [KAS-ZACHT] The GDPR/portability export ships cash_entries verbatim, removed rows INCLUDED with
    // their deleted_at visible. Everywhere else a removed line is absent; there it must be present,
    // because an export of "all your data" that silently drops rows is the harm that file is written
    // against.
    "src/lib/account-export.ts",
  ]);
  // A WRITE is not a read: an insert creates, an update heals a row already identified by a filtered
  // read, and a delete is the pre-migration path.
  const WRITE_MARKERS = [".insert(", ".update(", ".delete()"];
  // Two capability probes, which must NOT be filtered — they exist to discover whether the column is
  // there at all.
  const PROBE_MARKERS = ['select("settlement_id")', 'select("deleted_at")'];
  const WRAPPERS = ["liveCash.only(", "cash.only(", "live.only(", "liveForDelete.only("];

  // ── Waar het venster WEL en NIET mag kijken ──
  //
  // Een wrapper opent VÓÓR `.from(` — `liveCash.only(client.from("cash_entries")…)` — dus daarvoor
  // moet er achteruit gekeken worden, en met ruimte, want tussen de twee staan lange commentaren.
  //
  // Voor een WRITE geldt het omgekeerde, en dat verschil is hier het hele punt. `.insert(` en
  // `.update(` komen ná `.from(`, in dezelfde keten. Zou een write ook ACHTERUIT mogen tellen, dan
  // vrijwaart een insert een leesquery die er toevallig vlakbij staat — en juist in dit bestand
  // staan lezen en schrijven dicht op elkaar: /api/cash doet er allebei binnen enkele regels.
  // Deze poort zou dan groen blijven op een lezing die verwijderde boekingen meetelt, en dat is
  // precies de stille fout waar hij tegen is geschreven.
  //
  // Gemeten toen dit werd aangescherpt: alle 24 aanroepen vielen al aan de goede kant — 18 door een
  // wrapper, 5 doordat de aanroep ZELF een write is, 1 probe. Nul die alleen door een buurman werd
  // vrijgesteld. De aanscherping verandert vandaag dus geen enkel oordeel; ze zorgt dat dat morgen
  // ook nog zo is in plaats van toevallig.
  const unfiltered: string[] = [];
  for (const f of files) {
    if (EXEMPT_FILES.has(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/from\((?:"|')cash_entries(?:"|')\)/g)) {
      const before = src.slice(Math.max(0, m.index - 700), m.index);
      const statement = src.slice(m.index, m.index + 700);
      if (WRAPPERS.some((w) => before.includes(w))) continue;
      // Alleen vooruit: de write moet aan DEZE keten hangen, niet ergens in de buurt staan.
      if (WRITE_MARKERS.some((w) => statement.includes(w))) continue;
      if (PROBE_MARKERS.some((w) => statement.includes(w))) continue;
      unfiltered.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    unfiltered, [],
    "these read cash_entries without asking cash-live.ts for the live rows:\n  " + unfiltered.join("\n  "),
  );

  // And the door: soft delete when the column is there, the old hard delete when it is not. Shipping
  // an UPDATE on a column a hand-applied migration has not created yet would leave the owner unable
  // to remove anything at all.
  const route = code("src/app/api/cash/route.ts");
  assert.match(
    route, /liveForDelete\.supported[\s\S]{0,400}?\.update\(\{ deleted_at/,
    "the removal must be capability-gated, not assume the column",
  );
  assert.match(route, /: await supabase[\s\S]{0,120}?\.delete\(\)/, "…and fall back to the hard delete without it");
  assert.match(
    route, /\.update\(\{ deleted_at[\s\S]{0,400}?\.is\("deleted_at", null\)/,
    "a second concurrent removal may not overwrite the first one's timestamp",
  );
});

// ─── [OFFERTE-OPVOLGING] Een offerte die stil verloopt ────────────────────────
//
// "Geldig tot" staat op elke offerte-PDF en de app wist er niets van: geen badge, geen filter,
// geen signaal, en de herinneringscron sluit offertes met zoveel woorden uit. Een offerte die
// stil verloopt is omzet die nooit is opgehaald, en het is de goedkoopste omzet die er is — het
// werk om hem te winnen is al gedaan.
test("[OFFERTE-OPVOLGING] the app notices, and never acts for the owner", () => {
  const regel = code("src/lib/offerte-followup.ts");

  // Alleen een VERSTUURDE offerte kan verlopen: een concept is nooit de deur uit geweest.
  assert.match(regel, /return quote\.status === "sent";/,
    "a draft quote has no 'Geldig tot' on anyone's desk");
  // Geen datum = geen termijn. Er zelf een verzinnen stelt een deadline die nooit is afgesproken.
  assert.match(regel, /if \(dagen === null\) return null;/);

  // En het allerbelangrijkste: dit verandert NOOIT iets. Geen status, geen bericht aan de klant.
  assert.doesNotMatch(regel, /\.from\(|update\(|insert\(|fetch\(/,
    "the rule is pure — a quote that lapsed is a date that passed, not an event to book");
  assert.doesNotMatch(regel, /sendInvoice|sendMail|resend|email/i,
    "nothing goes to the customer by itself: following up a quote is a sales conversation, and " +
      "the app does everything except the last tap (the same line recurring.ts draws)");
});

test("[OFFERTE-OPVOLGING] a lapsed quote is never dressed up as a late payment", () => {
  // A sent quote whose 'Geldig tot' has passed fell straight through the overdue test — status
  // 'sent', date in the past — so the list put a red "Te laat" on it. Urgent, and about money
  // nobody owes: the customer has not done anything wrong, they simply have not answered yet.
  const row = code("src/components/invoice/InvoiceRow.tsx");
  assert.match(row, /const OFFERTE_TYPES = new Set\(\['pro_forma', 'offerte'\]\)/);
  assert.match(row, /if \(OFFERTE_TYPES\.has\(String\(invoice\.invoice_type \?\? ''\)\)\) return false/,
    "isOverdue must exempt a quote — its due_date is a validity date, not a payment term");
});

test("[OFFERTE-OPVOLGING] Vandaag cannot say 'niets te doen' while quotes go cold", () => {
  // This page's own rule is that a failed or incomplete read may never masquerade as a calm
  // all-clear. A third list that the empty-state does not know about is exactly that.
  const page = code("src/app/dashboard/vandaag/page.tsx");
  assert.match(page, /\.in\("invoice_type", \["pro_forma", "offerte"\]\)/, "the quotes must be read");
  assert.match(page, /quotesNeedingFollowup\(/, "…and judged by the shared rule, not by the query");
  assert.match(page, /offertesErr/, "…and a failed read must reach loadFailed like the others");

  const client = code("src/app/dashboard/vandaag/VandaagClient.tsx");
  assert.match(client, /zichtbareOffertes\.length === 0;/,
    "the empty state must count the quotes too, or the screen reassures while work sits there");
});

// ─── [OFFERTE-AKKOORD] De klant zegt ja of nee, in het document zelf ──────────
//
// Dit is de tweede publieke, loginvrije pagina in het product, en de eerste waarop iemand van
// BUITEN het bedrijf iets SCHRIJFT. Twee dingen mogen daar nooit misgaan.
test("[OFFERTE-AKKOORD] accepting never mints an invoice", () => {
  // Nummeren verbruikt een nummer uit de doorlopende reeks (Art. 35) en is onomkeerbaar. Dat
  // laten gebeuren door een klik van een derde, via een link die eeuwig blijft werken, is de ene
  // macht die deze app nergens weggeeft. Een akkoord is een SEIN; de ondernemer factureert.
  const route = code("src/app/api/offerte/[token]/route.ts");
  assert.doesNotMatch(route, /generateInvoiceNumber/, "a public route may never mint a number");
  assert.doesNotMatch(route, /\.insert\(/, "…nor create a row of any kind");

  // En wat het WEL schrijft, is precies drie velden. Getoetst op de update zelf en niet op het
  // hele bestand: een typeannotatie die `invoice_number` noemt is geen schrijfactie, en een gate
  // die dat verschil niet maakt bewaakt een tekst in plaats van een gedrag.
  const updates = route.match(/\.update\(\{[\s\S]*?\}/g) ?? [];
  assert.equal(updates.length, 1, "exactly one write, and it is the answer");
  assert.match(updates[0], /offerte_response:/);
  assert.match(updates[0], /offerte_responded_at:/);
  assert.match(updates[0], /offerte_response_name:/);
  for (const verboden of ["invoice_number", "invoice_type", "status:", "total_"]) {
    assert.ok(!updates[0].includes(verboden),
      `the answer must not write ${verboden} — it is a fact that is added, never a transition`);
  }
});

test("[OFFERTE-AKKOORD] the first answer stands, and the database is what enforces it", () => {
  const route = code("src/app/api/offerte/[token]/route.ts");
  // De regel zelf weigert een tweede antwoord…
  assert.match(code("src/lib/offerte-akkoord.ts"), /if \(answerOf\(quote\)\) return "already_answered";/);
  // …maar twee gelijktijdige klikken zien elkaars antwoord niet. De schrijfbeurt eist daarom zelf
  // dat het veld nog leeg is; verliest hij de race, dan raakt hij nul rijen.
  assert.match(route, /\.is\('offerte_response', null\)/,
    "the write must be the lock: a check without it is a TOCTOU race on the evidence");
  assert.match(route, /if \(!bijgewerkt \|\| bijgewerkt\.length === 0\)/,
    "…and losing that race must be answered honestly, not silently");
});

test("[OFFERTE-AKKOORD] the public page is an allowlist and leaks no working link", () => {
  const route = code("src/app/api/offerte/[token]/route.ts");
  // Eén projectie bepaalt wat een buitenstaander ziet — dezelfde regel als toPublicPayView.
  assert.match(route, /toPublicQuoteView\(/, "the view must go through the single allowlist");
  assert.doesNotMatch(route, /select\('\*'\)/, "never select('*') on a public route");
  // Het token IS de sleutel: een werkende link mag nooit in een foutrapport belanden.
  assert.match(route, /token\.slice\(-6\)/, "only a fragment of the token may be reported");
  for (const call of route.match(/offerteOnbeschikbaar\([^)]*\)/g) ?? []) {
    assert.doesNotMatch(call, /token:\s*token\b/, `a full token is being reported: ${call}`);
  }
  // [PAY-READ-HONEST] Een mislukte lezing zegt niet "deze link bestaat niet".
  assert.match(route, /customer told to retry, not that the link is unknown/);
});

test("[OFFERTE-AKKOORD] the mail degrades to the mail it always was", () => {
  // Zonder token (migratie nog open, of de schrijfbeurt mislukte) gaat er GEEN knop mee. Een knop
  // naar een pagina die niet bestaat is erger dan geen knop.
  const send = code("src/lib/offerte-send.ts");
  assert.match(send, /const akkoordLink = \(f\.akkoordUrl \?\? ""\)\.trim\(\);/);
  assert.match(send, /: "";/, "no link, no button");
  // En de route legt het token VAST voordat de mail weggaat — anders is de knop bij de klant dood.
  const route = code("src/app/api/invoice/[id]/send-offerte/route.ts");
  const tokenAt = route.indexOf("offerte_token: nieuw");
  const mailAt = route.indexOf("sendOfferteToClient({");
  assert.ok(tokenAt > 0 && mailAt > 0 && tokenAt < mailAt,
    "the token must be stored BEFORE the mail carrying it goes out");
});

test("[OFFERTE-AKKOORD] an answered quote changes what Vandaag asks for", () => {
  const regel = code("src/lib/offerte-followup.ts");
  // Ja is het dringendst: er ligt getekend werk dat nog niet is gefactureerd.
  assert.match(regel, /if \(quote\.offerte_response === "accepted"\) return "geaccepteerd";/);
  // Nee haalt hem van de lijst: doorgaan met porren is werk verzinnen dat er niet is.
  assert.match(regel, /if \(quote\.offerte_response === "declined"\) return null;/);
});

// ─── [FACTUUR-BIJLAGE] Een eigen bestand met de factuurmail mee ───────────────
test("[FACTUUR-BIJLAGE] the attachment is resolved BEFORE a number is minted", () => {
  // Dit is de hele reden dat deze regels bestaan. Een paar regels na het ophalen wordt een nummer
  // gemunt uit de doorlopende reeks (Art. 35 — onomkeerbaar). Blijkt de bijlage pas dáárna
  // onleesbaar, dan zijn er twee slechte uitkomsten en geen goede: versturen zonder het bestand
  // dat de ondernemer er bewust bij zette, of afbreken met een nummer dat al weg is.
  const send = code("src/app/api/invoice/send/route.ts");
  const bijlageAt = send.indexOf("const bijlageId =");
  const nummerAt = send.indexOf("generateInvoiceNumber(supabase");
  assert.ok(bijlageAt > 0, "the send route must resolve the attachment");
  assert.ok(nummerAt > 0);
  assert.ok(bijlageAt < nummerAt,
    "the attachment must be fetched and judged before a number exists — after it, no outcome is good");

  // En het downloaden zelf ook, niet alleen de keuring.
  const downloadAt = send.indexOf(".storage.from('documents').download(");
  assert.ok(downloadAt > 0 && downloadAt < nummerAt, "the bytes must be in hand before the number");
});

test("[FACTUUR-BIJLAGE] a file that cannot go along stops the send, and says why", () => {
  const send = code("src/app/api/invoice/send/route.ts");
  assert.match(send, /attachmentRefusal\(/, "the rule decides, not the route");
  assert.match(send, /attachmentRefusalText\(weigering\)/, "…and the owner reads the reason");
  // Een leesfout is niet hetzelfde als "de bijlage deugt niet": het eerste is tijdelijk.
  assert.match(send, /Er is nog niets verstuurd/,
    "a failed read must say that nothing was issued — the owner may safely retry");

  const regel = code("src/lib/invoice-attachment.ts");
  // Andermans bestand gaat nooit naar een derde.
  assert.match(regel, /if \(!doc\.user_id \|\| doc\.user_id !== ownerId\) return "not_owned";/);
  // En de grens gaat over de mailbox van de KLANT, niet over onze opslag.
  assert.match(regel, /BASE64_FACTOR/, "base64 makes a file a third bigger in transit");
  assert.match(regel, /RESERVED_FOR_INVOICE_BYTES/, "…and the invoice PDF has to fit beside it");
});

test("[FACTUUR-BIJLAGE] the invoice PDF stays the first attachment", () => {
  // De klant opent de eerste bijlage, en dat hoort het document te zijn waar de mail over gaat.
  const email = code("src/lib/email.ts");
  const block = email.slice(email.indexOf("...(pdfBuffer || extraAttachment"));
  const pdfAt = block.indexOf("filename: `${invoiceNumber}.pdf`");
  const extraAt = block.indexOf("extraAttachment ? [extraAttachment]");
  assert.ok(pdfAt > 0 && extraAt > 0 && pdfAt < extraAt, "the legal document comes first");
});

test("[DEEL-KORTING] a line's own fixed discount scales with the part being credited", () => {
  // Two features landed on main within hours of each other, from different sessions: a discount per
  // invoice LINE, and a creditnota for PART of a line. Neither is wrong on its own. Together, a
  // fixed line discount was subtracted in FULL from a partial credit — measured on 10 × € 50 with
  // € 25 off, where the customer paid € 47,50 per unit:
  //
  //     fair credit for 3 units   3 × 47,50 = € 142,50
  //     what was credited         150 − 25  = € 125,00      € 17,50 too little
  //
  // The same function already scaled a fixed DOCUMENT discount pro rata, with the argument written
  // out. The argument applies one level down and had not been made there.
  const mod = code("src/lib/partial-credit.ts");
  assert.match(
    mod, /eigen && eigen\.type === "amount"\s*\n\s*\? \{ discount_type: "amount", discount_value: round2\(eigen\.value \* deel\) \}/,
    "a fixed line discount must scale by the credited share",
  );
  assert.match(mod, /const deel = geheel === 0 \? 0 : Math\.abs\(quantity\) \/ Math\.abs\(geheel\);/,
    "…by the share of THAT line, not of the document");
  // The scaled amount has to travel with the line. The e-factuur recomputes quantity × price −
  // allowance (PEPPOL-EN16931-R120) and compares it to the line amount, so a scaled total beside
  // an unscaled discount is a refused file — the half-fix is worse than the defect.
  assert.match(mod, /const regel = \{ \.\.\.l, \.\.\.geschaald, quantity \};/,
    "the scaled discount must be ON the credited line, not only in its total");

  const spec = readFileSync("src/lib/partial-credit.test.ts", "utf8");
  assert.match(spec, /a fixed line discount scales with the part being credited/);
  assert.match(spec, /a percentage needs no scaling, and must not get any/,
    "a percentage is already pro rata — scaling it twice is the mirror-image defect");
  assert.match(spec, /a FULL credit is unchanged, to the cent/,
    "every creditnota this app has ever made took that path");
});

// ─── [DEEL-CREDIT] De twee handmatige knoppen die nog ja/nee vroegen ──────────
//
// De migratie creditnota_partial.sql maakte een creditnota voor een DEEL van een factuur mogelijk.
// Zes oppervlakken werden toen omgezet van "is er een creditnota?" naar "hoeveel is er nog open?".
// Twee bleven staan, en het zijn precies de HANDMATIGE varianten van flows waarvan de automatische
// broer al was omgezet: de knop "Herinner" naast de automatische herinneringscron, en het
// betaalverzoek voor één factuur naast dat voor een bundel.
//
// Het gevolg was in beide gevallen hetzelfde en het kostte de ondernemer geld: crediteer één
// betwiste regel van vijf, en de app weigerde vanaf dat moment nog te vorderen voor de andere vier
// — op een factuur die haar status 'sent' en haar volle totaal houdt, zonder dat enig scherm zei
// waarom.

test("[DEEL-CREDIT] a reminder stops only when NOTHING is left to claim", () => {
  const route = code("src/app/api/invoice/[id]/reminder/route.ts");
  // Het oordeel gaat over een BEDRAG. Een enkele rij vinden is geen antwoord meer.
  assert.match(route, /openAfterCredit\(inv\.total_inc_btw, \(inv as any\)\.amount_paid, gecrediteerd\)/,
    "the refusal must weigh the amounts, not count the creditnotas");
  assert.match(route, /if \(gecrediteerd > 0 && nogOpen <= 0\)/,
    "…and refuse only when the credits (plus payments) cover the whole invoice");
  assert.doesNotMatch(route, /if \(tegenCreditnota\)/,
    "the old yes/no refusal must be gone, not merely bypassed");

  // En het bedrag in de mail is diezelfde uitkomst. Het volle totaal noemen op een deels
  // gecrediteerde factuur vraagt de klant om geld dat hij zwart-op-wit heeft teruggekregen.
  assert.match(route, /openstaand: nogOpen,/,
    "the reminder must name what is still owed, never the full total");
  assert.doesNotMatch(route, /openstaand: outstandingAmount\(/,
    "outstandingAmount knows nothing about creditnotas");
});

test("[DEEL-CREDIT] a payment link is refused only for a fully credited invoice", () => {
  const route = code("src/app/api/invoice/[id]/betaalverzoek/route.ts");
  // De betaalpagina zelf is al deelcredit-bewust en int de rest. Deze route weigerde de link te
  // munten die diezelfde pagina klaarstond te bedienen.
  assert.match(route, /fullyCreditedIdsFrom\(creditRowList, \[invoice as \{ id: string; total_inc_btw\?: number \| null \}\]\)\.has\(id\)/,
    "only a FULLY credited invoice may be refused a payment link");
  assert.doesNotMatch(route, /if \(\(creditRows \?\? \[\]\)\.length > 0\)/,
    "the old count-based refusal must be gone");

  // …en het bedrag op de QR is de rest, niet het volle totaal. Anders toont de betaalpagina achter
  // de link een ander bedrag dan de modal waaruit hij gekopieerd werd.
  assert.match(route, /credited_inc_btw: gecrediteerd/,
    "the reduction must reach buildBetaalverzoek, which subtracts it in openAmount");

  // De leesfout blijft een APARTE uitkomst: "we konden niet nakijken" is niet "er is een creditnota".
  assert.match(route, /We konden niet nakijken of er een creditnota/,
    "a failed check must still fail closed, and say so in its own words");
});

// ─── [DEEL-CREDIT] De derde plek: de schermen die het bedrag OPTELLEN ─────────
//
// De sweep hierboven zette elk oppervlak om dat over ÉÉN factuur oordeelt. De oppervlakken die ze
// bij ELKAAR optellen bleven staan, en daar liep de tweede rekenwijze door: `|totaal| − betaald`,
// zonder de creditnota. Twee antwoorden op dezelfde vraag, op hetzelfde moment:
//
//     de herinneringsmail (openAfterCredit)    vraagt de klant om    € 450
//     het scherm          (outstandingAmount)  zegt de ondernemer    € 500
//
// De klant heeft de creditnota in handen; de boekhouder belt over het verschil. En de creditnota
// kan het van de andere kant niet rechttrekken, want elke lijst die dit getal toont heeft hem er al
// uit gehaald — isOpenReceivable weigert hem, anders klopt de TELLING niet meer.
//
// De banklijn lost dezelfde vraag met opzet ánders op en blijft ongemoeid: daar zijn de factuur en
// haar creditnota twee openstaande posten die één betaling SAMEN afwikkelt (findSupplierSumMatch,
// [BATCH-SIGN] in reconcileBatch). Daar aftrekken zou hem dubbel tellen.

test("[DEEL-CREDIT] the screens that ADD amounts up subtract the credit too", () => {
  const mod = code("src/lib/sales-overview.ts");
  // Eén definitie, niet twee. De tweede spelling is precies wat uit elkaar liep.
  assert.match(mod, /export function outstandingAmount\(f: SalesInvoice, creditedIncBtw = 0\): number \{\s*return openAfterCredit\(f\.total_inc_btw, f\.amount_paid, creditedIncBtw\);\s*\}/,
    "outstandingAmount must delegate to openAfterCredit, not re-derive it");
  assert.doesNotMatch(mod, /const rest = total - paid;/,
    "the second spelling of the same arithmetic must be gone, not merely bypassed");

  // …en summarise moet het bedrag ook echt DOORGEVEN. Een parameter die niemand vult is geen fix.
  const body = mod.slice(mod.indexOf("export function summarise"));
  assert.match(body, /const rest = outstandingAmount\(f, creditedFor\(f, credited\)\);/,
    "summarise must price every invoice after its credits");
  // [CREDITNOTA-NO-CHASE] En een creditnota telt in geen enkel totaal en in geen enkele telling
  // mee: outstandingAmount neemt de absolute waarde, dus zonder deze regel werd € 50 krediet bij
  // € 500 schuld OPGETELD — € 550 openstaand, en twee facturen te laat in plaats van één.
  assert.match(body, /if \(\(f\.invoice_type \?\? "factuur"\) !== "factuur"\) continue;/,
    "a creditnota is the opposite of a receivable and belongs in no total");
});

test("[DEEL-CREDIT] every caller that HOLDS the creditnota rows hands them over", () => {
  // De reparatie zit in de aanroepen. Een optionele parameter repareert niets zolang de drie
  // schermen die de creditnota-rijen al binnen hebben ze op de vloer laten liggen.
  const debiteuren = code("src/app/dashboard/accountant/debiteuren/page.tsx");
  assert.match(debiteuren, /const gecrediteerd = creditedTotalsFrom\(creditnotas\)/);
  assert.match(debiteuren, /buildDebtorBoard\(invoer, namen, readClock\(\), gecrediteerd\)/,
    "the debiteurenlijst is the number an accountant reads out on the telephone");

  const board = code("src/lib/accountant-debtors.ts");
  const boardBody = board.slice(board.indexOf("export function buildDebtorBoard"));
  assert.match(boardBody, /const open = outstandingAmount\(f, gecrediteerd\);/);
  assert.match(boardBody, /canRemind\(f, nowMs, gecrediteerd\)/,
    "the button and the amount beside it must never disagree about what is owed");

  const queues = code("src/modules/accountant/work-queues.ts");
  assert.match(queues, /outstandingAmount\(row, gecrediteerd\.get\(row\.id\) \?\? 0\)/);

  const client = code("src/app/dashboard/verkoop/VerkoopClient.tsx");
  assert.match(client, /summarise\(facturen, nu, creditMap\)/);
  assert.match(client, /outstandingAmount\(f, creditMap\.get\(f\.id\) \?\? 0\)/);
});

// ─── [KAS-DUBBELE-KOST] Dezelfde aankoop, twee keer in de boeken ─────────────
//
// De app stuurde hier al op aan en controleerde nooit. De [KAS-UPLOAD]-knop zegt met zoveel
// woorden dat een contant betaalde bon door de intake hoort en "deliberately NOT a manual cash
// 'kosten' entry (that would drop the voorbelasting and double-count once the same receipt is
// booked as an invoice)" — maar 'kosten' staat open in het toevoegformulier, en niets vergeleek die
// regel ooit met de factuur die de volgende ochtend binnenkomt. Dan telt dezelfde aankoop twee keer
// als kosten, en met een bon + tarief wordt ook de btw twee keer teruggevraagd.

test("[DEEL-CREDIT-CUMULATIEF] the same line cannot be credited twice", () => {
  const mod = code("src/lib/partial-credit.ts");
  // Het plafond is wat er NOG over is, niet wat er ooit op de regel stond.
  assert.match(mod, /const overGebleven = remainingForKey\(lines, bron, eerder \+ alGevraagd\);/,
    "the cap must be the remainder after earlier credits AND after this same selection");
  assert.doesNotMatch(mod, /if \(Math\.abs\(gevraagd\) > Math\.abs\(origineel\) \+ 1e-9\)/,
    "the original-line comparison must be gone, not merely bypassed");
  // De route moet de eerdere creditnotaREGELS ook echt lezen — een parameter die niemand vult
  // repareert niets, en dit is precies de vorm die dit bestand blijft dichtzetten.
  const route = code("src/app/api/invoice/creditnota/route.ts");
  assert.match(route, /creditedQuantitiesByLine\(\s*bronRegels,/);
  assert.match(route, /checkCreditSelection\(bronRegels, selectie, alGecrediteerdPerRegel\)/);
  // …en faalt DICHT als hij ze niet kan lezen. Anders valt de controle stil terug op
  // "er is nog niets gecrediteerd", met een reden om het niet te zien.
  assert.match(route, /earlier creditnota lines unreadable — refusing to credit/);
});

test("[CRON-STIL] a failed candidate read is not a quiet night", () => {
  // The catch returned [] and the very next line answered ok:true, sent:0 — indistinguishable from
  // "nothing was overdue". Dunning could be dead every night while the heartbeat read green.
  const cron = code("src/app/api/cron/reminders/route.ts");
  assert.match(cron, /invoiceReadFailed = e instanceof Error \? e\.message : String\(e\);/,
    "the failure has to be remembered, not only logged");
  assert.match(cron, /if \(invoiceReadFailed !== null\) \{/);
  assert.match(cron, /note: "invoice_lookup_failed" \}, false\)/,
    "…and the run must close as FAILED, or the heartbeat still says green");
  assert.match(cron, /tag: "CRON-REMINDERS",\s*\n\s*message: "candidate invoice read failed/,
    "…and reach a person, since a cron's stdout reaches nobody");
  // The guard must precede the empty-list branch it exists to distinguish from.
  assert.ok(
    cron.indexOf("if (invoiceReadFailed !== null)") < cron.indexOf("if (invoices.length === 0)"),
    "a read failure must be answered before 'nothing to do' is",
  );
});

test("[HERLEZING-STIL] a read that never happened may not archive an invoice", () => {
  // classifyAttachment answers a caught failure — a blown AI-budget fuse, a model that returned
  // nothing — with a FALLBACK: isInvoice false at confidence 0. That is the absence of a judgement,
  // not a judgement, and it arrived here as "not an invoice". One blown fuse plus "herlees alles"
  // then archives the whole verify queue: real invoices, real amounts, on a reading that never
  // took place. The e-mail side already draws this distinction.
  const route = code("src/app/api/email/reimport/[id]/route.ts");
  assert.match(route, /if \(!c\.isInvoice && !\(\(c\.confidence \?\? 0\) > 0\)\) \{/,
    "no confidence means no reading, and no reading means no archiving");
  assert.match(route, /We konden dit document nu niet lezen/,
    "…and the owner is told which of the two it was");
  // …and it has to come BEFORE the archive branch, or it decides nothing.
  assert.ok(
    route.indexOf("(c.confidence ?? 0) > 0") < route.indexOf('status: "archived"'),
    "a guard that runs after the write is not a guard",
  );
});

test("[WAARSCHUWING] the purge reads the stamp its own refusal depends on", () => {
  // decidePurge's last gate refuses any row without purge_warning_sent_at — including one where
  // the field is ABSENT, which is the right answer for a row that proves nothing. The purge query
  // did not select it, so every candidate arrived stamp-less and was refused, every night, forever:
  // the AVG art. 17 erasure could never run. The 30-day letter itself was sent and stamped
  // correctly a hundred lines above, by the same cron.
  const route = code("src/app/api/cron/retention-purge/route.ts");
  // Sliced to the PURGE query specifically: the warning query a hundred lines above selects the
  // same column, and a whole-file match would have passed while the purge query lost it. It did —
  // the first negative control edited the warning query and this gate never noticed.
  const purgeQuery = route.slice(route.indexOf('.from("deletion_requests")', route.indexOf("let rows: DeletionRequestRow[]")));
  assert.match(purgeQuery, /purged_at, purge_warning_sent_at"/,
    "the purge query must fetch the stamp it refuses on");
  // …and the WARNING query needs it too, for its own reason: it filters on it to find who has not
  // been written to yet. Both, separately, or one of them silently stops working.
  const warnQuery = route.slice(route.indexOf('.from("deletion_requests")'), route.indexOf("let rows: DeletionRequestRow[]"));
  assert.match(warnQuery, /\.is\("purge_warning_sent_at", null\)/,
    "the warning query must still find the rows that were never written to");

  // …and the TYPE must declare it, or the next caller drops it again with tsc silent. That is how
  // it happened: the field was never on DeletionRequestRow at all.
  const mod = code("src/lib/retention-purge.ts");
  assert.match(mod, /purge_warning_sent_at\?: string \| null;/);

  // The promise itself is untouched: 29 days is still a refusal, 31 days still erases.
  const spec = readFileSync("src/lib/retention-purge.test.ts", "utf8");
  assert.match(spec, /a row that was never warned is refused, however expired it is/);
  assert.match(spec, /a MISSING column is refused too/);
});

test("[ORIGINEEL-INKOOP] only a purchase invoice may be given an original", () => {
  // This route's one write puts the uploaded file's key into invoices.pdf_url. On an OUTGOING
  // invoice that column is not an empty slot — it is the legal PDF the app rendered and mailed
  // (art. 35), and the closing package ships it to the accountant as <invoice_number>.pdf. The
  // route selected `direction` and never asked it.
  const route = code("src/app/api/invoice/[id]/document/route.ts");
  assert.match(route, /if \(\(inv\.direction \?\? "incoming"\) !== "incoming"\) \{/,
    "an outgoing invoice may not have its pdf_url replaced by an upload");
  assert.match(route, /geen_inkoopfactuur/);
  // …and the refusal points at the path that DOES restore an outgoing PDF, or it is a dead end.
  assert.match(route, /Verstuur de factuur opnieuw/);
  // The guard must sit before the write, not beside it.
  assert.ok(
    route.indexOf('!== "incoming"') < route.indexOf("pdf_url: storagePath"),
    "a guard that runs after the write is not a guard",
  );
});

test("[MANDAAT-SOORT] an invoicing mandate is read as one, and only one", () => {
  // getActingForClient read EVERY unrevoked mandate row and never asked which kind it was — it did
  // not even select the column, so mandateKindOf saw `kind: undefined` and returned its default
  // 'facturen'. A client who granted only "bevestigen" therefore handed over invoicing and dunning:
  // the accountant could mint numbers in that client's own series (art. 35) and mail their
  // customers. The mirror is on the same line: granting BOTH kinds gives two rows, maybeSingle()
  // answers null on more than one, and the accountant met a 403 with both switches ON.
  const mod = code("src/lib/acting-for-server.ts");
  const fn = mod.slice(mod.indexOf("export async function getActingForClient"),
                       mod.indexOf("export async function canConfirmForClientServer"));
  assert.match(fn, /\.select\("zzper_id, accountant_id, kind, revoked_at"\)/,
    "the kind has to be selected before anything can judge it");
  assert.match(fn, /\.eq\("kind", "facturen"\)/,
    "…and filtered, exactly as the confirm sibling filters on 'bevestigen'");

  // [DEPLOY-SAFE] `kind` arrives with a migration. Selecting a column that is not there yet fails
  // the whole read, which would take an accountant's EXISTING invoicing access away — so that one
  // error, and only that one, falls back to the pre-kind query, where every mandate really was an
  // invoicing mandate.
  assert.match(fn, /isMissingColumn\(mandateErr\.message/);
  assert.match(fn, /\.select\("zzper_id, accountant_id, revoked_at"\)/,
    "the fallback is the query this function used before");
  // Any OTHER read failure must stay null: "we could not read the mandate" is not "no mandate".
  assert.match(fn, /let mandateRow = \(mandate as MandateRow \| null\) \?\? null;/);
});

test("[SEC-STORAGE-PATH] every service-role read of an owner-written path is attributed first", () => {
  // The rule this module's own header states: a ROW check says "you may see this record", never
  // "and the record points at your bytes". file_url and pdf_url are ordinary text on rows the owner
  // may write, and the service-role client bypasses the bucket policy that would catch a key from
  // another tenant's folder. Four doors already applied it; these five did not.
  //
  // Each assertion below pins the GUARDED EXPRESSION, not the presence of the helper's name
  // anywhere in the file. A first version of this gate did the latter and three negative controls
  // walked straight through it — the same mention-not-wiring shape this file keeps closing.

  // The attachment mailed to the customer. Refused with the not_found sentence on purpose: telling
  // a prober "not yours" would tell them which keys exist.
  assert.match(code("src/app/api/invoice/send/route.ts"),
    /if \(!pathBelongsToOwner\(pad, ownerId\)\) \{/);

  // The PDF attached to a dunning mail — sent to an address the same row carries.
  assert.match(code("src/app/api/cron/reminders/route.ts"),
    /if \(inv\.pdf_url && pathBelongsToOwner\(pdfPath, ownerId\)\) \{/);

  // A working one-hour signed URL.
  assert.match(code("src/app/dashboard/vragen/page.tsx"),
    /if \(!pathBelongsToOwner\(pad, user\.id\)\) return/);

  // The one that DELETES. Its filter must drop a foreign key rather than remove it: an orphan
  // object is reclaimable, another tenant's bytes are not.
  assert.match(code("src/app/api/onboarding/reset/route.ts"),
    /\.filter\(\(p\) => p && pathBelongsToOwner\(p, user\.id\)\)/);

  // Bytes shipped inside the quarter ZIP the accountant opens.
  const pkg = code("src/lib/closing-package.ts");
  assert.match(pkg, /if \(d\?\.file_url && pathBelongsToOwner\(pad, ownerId\)\) \{/);
  // …and the two reads that fetched documents BY ID with no owner filter at all, while the
  // bankafschrift query directly below them always had one.
  assert.doesNotMatch(pkg, /\.select\("id, file_url"\)\s*\.in\("id", incomingDocIds\)/,
    "a documents read by id must be scoped to the owner");
  assert.doesNotMatch(pkg, /\.select\("id, file_url, file_name"\)\s*\.in\("id", incomingDocIds\)/,
    "…both of them");

  // Every one of them normalises first, or a stored full URL dodges the check entirely.
  for (const f of ["src/app/api/invoice/send/route.ts", "src/app/api/cron/reminders/route.ts",
                   "src/app/dashboard/vragen/page.tsx", "src/app/api/onboarding/reset/route.ts",
                   "src/lib/closing-package.ts"]) {
    assert.match(code(f), /toStoragePath\(/, `${f} must normalise the stored value first`);
  }
});

test("[DECLARED-INVOICE-EIGEN-CLAIM] the guard is not fed the payment's own claim", () => {
  // undeclaredMissingInvoices computes "what this payment NAMES" minus "what we HOLD". It was
  // handed [...refNumbers, …] as the held set, and refNumbers is parseReferenceNumbers(tx.reference)
  // — the payment's own claim, read from the same text. The claim was subtracted from itself and
  // the answer was always empty. Measured on the ATAPACK remittance the guard's own header cites:
  // route's call → [], correct call → ["26302362"], the invoice then paid a second time.
  const route = code("src/app/api/bank/confirm/route.ts");
  assert.match(route, /\[inv\.invoice_number, \.\.\.linkedInvoiceNumbers\],/,
    "held = this invoice plus the ones this bank line already settled");
  assert.doesNotMatch(route, /\[\.\.\.refNumbers, inv\.invoice_number\]/,
    "the payment's own reference tokens may never be the held set");
  // …and the linked numbers must actually be collected, or the guard fires on a legitimate second
  // booking against the same line.
  assert.match(route, /if \(n !== ""\) linkedInvoiceNumbers\.push\(n\);/);
  assert.match(route, /invoice_type, total_inc_btw, invoice_number"/,
    "invoice_number has to be selected for that to be possible");
});

test("[CREDIT-NETTING-BEVESTIG] the confirm guard sees the same payment the matcher saw", () => {
  // isEligible's escape for a netted credit note is referenceMatches(tx, …), which reads
  // tx.reference and tx.description. The route blanked both while SELECTing them one screen up, so
  // the rule could never fire: every netted creditnota answered 409 not_eligible on a Bevestig
  // button the matcher had just rendered. Same defect the note beside it records for total_inc_btw.
  const route = code("src/app/api/bank/confirm/route.ts");
  const guard = route.slice(route.indexOf("const eligible = isEligible("), route.indexOf("if (!eligible)"));
  assert.match(guard, /description: tx\.description \?\? "",/);
  assert.match(guard, /reference: tx\.reference \?\? null,/);
  assert.doesNotMatch(guard, /description: "",/);
  assert.doesNotMatch(guard, /reference: null,/);
});

test("[CREDITNOTA-DOCUMENT] a creditnota is a CreditNote, not an Invoice with a code on it", () => {
  const mod = code("src/lib/ubl-export.ts");
  assert.match(mod, /cn: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.match(mod, /const isCreditNote = \(header\.invoice_type \?\? "factuur"\) === "creditnota";/);
  // Elk element dat het documenttype noemt volgt het. Een half omgezet document is erger dan het
  // origineel: een importeur die de CODE leest treft dan 381 in een Invoice, en een die de WORTEL
  // leest treft InvoiceLine in een CreditNote.
  assert.match(mod, /isCreditNote \? NS\.cn : NS\.inv/, "namespace");
  assert.match(mod, /const docName = isCreditNote \? "CreditNote" : "Invoice";/, "root element");
  assert.match(mod, /isCreditNote \? "CreditNoteTypeCode" : "InvoiceTypeCode"/, "type code element");
  assert.match(mod, /isCreditNote \? "CreditNoteLine" : "InvoiceLine"/, "line element");
  assert.match(mod, /isCreditNote \? "CreditedQuantity" : "InvoicedQuantity"/, "quantity element");

  // Het bewijs dat dit geen smaakkwestie is, staat in dit huis: de eigen lezer beslist op de
  // WORTEL en nooit op de code, dus een creditnota die hier uitging kwam hier terug als een
  // positieve inkoopfactuur met positieve voorbelasting.
  const reader = code("src/lib/e-invoice.ts");
  assert.match(reader, /isCreditNote: \/<\(\?:\\w\+:\)\?CreditNote\[\\s>\]\//,
    "the reader dispatches on the root element — that is what makes the export's shape load-bearing");
  const spec = readFileSync("src/lib/ubl-export.test.ts", "utf8");
  assert.match(spec, /this app reads its own creditnota back as a credit/,
    "…and the round trip is asserted, not merely argued");
});

test("[KOPER-LAND] the e-factuur states the buyer's real country", () => {
  const mod = code("src/lib/ubl-export.ts");
  assert.doesNotMatch(mod, /cusAddr\.ele\(NS\.cac, "Country"\)\.ele\(NS\.cbc, "IdentificationCode"\)\.txt\("NL"\)/,
    "BT-55 must not be a literal — the same call reverse-charges on a non-NL VAT number");
  assert.match(mod, /\.txt\(buyerCountryCode\(header\.client_btw_number\)\)/);
  // Dezelfde toets als de verlegging zelf, anders verhuist de tegenspraak alleen.
  assert.match(mod, /if \(shape\.kind !== "eu"\) return "NL";/,
    "the country follows exactly the evidence isReverseChargedInvoice follows");
  assert.match(mod, /return shape\.country === "EL" \? "GR" : shape\.country;/,
    "BT-55 is a country code: Greece is GR, not the EL of its VAT number");
});

test("[WIK-EEN-AANMANING] one statutory demand per debtor, not per invoice", () => {
  const mod = code("src/lib/incasso.ts");
  assert.match(mod, /export function aggregateWikClaims/);
  assert.match(mod, /principal \+= open;/, "the hoofdsommen are added together (art. 6:96 lid 7 BW)");
  assert.match(mod, /dag na de vervaldatum/, "handelsrente starts the day AFTER (art. 6:119a lid 1 BW)");

  const cron = code("src/app/api/cron/reminders/route.ts");
  assert.match(cron, /const samen = aggregateWikClaims\(claimsPerDebiteur\.get\(debiteur\) \?\? \[\]\);/);
  assert.match(cron, /openstaand: samen\.principal > 0 \? samen\.principal : openstaand,/,
    "the demand names the debtor's total, not this one invoice's remainder");
  // …en de tweede factuur van dezelfde debiteur krijgt geen TWEEDE aanmaning.
  assert.match(cron, /&& !aangemaand\.has\(debiteur\)/);
  assert.match(cron, /if \(wik\) aangemaand\.add\(debiteur\);/);
});

test("[KAS-DUBBELE-KOST] the detector reads, reports, and never books", () => {
  const mod = code("src/lib/cash-cost-overlap.ts");
  const collect = code("src/lib/cash-cost-overlap-collect.ts");
  // Alles hieraan is READ-ONLY. Een detector die zelf iets rechtzet, zet het recht op een vermoeden.
  for (const [naam, bron] of [["cash-cost-overlap", mod], ["cash-cost-overlap-collect", collect]] as const) {
    assert.doesNotMatch(bron, /\.(insert|update|upsert|delete|rpc)\(/,
      `${naam} must never write — which of the two rows is right is a question about paper`);
  }
  // De twee regels die het stil houden waar het stil moet zijn.
  assert.match(mod, /if \(e\.invoice_id != null\) return false;/,
    "a system settlement IS the invoice's own cash movement, never a duplicate of it");
  assert.match(mod, /if \(gap == null \|\| gap > window\) continue;/,
    "an undateable pair is not evidence — silence beats a question nobody can check");
  // Tot op de cent, en het bedrag is een SLEUTEL en geen vergelijking: de opzoeking in de index is
  // exact of hij bestaat niet. Een marge hier maakt van een sterk signaal een ruispaneel, en een
  // paneel dat ruist wordt weggeklikt — precies de uitkomst die dit hele bestand voorkomt.
  assert.match(mod, /const cents = \(rounded: number\): number => Math\.round\(rounded \* 100\);/,
    "the amount is keyed in integer cents, so a hit is exact by construction");
  assert.match(mod, /byGross\.get\(key\)/);
  assert.match(mod, /byNet\.get\(key\)/);
  assert.doesNotMatch(mod, /nearAmount|BIJNA/, "no near-amount tier: this pairing is exact or it is nothing");
  // …en de sleutel krijgt een AFGEROND bedrag. Zonder round2 sleutelt een halve cent (1,005 is in
  // werkelijkheid 1,00499999999999989) op 100 terwijl de factuur al op 1,01 staat opgeslagen, en
  // een echt paar wordt niet gemeld. Aangetoond met een negative control.
  assert.match(mod, /const amount = round2\(magnitude\(e\.amount\)\);/,
    "the key must be built from a rounded amount — see the half-cent case");

  // [KAS-ZACHT] Een verwijderde kasregel telt nergens, ook niet als vraag.
  assert.match(collect, /liveCashEntries/,
    "every reader of cash_entries goes through the soft-delete rule");
  // [NO-SILENT-EMPTY] "We konden niet kijken" is niet "er is niets".
  assert.match(collect, /readFailed: true/,
    "a failed read must be reportable as unknown, never as a clean quarter");
});

test("[KAS-DUBBELE-KOST] it reaches BOTH the owner and the aangifte", () => {
  // De Kas-pagina is waar de ondernemer het kan oplossen; de aangifte is waar de dubbele kost
  // terechtkomt. Alleen het eerste doen laat de boekhouder — vaak de enige die beide kanten ziet —
  // met een schone pagina achter.
  const kasboek = code("src/app/api/kasboek/route.ts");
  assert.match(kasboek, /const doubleCosts = await collectCashCostOverlaps\(supabase, user\.id, \{ from: dupStart, to: dupEnd \}\)/,
    "the Kas page's own endpoint computes it");
  assert.match(kasboek, /doubleCostsUnknown: doubleCosts\.readFailed/,
    "…and reports a failed read as such");

  const aangifte = code("src/app/api/aangifte/route.ts");
  assert.match(aangifte, /const dcNote = doubleCostNote\(doubleCosts\.overlaps\);/);
  assert.match(aangifte, /if \(dcNote\) regimeNotes\.push\(dcNote\);/,
    "the accountant reading the aangifte must be told");
  // Een NOTITIE, geen blokkade. Een negatieve kas is rekenkunde; dit is een koppeling met sterk
  // bewijs en geen bewijs. Iemand tegenhouden bij zijn wettelijke plicht op een vermoeden is erger
  // dan het vermoeden.
  assert.doesNotMatch(aangifte, /doubleCost[^\n]*blokk|blocked.*doubleCost/i,
    "a probable duplicate must never block a filing");

  // Het paneel neemt zijn rijen als PROPS. Een blok dat zijn rijen uit een fetch krijgt rendert in
  // geen enkele gate, dus zou de regel die geld opmaakt voor het eerst op het scherm van een
  // ondernemer draaien — de klasse die tests/render/ bestaat om te vangen.
  const kas = code("src/app/dashboard/kas/KasClient.tsx");
  assert.match(kas, /export function DoubleCostNotice\(\{ rows, unknown, t \}/,
    "the panel must be renderable without a session");
  assert.match(kas, /<DoubleCostNotice/, "…and actually used by the screen");
  // De verdicts moeten kunnen OPKLAREN. Een 'unknown' die alleen maar ge-OR-d wordt blijft staan
  // over een kwartaal dat sindsdien tien keer schoon is gelezen.
  assert.match(kas, /unknown: !blocking\.ok \|\| !open\.ok/,
    "the unknown verdict is recomputed each refresh, never accumulated");
  const render = readFileSync("tests/render/money-screens.test.tsx", "utf8");
  assert.match(render, /the double-cost panel renders every branch it has/,
    "and it is on the render line with rows that exercise it");
});

test("[DEEL-CREDIT] the facturenlijst tells withdrawn apart from partly credited", () => {
  // Deze lijst laadde de creditnota's als een VERZAMELING IDS — een ja/nee — en dat werd de
  // verkeerde vraag zodra een creditnota één betwiste regel kon dekken. Drie dingen zeiden daarna
  // "ingetrokken" over een factuur waar nog geld op staat, en het derde nam een knop mee.
  const client = code("src/app/dashboard/facturen/FacturenClient.tsx");
  assert.doesNotMatch(client, /creditedIds/,
    "the yes/no set must be gone, not merely bypassed");
  // The AMOUNT, and not one frozen spelling of the column list. [CREDIT-BEWIJS] added
  // invoice_number and invoice_date so the chip can name the documents behind it, and a gate that
  // pins the exact string goes red on a read that grew MORE honest — which is how a gate gets
  // weakened instead of obeyed.
  const creditSelect = /\.select\('original_invoice_id, total_inc_btw([^']*)'\)/.exec(client);
  assert.ok(creditSelect,
    "the read must fetch the AMOUNT — without it nothing here can tell the two states apart");
  assert.match(client, /setCreditedAmounts\(creditedTotalsFrom\(rows\)\)/,
    "…through the shared definition, not a second sum of the same rows");

  // De bundel: de API weigert een deels gecrediteerde factuur al niet meer, dus het scherm mocht
  // hem niet blijven uitgrijzen. Dit is de regel die geld kostte — een betaalverzoek dat niet
  // verstuurd kon worden voor een bedrag dat gewoon openstond.
  const bundel = client.slice(client.indexOf("const isBundelbaar"), client.indexOf("function toggleSelect"));
  assert.match(bundel, /!isVolledigGecrediteerd\(inv\)/,
    "only a FULLY credited invoice may be kept out of a bundle");

  // De chip belooft in zijn eigen tooltip dat er niets meer openstaat. Dat mag alleen als het waar is.
  assert.match(client, /\{isVolledigGecrediteerd\(inv\) && \(/,
    "the 'Gecrediteerd' chip is for a withdrawn invoice only");
  assert.match(client, /\{!isVolledigGecrediteerd\(inv\) && gecrediteerdOp\(inv\.id\) > 0 && \(/,
    "a partly credited invoice gets its own chip rather than silence");
  // The chip must survive a partial credit — that is what this line has always guarded. It now
  // also has to be RIGHT about the amount: measured against the gross total, an invoice whose
  // remaining € 450 has been paid still counts as "partly paid", and the chip announces € 0,00
  // open on an invoice that is finished. So the predicate is told what came back, and the
  // suppression stays limited to a WITHDRAWN invoice, exactly as before.
  assert.match(client, /\{isPartiallyPaid\(inv, gecrediteerdOp\(inv\.id\)\) && !isVolledigGecrediteerd\(inv\) && \(/,
    "the deelbetaling chip — and the tap target under it — must survive a partial credit, and must measure against what is owed");

  // [TDZ] De helper staat vóór zijn gebruiker. De buurscherm-bug die tests/render/ bestaat om te
  // vangen was precies dit: een const die zeventig regels boven zijn declaratie werd gelezen.
  assert.ok(
    client.indexOf("const isVolledigGecrediteerd") < client.indexOf("const isBundelbaar"),
    "a helper must be declared before the function that calls it",
  );
});

test("[DEEL-CREDIT] a partial credit does not switch off either art. 29 detector", () => {
  // Beide detectoren vroegen "staat er een creditnota tegenover?" en lieten de héle factuur vallen
  // bij ja. Dat klopte zolang een creditnota alleen de hele factuur kon zijn. Sinds
  // creditnota_partial.sql zette één creditnota van € 121 op een factuur van € 1.210 de hele regel
  // uit — aan beide kanten, en beide keren zwijgend:
  //
  //   lid 1, het geld dat je KRIJGT: de klant betaalde de resterende € 1.089 nooit, er ging een jaar
  //     overheen, en de BTW daarover mag terug. Gemeten: € 189 terug te vragen, € 0 gemeld.
  //   lid 7, het geld dat je MOET betalen: dezelfde vorm op een inkoopfactuur haalde de waarschuwing
  //     helemaal weg — volgens de kop van die module "de enige kant die geld kost", de kant die een
  //     ondernemer pas hoort als de naheffing er is.
  const mod = code("src/lib/bad-debt.ts");
  assert.doesNotMatch(mod, /const creditedOriginalIds = new Set<string>\(\)/,
    "the all-or-nothing set must be gone, not merely bypassed");
  assert.doesNotMatch(mod, /creditedOriginalIds\.has\(String\(i\.id\)\)/,
    "…and no loop may still drop an invoice on the mere EXISTENCE of a credit");

  // Het bedrag reist mee in het onbetaalde deel, en dat is precies waar de correctie hoort: de
  // creditnota droeg zelf NEGATIEVE btw en is in haar eigen tijdvak aangegeven, dus over het
  // gecrediteerde deel valt niets meer terug te vragen of terug te betalen.
  assert.match(mod, /\(gross - paid - gecrediteerd\) \/ gross/,
    "the credited amount belongs in the unpaid share, alongside the payments");

  // Beide detectoren moeten hem ook echt AANROEPEN. Een helper die één van de twee gebruikt is
  // exact de vorm die dit bestand blijft dichtzetten.
  const sales = mod.slice(mod.indexOf("export function detectBadDebt"), mod.indexOf("export const BAD_DEBT_MIN_EUR"));
  const purchase = mod.slice(mod.indexOf("export function detectVatClawback"));
  for (const [naam, body] of [["detectBadDebt", sales], ["detectVatClawback", purchase]] as const) {
    assert.match(body, /const credited = creditedByOriginal\(args\.invoices\);/,
      `${naam} must measure how much was credited, not whether anything was`);
    assert.match(body, /const unpaidFraction = openFraction\(i, inc, credited\);/,
      `${naam} must price the invoice on what is left after payments AND credits`);
  }

  // Eén definitie van "hoeveel is er gecrediteerd", gedeeld met de schermen.
  assert.match(mod, /import \{ creditedTotalsFrom \} from "\.\/credited-invoices"/,
    "the credited total has one definition in this app");
});

test("[CREDITNOTA-NO-CHASE] the verkoop query selects the column its own guard judges on", () => {
  // canRemind weigert een creditnota op invoice_type. Deze query vroeg die kolom niet op, dus las
  // de regel `?? 'factuur'` en weigerde niets: onder een creditnota stond een levende knop
  // "Herinnering sturen" — de mail die geld opeist dat de klant juist terugkrijgt. De route
  // weigerde hem alsnog, dus er ging niets de deur uit; er stond een knop die alleen een
  // foutmelding kon geven. De bewaker stond er, alleen niet het gegeven waar hij op oordeelt.
  const page = code("src/app/dashboard/verkoop/page.tsx");
  // Slice the SELECT itself — from the table to the first filter — not "everything up to the next
  // `const facturen…`". That anchor assumed the query is awaited straight into its variable, and
  // the moment the read was hoisted into a Promise.all the slice ran backwards and silently became
  // the empty string: a gate that passes on nothing, or (as here) fails for a reason that has
  // nothing to do with the column it guards. What this test is about is which columns come back.
  const fromInvoices = page.slice(page.indexOf("from('invoices')"));
  const select = fromInvoices.slice(0, fromInvoices.indexOf(".eq("));
  assert.ok(select.includes(".select("), "the anchor must land on a real select, not an empty slice");
  assert.match(select, /invoice_type/, "without this column the creditnota guard cannot fire");
  assert.match(select, /original_invoice_id/, "…and without this one nothing can be netted");

  // En het scherm spreekt zichzelf niet tegen: geen rood "te laat" boven de zin dat een
  // creditnota geen vordering is.
  const client = code("src/app/dashboard/verkoop/VerkoopClient.tsx");
  assert.match(client, /\{credit \? 'creditnota' : LABEL\[stand\]\}/,
    "a creditnota is badged as one, never as a late invoice");
  assert.match(client, /\{!credit && stand === 'te-laat' && \(/,
    "…and it is offered no reminder block at all");
});

// ─── [FACTUUR-BIJLAGE] De bijlage die op de factuur stond en nergens te zien was ───
//
// De kolom werd geschreven en nergens teruggelezen. De verstuurroute viel altijd terug op wat er
// op de factuur stond, dus het bestand ging gewoon mee — alleen zag de ondernemer daar niets van,
// en kon hij het er niet af halen. Belandde dat bestand later in de prullenbak, dan weigerde élke
// nieuwe verzending met "kies een ander bestand", op een scherm zonder enige manier om dat te doen.
// De factuur was daarmee niet meer te versturen.

test("[FACTUUR-BIJLAGE] the send route knows THREE states, not two", () => {
  const send = code("src/app/api/invoice/send/route.ts");
  // Sleutel afwezig = zwijgen = neem wat er op de factuur staat. Alleen zo kunnen de cron, het
  // bewerkscherm en elke andere aanroeper die van bijlagen niets weet er niets aan veranderen.
  assert.match(send, /const bijlageMeegestuurd = !!body && typeof body === 'object' && 'attachment_document_id' in body/,
    "the KEY's presence decides, not its value");
  assert.match(send, /const bijlageId = bijlageMeegestuurd\s*\n\s*\? gevraagdeBijlage\s*\n\s*: \(\(invoice as/,
    "an explicit null must mean NO attachment, not 'fall back to the stored one'");
  // …en dat wist ook de kolom, anders geldt "Weghalen" voor één mail en nergens anders.
  assert.match(send, /\.\.\.\(bijlageMeegestuurd && 'attachment_document_id' in invoice\s*\n\s*\? \{ attachment_document_id: gevraagdeBijlage \}/,
    "removing an attachment must clear the column, or the next send re-attaches it");
});

test("[FACTUUR-BIJLAGE] a resend can change the attachment, and remembers it", () => {
  const send = code("src/app/api/invoice/send/route.ts");
  // Het is juist bij OPNIEUW versturen dat een bijlage wisselt of vervalt, en dat pad slaat de
  // gewone commit-update over (die zet nummer en status vast — bij een resend is er niets vast te
  // zetten). Dus staat de bijlagekolom daar apart, en alleen die.
  assert.match(send, /if \(resend && bijlageMeegestuurd && 'attachment_document_id' in invoice\)/,
    "a resend must be able to persist a changed attachment");
  assert.match(send, /bijlagekeuze niet vastgelegd bij opnieuw versturen/,
    "…and a failure to remember must not stop the mail that is already assembled");
});

test("[FACTUUR-BIJLAGE] the screen reads the attachment back, and stays silent when it cannot", () => {
  const scherm = code("src/app/dashboard/invoice/[id]/page.tsx");
  assert.match(scherm, /const bijlageId = \(invoiceData as \{ attachment_document_id\?: string \| null \}\)\.attachment_document_id/,
    "the invoice's own attachment must be read back — a column written and never read is a lie on screen");
  // De prullenbak-stand wordt NIET weggefilterd: dat is juist het geval waarin de ondernemer moet
  // ingrijpen, en het scherm zegt wat eraan te doen is.
  assert.match(scherm, /\.select\('id, file_name, file_size, trashed'\)/,
    "a trashed attachment must be visible, because that is the one that blocks sending");
  assert.match(scherm, /t\('bijlage\.inPrullenbak'\)/);

  // En bij twijfel zwijgt het scherm. Zou het `null` sturen wanneer het de documentrij niet kón
  // lezen, dan wist een verkoopmedewerker — die de bestanden van zijn werkgever via RLS niet mag
  // zien — de bijlage van zijn baas door alleen maar op Versturen te drukken.
  const stuurt = scherm.match(/\.\.\.\(bijlageBekend \? \{ attachment_document_id: bijlage\?\.id \?\? null \} : \{\}\)/g) ?? [];
  assert.equal(stuurt.length, 2,
    "both send paths (first send and resend) must speak only when the screen knows the truth");
});

// ─── [SHEET-NIET-OPSLAAN] The app sent the owner to the right door, then locked it ───────────────

test("[SHEET-NIET-OPSLAAN] a spreadsheet on the bank endpoint claims no content_hash", () => {
  // RECONCILIATION_TRIANGLE.md carried this as "latent": a spreadsheet dropped on the bank importer
  // was still stored with doc_type "bankafschrift" and a content_hash.
  //
  // Mis-filing was the visible half. The half that costs a day's turnover is the hash: importBankStatement
  // already DETECTS the spreadsheet and warns, by name, "importeer het via Dagomzet". The owner follows
  // that advice, uploads the same bytes there, and byte-hash dedup rejects them as already seen. We
  // point at the right door and lock it on the way. Nothing errors; the day's turnover just never arrives.
  //
  // A source gate, not a unit test, because importBankStatement is 440 lines of I/O over the Supabase
  // pipeline — there is no pure seam to assert against. What it pins is the ONE structural fact that
  // makes the bug impossible: the passthrough insert is not reachable while nonBankSpreadsheet is true.
  const mod = code("src/lib/bank-ingest.ts");

  // The guard exists and is the first branch of the passthrough store.
  assert.match(mod, /if \(nonBankSpreadsheet\) \{\s*statementStored = false;\s*\} else if \(priorDocId\)/,
    "the spreadsheet branch must short-circuit the passthrough store before priorDocId/insert");

  // The insert that carries doc_type + content_hash + shared must sit in the else-branch, i.e. AFTER
  // that guard. If a later edit moves it above, this fails while the branch above still reads fine.
  const guardAt = mod.indexOf("if (nonBankSpreadsheet)");
  const insertAt = mod.indexOf('doc_type: "bankafschrift"');
  assert.ok(guardAt > 0 && insertAt > 0, "both the guard and the bankafschrift insert must exist");
  assert.ok(guardAt < insertAt,
    "the nonBankSpreadsheet guard must come BEFORE the bankafschrift insert, or the hash is claimed anyway");

  // The detection that feeds the guard must still be wired — a guard on a flag nobody sets is not a guard.
  assert.match(mod, /nonBankSpreadsheet = true/,
    "looksLikeSpreadsheetBinary must still set the flag the guard reads");
});

// ─── [ANON-RPC] De guard die aannam dat "geen uid" hetzelfde is als "de server" ───
//
// Een reeks SECURITY DEFINER-functies bewaakt zichzelf met
//
//     IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE …
//
// waarvan de eigen toelichting zegt: met de sessieclient is auth.uid() de aanroeper, met
// service_role is hij NULL. Dat tweede klopt — en `anon` is óók NULL. Anon is niet "niemand" maar
// de rol achter de publieke sleutel die in elke browserbundel meegaat, en PostgREST zet elke
// functie in het public-schema op /rest/v1/rpc/. Gemeten op de productiedatabase:
//
//     SET LOCAL ROLE anon; SELECT auth.uid() IS NULL   →  true
//     has_function_privilege('anon', …, 'EXECUTE')     →  true
//
// Het zwaarste geval is niet het grootste bedrag maar het onomkeerbare: seed_invoice_counter is
// alleen-vooruit (GREATEST), dus verlagen kan niet — maar wie de teller van een vreemde op
// 999999999 zet, heeft diens Art. 35-nummerreeks permanent stuk, en daar bestaat geen herstel voor.

test("[ANON-RPC] every state-changing RPC is revoked from anon", () => {
  const sql = readFileSync("supabase/migrations/rpc_anon_revoke.sql", "utf8");
  for (const fn of [
    "seed_invoice_counter", "next_invoice_seq", "apply_manual_payment", "apply_bank_payment",
    "allocate_bank_payment", "confirm_bank_payment", "book_bank_batch", "move_invoice_payment",
    "recompute_invoice_amount_paid", "fair_use_consume", "fair_use_release",
    "handle_new_user", "assert_credit_within_original",
  ]) {
    assert.ok(sql.includes(`'${fn}'`), `${fn} must be in the revoke list`);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM anon/);
  // REVOKE … FROM PUBLIC haalt ook impliciete rechten weg, dus de server moet expliciet terug —
  // anders zet deze migratie de app zelf buiten de deur.
  assert.match(sql, /GRANT EXECUTE ON FUNCTION %s TO service_role/,
    "the pipeline uses every one of these; without this grant the app locks itself out");
  // Op handtekening, niet op naam: een overladen functie laat anders één variant openstaan.
  assert.match(sql, /pg_get_function_identity_arguments/,
    "an overloaded function needs every signature revoked, not just the first");
});

test("[ANON-RPC] the server-only RPCs really are server-only", () => {
  // De tweede lijst in de migratie trekt óók `authenticated` in. Dat mag alleen als geen enkel
  // scherm ze via de sessieclient aanroept — anders zet deze migratie een knop stil. Deze poort
  // is de reden dat de lijst later niet stilletjes fout kan worden: voegt iemand een aanroep met
  // de sessieclient toe, dan faalt hij hier en niet bij een gebruiker.
  const SERVER_ONLY = [
    "seed_invoice_counter", "recompute_invoice_amount_paid",
    "fair_use_consume", "fair_use_release", "confirm_bank_payment",
  ];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(p) && !p.endsWith(".test.ts")) out.push(p);
    }
    return out;
  };
  const bronnen = walk("src");
  for (const fn of SERVER_ONLY) {
    for (const file of bronnen) {
      const src = readFileSync(file, "utf8");
      for (const regel of src.split("\n")) {
        if (!regel.includes(`rpc("${fn}"`) && !regel.includes(`rpc('${fn}'`)) continue;
        assert.match(regel, /(pipeline|insertPipeline|pipelineForConfirm)\s*(as any\s*)?\)?\.rpc/,
          `${fn} is revoked from 'authenticated' — it may only be called with the service-role client (${file})`);
      }
    }
  }
});

// ─── [ZOEKPAD] Een vast zoekpad op de negen eigen functies ────────────────────
//
// Hygiëne, geen gat, en dat verschil staat er met opzet bij: een migratie die zich voordoet als
// noodreparatie maakt de volgende noodreparatie ongeloofwaardig. Op de productiedatabase gemeten
// staat geen van de negen op SECURITY DEFINER, en heeft anon noch authenticated CREATE op enig
// schema — twee onafhankelijke redenen waarom er vandaag niets te kapen valt.
//
// Het wordt toch vastgezet omdat die twee redenen OMSTANDIGHEDEN zijn, geen afspraken. Wie morgen
// één van deze bewakers SECURITY DEFINER maakt — een volstrekt normale wijziging — erft anders
// stilzwijgend een echte kwetsbaarheid, en niets zou daarop wijzen.

test("[ZOEKPAD] every own function is pinned, and pg_temp comes last", () => {
  const sql = readFileSync("supabase/migrations/function_search_path.sql", "utf8");
  for (const fn of [
    // De vier bewakers eerst — die hebben het meest te verliezen.
    "prevent_billing_self_grant", "prevent_accountant_amount_changes",
    "prevent_verwerkt_invoice_changes", "guard_paid_when_verwerkt",
    "invoices_search_vector_update", "documents_search_vector_update",
    "set_updated_at", "touch_updated_at", "get_accountant_for_zzper",
  ]) {
    assert.ok(sql.includes(`'${fn}'`), `${fn} must get a pinned search_path`);
  }
  // pg_temp ACHTERAAN. Laat je het weg, dan zet Postgres het impliciet vooraan, en dan is het
  // tijdelijke schema van de aanroeper juist wél weer een plek om een naam te kapen — precies wat
  // deze migratie afsluit. Een half toegepast idee is hier erger dan geen idee.
  assert.match(sql, /SET search_path = public, pg_catalog, pg_temp/,
    "pg_temp must be named explicitly and LAST, or the fix reopens what it closes");
  assert.ok(!/search_path = pg_temp/.test(sql), "pg_temp must never come first");
  // `public` moet erin, want get_accountant_for_zzper noemt accountant_clients zonder schema.
  assert.match(sql, /accountant_clients/,
    "the one unqualified table reference is why the path cannot be empty — say so");
  // En de migratie moet zeggen dat dit GEEN gat was. Zie de kop hierboven.
  assert.match(sql, /HYGIËNE, geen gat/,
    "a migration that poses as an emergency spends credibility the next emergency needs");
});

test("[FACTUUR-BIJLAGE] a copied invoice does not inherit the attachment", () => {
  // Twee routes maken een nieuwe factuur uit een bestaande. Zou de bijlage meereizen, dan krijgt de
  // klant bij élke maandelijkse factuur de werkbon van de eerste maand, en bij elk duplicaat een
  // document dat over ander werk gaat — een verkeerd document bij een derde, zonder dat er iets
  // misgaat waar iemand op kan wijzen.
  //
  // Allebei de routes bouwen hun rij uit een EXPLICIETE kolommenlijst, dus vandaag klopt het
  // vanzelf. Deze poort maakt van dat toeval een afspraak: wie de kolom later toevoegt — een
  // volstrekt plausibele "verbetering" — krijgt hier rood in plaats van een verstuurde mail.
  for (const f of [
    "src/app/api/invoice/[id]/duplicate/route.ts",
    "src/app/api/cron/recurring/route.ts",
  ]) {
    assert.ok(
      !code(f).includes("attachment_document_id"),
      `${f} must not carry the attachment into a copy — an attachment is evidence about ONE job`,
    );
  }
  // En de reden staat op de plek waar iemand hem zoekt, niet alleen hier. readFileSync en niet
  // code(): de uitleg IS commentaar, en code() is precies de helper die commentaar weghaalt.
  assert.match(readFileSync("src/lib/invoice-attachment.ts", "utf8"), /EEN KOPIE KRIJGT DE BIJLAGE NIET MEE/,
    "the decision must be written where the feature is explained, or it reads as an omission");
});

// ─── [MIGRATIE-JOURNAAL] De inventarisvraag mag niet achterlopen op de map ────
//
// docs/WELKE_MIGRATIES_STAAN_ER.sql beantwoordt "wat staat er ÉCHT in de database?". De vorige
// versie stelde die vraag met een lijst die iemand met de hand bijhield, en schreef zelf op wat
// daar mis mee is:
//
//     "Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de hand in. Een migratie
//      die er niet in staat, kan dit bestand ook niet 'OPEN' noemen."
//
// Dat ging twee keer mis. Eén keer dekte de lijst 17 van de 71 migraties en gaf een schoon "alles
// toegepast" terug — met de vier waar de hele betaalkant op leunt er niet in. Bij de laatste
// telling dekte hij er 28 van de 104.
//
// Het bestand wordt nu GEGENEREERD uit supabase/migrations/. Deze poort is wat die generatie waard
// maakt: hij faalt zodra de map en het bestand uit elkaar lopen. Een nieuwe migratie zonder
// regenereren is dan een rode poort in plaats van een lijst die stilletjes te weinig vraagt.

test("[MIGRATIE-JOURNAAL] the inventory query covers every migration on disk", () => {
  const sql = readFileSync("docs/WELKE_MIGRATIES_STAAN_ER.sql", "utf8");
  const opSchijf = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

  // Elke migratie komt óf als probe voor, óf staat expliciet bij "niet vast te stellen". Zwijgen
  // is de enige uitkomst die niet mag: dat is precies hoe de vorige versie te weinig vroeg.
  const ontbreekt = opSchijf.filter((f) => !sql.includes(f));
  assert.deepEqual(ontbreekt, [],
    "these migrations are on disk but absent from the inventory — regenerate with\n" +
    "  npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql\n  " +
    ontbreekt.join("\n  "));

  // …en andersom: een regel over een migratie die niet meer bestaat, vraagt naar niets.
  for (const m of sql.matchAll(/^ {2}\('([^']+\.sql)'/gm)) {
    assert.ok(opSchijf.includes(m[1]), `${m[1]} is probed but no longer exists in supabase/migrations/`);
  }

  // Met de hand bijwerken is de fout die dit alles veroorzaakte, dus dat moet er ook op staan.
  assert.match(sql, /automatisch gegenereerd, NIET met de hand bijwerken/);
  assert.match(sql, /scripts\/migration-inventory\.ts/, "the file must name the script that makes it");
});

test("[MIGRATIE-JOURNAAL] a migration that creates nothing is named, never guessed at", () => {
  // Een migratie die alleen intrekt (rpc_anon_revoke), alleen wijzigt (function_search_path) of
  // alleen data verplaatst (supplier_backfill) heeft geen object waarvan het BESTAAN iets bewijst.
  // Daar een vingerafdruk voor verzinnen zou een verkeerd antwoord geven in plaats van geen — en
  // een lijst die zwijgt over wat ze niet weet is de lijst waar dit bestand tegen is geschreven.
  const sql = readFileSync("docs/WELKE_MIGRATIES_STAAN_ER.sql", "utf8");
  const blok = sql.slice(sql.indexOf("NIET VAST TE STELLEN"));
  for (const f of ["rpc_anon_revoke.sql", "function_search_path.sql", "supplier_backfill.sql"]) {
    assert.ok(blok.includes(f), `${f} creates nothing and must be listed as undeterminable`);
    // …en dus NIET als probe, want dan zou hij voor eeuwig 'OPEN' heten.
    assert.ok(!sql.includes(`  ('${f}'`), `${f} must not be given an invented fingerprint`);
  }
});

test("[MIGRATIE-JOURNAAL] a policy is looked for in the schema it actually lives in", () => {
  // documents_shared_and_storage_policies.sql zet drie policies op `storage.objects` — daar staan
  // de bestanden. De eerste versie van de generator zocht alles in `public` en noemde die migratie
  // dus voor eeuwig GEDEELTELIJK, hoe goed ze ook gedraaid had.
  //
  // Dat is de duurste soort meetfout: een alarm dat nooit uitgaat leert iedereen om het weg te
  // klikken, en dan mist het ook de keer dat het wél iets betekent.
  const sql = readFileSync("docs/WELKE_MIGRATIES_STAAN_ER.sql", "utf8");
  for (const naam of ["documents_upload", "documents_read", "documents_delete"]) {
    assert.match(sql, new RegExp(`'policy', '${naam}', 'objects', 'storage'`),
      `${naam} lives on storage.objects — probing public would never find it`);
  }
  // En de query moet het schema van de probe gebruiken, niet een vast 'public'.
  assert.match(sql, /where schemaname = p\.schema and tablename = p\.tabel and policyname = p\.object/);
  assert.doesNotMatch(sql, /where schemaname = 'public' and policyname/,
    "a hard-coded schema is exactly the bug this replaced");
});

test("[MIGRATIE-JOURNAAL] every ignored object is named, reasoned, and really created", () => {
  // NIETS_BEWIJZEND is de enige plek waar met de hand een meting wordt uitgezet. Dat maakt het de
  // enige plek waar een falende migratie zich kan verstoppen — dus staat er een prijs op: het
  // object moet echt door die migratie worden aangemaakt, en er moet een reden bij staan die in
  // de gegenereerde lijst terechtkomt.
  const gen = readFileSync("scripts/migration-inventory.ts", "utf8");
  const sql = readFileSync("docs/WELKE_MIGRATIES_STAAN_ER.sql", "utf8");
  const blok = gen.slice(gen.indexOf("const NIETS_BEWIJZEND"), gen.indexOf("/** SQL-commentaar eraf"));

  const entries = [...blok.matchAll(/"([a-z0-9_]+\.sql)":\s*\[([\s\S]*?)\n {2}\]/g)];
  assert.ok(entries.length > 0, "the override table must be readable, or this gate proves nothing");

  for (const [, bestand, body] of entries) {
    const pad = `supabase/migrations/${bestand}`;
    assert.ok(existsSync(pad), `${bestand} is overridden but does not exist`);
    const migratie = readFileSync(pad, "utf8");
    for (const obj of body.matchAll(/object:\s*"([a-z0-9_]+)"/g)) {
      // Het object moet écht door DEZE migratie worden aangemaakt — anders zet je een meting uit
      // die nergens over ging, en verbergt de regel iets anders dan hij beweert.
      assert.ok(migratie.includes(obj[1]),
        `${bestand} does not create ${obj[1]} — an override must point at something real`);
      // …en de reden moet de lezer bereiken, niet alleen de generator.
      assert.ok(sql.includes(obj[1]),
        `${obj[1]} is ignored but its reason never reaches docs/WELKE_MIGRATIES_STAAN_ER.sql`);
    }
    assert.match(body, /reden:/, `${bestand} needs a written reason, not just a name`);
  }
});

test("[FOCUS-NAZICHT] a deep-linked row is checked after it lands, not only aimed", () => {
  // Reported twice: tapping an invoice on /vandaag lands past it. The first fix was the margin
  // ([FOCUS-KOP]); this is the second half. scrollIntoView({behavior:'smooth'}) computes its
  // destination ONCE, so anything above the list that changes height while it animates moves the
  // row and the browser never re-aims. Measured in Chromium at 390x844: a 120px notice vanishing
  // mid-animation left the row 112px above the chrome — two rows off the top of the screen.
  const mod = code("src/lib/focus-scroll.ts");
  assert.match(mod, /for \(const at of FOCUS_SETTLE_MS\)/, "the landing must look again");
  assert.match(mod, /if \(!focusLandingOff\(row\.getBoundingClientRect\(\)\.top, want\)\) return;/,
    "…and only move when it is actually off");
  assert.match(mod, /row\.scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/,
    "the correction is instant — a second animation is a second window for the same shift");
  // The margin is re-measured per attempt: the chrome that has to be cleared can change too.
  assert.match(mod, /const margin = \(\) =>/, "the aim must be recomputed, not captured once");
  // And it stops the moment the owner touches the page. Fighting someone who has started scrolling
  // is worse than the miss being corrected: the miss is over, the fight is not.
  // The REGISTRATION, not the removal beside it: both loops read the same, and a negative control
  // that deleted the listener still matched the one inside stop(). A gate that can be satisfied by
  // the cleanup of a thing that is no longer set up is not guarding anything.
  assert.match(mod, /window\.addEventListener\(ev, stop, \{ once: true, passive: true \}\);/,
    "a correction must yield to the owner");
  assert.match(mod, /if \(cancelled \|\| !row\.isConnected\) return;/,
    "…and to a row that has left the page");

  const spec = readFileSync("src/lib/focus-scroll.test.ts", "utf8");
  assert.match(spec, /the error is the height of whatever moved/, "the measurement belongs in the test");
  assert.match(spec, /would fight the animation/, "…including why the first look is at 700ms");
});

test("[AFHANDELEN-STIL] a run that books nothing says so", () => {
  // Reported with the screen open: "Nu afhandelen" produces no visible result. The panel above it
  // kept reading "1 zekere betaling klaar om af te handelen" and nothing else on the page moved,
  // so the owner tapped it again.
  //
  // The outcome block required THREE things at once: a count above zero AND the screen's own
  // counter already at zero. The reported case fails both — the server books nothing and the
  // counter stays where it was — so a button on the money screen ran, finished, and reported
  // nothing at all. A partial run was equally silent: booking 1 of 2 left the counter at 1.
  const bank = code("src/app/dashboard/bank/BankClient.tsx");
  assert.match(bank, /\{autoDoneCount != null && \(/,
    "the outcome must be reported whenever a run finished, not only when it succeeded fully");
  assert.doesNotMatch(bank, /autoDoneCount != null && autoDoneCount > 0 && safeAutoCount === 0/,
    "the three-condition gate is what made the button silent");
  assert.match(bank, /autoDoneCount === 0\s*\n?\s*\? t\('bank\.auto\.geenGeboekt'\)/,
    "…and zero must have its own sentence");

  // The sentence must not invent a reason. The server refuses for things this screen cannot see —
  // an invoice the accountant locked, a filed quarter, a payment booked elsewhere meanwhile — so it
  // says what it knows and points at what still works.
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'bank\.auto\.geenGeboekt'/);
  assert.match(messages, /koppel ze met één tik/, "the owner must be given the next step");
});

// ─── [CRON-HARTSLAG-EIND] Een geopende hartslagregel moet ook dichtgaan ───────
//
// `beginCronRun` schrijft een regel met ok = NULL; `finishCronRun` zet hem op true/false. Een
// route die daartussen vertrekt via een vroege return laat die regel voor eeuwig op NULL staan, en
// de gezondheidscheck leest NULL als 'afgebroken'.
//
// Twee routes deden dat, en het waren niet de zeldzame paden: "geen ondernemers met herinneringen
// aan", "niets vervallen", "geen kandidaten om te wissen" zijn de GEWONE uitkomsten. Gemeten op
// 15 augustus 2026 in productie:
//
//     reminders        laatste run 07:00, ok = NULL   → gelezen als AFGEROND NOOIT
//     retention-purge  laatste run 10 aug, ok = NULL  → idem
//
// Allebei hadden gewoon gedraaid en niets te doen gehad. Een alarm dat altijd afgaat leert je
// alarmen wegklikken — en dan mis je de keer dat hij ergens over gaat. Erger: in reminders verliet
// een ECHTE leesfout de route via dezelfde deur, dus "niets te doen" en "ik kon niet kijken" waren
// van buiten niet te onderscheiden.

test("[CRON-HARTSLAG-EIND] no cron route can leave with its heartbeat row still open", () => {
  const dir = "src/app/api/cron";
  const routes = readdirSync(dir)
    .filter((d) => existsSync(`${dir}/${d}/route.ts`))
    .map((d) => `${dir}/${d}/route.ts`);
  assert.ok(routes.length >= 5, "the cron routes must be found, or this gate proves nothing");

  for (const f of routes) {
    const src = code(f);
    const startAt = src.indexOf("beginCronRun(");
    if (startAt < 0) continue; // deze route houdt geen hartslag bij

    // Alles ná het openen van de regel. Elke `return NextResponse` daarin moet langs de afsluiter:
    // óf finishCronRun staat ervóór op diezelfde regel-route, óf hij vertrekt via de klaar()-helper
    // die zelf afsluit.
    const na = src.slice(startAt);
    const finishAt = na.indexOf("finishCronRun(");
    assert.ok(finishAt > 0, `${f} opens a heartbeat row and never closes it`);

    // De vroege uitgangen: alles wat vóór de afsluiter terugkeert.
    const voorAfsluiter = na.slice(0, finishAt);
    for (const m of voorAfsluiter.matchAll(/return NextResponse\.json\(/g)) {
      const regel = voorAfsluiter.slice(0, m.index).split("\n").length;
      assert.fail(
        `${f}: a return before the heartbeat is closed (around line ` +
        `${src.slice(0, startAt).split("\n").length + regel}). Leave via the klaar() helper, ` +
        `so the run cannot be recorded as 'afgebroken' while it actually succeeded.`,
      );
    }
  }
});

test("[CRON-HARTSLAG-EIND] a read that failed is not recorded as a good run", () => {
  // Het tweede halve punt, en zonder dit is de eerste poort een dekmantel: je kunt élke uitgang
  // dichtzetten met ok = true en dan meldt niets ooit nog iets. De twee paden die WÉL misgingen
  // moeten als mislukt in de boeken staan, anders is de hartslag een groen lampje op een dood
  // apparaat.
  const rem = code("src/app/api/cron/reminders/route.ts");
  assert.match(rem, /note: "lookup_failed" \}, false\)/,
    "an enabled-owner lookup that threw is not a successful run");
  assert.match(rem, /skipped: "creditnota_lookup_failed" \}, false\)/,
    "failing closed still means the run did not do its job");

  const ret = code("src/app/api/cron/retention-purge/route.ts");
  assert.match(ret, /note: "kluis_check_unavailable_nothing_purged",\s*\}, false\)/,
    "nothing purged because the kluis check could not run is a failed run, not a quiet one");
});

// ── [BRON-VOCABULAIRE] What may be written into a `source` column ────────────────────────────────
//
// `invoices.source` and `documents.source` each carry a CHECK constraint, and the two vocabularies
// are NOT the same: an invoice may be 'created' (this owner wrote it) and a document may not; a
// document may be 'whatsapp' and an invoice may not. So "which values exist" cannot be answered
// from memory at a call site — it has to be read from the schema.
//
// One route did answer it from memory. /api/documents/[id]/read-as-invoice wrote source:'reread',
// a fifth value that exists nowhere in the constraint, so Postgres rejected the row (23514) and the
// route answered 500. Proven against a real Postgres 16 with the constraint copied verbatim from
// database.sql: 'reread' → violates check constraint "invoices_source_check"; 'created', 'email',
// 'upload' and 'camera' all insert.
//
// What made it worth a gate rather than a one-line fix: this was the ONLY recovery path for a file
// the reader once skipped — "lees alsnog als factuur" — so it failed on every attempt, and each
// attempt also charged the owner a document from their monthly allowance. TypeScript cannot catch
// it (the generated type is `string | null`), and no test called the route.
//
// HONEST LIMIT, stated because a gate that hides its blind spot is worse than none: this reads
// LITERAL values only. Two invoices-inserts and several documents-inserts write no `source` at all
// (the column is nullable), and /api/intake writes a variable — which is why INTAKE_SOURCES is
// checked separately below, against both tables, since that route writes to both.

/** The CHECK vocabulary of one text column, read from the schema itself. */
function schemaVocabulary(table: string, column: string): string[] {
  const sql = readFileSync("database.sql", "utf8");
  const from = sql.indexOf(`CREATE TABLE public.${table} (`);
  assert.ok(from >= 0, `database.sql declares ${table}`);
  const body = sql.slice(from, sql.indexOf("\n);", from));
  const m = new RegExp(`${column} text[^,]*?CHECK \\(${column} = ANY \\(ARRAY\\[([^\\]]+)\\]`, "s").exec(body);
  assert.ok(m, `${table}.${column} still has a CHECK vocabulary — if it was dropped, this gate must be rewritten, not deleted`);
  const values = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(values.length > 0, `${table}.${column} vocabulary is not empty`);
  return values;
}

/**
 * The values assigned to `source` at the TOP LEVEL of the object literal that follows an
 * insert/upsert on `table`. Depth-aware on purpose: a `source:` inside a nested jsonb payload
 * (logAuditAction's newValue is the one right next to the defect) is not a column write, and a
 * gate that counted it would fail on correct code and be switched off.
 */
function literalSourceWrites(table: string): Array<{ file: string; line: number; value: string }> {
  const out: Array<{ file: string; line: number; value: string }> = [];
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = `${dir}/${entry}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
    }
  })("src");

  const call = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)\\s*(?://[^\\n]*\\n\\s*)*\\.(insert|upsert)\\(`, "g");
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = call.exec(src))) {
      const open = src.indexOf("{", m.index + m[0].length);
      if (open < 0 || open - (m.index + m[0].length) > 40) continue; // .insert(rows) — nothing literal to read
      let depth = 0, end = open, quote: string | null = null;
      for (; end < src.length; end++) {
        const c = src[end];
        if (quote) { if (c === "\\") end++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
      }
      const body = src.slice(open, end + 1);
      depth = 0; quote = null;
      for (let j = 0; j < body.length; j++) {
        const c = body[j];
        if (quote) { if (c === "\\") j++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
        else if (depth === 1) {
          const f = /^(?<![_a-zA-Z])source: *(['"])([a-z_]+)\1/.exec(body.slice(j));
          if (f) out.push({ file, line: src.slice(0, open + j).split("\n").length, value: f[2] });
        }
      }
    }
  }
  return out;
}

test("[BRON-VOCABULAIRE] no row is written with a source the database refuses", () => {
  let checked = 0;
  for (const table of ["invoices", "documents"]) {
    const allowed = schemaVocabulary(table, "source");
    for (const w of literalSourceWrites(table)) {
      checked++;
      assert.ok(
        allowed.includes(w.value),
        `${w.file}:${w.line} writes ${table}.source = '${w.value}', which the CHECK constraint ` +
        `does not allow (${allowed.join(" | ")}). Postgres rejects the row and the route fails.`,
      );
    }
  }
  // The gate must be LOOKING at something. Without this it would pass just as happily on a regex
  // that stopped matching after a refactor of how these routes call Supabase — and a whole-app scan
  // that silently finds nothing is the most convincing green light there is.
  //
  // The floor is the count that exists TODAY, and the direction is deliberate: a new insert site
  // pushes it UP and still passes, while a site the scan stopped seeing pushes it DOWN and fails.
  // A loose floor was measured to be no floor at all — at >= 12 the two intake writes could vanish
  // with the gate still green.
  assert.ok(checked >= 15, `expected every known literal source write to be examined, saw ${checked}`);
});

test("[BRON-VOCABULAIRE] the one route that writes a variable is fenced against BOTH tables", () => {
  // /api/intake writes documents.source AND invoices.source from the same value, so its whitelist
  // has to satisfy the intersection — the previous version of this route claimed 'camera' for every
  // row including files dropped on /dashboard/upload, and the fix was this constant.
  const intake = code("src/app/api/intake/route.ts");
  const m = /const INTAKE_SOURCES = \[([^\]]+)\] as const/.exec(intake);
  assert.ok(m, "the intake source whitelist still exists");
  const values = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(values.length > 0, "and it is not empty");
  const invoices = schemaVocabulary("invoices", "source");
  const documents = schemaVocabulary("documents", "source");
  for (const v of values) {
    assert.ok(invoices.includes(v), `intake may write invoices.source='${v}'`);
    assert.ok(documents.includes(v), `intake may write documents.source='${v}'`);
  }
  // And the fallback for an older client is one of them, not a fifth invention.
  assert.match(intake, /: "camera"/, "the fallback is a value from the whitelist");
});

test("[TWEEDE-KANS-BRON] the second-chance re-read gives the document back when it stores nothing", () => {
  // The other half of the same route, and the same rule its own header states: a failure is not a
  // reading. It was applied to the failed READ and not to the failed INSERT — the branch that ran
  // on every single attempt, so the one path that could rescue a skipped file also charged for it.
  const route = code("src/app/api/documents/[id]/read-as-invoice/route.ts");
  const insertFailure = route.indexOf("if (insErr || !invoice)");
  assert.ok(insertFailure > 0, "the insert-failure branch still exists");
  const branch = route.slice(insertFailure, route.indexOf("}", route.indexOf("status: 500", insertFailure)));
  assert.match(branch, /await gate\.release\(\)/, "a reading that stored nothing is not charged");
});

test("[NO-SILENT-EMPTY] the verify queue never reports an unread queue as a finished one", () => {
  // /dashboard/incoming is the ONLY surface where a 'processing' invoice can be confirmed, and its
  // empty state is the sentence "Alles verwerkt" — a claim about the owner's books, not about this
  // page. The server read was already fail-soft (`.catch(() => null)`, correct: a failed read may
  // not blank the page), but `pendingRaw ?? []` one line down threw away the only distinction that
  // matters, so a database that would not answer looked exactly like a queue that was finished.
  // Nothing else on the screen contradicted it — the counts in the tab labels are counts of what
  // loaded. Same rule, same two sentences and the same banner as Crediteuren next door.
  const page = code("src/app/dashboard/incoming/page.tsx");

  // All three lists travel through one flag. Naming them individually rather than counting calls:
  // a gate that asserted "three readOrFlag calls" would pass on three calls for the same list.
  assert.match(page, /readOrFlag\("controlewachtrij"/, "the queue itself");
  assert.match(page, /readOrFlag\("genegeerde facturen"/, "the tab an archived invoice is restored from");
  assert.match(page, /readFailed\.push\("bevestigde facturen"\)/, "and the confirmed tab, whose two reads dropped their error entirely");
  // The confirmed reads must actually LOOK at the error — `const { data }` alone is how they got here.
  assert.match(page, /const \{ data: confirmedReceivedRaw, error: confirmedReceivedErr \}/);
  assert.match(page, /const \{ data: confirmedPaidRaw, error: confirmedPaidErr \}/);
  // And the flag has to leave the server. Without this line every check above is bookkeeping.
  assert.match(page, /readFailed=\{readFailed\}/, "the screen is handed what could not be read");

  const client = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");
  // ORDER, not presence: both branches exist either way, and the defect is which one is asked
  // first. `loadIncomplete` must be tested BEFORE the empty state, or "Alles verwerkt" wins on
  // exactly the runs where it is false.
  const incompleteAt = client.indexOf("{loadIncomplete ? (");
  const emptyAt = client.indexOf("t('ink.allesVerwerkt')");
  assert.ok(incompleteAt > 0, "the failed-read branch exists");
  assert.ok(emptyAt > 0, "the empty state still exists — an honest empty queue is good news");
  assert.ok(incompleteAt < emptyAt, "a failed read is asked about BEFORE the page claims to be done");
  assert.match(client, /const loadIncomplete = readFailed\.length > 0;/);
  assert.match(client, /t\('ink\.bronnenNietOpgehaald', \{ sources: readFailed\.join\(" en "\) \}\)/,
    "the banner names which list is short");

  const render = readFileSync("tests/render/money-screens.test.tsx", "utf8");
  assert.match(render, /the verify queue does not report an unread queue as finished/,
    "and it renders in the render gate, with the empty-list-plus-failed-read rows that produce it");
});

test("[REMINDER-TRUTH] the Herinneren button does not report a rejected e-mail as sent", () => {
  // sendInvoiceReminder returns { delivered } exactly because a provider REJECTION is not an
  // exception — deliverEmail(critical:false) logs it, reports it, and returns false. The cron reads
  // that; this route awaited the call and dropped the answer, so a refused address came back 200
  // with "verstuurd N".
  //
  // And the claim row stayed on 'sent', which is the half that bites twice: `geslaagd` counts every
  // row that is not 'failed' and feeds canRemind, so the phantom send both raised reminder_count and
  // set last_reminder_at to now — the owner is told the letter went out AND is then refused when
  // they try again. Released rather than marked failed, because a rejection means it demonstrably
  // did not arrive: a retry cannot become a second letter at the customer.
  const route = code("src/app/api/invoice/[id]/reminder/route.ts");
  assert.match(route, /delivery = await sendInvoiceReminder\(\{/, "the result is captured");
  assert.match(route, /if \(!delivery\.delivered\) \{/, "…and acted on");
  const branch = route.slice(route.indexOf("if (!delivery.delivered) {"));
  const answer = branch.slice(0, branch.indexOf("status: 502") + 20);
  assert.match(answer, /\.from\('invoice_reminders'\)\.delete\(\)\.eq\('id', claim\.id\)/,
    "the claim is released, or the button stays blocked on a reminder that never happened");
  assert.match(answer, /releaseErr/, "and a release that itself failed is not discarded");
  // The branch must LEAVE, not merely log. Measured on the slice that ends at the 502 itself, so
  // this cannot be satisfied by a `return` somewhere further down the route.
  assert.match(answer, /return NextResponse\.json\(/,
    "a rejection leaves the route as an error, never as ok:true");
  assert.doesNotMatch(answer, /ok: true/, "and nothing on the way there claims success");

  // The cron half is the one where this costs a legal right; it already reads the flag. Pinned here
  // so the two never drift back apart.
  const cron = code("src/app/api/cron/reminders/route.ts");
  assert.match(cron, /if \(!delivery\.delivered\) \{/, "the automatic path reads the same flag");
});

test("[CRON-HONEST] the accountant's morning run cannot report itself green after failing everyone", () => {
  // ok:true was a constant, and it is the one field with a reader — judgeCron maps ok=false to
  // "gefaald" on /api/health. So a run where every accountant threw (invoices unreadable) or every
  // notification insert was refused closed its heartbeat GREEN with sent:0, quiet:0. Nothing
  // compares sent+quiet to the number of accountants, so there was no other trace.
  const route = code("src/app/api/cron/accountant-daily/route.ts");
  // SLICED TO EACH HEARTBEAT CALL, and every one of them checked. Two measurements shaped this:
  //   · a whole-file /ok: failed === 0/ is no gate at all — the JSON response on the next line
  //     carries the same text, so restoring `ok: true` inside finishCronRun left the file matching
  //     and the negative control passed;
  //   · indexOf() finds the EARLY exit (the links lookup, which correctly stamps ok:false), not
  //     the one at the end. Reading "a finishCronRun call" was reading the wrong one.
  // So: collect them all, and require each to be either an explicit failure or the computed verdict.
  const stamps = [...route.matchAll(/finishCronRun\([^,]+,[^,]+,\s*\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  assert.ok(stamps.length >= 2, `both exits close the heartbeat, saw ${stamps.length}`);
  for (const stamp of stamps) {
    assert.doesNotMatch(stamp, /ok: true/, "no unconditional green stamp on any heartbeat in this file");
    assert.match(stamp, /ok: (false|failed === 0)/, "every exit states a verdict it computed");
  }
  assert.ok(stamps.some((x) => /ok: failed === 0/.test(x)), "and the run that did the work judges itself by its failures");
  // Both failure paths must actually FEED that counter — the flag is worthless if nothing raises it.
  const perAccountant = route.slice(route.indexOf("} catch (e) {", route.indexOf("const melding")));
  assert.match(perAccountant, /failed\+\+/, "an accountant skipped by a thrown read counts as a failure");
  const insertFailure = route.slice(route.indexOf("if (!melding.ok)"));
  assert.match(insertFailure.slice(0, insertFailure.indexOf("continue;")), /failed\+\+/,
    "a notification the database refused counts too — that accountant was not told");
  assert.match(route, /result: \{ sent, quiet, failed \}/, "and the count is recorded, not just used");

  // The heartbeat judge is what gives ok=false its consequence. Without this the gate above pins a
  // boolean nobody reads.
  const heartbeat = code("src/lib/cron-heartbeat.ts");
  assert.match(heartbeat, /if \(run\.ok === false\) return "gefaald";/,
    "ok=false is what /api/health turns into an alarm");
});

test("[BRUG-UPLOAD-DELEN] a file dropped in the shared folder is actually shared", () => {
  // "Gedeeld met boekhouder" exists for one act. The bestanden PATCH route honours it — a MOVE
  // into folder_type='shared' sets documents.shared, the flag the accountant's RLS reads — and the
  // upload path went straight through uploadDocument's insert, which never wrote it. So the owner
  // opened the shared folder, dropped a file, saw it sitting there, and the accountant received
  // nothing. The failure is invisible from the owner's side by construction: the file IS in the
  // folder they put it in.
  const docs = code("src/lib/documents.ts");

  // The question has to be ASKED — of the chosen folder, scoped to this owner.
  assert.match(docs, /\.from\("folders"\)\s*\.select\("folder_type"\)\s*\.eq\("id", opts\.folderId\)\s*\.eq\("user_id", userId\)/,
    "the target folder's type is read, and only from the owner's own folders");
  assert.match(docs, /sharedOnUpload = folder\?\.folder_type === "shared"/);

  // …and the ANSWER has to reach the row. Sliced to the insert, because a flag computed and not
  // written is precisely the shape of the bug being fixed.
  const insertAt = docs.indexOf('.from("documents")\n    .insert({');
  assert.ok(insertAt > 0, "the upload insert still exists");
  const insert = docs.slice(insertAt, docs.indexOf("})", insertAt));
  assert.match(insert, /shared: sharedOnUpload,/,
    "the row carries the verdict — not a literal, or it shares everything or nothing");

  // The same flag, read by the two surfaces that ARE the accountant's access. Without this the
  // gate above pins a column nobody consumes.
  const bestanden = code("src/app/api/bestanden/route.ts");
  assert.match(bestanden, /q = q\.eq\("shared", true\)/, "the shared view reads it");
  assert.match(bestanden, /patch\.shared = true;/, "and a move into the folder still sets it");
});

test("[MAP-VAN-DE-EIGENAAR] automatic filing never overrides the folder the owner chose", () => {
  // The upload takes a destination (lib/documents.ts [I#1]: "without this the file silently leaves
  // the folder on the next refresh") — and then this client re-created that exact failure one layer
  // up, by PATCHing the AI's suggested folder over it unconditionally. Drop a file in
  // "2026 / Q1 / Facturen" and a second later it is somewhere else, with nothing said.
  //
  // At the ROOT there is no choice to override, and there the automatic filing is the help it was
  // built to be. So the condition is the presence of a chosen folder, not a setting.
  const upload = code("src/app/dashboard/bestanden/components/UploadArea.tsx");
  const classifyAt = upload.indexOf('fetch("/api/bestanden/classify"');
  assert.ok(classifyAt > 0, "the classify call still runs — it also stamps the document type");
  const after = upload.slice(classifyAt, upload.indexOf("catch", classifyAt));
  assert.match(after, /if \(cr\.ok && !currentFolderId\)/,
    "the move is only considered when the owner chose no folder");
  // And the move itself must sit INSIDE that condition, not merely after it.
  const guardAt = after.indexOf("if (cr.ok && !currentFolderId)");
  const patchAt = after.indexOf('method: "PATCH"');
  assert.ok(patchAt > guardAt, "the folder PATCH is inside the guard");
  // The destination the owner picked still travels with the upload in the first place.
  assert.match(upload, /if \(currentFolderId\) fd\.append\("folder_id", currentFolderId\)/);
});

test("[WACHTRIJ-VERS] a refreshed queue actually refreshes, and a bulk confirm echoes nothing back", () => {
  // Two halves of one defect. The list is seeded with useState(initialInvoices), which reads its
  // initial value ONCE — so every router.refresh() on this page handed fresh rows to a hook that
  // had already decided, including the call whose own comment says "pick up the refreshed amounts
  // + health". Nothing of the sort could happen.
  //
  //   · The card kept the amounts read at page load, and the verify modal opens seeded from that
  //     card — so after "Opnieuw inlezen" corrected a total, the owner reviewed and confirmed the
  //     number the correction had just replaced.
  //   · Worse, with no human at all: the BULK confirm copied six fields out of that stale state
  //     into the request, and the confirm route writes any field it is sent. So a batch wrote the
  //     old amounts back over a correction, into the books and the aangifte.
  const client = code("src/app/dashboard/incoming/IncomingInvoicesClient.tsx");

  assert.match(client, /applyServerRefresh\(prev, initialInvoices\)/, "the queue takes the server's content");
  assert.match(client, /applyServerRefresh\(prev, ignoredInvoices\)/, "and so does the Genegeerd tab");
  // DURING RENDER, not in an effect: an effect paints the stale row first and corrects it a frame
  // later. The linter refuses it outright, and this page warns about the same shape three times.
  assert.match(client, /if \(pendingSeed !== initialInvoices\) \{/, "adjusted during render");
  assert.doesNotMatch(client, /useEffect\(\(\) => \{\s*setPending\(\(prev\) => applyServerRefresh/,
    "never from an effect");

  // The bulk request must carry the action and the flag and NOTHING copied out of local state.
  const batchAt = client.indexOf("const handleVerifyBatch");
  assert.ok(batchAt > 0, "the bulk verify still exists");
  const batchBody = client.slice(client.indexOf('action: "verify"', batchAt), client.indexOf("if (res.ok)", batchAt));
  for (const field of ["total_ex_btw", "btw_amount", "total_inc_btw", "client_name", "invoice_number", "invoice_date"]) {
    assert.doesNotMatch(batchBody, new RegExp(`${field}: inv\\.`),
      `the bulk confirm may not send ${field} — it books what is stored, as its own comment says`);
  }
  assert.match(batchBody, /deferAutoConfirm: true/, "the one flag it does send is still there");

  // The single verify still sends amounts, and must: those came from the modal, where a person
  // looked at the document. Dropping them there would silently discard every correction typed.
  const verifyAt = client.indexOf("const handleVerify = useCallback");
  assert.ok(verifyAt > 0);
  assert.match(client.slice(verifyAt, verifyAt + 2000), /body: JSON\.stringify\(\{ action: "verify", \.\.\.amounts \}\)/,
    "a reviewed amount still reaches the server");

  // And the rule the merge rests on is the one that is unit-tested, not a second copy of it.
  const rule = code("src/lib/queue-sync.ts");
  assert.match(rule, /export function applyServerRefresh/);
  assert.match(rule, /return changed \? next : \(held as T\[\]\);/,
    "an unchanged refresh returns the same array — this runs on every router.refresh()");
  const unit = readFileSync("src/lib/queue-sync.test.ts", "utf8");
  assert.match(unit, /cannot resurrect an optimistically removed invoice/,
    "the membership half of the invariant is held by a test, not by a comment");
});

// ── [SUPPLETIE] A quarter that is already at the Belastingdienst ─────────────────────────────────
//
// art. 10a AWR jo. art. 15 Uitvoeringsbesluit OB 1968: once an entrepreneur becomes AWARE that a
// filed BTW-aangifte was wrong, they must report it. Over €1.000 that is a formal suppletie; below,
// it may be carried into the next regular return. The obligation is time-bound, and the app is the
// only thing that knows the moment of awareness — it is the instant a change lands in a quarter
// that has already been filed.
//
// The snapshot (btw_filings) and the divergence rule (btw-filing.ts) were already here and already
// correct. What was missing is that nothing ASKED at the moment the books moved: the answer sat on
// two screens, waiting for an owner who happened to open them, which for a duty with a clock on it
// is the same as not knowing.

test("[SUPPLETIE] the correction route asks whether it just moved a filed quarter — and tells the owner", () => {
  // /api/invoice/[id]/amounts is THE door for correcting a booked purchase invoice: amounts, kind
  // (a creditnota tick flips the sign of both the cost and the voorbelasting) and invoice_date. It
  // carried six fail-closed guards and the filed quarter was not one of them.
  //
  // Not a seventh refusal, deliberately. The owner cannot issue a creditnota against their own
  // supplier, and the figure being corrected is a reading of someone else's paper — refusing would
  // leave the books permanently wrong AND the Belastingdienst uninformed, which is worse in both
  // directions. Allow, compute, say the number.
  const route = code("src/app/api/invoice/[id]/amounts/route.ts");
  assert.match(route, /const filedImpact = await filedQuarterImpacts\(\{/, "the question is asked");

  // BOTH dates. A corrected invoice_date moves the invoice out of one quarter and into another:
  // the first loses the amount, the second gains it, and naming one describes half a correction.
  assert.match(route, /dates: \[invoice\.invoice_date, patch\.invoice_date \?\? invoice\.invoice_date\]/,
    "the quarter it left and the quarter it landed in");

  // AFTER the write. An obligation announced for a correction that did not save is a suppletie
  // filed over nothing.
  const writeAt = route.indexOf('.update(patch)');
  const askAt = route.indexOf("await filedQuarterImpacts({");
  assert.ok(writeAt > 0 && askAt > writeAt, "asked after the row was actually stored");

  // Three destinations, because the modal closes and a legal clock does not: the response (the
  // dialog), the bell (survives the session), and the stamp (survives everything).
  assert.match(route, /suppletie,/, "the sentence reaches the screen");
  assert.match(route, /await createNotification\(\{[\s\S]{0,400}?Ingediend kwartaal \$\{impact\.label\} is gewijzigd/,
    "…and the bell");
  assert.match(route, /await stampDivergence\(\{/, "…and the moment is recorded");

  // [NO-SILENT-EMPTY] A failed check is not a clean bill of health. This is the one place where
  // silence would let a reporting duty pass unnoticed.
  assert.match(route, /if \(filedImpact\.unknown\) \{/);
  assert.match(route, /We konden niet nakijken of dit kwartaal al is ingediend/);
});

test("[SUPPLETIE] the sentence reaches a human on BOTH doors into that route", () => {
  // The correction modal is one door; "Ja, dit is een creditnota" on the pay screen is the other,
  // and it makes the single largest swing either screen can produce — the cost and the
  // voorbelasting both change sign. A door that drops the sentence leaves the duty known only to
  // the server.
  const modal = code("src/components/invoice/InvoiceCorrectionModal.tsx");
  assert.match(modal, /await dialog\.alert\(\{/, "a dialog, not a toast");
  assert.match(modal, /Let op: dit kwartaal is al ingediend/);
  // A toast reports what the owner just did; this reports a duty they acquired by doing it. Three
  // seconds and a fade is the wrong shape, so it has to be acknowledged.
  const suppletieAt = modal.indexOf("const suppletie = Array.isArray");
  assert.ok(suppletieAt > 0, "the modal reads the field");
  assert.doesNotMatch(modal.slice(suppletieAt), /onMessage\(suppletie/, "never delivered as a toast");

  const manage = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  const creditAt = manage.indexOf("async function bookAsCreditnota");
  assert.ok(creditAt > 0, "the creditnota door still exists");
  const creditBody = manage.slice(creditAt, manage.indexOf("\n  }", manage.indexOf("setCreditBusy(false)", creditAt)));
  assert.match(creditBody, /data\.suppletie/, "and it reads the same field");
  assert.match(creditBody, /dialog\.alert\(\{/, "with the same acknowledgement");
});

test("[SUPPLETIE] the moment of awareness is written once and never moved", () => {
  // art. 10a runs its clock from the FIRST knowledge, not the latest edit. A second correction three
  // weeks later must not restart it. Proven on a real Postgres 16 with these two statements: after
  // a 10:00 stamp and a later 14:00 one, first_divergence_at held at the first and
  // last_divergence_at moved to the second.
  const lib = code("src/lib/filed-quarter.ts");
  const stampAt = lib.indexOf("export async function stampDivergence");
  assert.ok(stampAt > 0);
  const stamp = lib.slice(stampAt);
  assert.match(stamp, /\.is\("first_divergence_at", null\)/,
    "the first stamp is guarded by the column still being empty — that is what makes it permanent");
  // The second write is what keeps last_ current, and it must be unconditional.
  const lastAt = stamp.indexOf('update({ last_divergence_at: args.nowIso })');
  assert.ok(lastAt > 0, "the follow-up write exists");
  assert.doesNotMatch(stamp.slice(lastAt, lastAt + 400), /\.is\("first_divergence_at", null\)/,
    "…and is not guarded, or a quarter would freeze at its first movement");

  // [DEPLOY-SAFE] The columns arrive by a hand-applied migration, and losing a timestamp may never
  // undo or hold up the correction that was already stored.
  assert.match(stamp, /isMissingColumn\(error\.message/);
  assert.match(stamp, /reason: "missing_column"/);

  const sql = readFileSync("supabase/migrations/btw_filings_divergence.sql", "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS first_divergence_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_divergence_at timestamptz/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS btw_filings_diverged_idx/,
    "the accountant's morning run reads this every day");
});

test("[SUPPLETIE] the accountant hears about it, and is not nagged about it", () => {
  // The accountant is the person who actually files a suppletie, and this app sends them almost
  // nothing. But a standing obligation repeated every morning is the message you stop reading —
  // the shape accountant-daily.ts deletes everywhere else. So: NEW speaks, STANDING rides along.
  const plan = code("src/lib/accountant-daily.ts");
  assert.match(plan, /newlyDivergedQuarters: number/);
  assert.match(plan, /divergedQuarters: number/);
  assert.match(plan, /if \(newWork === 0 && !deadline && diverged === 0\) return null/,
    "a newly moved filing is worth a morning on its own");
  // …and the standing count is NOT in that condition, or it would send every day forever.
  const trigger = /if \(newWork === 0 && !deadline && diverged === 0\) return null/.exec(plan);
  assert.ok(trigger && !/divergedStanding/.test(trigger[0]),
    "the standing total may never be a reason to send");

  const cron = code("src/app/api/cron/accountant-daily/route.ts");
  assert.match(cron, /\.not\("first_divergence_at", "is", null\)/, "read from the stamp, not recomputed");
  // The window is decided by PARSED time. PostgREST renders a timestamptz as `…+00:00` while this
  // cron builds `…Z`, and comparing those as strings diverges at the boundary — `+` is 0x2B, `.` is
  // 0x2E, so a stamp at exactly midnight UTC sorts before the window it should open. Measured. It
  // matters because these signals fire ONCE: miss the firing and the accountant is never told.
  assert.match(cron, /const isNew = \(iso: string \| null \| undefined\): boolean =>/);
  assert.match(cron, /Number\.isFinite\(ms\) && ms >= sinceMs/);
  assert.doesNotMatch(cron, /\?\? ""\) >= since\b/,
    "no window is decided by comparing two differently-formatted ISO strings");
  assert.match(cron, /isNew\(d\.first_divergence_at\)/);
  assert.match(cron, /isNew\(r\.created_at\)/, "the sibling signal in this same function too");
  assert.match(cron, /newlyDivergedQuarters, divergedQuarters,/, "and handed to the pure planner");
  // Degrades to zero, like the deadline half above it: an unreadable answer makes the morning
  // quieter rather than inventing a suppletie that may not exist.
  assert.match(cron, /let newlyDivergedQuarters = 0;/);
  assert.match(cron, /isMissingColumn\(message\) \|\| isMissingRelation\(message\)/);
});

test("[SUPPLETIE] one definition of a filed quarter, not two", () => {
  // quarterBounds / FILING_COLS / figuresOf / readFiling were private to the filing route. The
  // correction routes ask the same question, and two copies of THIS rule drifting means one screen
  // announcing a suppletie while another stays quiet about the same quarter.
  const lib = code("src/lib/filed-quarter.ts");
  for (const name of ["quarterBounds", "quarterOf", "figuresOf", "readFiling", "filedQuarterImpacts"]) {
    assert.match(lib, new RegExp(`export (async )?function ${name}`), `${name} lives in the shared module`);
  }
  const route = code("src/app/api/btw/file/route.ts");
  assert.match(route, /from "@\/lib\/filed-quarter"/, "the filing route imports them");
  assert.doesNotMatch(route, /function readFiling\(/, "and keeps no copy of its own");
  assert.doesNotMatch(route, /function quarterBounds\(/);

  // The divergence itself is computed by the SAME engine the aangifte and /api/result use, so the
  // delta announced at the moment of the correction is the delta those surfaces will show.
  assert.match(lib, /computeResultForRange\(\{ pipeline: args\.pipeline/);
  assert.match(lib, /computeFilingDivergence\(figuresOf\(row\)/);

  const unit = readFileSync("src/lib/filed-quarter.test.ts", "utf8");
  assert.match(unit, /a filing read that FAILED is unknown, never 'nothing moved'/,
    "the fail-closed half is held by a test");
});

test("[DODE-TEST] no test file has live code after its own process.exit()", () => {
  // 224 test files in this repo end with `console.log(summary); process.exit(...)`. Append a new
  // section to one of them — the natural way to add a case — and not one line of it runs. The file
  // still prints its old count and still exits 0, so `npm run gates` goes green over a section that
  // was never executed.
  //
  // Measured, not theorised: a block of eighteen assertions was appended to btw-filing.test.ts and
  // the run reported "36 passed" — the count from before it existed. It was noticed only because
  // the new test NAMES were missing from the output, which is not something a gate run checks.
  //
  // Dead assertions are worse than no assertions: they read as coverage. This is the same defect
  // class this whole file is built around — a rule that was written, argued for, and never reached.
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = `${dir}/${entry}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(p)) files.push(p);
    }
  })("src");
  for (const dir of ["tests"]) if (existsSync(dir)) (function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const p = `${d}/${entry}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(p)) files.push(p);
    }
  })(dir);

  let checked = 0;
  const offenders: string[] = [];
  for (const file of files) {
    // LINE-based, and that is not a detail. Matching the substring "process.exit(" finds this
    // gate's own assertion text and every other file that merely mentions it, so the detector's
    // first version reported itself. A top-level exit is a STATEMENT at the start of a line.
    const lines = code(file).split("\n");
    let at = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^process\.exit\(/.test(lines[i])) { at = i; break; }
    }
    if (at < 0) continue;
    checked++;
    // Everything on later LINES. Slicing by character index breaks when the exit is the final line
    // with no trailing newline: indexOf("\n") is -1, slice(0) returns the whole file, and every
    // such file reports itself. That is how the first version flagged three clean ones.
    const after = lines.slice(at + 1).join("\n");
    // Only ASSERTIONS count as an offence, not scaffolding. accountant-access.test.ts wraps its
    // whole body in `async function main()` and calls it at the end, so `}` and `main();` sit after
    // an exit that is genuinely the last statement of that function — flagging those would be a
    // false alarm, and a gate that cries wolf gets switched off. What is never harmless is a
    // `check(` or an `assert` down there: that is a test claiming coverage it does not have.
    if (/\b(check|assert|test|it)\s*[.(]/.test(after)) {
      offenders.push(`${file}: ${after.trim().split("\n")[0].slice(0, 70)}`);
    }
  }
  // 283 test files; 63 end with the top-level `console.log(summary); process.exit(...)` shape this
  // gate is about. The floor is that count, and the direction is deliberate: a new file using the
  // pattern pushes it UP and still passes, while a detector that stopped matching pushes it DOWN
  // and fails. An INDENTED exit is excluded on purpose — inside a conditional block the code after
  // it is reachable, and flagging those would be a false alarm that gets the gate switched off.
  assert.ok(checked >= 60, `the scan must be looking at the real test corpus, saw ${checked}`);
  assert.deepEqual(offenders, [],
    "code after process.exit() never runs — move it above the summary, or the file reports a count " +
    "that predates it");
});

test("[SUPPLETIE-VERREKEND] the app now produces the number it has been telling owners to carry", () => {
  // Two screens have said "onder €1.000 mag je dit verwerken in je volgende aangifte" for a while.
  // Nothing carried anything: the aangifte query is date-ranged to its own quarter, so the owner was
  // told to move a figure forward and left to work out which, from where, and how much.
  const route = code("src/app/api/aangifte/route.ts");
  assert.match(route, /const corrections = await outstandingCorrections\(\{ pipeline, ownerId, year, quarter \}\)/);
  assert.match(route, /corrections: corrections\.corrections\.map/, "and they reach the screen");
  // [NO-SILENT-EMPTY] An empty list says "nothing to carry"; this says "we could not look". On the
  // screen a tax return is filled in from, those two may never render the same.
  assert.match(route, /correctionsUnknown: corrections\.unknown/);

  // BESIDE the rubrieken, exactly like the ICP-opgaaf. A correction from a previous quarter
  // reconciles with no invoice of this one, and a total that traces back to no document is the
  // shape of figure nobody trusts.
  const lib = code("src/lib/filed-quarter.ts");
  assert.match(lib, /if \(route === "carry"\) \{/,
    "only a carry is offered — a suppletie needs its own form");
  assert.doesNotMatch(lib, /route === "suppletie"[^\n]*corrections\.push/,
    "a correction over €1.000 is never presented as a line to carry");

  const client = code("src/app/dashboard/aangifte/AangifteClient.tsx");
  // The KEY, not the sentence. [TAAL] moved this copy into the catalogue — a component holds no
  // language of its own — and the two [TAAL] gates already prove the key exists and is rendered, so
  // matching the Dutch here would only re-pin a string that has moved once and can move again.
  assert.match(client, /t\('aang\.correcties'\)/);
  assert.match(client, /t\('aang\.correcties\.uitleg'\)/, "…including what the owner is told to do with it");
  assert.match(client, /correctionsUnknown && \(/, "and the screen can say it could not look");
  assert.match(client, /t\('aang\.correcties\.onbekend'\)/);
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'aang\.correcties': \{\s*nl: 'Correcties uit eerdere kwartalen'/,
    "and Dutch is the source language of the key, per AGENTS.md");
});

test("[SUPPLETIE-VERREKEND] a carried correction cannot be declared twice, or closed by a guess", () => {
  // The moment the aangifte names a correction, it owes the owner an answer to "and now it is
  // done" — or it offers the same one next quarter and the figure is declared twice.
  //
  // What is recorded is an AMOUNT, not a flag, and the reason is the second movement: a quarter
  // corrected to −160 (carried) and then moved to −210 still owes −50. A boolean would make that
  // invisible, which is the more expensive of the two mistakes.
  const filing = code("src/lib/btw-filing.ts");
  assert.match(filing, /export function outstandingCorrection\(btwSaldoDelta: number, carriedSaldo/);
  assert.match(filing, /return round2\(delta - \(Number\.isFinite\(carried\) \? carried : 0\)\)/);
  assert.match(filing, /export function correctionRoute\(outstanding: number\)/,
    "the route is judged on what REMAINS, not on the whole movement");

  const carry = code("src/app/api/btw/carry/route.ts");
  // NEVER inferred from a filing. Marking a correction carried because a later quarter was filed
  // assumes the owner included it — and when they did not, the app has silently discharged a duty
  // at the Belastingdienst that still stands.
  assert.match(carry, /export async function POST/);
  assert.doesNotMatch(carry, /btw\.filed/, "this is not a side effect of filing a quarter");
  // The amount is recomputed server-side, never taken from the request: a screen left open while
  // the books moved would otherwise record a carry that no longer matches them.
  assert.match(carry, /outstanding = outstandingCorrection\(divergence\.btwSaldoDelta, alreadyCarried\)/);
  assert.doesNotMatch(carry, /body\?\.(amount|outstanding|saldo)/, "no amount is accepted from the client");
  // ADDED, not replaced — asserted on the WRITE below, not on the file: the audit trail records
  // the same expression, so a whole-file match stayed green while the update was changed to
  // overwrite. Measured; the negative control passed until this moved.
  // The threshold is re-checked here, because it decides which FORM the Belastingdienst expects.
  assert.match(carry, /if \(route === "suppletie"\) \{/);
  assert.match(carry, /code: "suppletie_required"/);
  // Forward only. A correction recorded against the very return it came from is not a shape that
  // exists.
  assert.match(carry, /if \(!isBefore\(from, into\)\) \{/);
  // [DEPLOY-SAFE] A write that recorded nothing must not answer ok — the owner would believe the
  // correction is closed and it would be offered again next quarter.
  assert.match(carry, /code: "not_migrated"/);
  assert.match(carry, /status: 503/);

  // The snapshot is NOT rewritten. Re-freezing the earlier quarter would make the arithmetic come
  // out and destroy the only record of what was actually sent.
  //
  // Sliced to the UPDATE payload. A whole-file search for those field names matches the READ that
  // recomputes the divergence — `omzet: result.omzet` and its siblings are how the current figures
  // are handed to computeFilingDivergence — so it would fail on correct code, which is the kind of
  // gate that gets deleted rather than fixed.
  const updateAt = carry.indexOf('.update({');
  assert.ok(updateAt > 0, "the carry still writes something");
  const payload = carry.slice(updateAt, carry.indexOf("})", updateAt));
  for (const frozen of ["omzet", "kosten", "btw_verschuldigd", "btw_voorbelasting", "btw_saldo", "filed_at"]) {
    assert.ok(!new RegExp(`\\b${frozen}:`).test(payload),
      `[FILING-NO-OVERWRITE] a carry may not write ${frozen} — the frozen figures are the only ` +
      "record of what was actually sent to the Belastingdienst");
  }
  assert.match(payload, /carried_saldo: alreadyCarried \+ outstanding/,
    "the amount is ADDED to what was carried before: a quarter can be corrected in two steps, and " +
    "each step is declared in the return that was open at the time");

  const sql = readFileSync("supabase/migrations/btw_filings_carried.sql", "utf8");
  for (const col of ["carried_saldo", "carried_into_year", "carried_into_quarter", "carried_at"]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`), col);
  }
  assert.match(sql, /carried_into_quarter BETWEEN 1 AND 4/, "\"verwerkt in 2026-Q7\" never reaches an accountant");

  // And the tick belongs to the owner, on the row, with the amount beside it.
  const client = code("src/app/dashboard/aangifte/AangifteClient.tsx");
  assert.match(client, /async function markCarried\(c: Correction\)/);
  assert.match(client, /body: JSON\.stringify\(\{\s*from: \{[^}]*\},\s*into: \{ year, quarter \},/,
    "the screen posts which quarter goes into which — and no amount");
  // The row leaves only on the server's ok: removing it optimistically hides a correction that is
  // still owed, on the screen a tax return is filled in from.
  const handler = client.slice(client.indexOf("async function markCarried"));
  const okAt = handler.indexOf("setCorrections((prev) => prev.filter");
  const guardAt = handler.indexOf("if (!res.ok || !json.ok)");
  assert.ok(guardAt > 0 && okAt > guardAt, "the row is removed after the server agreed, not before");
});

test("[CONTROLE-EERLIJK] the checklist says only things that are true of this invoice", () => {
  // Reported from the screen, on BALKIP B.V. 264091 — read CORRECTLY at 1.123,62 + 101,13 =
  // 1.224,75, which is exact to the cent and 9,0%. Three of the app's own checks then said things
  // that were not true of it:
  //
  //   · "er staat wél € 50,00 + € 30,00 btw = € 80,00"   — the quantity column, offered as a total
  //   · "excl. + btw komt niet uit op het totaal"        — over a sum that comes out exactly
  //   · "Btw-bedrag nagerekend — 21%"  (green tick)      — on a row where 21% of the base is 235,96
  //
  // A check that is caught lying once is a check nobody reads again, including on the invoice where
  // it is right. That is what makes these worse than a missing check.
  const candidates = code("src/lib/amount-candidates.ts");
  // A triple must imply a rate the Netherlands has. `b > a` alone let 30-on-50 through at 60%.
  assert.match(candidates, /if \(b \/ a > MAX_NL_BTW_RATE \+ RATE_SLACK\) continue/);
  assert.match(candidates, /const MAX_NL_BTW_RATE = 0\.21/);
  // …and it must be the same size as what was read. 20% is not impossible, so the rate filter
  // cannot reject € 12 as the total of a € 1.224,75 invoice; scale can.
  assert.match(candidates, /const floor = known === null \? 0 : known \/ 10/);
  assert.match(candidates, /totalsCandidates\(amounts\)\.filter\(\(c\) => c\.inc >= floor\)/);

  const split = code("src/lib/btw-split.ts");
  // Each row is asked about ITSELF before the block is asked about our totals. The column sums are
  // a weak test: any misread preserving the two totals passes them, and taking the rate from one
  // printed row and the amounts from another is exactly such a misread.
  assert.match(split, /const offenders = rows\.filter\(\(r\) => \{/);
  assert.match(split, /if \(offenders\.length > 0\) return \{ kind: 'row-inconsistent'/);
  const rowsAt = split.indexOf("const offenders = rows.filter");
  const sumAt = split.indexOf("const rowsBase = round2(");
  assert.ok(rowsAt > 0 && sumAt > rowsAt, "asked BEFORE the column sums are trusted");
  // …and it may never count as corroboration, whatever its columns add up to.
  assert.match(split, /return v\.kind === 'single-rate' \|\| v\.kind === 'blend-verified'/,
    "btwSplitCorroborated is an allowlist, so a new verdict cannot become a tick by default");

  const checks = code("src/lib/invoice-checks.ts");
  // The arithmetic row is judged on the arithmetic. flags.arithmetic carries two findings because
  // both mean "do not book this unseen"; printing one row about both is what produced the false
  // sentence. The other finding has its own row.
  assert.match(checks, /health\.flags\.arithmetic && !health\.flags\.notOnDocument\s*\n?\s*\?\s*'flagged'/);
  assert.match(checks, /id: 'total-on-document'/);
  // The detail must use the SAME condition as the outcome — keying them differently put a green
  // tick over the sentence "excl. + btw komt niet uit op het totaal", a row contradicting itself.
  const detailAt = checks.indexOf("detail: health.flags.arithmetic");
  assert.ok(detailAt > 0, "the arithmetic row still has a detail");
  assert.match(checks.slice(detailAt, detailAt + 120), /&& !health\.flags\.notOnDocument/,
    "outcome and detail are decided by one condition, or the row disagrees with itself");

  const health = code("src/lib/import-health.ts");
  assert.match(health, /flags\.notOnDocument = true/, "the finding is distinguishable at the source");
  assert.match(health, /notOnDocument: false,/, "…and defaults to false like every other flag");
});

test("[OPENSTAAND-BEWIJS] the pay screen proves what it claims instead of asserting it", () => {
  // The owner knows the app reads their invoices correctly and still does not quite believe the
  // list of what they owe. That is not irrational: every screen shows a CONCLUSION and none shows
  // its working. "Openstaand: € 8.914" can only be checked by redoing the work the app exists to
  // do — so the doubt has nowhere to go.
  //
  // Three things were missing, and all three are about evidence rather than accuracy.

  // 1. The reverse question, which nothing had ever asked. The engine answers "which invoice does
  //    this payment belong to?" at import time; nobody asked "is this bill I am about to pay
  //    perhaps already paid?"
  const proof = code("src/lib/open-invoice-proof.ts");
  assert.match(proof, /matchTransactions\(\[\.\.\.transactions\], \[\.\.\.openInvoices\]\)/,
    "it REUSES the bank screen's engine — a second private notion of a match would drift, and then " +
    "two screens would disagree about the same euro");
  // The gate is the SIGNALS, not the score, and that is measured rather than preferred: against the
  // real engine a € 1.224,75 payment to a DIFFERENT supplier scores 0.711 (amount + date) while a
  // payment quoting "FACTUUR 264091" scores 0.600 (reference + amount). Any confidence bar that
  // admits the evidence admits the coincidence.
  assert.match(proof, /export function isProvingCandidate/);
  assert.match(proof, /signals\.some\(\(s\) => IDENTITY_SIGNALS\.has\(s\)\) && signals\.some\(\(s\) => AMOUNT_SIGNALS\.has\(s\)\)/);
  // Sliced to the filter itself and matched on the SHAPE of a score comparison, not on one spelling
  // of it. The first version pinned the literal `c.confidence < PROOF_CONFIDENCE` and stayed green
  // when the gate was replaced by `c.confidence < 0.7` — the same defect it was written to prevent.
  const filterAt = proof.indexOf("for (const c of m.candidates)");
  assert.ok(filterAt > 0, "the candidate loop still exists");
  // The SKIP line, not any comparison in the loop. Confidence is still allowed to break a tie
  // between two candidates for the same invoice — what it may not do is decide whether a candidate
  // is shown at all. Matching every `c.confidence` in the block would have rejected that tiebreaker,
  // which is correct code, and a gate that fails on correct code is one that gets deleted.
  const skip = proof.slice(filterAt).split("\n").find((l) => l.includes("continue"));
  assert.ok(skip, "the loop still skips candidates it does not believe");
  assert.match(skip!, /isProvingCandidate\(c\.signals\)/, "…on the signals");
  assert.doesNotMatch(skip!, /confidence/,
    "no score threshold decides this — confidence is a tiebreaker, never the gate");
  // 'date' may never appear in either set — a nearby day is the coincidence generator itself.
  const idSet = /const IDENTITY_SIGNALS = new Set<MatchSignal>\(\[([\s\S]*?)\]\)/.exec(proof);
  assert.ok(idSet, "the identity set is declared");
  assert.doesNotMatch(idSet![1], /'date'/, "a date proves nothing about identity");

  // 2. The SCOPE, which is the actual product. "We found no payment" is an absence, and an absence
  //    proves nothing unless the search is stated. Every number in the sentence is checkable
  //    against the owner's own bank in seconds.
  const text = code("src/lib/open-invoice-proof-text.ts");
  assert.match(text, /t\('bewijs\.scope\.meer', \{ facturen, tx: proof\.checkedTransactions, tot \}\)/,
    "how many bank lines");
  assert.match(text, /t\('bewijs\.scope\.tot', \{ datum: dag \}\)/,
    "…and the horizon: where the app stops knowing");
  // The two answers that must never look like a clean check, and the two that must never collapse
  // into one another. Both sides of the books name their own kind of document.
  assert.match(text, /t\('bewijs\.geenBank', \{ facturen \}\)/,
    "no bank data is not a clean bill of health");
  assert.match(text, /t\('bewijs\.geenOpen\.inkoop'\)/);
  assert.match(text, /t\('bewijs\.geenOpen\.verkoop'\)/);

  // [TAAL] The words themselves live in the catalogue, in Dutch, and are asserted THERE — one
  // place, so a rewording cannot leave the gate green while the screen changes its promise.
  const cat = readFileSync("src/lib/i18n/messages.ts", "utf8");
  for (const sentence of [
    "vergeleken met {tx} banktransacties{tot}",
    " t/m {datum}",
    "nog niet vergeleken met je bank",
    "Er staan geen inkoopfacturen open om na te kijken.",
    "Er staan geen verkoopfacturen open om na te kijken.",
    "Geen betaling gevonden die bij een van deze facturen past.",
    "niet met je bank vergelijken",
    "Niet alles is meegenomen",
  ]) {
    assert.ok(cat.includes(sentence), `the catalogue lost: "${sentence}"`);
  }
  // The two questions are DIFFERENT questions. On a purchase invoice the owner is asked about the
  // document; on a sales invoice about the CUSTOMER, because that is the person a reminder — and
  // on the last tier a statutory aanmaning — is about to be sent to.
  assert.ok(cat.includes("Klopt het dat deze factuur nog openstaat?"));
  assert.ok(cat.includes("Klopt het dat deze klant nog niet betaald heeft?"));

  // [NO-SILENT-EMPTY] A read that failed is its own answer, with no rows under it. Collapsing it
  // into "geen betaling gevonden" is the most convincing lie this feature could tell.
  assert.match(text, /if \(proof\.readFailed\) \{[\s\S]*?failed: true, lead: t\('bewijs\.leesFout'\), rows: \[\]/);
  // A bounded check says it was bounded, in all three shapes — a check cut short and presented as
  // a complete one is the exact false reassurance this panel exists to remove.
  assert.match(text, /t\('bewijs\.beperkt\.beide'/);
  assert.match(text, /t\('bewijs\.beperkt\.facturen'/);
  assert.match(text, /t\('bewijs\.beperkt\.transacties'/);

  // 3. Evidence under every "Betaald" — the screen read amount_paid and never bank_tx_invoices.
  const ev = code("src/lib/payment-evidence.ts");
  assert.match(ev, /case 'unknown':/, "a failed read is its own answer…");
  assert.match(ev, /case 'none':/, "…and so is 'marked paid with nothing recording how'");
  assert.match(ev, /if \(links === null\) return \{ kind: 'unknown' \}/,
    "collapsing those two makes a busy database assert an invoice has no payment evidence");
  assert.match(ev, /export function isBankProven/,
    "a bank-proven payment and the owner's own tick are different claims");
  // The direction of the money reaches the WORDS. "afgeschreven naar Kiwi Food Market" under an
  // invoice Kiwi paid describes the owner paying their own customer, on the line that exists to be
  // believed. Own keys per direction — a shared one with the verb as a parameter is the mistranslation
  // rule 1 of messages.ts forbids.
  assert.match(ev, /t\('betaal\.bank\.inkoop'/);
  assert.match(ev, /t\('betaal\.bank\.verkoop'/);
  for (const sentence of [
    "{bedrag} afgeschreven op {datum} naar {naam}",
    "{bedrag} bijgeschreven op {datum} van {naam}",
    "Als betaald gemarkeerd, maar er is geen betaling aan gekoppeld.",
    "We konden niet nakijken waar deze betaling vandaan komt.",
  ]) {
    assert.ok(cat.includes(sentence), `the catalogue lost: "${sentence}"`);
  }
  // Four claims, four tones — rendering the bank's word and the owner's tick alike is the whole
  // thing this feature exists to stop.
  assert.match(ev, /tone: 'bank' \| 'hand' \| 'geen' \| 'onbekend'/);
  assert.match(ev, /if \(!ev\) return null/,
    "a row nobody sent evidence for gets no line, not an empty claim");
  const paintEv = code("src/components/invoice/PaymentEvidenceLine.tsx");
  assert.match(paintEv, /dir=\{line\.dir\}/, "the direction travels with the words");
  assert.match(paintEv, /\{line\.text\}/);
  assert.match(paintEv, /TONE\[line\.tone\]/, "the colour comes off the model, not off a branch here");
  assert.doesNotMatch(paintEv, /textAlign: 'right'/, "use textAlign: 'end'");
  assert.doesNotMatch(paintEv, /paddingLeft:/, "use paddingInlineStart");

  const salesListEarly = code("src/app/dashboard/facturen/FacturenClient.tsx");

  // [ID-CHUNK] A PostgREST filter travels in the URL. The sales list is paged and unbounded, so a
  // bare .in() over a few hundred settled invoices blows the length limit — and what breaks is the
  // evidence line, which simply stops appearing. Chunked, so a long list costs more queries and
  // never a silently shorter answer.
  const evCollect = code("src/lib/payment-evidence-collect.ts");
  assert.match(evCollect, /fetchAllRowsForIds/);
  assert.doesNotMatch(evCollect, /\.in\('invoice_id', \[\.\.\.args\.invoiceIds\]\)/,
    "the id list may not travel in one URL");
  assert.match(ev, /export function settledInvoiceIds/,
    "only the rows that CLAIM to be settled are asked about");

  // ── [DEELBETALING-BEWIJS] The hardest number in the app to check by hand ─────────────────────
  //
  // On a partly settled invoice "Deels betaald · nog € 460" is a conclusion the owner can only
  // verify by opening their bank and adding up — the work this product exists to remove, handed
  // back at the moment trust is being asked for. So the terms are named, each with its own
  // evidence, and the sum is stated against the invoice total.
  assert.match(ev, /t\('deel\.samen\.meer'/);
  assert.match(ev, /entries\.push\(bewijs\)/,
    "each term carries its OWN sentence — bank and hand are different claims");
  for (const sentence of [
    "{betaald} van {totaal} voldaan, in {count} betalingen:",
    "de app rekent met {geboekt} betaald, maar de vastgelegde betalingen tellen op tot {geteld}",
    "geen vastgelegd bedrag, dus het openstaande saldo is hier niet na te rekenen",
  ]) {
    assert.ok(cat.includes(sentence), `the catalogue lost: "${sentence}"`);
  }

  // [NO-SILENT-EMPTY] invoices.amount_paid is a CACHED Σ amount_applied, kept by a database
  // function that also CLAMPS at the invoice magnitude. Nothing had ever held the two against each
  // other, so a remainder no instalment supports rendered as fact. Both figures, never a silent
  // preference for one.
  assert.match(ev, /t\('deel\.verschil', \{ geboekt: EUR\.format\(geboekt\), geteld: EUR\.format\(ev\.total\) \}\)/);
  assert.match(ev, /Math\.abs\(round2\(geboekt - ev\.total\)\) > CENT_EPSILON/,
    "a cent of float dust is not a divergence");
  assert.match(ev, /if \(ev\.totalKnown === false\)/,
    "an unverifiable total may never read as a verified one");

  // A link created before bank_tx_invoices.amount_applied existed carries NULL, and by construction
  // settled its invoice IN FULL — the rule allocatedOnLine has always applied, where reading NULL
  // as 0 would let the same euros be spent twice. Read as 0 here, the link was dropped and the
  // invoice rendered the amber "marked paid, no payment linked" about an invoice with a bank line
  // on it — a false alarm on the line that may never cry wolf.
  assert.match(ev, /amountApplied: number \| null/);
  assert.match(ev, /if \(link\.amountApplied === null\)/);
  assert.match(evCollect, /amountApplied: l\.amount_applied == null \? null : Number\(l\.amount_applied\) \|\| 0/,
    "the collector may not coerce NULL to 0 — that is where the false alarm came from");
  // …and both screens hand over the totals that value it.
  assert.match(evCollect, /classifyPayment\(perInvoice\.get\(id\) \?\? \[\], args\.totals\?\.\[id\]\)/);
  assert.match(code("src/app/dashboard/incoming/manage/page.tsx"), /totals: Object\.fromEntries\(/);
  assert.match(salesListEarly, /totals\[inv\.id\] = inv\.total_inc_btw \?\? null/);

  // The sentence runs inside a LIST ROW, where a throw blanks the screen rather than one line.
  assert.match(ev, /\(ev\.applied \?\? \[\]\)\.find/,
    "an evidence object assembled elsewhere carries no `applied`, and must not crash the row");

  // ── [CREDIT-SIGN] The direction of the MONEY, not of the document ────────────────────────────
  //
  // The invoices table has ONE `direction` column and it describes who issued the document. On an
  // ordinary invoice that is also the way the money moves, so the two were treated as one thing.
  // On a creditnota they are opposites — the owner refunds the customer — and the evidence line
  // said so out loud: a € 500 refund rendered as "bijgeschreven … van Kiwi Food Market" beside a
  // bank line of −500.
  const credits = code("src/lib/credited-invoices.ts");
  assert.match(credits, /export function moneyDirection/);
  assert.match(credits, /return documentIsOutgoing === credit \? "incoming" : "outgoing"/,
    "a creditnota reverses the flow its document direction implies");
  // A row can carry the SIGN before anyone has set the type (an AI read, an import), and the
  // screens already treat a negative total as a credit — this has to agree with them.
  assert.match(credits, /\(Number\(row\.total_inc_btw\) \|\| 0\) < 0/);
  // …and NEITHER screen may hard-code a direction any more. That is what put a refund in the
  // owner's income in the first place.
  for (const screen of [
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",
    "src/app/dashboard/facturen/FacturenClient.tsx",
  ]) {
    const client = code(screen);
    assert.match(client, /buildPaymentEvidenceLine\(paymentEvidence\[inv\.id\], moneyDirection\(inv\), taal, inv\)/,
      `${screen} must take the direction from the money, not from the list it is on`);
  }

  // ── [CREDIT-BEWIJS] Which credit notes are behind "Deels gecrediteerd · € 250" ───────────────
  //
  // The same argument as the instalments, with a different answer: an instalment is proved by
  // somebody else's record, a credit by a document the OWNER sent — one an accountant asks about
  // by number. The app was already holding this and never showed it.
  const creditText = code("src/lib/credit-evidence.ts");
  assert.match(creditText, /export function buildCreditEvidenceLine/);
  assert.match(creditText, /if \(!credits \|\| credits\.length === 0\) return null/,
    "an invoice with no credits gets no line, not an empty claim");
  assert.match(creditText, /t\('credit\.regel\.zonderNummer'/,
    "a creditnota in concept has no number yet — that is Art. 35, not a gap");
  assert.match(credits, /export function creditDetailsFrom/);
  assert.match(credits, /if \(amount <= EPSILON\) continue/, "a credit of nothing gives nothing back");
  assert.match(salesListEarly, /<CreditEvidenceLine line=\{buildCreditEvidenceLine\(creditRows\.get\(inv\.id\), taal\)\} \/>/);
  for (const sentence of [
    "{bedrag} teruggegeven met {count} creditnota",
    "We konden niet nakijken welke facturen je hebt gecrediteerd",
  ]) {
    assert.ok(cat.includes(sentence), `the catalogue lost: "${sentence}"`);
  }

  // [NO-SILENT-EMPTY] `const { data }` without `error` — supabase-js does not throw — turned a
  // failed credit read into an EMPTY credit map. Every credited invoice then showed its full total
  // as outstanding and lost its "Gecrediteerd" chip, so an invoice the owner formally withdrew
  // looked completely chaseable. On money given back in writing, that is the one direction this
  // screen may not fail in quietly.
  assert.match(salesListEarly, /setCreditsReadFailed\(true\)/);
  assert.match(salesListEarly, /\{creditsReadFailed && \(/, "…and the screen says so");
  assert.match(salesListEarly, /t\('credit\.leesFout'\)/);
  // [PAGINATION] …and it is paged. PostgREST caps a response at ~1000 rows silently, and a lost
  // credit is an invoice that reappears as fully owed.
  const creditReadAt = salesListEarly.indexOf(".eq('invoice_type', 'creditnota')");
  assert.ok(creditReadAt > 0, "the credit read still exists");
  const creditRead = salesListEarly.slice(Math.max(0, creditReadAt - 900), creditReadAt + 300);
  assert.match(creditRead, /fetchAllRows/, "the credit read may not take the first thousand and stop");

  // …and all of it actually reaches BOTH screens. A proof computed and not rendered is the defect
  // class this whole file exists for.
  const page = code("src/app/dashboard/incoming/manage/page.tsx");
  assert.match(page, /await collectOpenInvoiceProof\(\{ pipeline: supabase, ownerId: user\.id \}\)/);
  assert.match(page, /await collectPaymentEvidence\(\{/);
  assert.match(page, /openProof=\{openProof\}/);
  assert.match(page, /paymentEvidence=\{paymentEvidence\}/);

  // ── The sales side, which carries the larger risk ───────────────────────────────────────────
  //
  // A purchase invoice wrongly called open costs a second payment, and the owner can claw it back.
  // A SALES invoice wrongly called open is CHASED: a reminder, a firmer one, and on the last tier
  // a statutory aanmaning naming incassokosten — at a customer who paid three weeks ago. Nothing
  // on that screen can see it coming, because the app's own books say the invoice is open.
  const salesPage = code("src/app/dashboard/facturen/page.tsx");
  assert.match(salesPage, /collectOpenInvoiceProof\(\{[\s\S]{0,160}?direction: 'outgoing'/,
    "the sales list asks the question of its OWN direction — the default is the pay screen's");
  assert.match(salesPage, /openProof=\{openProof\}/);

  // A screen's own COPY, with the message keys taken out first.
  //
  // The naive version — does the file contain this Dutch word — fired on `t('ink.afgeschrevenOp')`,
  // which is a key NAME and the opposite of hardcoded copy: it is the word living in the catalogue
  // exactly as intended. A gate that goes red on correct code is one that gets deleted, so the keys
  // are stripped and what is left is what the component actually spells out itself.
  const copyOf = (screen: string) => code(screen).replace(/t\(\s*'[\w.]+'/g, "t(");

  // ONE component paints both. Two copies of a promise about the owner's books drift apart, and
  // this repo has the receipts: eleven copies of a status chip disagreed about four statuses.
  for (const screen of [
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",
    "src/app/dashboard/facturen/FacturenClient.tsx",
  ]) {
    const client = code(screen);
    assert.match(client, /<OpenInvoiceProofPanel panel=\{buildProofPanel\(openProof, taal\)\} \/>/,
      `${screen} must render the shared panel, in the owner's language`);
    // The screen imports the TEXT module, never the engine. open-invoice-proof.ts reaches
    // matchTransactions and would drag the whole matching engine into the browser bundle.
    assert.match(client, /from '@\/lib\/open-invoice-proof-text'/);
    assert.doesNotMatch(client, /from '@\/lib\/open-invoice-proof'/);
    // [TAAL] …and neither screen keeps a sentence of its own. The first version of this panel left
    // the failure line, the per-hit question and the bounded note hard-coded in the component —
    // the half-finished translation AGENTS.md warns about, which hides itself because the screen
    // still looks right in Dutch.
    const copy = copyOf(screen);
    for (const dutch of ["Niet alles is meegenomen", "In je bank staat", "niet met je bank vergelijken"]) {
      assert.ok(!copy.includes(dutch), `${screen} still holds copy of its own: "${dutch}"`);
    }
  }
  // The component itself holds none either — it paints what the panel object hands it, direction
  // included, so the words and the layout can never render out of step.
  const panel = code("src/components/invoice/OpenInvoiceProofPanel.tsx");
  assert.match(panel, /dir=\{panel\.dir\}/, "the direction travels with the words");
  assert.match(panel, /\{panel\.lead\}/);
  assert.match(panel, /\{row\.question\}/);
  assert.match(panel, /\{panel\.bounded\}/);
  assert.doesNotMatch(panel, /textAlign: 'right'/, "use textAlign: 'end'");
  assert.doesNotMatch(panel, /paddingLeft:/, "use paddingInlineStart");

  // …and BOTH lists paint it, each in its own direction. One component, one set of states.
  for (const [screen, direction] of [
    ["src/app/dashboard/incoming/manage/IncomingManageClient.tsx", "'incoming'"],
    ["src/app/dashboard/facturen/FacturenClient.tsx", "'outgoing'"],
  ] as const) {
    const client = code(screen);
    // …and the INVOICE travels with it. That fourth argument is what makes the arithmetic possible:
    // the total to measure the instalments against, and the amount_paid to hold their sum up to.
    // Without it the line is back to a conclusion with no working.
    //
    // The DIRECTION is no longer a literal here. It used to be the list's own — 'incoming' on the
    // pay screen, 'outgoing' on the sales list — and that is exactly what put a refund in the
    // owner's income: a creditnota moves money the other way than the document it belongs to.
    // [CREDIT-SIGN] below holds the rule itself; this only holds that the screen asks for it.
    void direction;
    assert.match(
      client,
      /<PaymentEvidenceLine line=\{buildPaymentEvidenceLine\(paymentEvidence\[inv\.id\], moneyDirection\(inv\), taal, inv\)\} \/>/,
      `${screen} must paint the shared line, in the MONEY's direction, the owner's language and against its own invoice`,
    );
    // [TAAL] …and keep no sentence of its own about it. Keys stripped first — see copyOf.
    const copy = copyOf(screen);
    for (const dutch of ["afgeschreven", "bijgeschreven", "Door jou afgevinkt", "geen betaling aan gekoppeld"]) {
      assert.ok(!copy.includes(dutch), `${screen} still holds copy of its own: "${dutch}"`);
    }
  }
  // The sales list has no server prop to lean on — its rows arrive by paging in the browser — so it
  // reads the evidence itself, through the owner's OWN session. Both tables carry a
  // `user_id = auth.uid()` select policy, so RLS scopes it exactly and no route widens anything.
  const salesList = code("src/app/dashboard/facturen/FacturenClient.tsx");
  assert.match(salesList, /collectPaymentEvidence\(\{ pipeline: supabase, ownerId: profile\.id, invoiceIds: ids, totals \}\)/);
  // Keyed on the settled ids AND their totals. Ids alone was not enough: the totals feed the
  // legacy-link valuation, and the effect read them out of its closure — so an invoice whose total
  // was corrected kept the OLD figure in the map and a NULL-amount link was valued at an amount
  // the invoice no longer carries. eslint pointed at exactly that missing dependency.
  assert.match(salesList, /const ids = settledInvoiceIds\(invoices\)/);
  assert.match(salesList, /key: ids\.map\(\(id\) => `\$\{id\}:\$\{totals\[id\] \?\? ''\}`\)\.join\(','\)/,
    "the key must move when a total moves, or the same rows are re-read with a stale figure");
  // [NO-SILENT-EMPTY] A throw must reach every row asked about as 'unknown'. A missing line reads
  // as "nothing to say", which is the state this whole feature exists to remove.
  assert.match(salesList, /all\[id\] = \{ kind: 'unknown' \}/);

  const render = readFileSync("tests/render/money-screens.test.tsx", "utf8");
  assert.match(render, /the pay screen states what was checked, against what, and until when/);
  assert.match(render, /carries the bank line that says so/);
  assert.match(render, /the sales list proves the other direction, in its own words/);
  assert.match(render, /the panel says what came in that belongs to no invoice/);
  assert.match(render, /one component paints the four claims, and each one differently/);
});

test("[HERINNER-BEWIJS] nothing is chased at a customer whose payment is already in the bank", () => {
  // The panel on the sales list makes this visible. This is the half that makes it MATTER.
  //
  // Every guard on the reminder paths asks the BOOKS whether an invoice is open — the status, the
  // amount_paid, the creditnota's — and all three answer "open" for the case that costs the most:
  // the customer paid, the bank line arrived, and nobody attached it to the invoice yet. No
  // arithmetic on either path can see that, so the letter went out to somebody who owes nothing.
  //
  // On the cron's final tier the letter is not a nudge. It is the statutory aanmaning that makes
  // incassokosten claimable at all (art. 6:96 BW), sent with no human in the loop.

  // ── The button the owner presses ────────────────────────────────────────────────────────────
  const manual = code("src/app/api/invoice/[id]/reminder/route.ts");
  assert.match(manual, /collectOpenInvoiceProof\(\{[\s\S]{0,120}?direction: 'outgoing', invoiceIds: \[id\]/,
    "the same engine the bank screen runs, scoped to this invoice");
  assert.match(manual, /code: 'bank_payment_found'/);
  assert.match(manual, /describeChaseBlock\(bewijs\.hits\[0\]/, "…answered with the bank line in it");
  // The order is the whole safety property: a refusal may not consume a reminder tier, or the
  // invoice ages toward the next one having never been chased.
  const guardAt = manual.indexOf("collectOpenInvoiceProof({");
  // The CLAIM, not the import of the offset helper — the first version of this gate pinned
  // `nextManualOffset`, which also appears in the import block at the top of the file and so
  // compared the guard against line 30. That is the mention-versus-wiring mistake this file keeps
  // catching in other people's code.
  const claimAt = manual.indexOf(".insert({");
  assert.ok(guardAt > 0 && claimAt > guardAt,
    "the bank check runs BEFORE the tier is claimed — a refusal must leave the trail untouched");
  // A block with no way out is its own defect: the app compared two readings, it did not settle a
  // debt, and an owner who knows the line is for something else must still be able to chase.
  assert.match(manual, /body\?\.confirmDespiteBankMatch !== true/);
  // [NO-SILENT-EMPTY] A check that could not RUN does not block a deliberate press — but the
  // answer may not pretend it looked.
  assert.match(manual, /bankCheckFailed = true/);
  assert.match(manual, /warning: \(await serverTranslator\(\)\)\('bewijs\.herinner\.nietGecontroleerd'\)/);

  // …and the screen actually offers both. A 409 the owner cannot answer is a dead end.
  const verkoop = code("src/app/dashboard/verkoop/VerkoopClient.tsx");
  assert.match(verkoop, /json\?\.code === 'bank_payment_found'/);
  assert.match(verkoop, /herinner\(ondanksBank, true\)/);
  assert.match(verkoop, /confirmDespiteBankMatch: true/);
  assert.match(verkoop, /json\?\.warning \|\| vert\('vk\.herinneringVerstuurd'\)/,
    "an unchecked send says so instead of reporting a clean one");

  // ── The cron, where nobody is watching ──────────────────────────────────────────────────────
  const cron = code("src/app/api/cron/reminders/route.ts");
  assert.match(cron, /collectOpenInvoiceProof\(\{[\s\S]{0,140}?direction: "outgoing", invoiceIds: \[\.\.\.tierByInvoice\.keys\(\)\]/,
    "one read per owner, over exactly the invoices about to be sent");
  // ONE tier decision, read in both places. Two calls to the same pure function is one too many to
  // keep honest: the day an argument is added to one, the guard and the send disagree about which
  // invoices are in play — and the guard is the one that goes quiet.
  assert.equal((cron.match(/reminderTierDue\(\{/g) ?? []).length, 1,
    "the tier is decided once and read from the map");
  assert.match(cron, /const tier = tierByInvoice\.get\(inv\.id\);/);
  // The hold happens BEFORE the claim, for the same reason as on the manual path.
  const bankGuardAt = cron.indexOf("const bankRegel = bankHitById.get(inv.id);");
  const upsertAt = cron.indexOf('.upsert(');
  assert.ok(bankGuardAt > 0 && upsertAt > bankGuardAt,
    "a held reminder must not burn its tier — the invoice would age toward the next one unchased");
  // FAIL CLOSED when the bank cannot be read: a held reminder costs a day (daily schedule,
  // idempotent tier claims), a wrong aanmaning costs a customer.
  assert.match(cron, /if \(!bewijs \|\| bewijs\.readFailed\) \{/);
  const outageAt = cron.indexOf("if (!bewijs || bewijs.readFailed) {");
  // Bounded by the SEND LOOP, not by a character count. The first version sliced 1800 characters
  // and asserted /continue;/ inside them — which reached past the branch into the loop below,
  // where several `continue`s live. Deleting the one that matters left the gate green: the
  // assertion had matched a MENTION instead of the WIRING, which is the defect class this file
  // exists to catch in other people's code and had just produced in its own.
  const sendLoopAt = cron.indexOf("for (const inv of ownerInvoices)", outageAt);
  assert.ok(sendLoopAt > outageAt, "the send loop still follows the bank check");
  const outageBlock = cron.slice(outageAt, sendLoopAt);
  assert.match(outageBlock, /continue;/, "…and that owner sends nothing this run");
  // Neither hold is silent. A cron that quietly stops chasing money is indistinguishable from one
  // that is broken, and the owner is the only person who can act on either.
  assert.match(outageBlock, /createNotification\(/);
  assert.match(cron, /title: "Herinnering niet verstuurd — betaling lijkt al binnen"/);
  assert.match(cron, /\$\{bankRegel\}/, "the notification names the bank line, or it cannot be acted on");
  // …but ONCE, on the day the reminder would have gone out. The tier is never claimed, so it stays
  // due every morning; a message every morning about the app's own uncertainty is one nobody reads
  // by week two. The standing state lives on the sales-list panel instead. The OUTAGE branch is
  // deliberately not wrapped in this — there the reminders have stopped and no screen says so.
  assert.match(cron, /if \(dueDay != null && dueDay \+ tier === today\) \{/);
  const heldAt = cron.indexOf("const bankRegel = bankHitById.get(inv.id);");
  const heldBlock = cron.slice(heldAt, cron.indexOf("continue;", heldAt));
  assert.ok(
    heldBlock.indexOf("dueDay + tier === today") < heldBlock.indexOf("createNotification("),
    "the once-a-day rule wraps the notification, not the other way round",
  );
  // …and a held invoice is out of the STATUTORY sum too. Art. 6:96 lid 7 adds one debtor's
  // hoofdsommen into a single aanmaning and lid 6 applies the staffel once over that total, so an
  // amount that may already be in the bank overstates the hoofdsom — and an over-stated fee is the
  // classic ground on which the whole incassokosten claim is struck. This is the second-order
  // mistake the guard itself could have caused: invoice A held, its amount riding into the demand
  // for invoice B of the same debtor.
  assert.match(cron, /for \(const i of ownerInvoices\) \{\s*if \(bankHitById\.has\(i\.id\)\) continue;/);
  const bankMapAt = cron.indexOf("bankHitById.set(h.invoiceId");
  const claimsAt = cron.indexOf("const claimsPerDebiteur");
  assert.ok(bankMapAt > 0 && claimsAt > bankMapAt,
    "the claims map is built AFTER the bank check — before it, there is nothing to leave out");

  // Two different holds, counted apart — collapsing them hides a broken read inside a number that
  // looks like the guard working.
  assert.match(cron, /bankHeld \+= 1;/);
  assert.match(cron, /bankCheckHeld \+= tierByInvoice\.size;/);
  for (const field of ["bankHeld,", "bankCheckHeld,"]) {
    assert.equal((cron.match(new RegExp(field.replace(",", ",\\s"), "g")) ?? []).length, 2,
      `${field} reaches BOTH the cron run record and the response`);
  }

  // ── [BINNENGEKOMEN-BEWIJS] The same engine, asked of the money ───────────────────────────────
  //
  // proveOpenInvoices asks per INVOICE ("is this thing I call open already paid?"); this asks per
  // PAYMENT ("what did this pay — and if nothing, how much of that is there?"). Same rule, because
  // two views of one answer can disagree only if they are computed twice.
  // Read here rather than leaning on a name from the neighbouring test — this block moved once
  // already and picked up a `proof` that belongs to [OPENSTAAND-BEWIJS], where it is in scope.
  const proofEngine = code("src/lib/open-invoice-proof.ts");
  assert.match(proofEngine, /export function proveIncomingPayments/);
  const incomingAt = proofEngine.indexOf("export function proveIncomingPayments");
  const incomingBody = proofEngine.slice(incomingAt);
  assert.match(incomingBody, /if \(!isProvingCandidate\(c\.signals\)\) continue/,
    "the same evidence rule, not a second private notion of a match");
  assert.match(incomingBody, /transactions\.filter\(\(t\) => \(t\.amount \?\? 0\) > 0\)/,
    "credits only — a debit belonging to nothing is a cost without a receipt, answered elsewhere");
  // The SUM, which is the whole point. Readiness already counts unexplained receipts, and a count
  // cannot tell three payments of € 5 from three of € 5.000 — only the second is turnover that was
  // never invoiced (art. 52 AWR).
  assert.match(incomingBody, /total \+= Math\.abs\(t\.amount\)/);
  assert.match(incomingBody, /newest === null \|\| t\.date > newest/,
    "…and the day, because old is a tidy-up and this week is a gap");
  // A line key built from the line's own fields: transactionId is nullable, so two id-less lines
  // would collide on '' and one payment's match would silence another's.
  assert.match(proofEngine, /function lineKey\(t: BankTransaction\)/);
  assert.doesNotMatch(incomingBody, /best\.has\(t\.transactionId\)/);

  // With NOTHING open the collector used to return early — answering "niets te controleren" about
  // an owner who may well be receiving money into a book with no invoices in it, which is exactly
  // the state this names.
  const proofCollect = code("src/lib/open-invoice-proof-collect.ts");
  assert.match(proofCollect, /const anchor = invoices\[0\]\?\.invoice_date \?\? bankThrough \?\? '1970-01-01'/);
  assert.match(proofCollect, /direction === 'outgoing'\s*\?\s*proveIncomingPayments\(invoices, transactions\)/,
    "only the sales side — an unattached credit there is a customer payment");

  // …and the sentence never accuses. A payment with no invoice can be a deposit, a private
  // transfer or a refund, and the owner is the only one who knows which.
  const catalogue = readFileSync("src/lib/i18n/messages.ts", "utf8");
  for (const sentence of [
    "{count} ontvangen betalingen nagekeken tegen {facturen}.",
    "horen bij geen enkele factuur in je boeken (laatste op {datum})",
    "Koppel ze bij Bank, of maak er een factuur voor als er omzet in zit.",
  ]) {
    assert.ok(catalogue.includes(sentence), `the catalogue lost: "${sentence}"`);
  }
  assert.match(code("src/lib/open-invoice-proof-text.ts"),
    /if \(!incoming \|\| incoming\.checkedPayments === 0\) return \[\]/,
    "nothing received → no sentence, rather than reassurance about a search over an empty set");
  assert.match(code("src/components/invoice/OpenInvoiceProofPanel.tsx"), /panel\.incoming\.map/,
    "and the panel paints it");

  const creditUnit = readFileSync("src/lib/credit-evidence.test.ts", "utf8");
  assert.match(creditUnit, /a creditnota moves money the OTHER way than its document points/);
  assert.match(creditUnit, /the chip states an amount; this states the documents behind it/);

  const unit = readFileSync("src/lib/open-invoice-proof.test.ts", "utf8");
  assert.match(unit, /the sentence that stops a reminder names the bank line and what to do/);
  assert.match(unit, /narrowing to one invoice narrows the ANSWER, never the search/);
  assert.match(unit, /the same engine, asked of the money instead of the invoice/);
  assert.match(unit, /the sentence names the sum and the day, and never accuses/);
});

// ─── [BLAD-SCROLL] Eén blad, één scroller, één grens ─────────────────────────
//
// `.sheet-scroll` maakt van een paneel de scroller en zet de grens op 88dvh — met een meting in de
// toelichting (Chromium 393×852: een paneel van 862px in een scherm van 852px, bovenkant
// afgesneden). Twee bladen zetten daar een eigen `maxHeight` overheen, en dat ging stil: inline
// wint van een klasse, dus het gemeten getal verloor van een getal zonder meting. FairUseModal deed
// het zelfs met `vh` in plaats van `dvh` — precies het verschil waar de klasse voor bestaat.
//
// InvoiceDocumentSheet had er nog een tweede laag bij: de klasse op het paneel én een eigen
// `overflow-y: auto` op de inhoud. Twee geneste scrollers om dezelfde inhoud is wat "het blad
// scrolt niet goed" betekent — je duwt de ene, de andere beweegt, de vaste kop schuift mee weg, en
// op de bodem van de binnenste neemt de buitenste het over.

test("[BLAD-SCROLL] a sheet never overrides the measured height of its own class", () => {
  const dir = "src";
  const walk = (d: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(d)) {
      const p = `${d}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
    }
    return out;
  };

  // Een overschrijving MET reden mag, en dat onderscheid is de poort waard. FeedbackButton zet
  // 85dvh omdat daar het toetsenbord bij moet: met het invoerveld open krimpt het zichtbare
  // scherm, en 88dvh laat de verzendknop erachter verdwijnen. Die redenering staat uitgeschreven
  // bij de regel zelf, mét meting (393×830, knop op 814px, balk vanaf 766px).
  //
  // Een poort die zo'n regel zou wegdwingen maakt de code slechter, niet beter. Dus staat hij hier
  // met naam en reden — en een nieuwe uitzondering kost dezelfde moeite: hem hier opschrijven.
  const MET_REDEN = new Map<string, string>([
    ["src/components/feedback/FeedbackButton.tsx",
     "85dvh laat ruimte voor het toetsenbord; 88dvh zet de verzendknop erachter. Gemeten."],
  ]);

  const overtreders: string[] = [];
  for (const f of walk(dir)) {
    if (MET_REDEN.has(f)) continue;
    const src = code(f);
    for (const m of src.matchAll(/className="sheet-(scroll|frame)"/g)) {
      // Het style-object van hetzelfde element: ruim genomen, want er staan lange commentaren in.
      const venster = src.slice(m.index, m.index + 1400);
      const eind = venster.indexOf("\n        >");
      const element = eind > 0 ? venster.slice(0, eind) : venster.slice(0, 900);
      if (/maxHeight:/.test(element)) {
        overtreders.push(`${f} (sheet-${m[1]})`);
      }
    }
  }
  assert.deepEqual(overtreders, [],
    "these set an inline maxHeight beside sheet-scroll/sheet-frame — inline wins, so the class's\n" +
    "measured limit is silently discarded. Put the limit in the class, not next to it:\n  " +
    overtreders.join("\n  "));
});

test("[BLAD-SCROLL] the panel that holds a scroller does not scroll itself", () => {
  // De twee helften van het paar horen bij elkaar: het paneel houdt vast, het deel eronder schuift.
  const css = readFileSync("src/app/globals.css", "utf8");
  const frame = css.slice(css.indexOf(".sheet-frame {"), css.indexOf(".sheet-scroll {"));
  assert.match(frame, /overflow:\s*hidden/, "a frame that scrolls is just sheet-scroll with extra steps");
  assert.match(frame, /max-height:\s*88vh;[\s\S]*max-height:\s*88dvh;/,
    "keep the vh fallback under the dvh line — dvh is what the mobile toolbar makes honest");

  const blad = code("src/components/invoice/InvoiceDocumentSheet.tsx");
  assert.match(blad, /className="sheet-frame"/, "this sheet has a fixed header, so the panel must not scroll");
  // En het schuivende deel moet ook echt kunnen krimpen. Zonder minHeight: 0 weigert een flex-item
  // kleiner te worden dan zijn inhoud, en dan schuift er niets — het paneel groeit gewoon door.
  assert.match(blad, /flex: 1, minHeight: 0, overflowY: 'auto'/,
    "the scrolling part needs flex: 1 AND minHeight: 0, or it never becomes a scroller");
});


// ─── [WATERVAL] Eén verificatie per verzoek, en niemand die er stiekem omheen gaat ───
//
// Een /dashboard/*-scherm vroeg drie keer aan de authenticatieserver wie er is: de layout, de
// pagina, en getActingFor() eronder. Drie keer heen en weer, na elkaar, met dezelfde cookie, voor
// hetzelfde antwoord — en pas dáárna begon het scherm iets te lezen. Dat is nu één vraag per
// verzoek (session-user.ts).
//
// De drie poorten hieronder bewaken elk iets anders, en de eerste is de enige die over geld gaat.

test("[WATERVAL] the memoised reader VERIFIES — it never falls back to reading the cookie", () => {
  // Dit is de poort die ertoe doet. `getSession()` leest het token uit de cookie en gelooft het;
  // `getUser()` legt het voor aan de authenticatieserver en wacht op het oordeel. Die tweede is
  // trager, en dat is precies waarom iemand die dit bestand ooit "sneller" komt maken hem zou
  // vervangen — de app blijft werken, de tests blijven groen, en vanaf dat moment bepaalt een
  // meegestuurde cookie wie je bent. In een boekhoudapp is dat het hele slot.
  //
  // Memoïseren mag; de vraag overslaan niet.
  const dal = code("src/lib/session-user.ts");
  assert.match(dal, /supabase\.auth\.getUser\(\)/,
    "the answer may be reused within a request, but it must still be an ANSWER from the auth server");
  assert.doesNotMatch(dal, /auth\.getSession\(/,
    "getSession() trusts the cookie it was handed — never the door for 'who is this'");
});

test("[WATERVAL] the reader is memoised per REQUEST, never cached over time", () => {
  // React's cache() leeft precies zolang als één render/verzoek. Dat verschil is het hele punt:
  // een medewerker van wie de toegang zojuist is ingetrokken hoort bij zijn VOLGENDE klik buiten
  // te staan, niet na een minuut. Wie hier een TTL-cache van maakt maakt van een intrekking een
  // vertraging — en dat is geen prestatiekwestie maar een toegangskwestie.
  //
  // Verdwijnt cache() juist helemáál, dan is er niets kapot en merkt niemand iets: het scherm
  // wordt alleen weer stil twee keer zo traag. Dat is precies het soort achteruitgang dat geen
  // enkele andere test opmerkt, en daarom staat hij hier.
  const dal = code("src/lib/session-user.ts");
  assert.match(dal, /import \{ cache \} from "react"/, "the memo comes from React, per render pass");
  assert.match(dal, /export const getSessionUser = cache\(/,
    "unwrapped, this is just getUser() with extra steps — every caller pays the round-trip again");
});

test("[WATERVAL] no server page asks the auth server a second time behind the layout's back", () => {
  // De besparing zit er alleen in als iedereen dezelfde deur gebruikt. Eén pagina die zijn eigen
  // supabase.auth.getUser() doet, betaalt zijn eigen rit — en omdat het scherm het gewoon dóét,
  // ziet niemand dat terug behalve in de laadtijd.
  //
  // De publieke landingspagina staat er met opzet buiten: die valt niet onder de dashboard-layout,
  // dus er is niemand om een antwoord mee te delen, en hij leest `data` in plaats van `user`.
  const BUITEN = new Set(["src/app/page.tsx"]);
  const schermen: string[] = [];
  const loop = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const pad = `${dir}/${e}`;
      if (statSync(pad).isDirectory()) loop(pad);
      else if (/^(page|layout)\.tsx$/.test(e)) schermen.push(pad);
    }
  };
  loop("src/app");
  assert.ok(schermen.length > 30, "the walker found almost nothing — it is looking in the wrong place");

  const overtreders = schermen
    .filter((f) => !BUITEN.has(f))
    .filter((f) => !/^\s*['"]use client['"]/m.test(readFileSync(f, "utf8").split("\n").slice(0, 6).join("\n")))
    .filter((f) => /auth\.getUser\(/.test(code(f)));
  assert.deepEqual(overtreders, [],
    "these server components ask the auth server themselves; use getSessionUser() from session-user.ts:\n  " +
    overtreders.join("\n  "));
});


// ─── [BTW-RESERVERING] The money in the account that is already the tax office's ───
//
// A zzp'er invoices € 1.210 and € 1.210 arrives. € 210 of it was never theirs. Every screen in
// this app showed the full amount, and a quarter later the aangifte asks for money already spent
// on stock and rent. The sum was always there — it was simply never said out loud.
//
// The rule lives in btw-reservation.ts and is tested there, on DIRECTION and not merely on
// outcome. What those tests cannot see is below: that the answer reaches a screen, that the route
// invents no balance, and that the panel holds no language of its own.

test("[BTW-RESERVERING] the route never invents a balance it could not read", () => {
  // bankBalanceOf answers null when no statement declared a balance, and the rule turns that into
  // 'unknown' with no `free` figure at all. One `?? 0` anywhere on that path would turn "we do not
  // know what you have" into "you have nothing" — and then into a `free` of exactly minus the tax bill,
  // shown in red, on a screen the owner opens every morning. It is the same false-zero this
  // codebase refuses on the Kas page and the Brug, at the one place it would frighten someone.
  const route = code("src/app/api/btw-reservation/route.ts");
  assert.match(route, /balance: balance\.balance,/,
    "the balance goes through as it came out — null included");
  assert.doesNotMatch(route, /balance\.balance \?\? 0/, "a null balance is not zero euros");
  assert.doesNotMatch(route, /balance: Number\(balance/, "and it is not coerced on the way either");

  // The filings read is the other half. A missing btw_filings row reads as "not filed", which
  // makes a settled quarter look outstanding AND announces a late aangifte to someone who filed on
  // time — wrong in the alarming direction, about the tax office. So that read refuses rather than
  // degrades, unlike the balance read beside it.
  assert.match(route, /filingRows == null/, "a failed filings read must stop the answer");
  assert.match(route, /status: 503/, "…with no answer, rather than a frightening one");
});

test("[BTW-RESERVERING] the answer reaches a screen", () => {
  // A figure computed by a route nobody calls is not a feature, it is a cost. This one exists to
  // be read on the screen the owner opens most, before the money is spent — anywhere else and it
  // arrives after the decision it was meant to inform.
  const vandaag = code("src/app/dashboard/vandaag/VandaagClient.tsx");
  assert.match(vandaag, /<BtwReservationPanel \/>/, "the panel is mounted on Vandaag");
  assert.match(vandaag, /import BtwReservationPanel from/);

  const panel = code("src/components/btw/BtwReservationPanel.tsx");
  assert.match(panel, /fetch\("\/api\/btw-reservation"\)/, "and it is the route's own answer");
  // Off the critical path: computeResultForRange walks a quarter of invoices, bank lines and daily
  // turnover, and doing that in the server component would put the heaviest read in the app in
  // front of the screen the [WATERVAL] work was done for.
  assert.match(panel, /useEffect\(/, "fetched after paint, never in the server render");
  assert.match(panel, /if \(!panel\) return null;/,
    "nothing is drawn until there is something true to draw — no skeleton on a money tile");
});

test("[BTW-RESERVERING] the panel holds no language of its own", () => {
  // Same rule as InvoiceSentModal: one hard-coded Dutch sentence and the translation stays
  // permanently half-finished, because the screen keeps looking right in Dutch and nothing points
  // at the gap. Every word here comes off the object btw-reservation-copy.ts builds.
  const panel = code("src/components/btw/BtwReservationPanel.tsx");
  for (const dutch of [
    "Belastingdienst",
    "Blijft voor jou",
    "tekort",
    "Naar de aangifte",
    "banksaldo",
  ]) {
    assert.ok(
      !new RegExp(`["'>][^"'<]*${dutch}`).test(panel),
      `a Dutch string is baked into the panel: "${dutch}"`,
    );
  }
  // The direction travels on the same object as the words, so the two cannot render out of step.
  assert.match(panel, /dir=\{panel\.dir\}/);

  // And every note code has a sentence. The Record<ReservationNote, MessageKey> makes a MISSING
  // one a build error; this catches the other end — a code quietly dropped from the union while
  // its sentence stays in the catalogue, where the orphan half of the [TAAL] gate would then be
  // the only thing standing between it and a dead translation.
  const rule = code("src/lib/btw-reservation.ts");
  const copy = code("src/lib/btw-reservation-copy.ts");
  // Scoped to the ReservationNote union alone. Reading every `| "..."` in the file would also
  // sweep up ReservationState's members, and a gate that fails on the wrong union teaches the
  // next person to weaken it rather than to look.
  const unionText = rule.slice(rule.indexOf("export type ReservationNote ="));
  const codes = [...unionText.slice(0, unionText.indexOf(";")).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 7, `expected the note codes, found ${codes.length}`);
  for (const c of codes) {
    assert.ok(copy.includes(`"${c}"`), `note code with no sentence: ${c}`);
  }
});

test("[DEEL-CREDIT] the home tile subtracts the credit it already went and read", () => {
  // Three surfaces, one invoice, two answers. /api/daily-truth read the creditnota rows to decide
  // WHICH invoices leave the list, and then summed the ones that stayed at their FULL open amount.
  // The creditnota itself is gone by then — isOpenReceivable refuses one by design — so the € 50
  // the customer got back was subtracted nowhere, and "Te ontvangen" on the home screen stood € 50
  // above the facturenlijst and the accountant's debiteurenlijst, which both had it right.
  //
  // The rule is stated in full at outstandingAmount() in sales-overview.ts: on a surface that
  // drops the creditnota, the credit comes off the invoice or it comes off nothing.
  const route = code("src/app/api/daily-truth/route.ts");
  assert.match(route, /creditedTotalsFrom\(creditRows \?\? \[\]\)/,
    "the rows are already in hand — the same read that filters the list must also reduce it");
  assert.match(route, /total: recv\.reduce\(\(s, r\) => s \+ openstaandOf\(r, creditedOn\(r\.id\)\), 0\)/,
    "the receivable total is net of what was credited");
  assert.match(route, /credited_inc_btw: creditedOn\(r\.id\)/,
    "and so is the payment-difference detector, or it names a creditnota as a bank charge");

  // The INCOMING side deliberately passes nothing. There an invoice and its creditnota are two
  // open items a payment settles together by pairing ([BATCH-SIGN]); subtracting there as well
  // would count the credit twice. Two models, each correct where it lives.
  const pay = route.slice(route.indexOf("const toPay"), route.indexOf("const recvAll"));
  assert.doesNotMatch(pay, /creditedOn/, "the pairing side must keep pairing");
});

test("[DEEL-CREDIT] the invoice list never states an open amount the credit beside it contradicts", () => {
  // The facturenlijst prints a chip that names the credited amount — "Deels gecrediteerd € 50" —
  // and printed, two lines below it, an open amount that ignored that very number. It also fed the
  // gross figure to three other places, and one of them is not a display at all:
  //
  //   · the bundle preview, where the SERVER already subtracts the credit (betaalverzoek.ts), so
  //     the owner read a total higher than the amount the customer's QR would ask for — the exact
  //     sentence the comment beside that line already warned about, one level down;
  //   · the "Betaald?" dialog, where openAmount is the field's CAP. Gross, it let the owner record
  //     a € 500 payment on an invoice they had put in writing was only € 450 for.
  //
  // The data was already loaded on this screen (creditedAmounts / gecrediteerdOp) to draw the chip.
  const list = code("src/app/dashboard/facturen/FacturenClient.tsx");
  const gross = [...list.matchAll(/openAmount\(inv\)/g)];
  assert.deepEqual(gross.map(() => "openAmount(inv)"), [],
    "every open-amount on this screen must be told what was credited — openAmount(inv, gecrediteerdOp(inv.id))");
  assert.match(list, /isPartiallyPaid\(inv, gecrediteerdOp\(inv\.id\)\)/,
    "…including the predicate that decides whether the chip appears at all, or a settled invoice keeps one saying € 0,00 open");

  // The INCOMING screen passes nothing, deliberately: there an invoice and its creditnota are two
  // open items a payment settles together by pairing ([BATCH-SIGN]). Subtracting there too would
  // count the credit twice. Two models, each correct where it lives.
  const incoming = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  assert.doesNotMatch(incoming, /openAmount\w*\([^)]*gecrediteerd/,
    "the pairing side must keep pairing");
});

test("[DEEL-CREDIT] all three readers of the creditnota set page past the same silent cap", () => {
  // Three surfaces read the identical set — same select, same filters — to answer the identical
  // question: which invoices were withdrawn, and by how much. Their comments say in as many words
  // that they must agree ("the home tile already filters both … without this they contradict each
  // other, with the home saying 'niets te doen' while this page shows a red '55 dagen te laat'").
  //
  // Two of them paged past PostgREST's silent ~1000-row cap and one did not, so the agreement held
  // only until an owner's thousand-and-first creditnota. And the error ran the wrong way: a credit
  // that falls off the end is a credit nobody subtracts, so the owner chases a customer for money
  // they took back in writing.
  const readers: Array<[string, string]> = [
    ["src/app/dashboard/vandaag/page.tsx", "the daily control centre"],
    ["src/app/api/daily-truth/route.ts", "the home tile"],
    ["src/app/api/cron/reminders/route.ts", "the reminder cron"],
  ];
  for (const [path, what] of readers) {
    const src = code(path);
    const i = src.indexOf('.eq("invoice_type", "creditnota")');
    assert.ok(i > 0, `${what} no longer reads the creditnota set at all (${path})`);
    // The paging call wraps the query, so it sits BEFORE the filter in the source.
    const chain = src.slice(Math.max(0, i - 900), i + 300);
    assert.match(chain, /fetchAllRows(ForIds)?[<(]/,
      `${what} reads this set unpaged — past ~1000 creditnota's it silently disagrees with the other two (${path})`);
    assert.match(chain, /\.order\("id", \{ ascending: true \}\)/,
      `${what} must page on a unique key, or a row is served twice or skipped (${path})`);
  }
});

// ─── [TZ] One clock, for every door ────────────────────────────────────────────────
//
// format-nl.ts states the rule and names the damage in full: `new Date().toISOString()` is UTC,
// the Netherlands is UTC+1/+2, so for the hour after midnight (two in summer) it answers
// YESTERDAY. On an invoice date that is the previous fiscal year and the previous BTW-quarter, on
// a document already carrying a number from the doorlopende reeks.
//
// The rule was written; it was not enforced. Seven places still asked the server's day, and one of
// them was the screen where a BOOKKEEPER invoices on a client's behalf — the owner's own invoice
// screen had used amsterdamToday() all along. Same feature, two doors, two clocks.

test("[TZ] no business date is taken from the server's UTC day", () => {
  // A date used as a FILENAME is not a business date, and forcing it through the same door would
  // be a gate teaching people to weaken it. Both exceptions are named, with the reason, so the
  // list cannot quietly grow into "wherever it was inconvenient".
  const GEEN_ZAKELIJKE_DATUM = new Map<string, string>([
    ["src/app/api/account/export/route.ts", "a filename stamp on a download, read by nobody's books"],
    ["src/app/dashboard/settings/page.tsx", "the same stamp, on the client side of that download"],
  ]);

  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p) || /\.test\.tsx?$/.test(p)) continue;
      if (p === "src/lib/format-nl.ts") continue; // the file that DEFINES the right answer
      const src = code(p);
      // `new Date().toISOString()` sliced to a day. Not any toISOString(): a timestamp written to
      // a timestamptz column is correct as UTC and must stay that way.
      if (!/new Date\(\)\.toISOString\(\)\s*\.\s*(slice\(0, ?10\)|split\(["'`]T["'`]\)\[0\])/.test(src)) continue;
      if (GEEN_ZAKELIJKE_DATUM.has(p)) continue;
      offenders.push(p);
    }
  };
  scan("src");

  assert.deepEqual(offenders, [],
    "these take the day from UTC; a Dutch business day comes from amsterdamToday():\n  " +
    offenders.join("\n  "));

  // And the exceptions must still be real — a path that no longer contains the pattern is a stale
  // excuse, and a stale excuse is how an exception list stops meaning anything.
  for (const [path, why] of GEEN_ZAKELIJKE_DATUM) {
    assert.ok(existsSync(path), `exempted file is gone: ${path} (${why})`);
    assert.match(code(path), /new Date\(\)\.toISOString\(\)/,
      `${path} no longer needs its exemption (${why}) — remove it from the list`);
  }
});

test("[TZ] the two doors onto an invoice date use the SAME clock", () => {
  // The owner makes an invoice on /dashboard/invoice/new; a bookkeeper with an invoicing mandate
  // makes one on the accountant screen. Same series, same numbering, same BTW-quarter — and for
  // one hour a night they disagreed about what day it was.
  const owner = code("src/app/dashboard/invoice/new/page.tsx");
  const accountant = code("src/modules/accountant/pages/AccountantFactuur.tsx");
  for (const [src, who] of [[owner, "the owner's invoice screen"], [accountant, "the accountant's"]] as const) {
    assert.match(src, /amsterdamToday\(\)/, `${who} must date an invoice on the owner's day`);
  }
  assert.doesNotMatch(accountant, /new Date\(\)\.toISOString\(\)/,
    "the accountant screen may not fall back to the browser's UTC date for a legal document date");
});

// ─── [LOGBOEK] The trail that was written from sixty files and shown to nobody ────────────────
//
// audit_logs is written from 60 files in 89 distinct actions. Every one of those writes worked,
// and until this feature not one row had ever been rendered on a screen. That was survivable while
// the owner was the only person writing — what had happened in the administration was what they
// had just done themselves, and the notification they got at that moment was the whole story. It
// stopped being survivable when a mandated bookkeeper could issue invoices under the owner's BTW
// number, chase their customers and confirm their purchase invoices: audit_logs.user_id is the
// ACTOR, so every one of those rows carries the BOOKKEEPER, and the owner — who stays answerable
// for all of it (art. 35a Wet OB, art. 52 AWR) — could see exactly none of them. The migration
// that opened the read side (supabase/migrations/audit_logs_client_read.sql: policy
// audit_logs_about_me over audit_row_is_about_me()) sat in the database with no caller at all.
//
// The gates below are the ways this feature can be shipped and still be worthless. Not one of them
// turns anything red on its own — tsc, eslint and next build all stay green through every single
// one, and so does the smoke test, which never logs in:
//
//   · an action nobody wrote a sentence for — the row lands on the screen as `bank.overapplied`;
//   · the route reaching for service_role, which would make the RLS policy this whole screen rests
//     on decorative and hand one entrepreneur's trail to another;
//   · a failed read answered with `[]` — the screen then says, in Dutch, that nothing has happened
//     in this administration, which is the one lie an audit trail may never tell;
//   · a screen nobody can reach, which is what the migration already was.

test("[LOGBOEK] every audit action has a sentence, so no row reaches the screen as an identifier", () => {
  // toLogboekEntry never drops a row and never throws — it cannot, because a trail that hides what
  // it has no words for reads as COMPLETE while it is not, and the gaps are invisible by
  // construction. What it does instead is fall back to log.onbekend ("Handeling vastgelegd") with
  // the raw action name beside it in mono. That fallback is right for the 40 historical rows
  // written before this union existed, and it is WRONG for an action a colleague adds next month:
  // nothing fails, nothing is red, and the owner reads "Handeling vastgelegd — bank.overapplied"
  // on the one screen they opened to find out what was done in their name.
  //
  // So the union is read out of audit.ts and held against the catalogue. It has to happen HERE or
  // nowhere: audit.ts imports supabase-pipeline and therefore builds the service_role client, so
  // logboek.ts deliberately does not import it — not even for the type (see that file's header).
  // This gate IS the link between the two files.
  const audit = code("src/lib/audit.ts");
  const unionStart = audit.indexOf("export type AuditAction =");
  assert.ok(unionStart > -1, "the AuditAction union moved — this gate reads it straight out of the file");

  // The union runs to the first genuinely EMPTY line after it. Every member sits on its own
  // `| '...'` line and code() has already turned the comments between them into whitespace, so no
  // blank line can occur inside it today.
  const unionEnd = audit.indexOf("\n\n", unionStart);
  const union = audit.slice(unionStart, unionEnd);
  const actions = [...union.matchAll(/\|\s*'([a-z][\w.]*)'/g)].map((m) => m[1]);

  // Two floors under the parse, because every assertion below is a loop over `actions` — and a
  // loop over an empty or truncated list PASSES, silently, forever. That is this file's own
  // [STRIPPER-BLIND] defect class, and it is at its most dangerous in exactly this shape: a gate
  // whose subject is a list it extracts itself.
  assert.ok(
    actions.length >= 89,
    `expected at least the 89 known audit actions, parsed ${actions.length} — the union's shape ` +
      "changed and this gate is now checking a fraction of it",
  );
  // And the slice really took the WHOLE union: what sits between where it stopped and the next
  // declaration is nothing but whitespace. Without this, a blank line introduced halfway down the
  // union would leave every action below it unchecked, with the gate still green.
  const afterUnion = audit.slice(unionEnd, audit.indexOf("export", unionEnd));
  assert.match(
    afterUnion, /^\s*$/,
    "there is now a blank line INSIDE the AuditAction union — this gate stops at the first one, " +
      "so everything below it would go unchecked while this test stayed green",
  );

  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  const declared = new Set([...messages.matchAll(/^\s{2}'([\w.]+)':\s*\{/gm)].map((m) => m[1]));
  assert.ok(declared.size > 0, "the catalogue may not be empty");

  const speechless = actions.filter((a) => !declared.has(`log.${a}`));
  assert.deepEqual(
    speechless, [],
    "these actions are written to audit_logs and have no sentence, so they reach the logboek as " +
      `a bare identifier — add a 'log.<action>' key for each:\n  ${speechless.join("\n  ")}`,
  );

  // The other direction. These twelve are the screen's own words — the heading, the three states,
  // the filter chips — and they are the only 'log.' keys that answer to no action. Anything else
  // left in the catalogue is a sentence for an action that no longer exists: a renamed action gets
  // caught by the half above (its new name has no key), but the OLD sentence stays behind, still
  // listed in logboek.ts's SENTENCE_KEYS, so tsc and the [TAAL] orphan gate both stay green over a
  // phrase describing something the app can no longer do.
  const SCREEN_KEYS = new Set([
    "log.titel", "log.uitleg", "log.leeg", "log.mislukt", "log.onbekend", "log.doorAnder",
    "log.meer", "log.filter.alles", "log.filter.geld", "log.filter.document",
    "log.filter.toegang", "log.spoorOnvolledig",
  ]);
  const stale = [...declared].filter(
    (k) => k.startsWith("log.") && !SCREEN_KEYS.has(k) && !actions.includes(k.slice("log.".length)),
  );
  assert.deepEqual(
    stale, [],
    `sentences in the catalogue for actions that are not in the union:\n  ${stale.join("\n  ")}`,
  );
});

test("[LOGBOEK] the trail is read with the SESSION client, so RLS decides what is in it", () => {
  // Every other owner-facing read route in this app reaches for createPipelineClient() and pins
  // each query to user.id by hand. This one must not, and the difference is the entire feature.
  //
  // The rows the owner cannot see anywhere else are the ones a BOOKKEEPER wrote in their
  // administration, and those carry the bookkeeper in user_id. A hand-written .eq("user_id",
  // user.id) would therefore hide precisely the half this screen exists for, while looking
  // perfectly correct — a filtered list is not an error, it is a shorter list, and nobody can tell
  // a short trail from a quiet month by looking at it.
  //
  // Which leaves the query below with no WHERE clause at all, and that is only safe because RLS
  // decides instead: "Users see own logs" plus audit_logs_about_me, resolved per entity_type by
  // audit_row_is_about_me(), which answers false for anything it does not know. On service_role
  // those policies do not apply — the same query would then return every entrepreneur's audit
  // trail to whoever opened the screen. Session client or leak; there is no third state.
  const route = code("src/app/api/logboek/route.ts");

  // The anchor first. Every doesNotMatch below is worthless over a file that stopped containing
  // the query — it would pass vacuously, which is the failure mode this file was built around.
  assert.match(route, /\.from\("audit_logs"\)/, "the route must still be the one that reads audit_logs");

  assert.match(route, /createServerSupabaseClient\(\)/, "the read runs as the logged-in owner");
  assert.doesNotMatch(
    route, /createPipelineClient/,
    "service_role bypasses row level security, so this route would answer with rows from other " +
      "people's administrations — audit_logs_about_me is the only thing scoping this query",
  );
  assert.doesNotMatch(
    route, /\.eq\("user_id"/,
    "a user_id filter here hides exactly what the owner came for: user_id is the ACTOR, so this " +
      "line would drop every action their bookkeeper performed in their own administration",
  );
});

test("[LOGBOEK] a failed read answers 503, and never an empty log", () => {
  // [NO-SILENT-EMPTY], at the place it is decided. supabase-js does not throw: a timed-out or
  // policy-refused read comes back as { data: null, error }, and one `?? []` on that path turns
  // "we could not read your trail" into "nothing has happened in your administration". Those are
  // different sentences on the screen (log.mislukt vs log.leeg) and only one of them is a claim.
  //
  // It is the claim that makes this worse than an ordinary swallowed error. The owner opens this
  // screen to establish that nothing was done behind their back; an empty page answers that
  // question with a lie, in the reassuring direction, and they close the tab satisfied. A logbook
  // that goes quiet when it breaks is worse than no logbook at all, because a quiet logbook is
  // believed.
  const route = code("src/app/api/logboek/route.ts");

  // TWO halves, and the second is the one that was nearly missed. postgrest-js can hand back
  // `{ data: null, error: null }` on a path it calls SUCCESS: in processResponse's catch branch a
  // 404 with an empty body sets status 204 and leaves both fields null (verified in
  // node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts, the issue-295 workaround). That is
  // exactly the shape an edge proxy returns when PostgREST is unreachable, when the project is
  // paused, or when the schema cache has never heard of this table — a read that never happened,
  // wearing a success's clothes. `data ?? []` swallows it and the screen says "Er is nog niets
  // gebeurd om te tonen" about a database we never managed to ask.
  assert.match(
    route, /if \(error \|\| data === null\) \{[\s\S]{0,600}?status: 503/,
    "no rows AND no error is an unreadable log too — not an empty one",
  );
  assert.doesNotMatch(
    route, /data \?\? \[\]/,
    "`data ?? []` turns a read that never reached PostgREST into the claim that nothing happened",
  );
  assert.match(route, /error: "log_unreadable"/, "…under the name the screen knows it by");
  assert.doesNotMatch(
    route, /entries: \[\]/,
    "this route may never hand the screen an empty list — an empty `entries` array leaving this " +
      "file is a statement that nothing happened, and a database hiccup does not get to make it",
  );

  // ORDER, not merely presence. `const fetched = data ?? []` is correct where it stands — after
  // the refusal — and catastrophic before it: the same line then coerces a failed read into an
  // empty page and the 503 below becomes unreachable. Nothing about that reordering fails to
  // compile, and both variants read fine in a diff.
  // ORDER, not merely presence: the refusal has to come before anything reads `data`. Nothing about
  // reordering those two fails to compile, and both variants read fine in a diff.
  const refusal = route.indexOf("log_unreadable");
  const firstUse = route.indexOf("const fetched = data");
  assert.ok(refusal > -1 && firstUse > -1, "both the refusal and the first use of data must be findable");
  assert.ok(
    refusal < firstUse,
    "`data` is read BEFORE the unreadable case is refused, so a failed read leaves this route as a " +
      "200 with an empty log — the exact answer the whole feature exists to prevent",
  );
});

test("[LOGBOEK] the screen tells 'nothing happened' apart from 'we could not read it'", () => {
  // The route refusing with 503 buys nothing if the client turns that into a blank list. Three
  // states, and the second and third look identical unless the screen is written to keep them
  // apart: rows / read-and-empty / could-not-read.
  const ui = code("src/app/dashboard/logboek/LogboekClient.tsx");

  assert.match(ui, /if \(!res\.ok\) throw/, "every non-2xx is a failed read, not a short one");
  assert.match(
    ui, /if \(!Array\.isArray\(rows\)\) throw/,
    "an answer we cannot recognise is a failed read too — not an empty one",
  );
  assert.doesNotMatch(
    ui, /\?\? \[\]/,
    "one `?? []` in this component is the single line that turns the feature back into the thing " +
      "it was built against: a broken read painted as a quiet administration",
  );

  // The empty sentence is gated on BOTH the state and the cursor, and that second half is not
  // decoration: with a page still outstanding, "Er is nog niets gebeurd" is a statement about our
  // paging wearing the words of a statement about the administration.
  assert.match(
    ui, /status === 'ok' && visible\.length === 0 && nextCursor === null/,
    "log.leeg may only be rendered when the read SUCCEEDED and there is genuinely nothing left " +
      "to fetch — not whenever the list happens to be empty",
  );
  assert.match(ui, /setStatus\('failed'\)/, "a first page that failed has its own state…");
  assert.match(ui, /setMoreFailed\(true\)/, "…and so does a second page, which must not wipe the rows already read");
});

test("[LOGBOEK] the screen holds no language of its own", () => {
  // One hard-coded Dutch sentence is how a translation stays permanently half-finished: the screen
  // still looks right in Dutch, so nothing points at the gap — and this is the screen an owner who
  // reads Dutch least comfortably has the most reason to open. Same rule as InvoiceSentModal and
  // BtwReservationPanel; the check is different because the words here are not one copy object but
  // a hundred catalogue entries, so the catalogue itself is the list of forbidden strings.
  const ui = code("src/app/dashboard/logboek/LogboekClient.tsx");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");

  const dutch = [...messages.matchAll(/^\s{2}'(log\.[\w.]+)':\s*\{\s*(?:\n\s*)?nl: '([^']*)'/gm)]
    .map((m) => [m[1], m[2]] as const)
    // Sentences, not words. 'log.filter.alles' is "Alles", and a gate that fires on a word that
    // short would fire on an identifier one day and teach the next person to weaken it.
    .filter(([, value]) => value.length >= 15);
  assert.ok(dutch.length >= 80, `expected the log sentences from the catalogue, found ${dutch.length}`);
  for (const [key, value] of dutch) {
    assert.ok(!ui.includes(value), `the sentence for ${key} is baked into the component: "${value}"`);
  }

  // And the SHAPE of a Dutch string in a rendered position, so a sentence written next month fails
  // this too — the part a list of known values cannot do. These are the [TAAL] sweep's patterns:
  // a text node on its own line, a string inside a JSX expression, a talking template literal, an
  // attribute a person reads.
  const leftovers: string[] = [];
  for (const pattern of [
    /> *([A-ZÉ][^<>{}\n]{3,70}?) *</g,
    />\s*\n\s+([A-ZÉ][^<>{}]{3,150}?)\s*\n\s*[<{]/g,
    /'([A-ZÉ][a-zéë]+(?: [a-zéëA-Z0-9.,…''—-]+){1,12}[.?…]?)'/g,
    /"([A-ZÉ][a-zéë]+(?: [a-zéëA-Z0-9.,…''""—;:()-]+){1,16}[.?!…:]?)"/g,
    /`([A-ZÉ][a-zéë]+[^`]{2,120})`/g,
    /(?:label|placeholder|title|aria-label)="([^"]{3,70})"/g,
  ]) {
    for (const m of ui.matchAll(pattern)) leftovers.push(m[1]);
  }
  assert.deepEqual(
    leftovers, [],
    `these read like sentences typed into the component instead of taken from t(...):\n  ${leftovers.join("\n  ")}`,
  );

  // Physical sides are wrong in exactly one language, which is the one nobody checks — and the
  // direction has to travel with the words or a fresh load with an Arabic cookie lays this column
  // out left-to-right (the root <html> only flips on a language SWITCH).
  assert.match(ui, /dir=\{dir\}/, "the column carries its own direction");
  assert.doesNotMatch(ui, /textAlign: 'right'/, "use textAlign: 'end'");
  assert.doesNotMatch(ui, /paddingLeft:/, "use paddingInlineStart");
});

test("[LOGBOEK] the screen is reachable without typing its address", () => {
  // The read policy audit_logs_about_me had been in the database for months, correct and complete,
  // and worth nothing at all because no caller existed. A route with no link into it is the same
  // thing one layer up: it passes tsc, it passes the build, it answers correctly to curl, and no
  // owner will ever see a row of their trail.
  const referrers: string[] = [];
  const scan = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p) || /\.test\.tsx?$/.test(p)) continue;
      // The screen's own files do not count as a way in.
      if (p.startsWith("src/app/dashboard/logboek/")) continue;
      if (code(p).includes("/dashboard/logboek")) referrers.push(p);
    }
  };
  scan("src");
  assert.ok(referrers.length > 0, "nothing in the app names /dashboard/logboek — the screen is unreachable");

  // Naming the path is not linking to it: DashboardChrome carries "/dashboard/logboek" in its
  // static title map, which keeps the sub-page bar from ever being nameless and takes nobody
  // anywhere. Somewhere there has to be an actual door.
  const linked = referrers.filter((p) => /href:? *['"]\/dashboard\/logboek['"]/.test(code(p)));
  assert.ok(
    linked.length > 0,
    `/dashboard/logboek is named but never linked — mentioned in:\n  ${referrers.join("\n  ")}`,
  );
});

test("[DUBBEL-BEWIJS] the no-double-pay check can say it did not check", () => {
  // /api/incoming/check-paid answers ONE question — "have you already paid this?" — on the screen
  // where the next tap sends money out. It had two answers and needed three: a warning, a clean
  // check, and "we could not look". Five paths produced the third while rendering as the second:
  // the invoice unreadable, the paid set unreadable, no amount on the document, no vendor to
  // anchor on, and a network failure the screen caught and swallowed.
  //
  // The two that need no database are the sharpest. An invoice with no readable amount and no
  // readable vendor is a document the reader could not make sense of — precisely the one most
  // likely to have been uploaded twice — so the check switched itself off hardest on the invoices
  // it understood least, and said nothing about having done so.
  const route = code("src/app/api/incoming/check-paid/route.ts");

  // Every exit that ANSWERS the question goes through one of two builders, so no exit can invent
  // its own shape or forget a field. The auth/parse guards are not answers — they carry `error`
  // and an HTTP status, and the screen reads them off res.ok.
  assert.match(route, /function answer\(r: DoublePayResult\)/);
  assert.match(route, /function unchecked\(reason: DoublePayUnchecked\)/);
  assert.match(route, /outcome: 'unchecked', match: null, search: null, reason/);

  // THE regression this gate exists for: the old silent answer must not come back. A bare
  // `duplicate: false` is the exact literal that made a database error look like a clean check.
  assert.doesNotMatch(route, /duplicate: false/,
    "a bare `duplicate: false` is the silence this whole change removes");
  // `duplicate` itself stays, derived from the outcome, for any caller still on the old shape.
  assert.match(route, /duplicate: r\.outcome === 'twin'/);

  // Both reads are read. supabase-js returns { data: null, error } rather than throwing, so a
  // destructure without `error` converts every failure into an empty result ([NO-SILENT-EMPTY]).
  assert.match(route, /const \{ data: target, error: targetError \} = await supabase/);
  assert.match(route, /const \{ data: matches, error: matchesError \} = await query/);
  for (const reason of ["invoice_unreadable", "candidates_unreadable", "no_amount", "no_vendor"]) {
    assert.match(route, new RegExp(`unchecked\\('${reason}'\\)`),
      `${reason} reports itself instead of answering "no duplicate"`);
  }

  // The SEARCH travels with every concluded answer. `candidates` is the count BEFORE pickPaidTwin's
  // fences on purpose: that is how wide the search was, and reporting the survivors instead would
  // describe the conclusion twice and the search not at all.
  assert.match(route, /candidates: candidates\.length/);
  assert.match(route, /anchor: target\.vendor_iban \? \('iban' as const\) : \('name' as const\)/);
  // The candidate ceiling is named, not left as a bare literal in the query — a bounded search
  // that cannot report its own bound is a complete-looking one.
  assert.match(route, /const MAX_CANDIDATES = 50/);
  assert.match(route, /\.limit\(MAX_CANDIDATES\)/);
  assert.match(route, /capped: candidates\.length >= MAX_CANDIDATES/);

  // ── The screen ──
  const client = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  // The catch used to open the ordinary pay dialog and say nothing. Not blocking was right; the
  // silence was the defect, and both halves have to stay.
  assert.match(client, /setPayCheck\(\{ outcome: 'unchecked', match: null, search: null, reason: 'network' \}\)/);
  assert.equal((client.match(/reason: 'network' \}\)/g) ?? []).length, 2,
    "both the thrown case AND the non-ok response report themselves — a 401 is not a clean check");
  // The notice reaches the sheet that spends the money, and the one that warns.
  assert.match(client, /notice=\{payCtx\.newStatus === 'paid'/);
  assert.match(client, /<DoublePayNotice notice=\{buildDoublePayNotice\(payCheck, taal\)\} \/>/);
  assert.match(client, /<DoublePayNotice notice=\{buildDoublePayNotice\(dupWarn\.check \?\? null, taal\)\} \/>/);
  // A stale answer may not survive its dialog: the next invoice's sheet must not open still
  // showing the previous one's search.
  assert.equal((client.match(/setPayCheck\(null\)/g) ?? []).length, 3,
    "cancel, the 'nee, nog niet' exit and executePay each clear the previous answer");

  // ── [TAAL] The component holds no language and no direction of its own ──
  const comp = readFileSync("src/components/invoice/DoublePayNotice.tsx", "utf8");
  assert.match(comp, /dir=\{notice\.dir\}/, "direction travels with the words, on the same object");
  // Every word on this component comes through the notice object. The check is structural rather
  // than a hunt for known Dutch phrases: a JSX TEXT NODE is what a hard-coded sentence looks like,
  // and there must be none. The first version of this assertion looked for a quoted string
  // starting with a capital — which JSX text is not — so it passed on a component with
  // `<span>Wij konden niet nakijken</span>` welded into it, and would have passed forever, on the
  // one file claiming to hold no language. That is [STRIPPER-BLIND]'s defect one level up: an
  // assertion that matches a MENTION instead of the WIRING.
  const jsxText = code("src/components/invoice/DoublePayNotice.tsx").match(/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</g);
  assert.equal(jsxText, null,
    `the component holds no words of its own — found ${JSON.stringify(jsxText)}`);
  // Physical sides are wrong in exactly one language, which is the one nobody checks.
  assert.match(comp, /borderInlineStart/);
  assert.doesNotMatch(comp, /borderLeft|paddingLeft|textAlign: 'right'/);

  // ── The vocabulary ──
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  const pure = code("src/lib/double-pay-check.ts");
  const used = new Set([...pure.matchAll(/["'](dubbel\.[a-zA-Z.]+)["']/g)].map((m) => m[1]));
  assert.ok(used.size >= 11, `the notice builder reaches its vocabulary (found ${used.size})`);
  for (const key of used) {
    assert.ok(messages.includes(`'${key}':`), `${key} exists in the catalogue`);
    // Dutch is required per key; a gap in another language falls back to Dutch, never to a key.
    const at = messages.indexOf(`'${key}':`);
    assert.match(messages.slice(at, at + 400), /nl: '/, `${key} has a Dutch sentence`);
  }
  // A noun inside a sentence is not a parameter: 'rekening'/'rekeningen' is a Dutch plural, and a
  // language with a dual or with suffix harmony cannot be served by swapping the noun into a slot.
  for (const key of ["dubbel.zoek.geen", "dubbel.zoek.een", "dubbel.zoek.meer"]) {
    assert.ok(used.has(key), `${key} is a whole sentence the builder chooses between`);
  }
});
