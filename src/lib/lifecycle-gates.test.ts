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
  const label = src.indexOf("schrijft automatisch af");
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
  assert.match(
    mod, /if \(newWork === 0 && !deadline\) return null/,
    "nothing new and no deadline band → NO message. Losing this line turns the whole thing into " +
      "a daily nag, which is strictly worse than the silence it replaced",
  );
  assert.match(
    mod, /DEADLINE_BANDS as readonly number\[\]\)\.includes\(days\)/,
    "the deadline speaks on its bands, not every day — otherwise it repeats itself for a month",
  );

  const cron = code("src/app/api/cron/accountant-daily/route.ts");
  // "New" must be measured against a window, not against the whole stack. Reading totalToConfirm
  // as the trigger is exactly the nag above.
  assert.match(cron, /created_at \?\? ""\) >= since/, "new work is measured against a window");
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
  const btn = src.slice(src.indexOf("runBooksAudit()"), src.indexOf("Reken mijn boeken na"));
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
  assert.match(
    email, /if \(cashSettledThisRun\)[\s\S]{0,220}?reconcileCashSettlements\(/,
    "and reconcile the kasboek once after the loop",
  );
  // The camera door reconciles in its existing side-effect block — the settlement must come FIRST,
  // or the drawer is a pass behind.
  const intake = code("src/app/api/intake/route.ts");
  const settleAt = intake.indexOf("apply_manual_payment");
  const reconcileAt = intake.indexOf("reconcileCashSettlements(pipeline");
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
  assert.match(ui, /Deze hoef je niet na te kijken/, "the tooltip must say what it is for");
  assert.match(ui, /Cijfers van de leverancier/, "and the badge must be on the row");
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
  assert.match(ui, /Lees opnieuw/, "and offer it in words");
  // The answer is always a sentence. A silent button on the one panel whose purpose is honesty
  // about what went missing would be the wrong thing twice over.
  assert.match(ui, /setRereadMessage\(typeof json\?\.message === "string"/, "success speaks");
  assert.match(ui, /setRereadMessage\(typeof json\?\.error === "string"/, "and so does failure");
});
