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
import { readFileSync, readdirSync, statSync } from "node:fs";

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
  const src = code("src/app/api/invoice/numbering/route.ts");
  assert.match(
    src, /const \{ count: issuedCount, error: lockError \}/,
    "the lock count dropped its error again — a database hiccup then reads as 'nobody has " +
      "invoiced yet' and the art. 35 numbering lock opens",
  );
  assert.match(src, /code: 'lock_check_unavailable'/, "an unreadable count must refuse, not unlock");
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
  const src = code("src/app/api/email/skipped/route.ts");
  assert.match(src, /error: skippedError/, "the skip-registry read must keep its error");
  assert.match(src, /error: couldNotReadError/, "and so must the unreadable-files count");
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

test("[INCASSO-CONFIRM] the switch sits after the sentence it controls", () => {
  // Trailing edge, where a switch lives on a phone: the label says what it controls and the
  // control is where the thumb reaches. Leading it also made the two lines of explanation hang off
  // a 20px column, starting the paragraph a third of the way across the card.
  //
  // Held here rather than in the render gate because this block only exists inside the EXPANDED
  // card, and that gate renders the collapsed list — an assertion there would match nothing and
  // pass forever, which is the shape of half the defects in this file.
  const src = code("src/app/dashboard/incoming/manage/IncomingManageClient.tsx");
  const label = src.indexOf("schrijft automatisch af");
  const toggle = src.indexOf("'toggle_on' : 'toggle_off'");
  assert.ok(label > 0 && toggle > 0, "both the label and the switch must still be there");
  assert.ok(label < toggle, "the switch renders after its label, not in front of it");
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
  const atomic = src.search(/rpc as any\)\("confirm_bank_payment"|rpc\("confirm_bank_payment"/);
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
  const btn = client.indexOf("Klopt, gecontroleerd");
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
