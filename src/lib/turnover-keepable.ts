// src/lib/turnover-keepable.ts
// [ARCHIEF-OPEN] Is this attachment a file /api/documents/reprocess could book as turnover or
// ledger? Run: npx tsx --test src/lib/turnover-keepable.test.ts
//
// WHY THIS EXISTS
// The e-mail door has exactly two outcomes for an attachment: it is an invoice (saved), or it is
// not (registered in the skip registry and the bytes are DROPPED). That second branch was written
// for advertising and read receipts, and it is correct for those. It is wrong for the one file
// this whole task is about: the daily till closing. That report is not an invoice — no supplier,
// no invoice number, nothing to pay — so a correct classifier confidently answers "not an invoice"
// and the app throws away the CASH SIDE of its own card income.
//
// The cost is measurable, not theoretical: daily_turnover holds zero days for Q1 and Q3 while
// € 253.439 of pos_income arrives over the bank. financial-result.ts only suppresses a card payout
// against a COVERED till day; with no covered day the amount falls through to omzet without a VAT
// rate, which is a `missing` that blocks the quarter. The reader for these files already exists
// and is already correct — it just never sees them.
//
// DERIVE, DON'T LIST — the point of this module
// The obvious implementation is a filename rule ("Jouw dagafsluiting - *.zip"). That is a list, and
// a list of one customer's export format at that. It would keep exactly today's file and silently
// drop the next till brand, the renamed export, the same report from a second location.
//
// So the question this module asks is not "is this the file we saw in production" but "would
// /api/documents/reprocess book this?" — answered by calling the SAME predicates that route calls:
// planSpreadsheetIngest for a sheet, looksLikeDailySalesReport for a PDF's text layer. Teach the
// reader a new till format and this door learns it in the same commit, for free. It also cannot
// drift into keeping files reprocess would refuse: the predicate IS the reader.
//
// What this module deliberately does NOT do: book anything. It answers a keep/drop question. The
// owner's [ZELF-EERST] switch says nothing books itself out of an unattended sync, and turnover
// feeds the VAT return, so the file is kept where the owner can see it and the booking stays a
// decision someone makes.

/** What kind of bookable file this is — the vocabulary the kept document is labelled with. */
export type KeepableKind = "dagomzet" | "grootboek";

export interface KeepVerdict {
  /** Keep the bytes as an owner-visible document instead of dropping them? */
  keep: boolean;
  /** Which reader would pick it up later. null when keep is false. */
  kind: KeepableKind | null;
  /** Dutch, shown to the owner next to the kept file. Empty when keep is false. */
  reason: string;
}

const DROP: KeepVerdict = { keep: false, kind: null, reason: "" };

/**
 * Cheap pre-filter on the name alone: only these extensions can ever reach a reader in
 * /api/documents/reprocess, so anything else is dropped without touching the bytes.
 *
 * This mirrors that route's own `isSheet`/`isPdf` test. Keep the two in step — the gate
 * [ARCHIEF-OPEN] in lifecycle-gates.test.ts asserts the extension sets are identical, because a
 * door that keeps a format the reader ignores builds a shelf of files nothing will ever book.
 */
export function couldBeBookableFile(filename: string): boolean {
  const name = (filename || "").toLowerCase();
  return /\.(xls|xlsx|csv|pdf)$/.test(name);
}

/**
 * Would a reader book this? `readSheet` and `readPdfText` are injected so this module stays pure
 * and testable — the caller supplies the same xlsx/unpdf pair the reprocess route uses.
 *
 * Never throws: a file that cannot be parsed is simply not ours, and the caller's existing
 * not-an-invoice path handles it exactly as before.
 */
export async function judgeKeepable(
  filename: string,
  bytes: Uint8Array,
  readers: {
    // `kind` is typed loosely on purpose: spreadsheet-ingest also answers "kasboek", and this
    // module must fall through on any kind /api/documents/reprocess does not book. A narrow union
    // here would make adding a fourth kind a type error in a file that has no opinion about it.
    planSheet: (bytes: Uint8Array) => { kind: string } | null;
    readPdfText: (bytes: Uint8Array) => Promise<string | null>;
    looksLikeDailySales: (text: string | null) => boolean;
  },
): Promise<KeepVerdict> {
  if (!couldBeBookableFile(filename)) return DROP;
  const name = filename.toLowerCase();

  if (/\.(xls|xlsx|csv)$/.test(name)) {
    let plan: { kind: string } | null = null;
    try {
      plan = readers.planSheet(bytes);
    } catch {
      return DROP; // unreadable as a sheet → not ours, and not our problem to report
    }
    if (plan?.kind === "turnover") {
      return { keep: true, kind: "dagomzet", reason: "kassa-omzet herkend — klaar om te boeken" };
    }
    if (plan?.kind === "ledger") {
      return { keep: true, kind: "grootboek", reason: "grootboek herkend — klaar om te boeken" };
    }
    return DROP;
  }

  // PDF — only the text layer decides. A scan has none, and guessing from a picture is exactly the
  // read this module refuses to do: the file goes down the unchanged not-an-invoice path.
  let text: string | null = null;
  try {
    text = await readers.readPdfText(bytes);
  } catch {
    return DROP;
  }
  if (!readers.looksLikeDailySales(text)) return DROP;
  return { keep: true, kind: "dagomzet", reason: "dagafsluiting herkend — klaar om te boeken" };
}
