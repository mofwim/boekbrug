// [PAKKET-VERS] Pure node test — run: npx tsx src/lib/package-freshness.test.ts
//
// The scenario throughout: the accountant pulled the Q2 2026 package on 5 July at 09:00.
// Everything the client did BEFORE that moment is in the ZIP; the question is only ever what
// came AFTER — and of that, only what belongs to Q2.
import { packageFreshness, lastDownloadPerOwner, type PackageFreshnessInput } from "./package-freshness";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const OWNER = "ac22189e-0000-0000-0000-000000000000";
const PULLED = "2026-07-05T09:00:00+00:00";
const BEFORE = "2026-07-01T10:00:00+00:00";
const AFTER = "2026-07-12T10:00:00+00:00";

const empty = (): PackageFreshnessInput => ({
  downloadedAt: PULLED, ownerId: OWNER, year: 2026, quarter: 2,
  invoices: [], documents: [], bank: [], cash: [], turnover: [],
});

const invoice = (over: Record<string, unknown> = {}) => ({
  direction: "incoming", status: "received", sender_id: "someone", receiver_id: OWNER,
  invoice_date: "2026-06-20", created_at: AFTER, updated_at: null, ...over,
});

console.log("\n— nothing after the download means nothing to say —");
{
  const r = packageFreshness({ ...empty(), invoices: [invoice({ created_at: BEFORE })] });
  check("a row from before the download does not count", r.total === 0);
  check("…and the sentence says the package is current, with the date", /5 jul/.test(r.sentence) && /niets bijgekomen/.test(r.sentence));
  check("…and does not tell the accountant to re-download", !/opnieuw/.test(r.sentence));
}

console.log("\n— the package's own judgement decides what counts, not a restatement of it —");
{
  const r = packageFreshness({ ...empty(), invoices: [
    invoice(),                                          // received incoming, in quarter, new → counts
    invoice({ status: "processing" }),                  // unverified: NOT in the ZIP, so not stale either
    invoice({ status: "archived" }),                    // archived is excluded by the package fetch itself
    invoice({ invoice_date: "2026-07-20" }),            // Q3 invoice: another quarter's package
  ] });
  check("only the invoice the ZIP would contain counts", r.invoices === 1 && r.total === 1);
  check("the sentence names the part, so nobody hunts in the wrong list", /1 factuur\b/.test(r.sentence) && /opnieuw op\./.test(r.sentence));
}

console.log("\n— the verify-after-download hole: no new created_at, and the package still changed —");
{
  // At download time this invoice sat as 'processing' (not in the ZIP). A week later the client
  // verified it: status flips, updated_at moves, created_at stays old. Counting on created_at
  // alone reports a fresh package that is missing an invoice.
  const r = packageFreshness({ ...empty(), invoices: [
    invoice({ created_at: BEFORE, updated_at: AFTER }),
  ] });
  check("an invoice verified after the download counts through updated_at", r.invoices === 1);
}

console.log("\n— a null invoice_date is [DATE-GAP], not disqualification —");
{
  const r = packageFreshness({ ...empty(), invoices: [invoice({ invoice_date: null })] });
  check("a dateless verified invoice counts — the package ships it too", r.invoices === 1);
}

console.log("\n— null direction goes through effectiveDirection, like the package —");
{
  // direction null + receiver = owner → incoming; 'received' is verified for incoming.
  const r = packageFreshness({ ...empty(), invoices: [invoice({ direction: null })] });
  check("a null-direction row is attributed, not dropped", r.invoices === 1);
  // Same row but the owner is the SENDER → outgoing, and 'received' is not a verified
  // outgoing status → not in the ZIP → not stale.
  const r2 = packageFreshness({ ...empty(), invoices: [invoice({ direction: null, sender_id: OWNER, receiver_id: "someone" })] });
  check("…and the attribution changes the verdict exactly as it does in the ZIP", r2.invoices === 0);
}

console.log("\n— documents: the two doors into the ZIP, and no third —");
{
  const doc = (over: Record<string, unknown> = {}) => ({
    doc_type: "overig", period: "2026-Q2", shared: true, trashed: false, invoice_id: null,
    created_at: AFTER, ...over,
  });
  const r = packageFreshness({ ...empty(), documents: [
    doc(),                                                        // shared loose doc tagged Q2 → counts
    doc({ doc_type: "bankafschrift", shared: false }),            // statement tagged Q2 → counts
    doc({ doc_type: "bankafschrift", shared: false, period: null, created_at: "2026-08-02T10:00:00+00:00" }), // untagged statement uploaded in Q3 → Q3's package
    doc({ period: "2026-Q3" }),                                   // shared doc of another quarter
    doc({ trashed: true }),                                       // trashed → the package skips it
    doc({ invoice_id: "some-invoice" }),                          // rides with its invoice, counted there
    doc({ created_at: BEFORE }),                                  // already in the ZIP
  ] });
  check("exactly the statement and the shared Q2 doc count", r.documents === 2);
}

console.log("\n— bank, kas en omzet: quarter date plus added-after —");
{
  const r = packageFreshness({ ...empty(),
    bank: [ { docDate: "2026-05-04", createdAt: AFTER }, { docDate: "2026-07-04", createdAt: AFTER } ],
    cash: [ { docDate: "2026-04-08", createdAt: AFTER }, { docDate: "2026-04-08", createdAt: BEFORE } ],
    turnover: [ { docDate: "2026-06-30", createdAt: AFTER } ],
  });
  check("a Q2-dated bank row added after the pull counts; a Q3-dated one does not", r.bank === 1);
  check("a cash payment backdated INTO the quarter after the pull counts", r.cash === 1);
  check("the last day of the quarter is inside it", r.turnover === 1);
  check("the sentence lists every part it found", /1 bankregel, 1 kasboeking, 1 omzetdag/.test(r.sentence));
}

console.log("\n— an unreadable timestamp lands on the safe side —");
{
  const r = packageFreshness({ ...empty(), cash: [{ docDate: "2026-04-08", createdAt: "geen datum" }] });
  check("a row whose created_at cannot be read counts as changed, never as safe", r.cash === 1);
}

console.log("\n— lastDownloadPerOwner: the newest pull per client, this quarter only —");
{
  const rows = [
    { entity_id: `${OWNER}:2026-Q2`, created_at: "2026-07-01T08:00:00+00:00" },
    { entity_id: `${OWNER}:2026-Q2`, created_at: PULLED },              // later pull wins
    { entity_id: `${OWNER}:2026-Q1`, created_at: "2026-07-06T08:00:00+00:00" }, // other quarter
    { entity_id: "other-client:2026-Q2", created_at: BEFORE },
    { entity_id: null, created_at: PULLED },
    { entity_id: `:2026-Q2`, created_at: PULLED },                      // malformed: empty owner
  ];
  const m = lastDownloadPerOwner(rows, 2026, 2);
  check("the LAST download wins — the accountant works from his newest copy", m.get(OWNER) === PULLED);
  check("another client's pull is its own entry", m.get("other-client") === BEFORE);
  check("another quarter's pull does not leak in, and malformed ids are ignored", m.size === 2);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
