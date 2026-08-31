// src/lib/document-references.ts
// [BEWIJS-VAST] What still points at a document — read BEFORE it is permanently deleted.
// Run: npx tsx --test src/lib/document-references.test.ts
//
// ── WHY THIS EXISTS ──
//
// A permanent delete from the prullenbak removed the documents row and nothing else. Eight foreign
// keys point at that row, and every one of them is a piece of provenance:
//
//   invoices.document_id                    the bewijsstuk of a purchase invoice
//   invoices.attachment_document_id         the attachment that went out with a sales invoice
//   cash_entries.document_id                the bon behind a kasboek line
//   daily_turnover.document_id              the Z-bon behind a day's turnover
//   eft_settlements.document_id             the pinafrekening
//   ledger_daily.document_id                the dagstaat
//   bank_transactions.statement_document_id which statement each line came from
//   bank_statement_periods.document_id      the period an uploaded statement COVERS
//
// Seven are ON DELETE SET NULL, so the delete succeeded and the link became NULL — no error, no
// audit line saying a booking lost its evidence, and no way afterwards to tell an invoice that
// never had a scan from one whose scan was thrown away. The Belastingdienst does not distinguish
// them either: both are an administratie without its bewijsstuk, for seven years.
//
// The eighth is worse, and it is the one nobody would predict. bank_statement_periods.document_id
// is ON DELETE CASCADE, so deleting a statement PDF DELETES the coverage record — and coverage is
// not documentation, it is an input. `computeDrawerBalance` and the financial result both suppress
// figures on days a statement covers. Remove the row and covered days become uncovered: amounts
// that were deliberately not counted start counting, and the owner sees his kasresultaat change
// because he emptied his prullenbak.
//
// ── WHY A REFUSAL AND NOT A WARNING ──
//
// The trash is the reversible step; this one is not. An owner who genuinely wants the file gone
// can detach or delete the booking first, and then the file deletes cleanly — that order keeps the
// books and the evidence in step. A warning he clicks past does not.
//
// ── WHY THE FAILURE MODE IS "REFUSE", NOT "ZERO" ──
//
// supabase-js does not throw on a query error; it returns { count: null, error }. A failed probe
// read as zero references is indistinguishable from a clean file, and it would permit exactly the
// delete this module exists to stop. So a probe that did not run refuses the delete and says so.

import type { MessageKey } from "./i18n/messages";

/** One thing that still points at the document. */
export interface DocumentReference {
  /** Which table holds it. English — this is an identifier, not screen text. */
  table: string;
  count: number;
  /**
   * The catalogue key for this reason, singular or plural ALREADY CHOSEN here.
   *
   * The screen renders what it is handed and holds no language of its own (AGENTS.md). Picking the
   * key server-side rather than sending a noun for the client to slot into a template is the same
   * rule one level up: "1 factuur" and "3 facturen" are two sentences, not one sentence with a
   * number in it, and in Arabic and Turkish they are further apart still.
   */
  key: MessageKey;
  /**
   * The same reason in Dutch, composed here.
   *
   * Not a second source of truth for the screen — it is what the API's own `error` field says, for
   * a log, a curl, and any client that predates these keys. The screen uses `key`.
   */
  phrase: string;
}

export type ReferenceVerdict =
  | { ok: true; references: DocumentReference[] }
  /** The check could not be completed. NOT "there are none" — the caller must refuse. */
  | { ok: false; failed: string };

/**
 * Every foreign key into `documents`, with the sentence its rows deserve.
 *
 * As DATA, so the gate over this file can compare it against the schema instead of against a
 * second hand-written list. A hand-maintained list is the weak part of this module and it is
 * named as such: a ninth foreign key added later is invisible here, which is why
 * [BEWIJS-VAST] in lifecycle-gates reads the migrations and asserts every FK into `documents`
 * appears below.
 */
export const DOCUMENT_REFERRERS: ReadonlyArray<{
  table: string;
  column: string;
  /** Dutch. Full sentences per count — a noun handed to one template breaks as soon as it is
   *  translated, and this repo has learned that once already (AGENTS.md). */
  one: string;
  many: (n: number) => string;
  /** The same two sentences in the catalogue, so the screen can say this in the owner's language. */
  keyOne: MessageKey;
  keyMany: MessageKey;
}> = [
  {
    table: "invoices",
    column: "document_id",
    one: "een factuur waarvan dit het bewijsstuk is",
    many: (n) => `${n} facturen waarvan dit het bewijsstuk is`,
    keyOne: "prul.ref.factuurBewijs.een",
    keyMany: "prul.ref.factuurBewijs.meer",
  },
  {
    table: "invoices",
    column: "attachment_document_id",
    one: "een factuur die dit als bijlage heeft meegestuurd",
    many: (n) => `${n} facturen die dit als bijlage hebben meegestuurd`,
    keyOne: "prul.ref.factuurBijlage.een",
    keyMany: "prul.ref.factuurBijlage.meer",
  },
  {
    table: "cash_entries",
    column: "document_id",
    one: "een kasboekregel waar dit de bon van is",
    many: (n) => `${n} kasboekregels waar dit de bon van is`,
    keyOne: "prul.ref.kasboek.een",
    keyMany: "prul.ref.kasboek.meer",
  },
  {
    table: "daily_turnover",
    column: "document_id",
    one: "een dagomzet die op dit bestand steunt",
    many: (n) => `${n} dagomzetten die op dit bestand steunen`,
    keyOne: "prul.ref.dagomzet.een",
    keyMany: "prul.ref.dagomzet.meer",
  },
  {
    table: "eft_settlements",
    column: "document_id",
    one: "een pinafrekening die op dit bestand steunt",
    many: (n) => `${n} pinafrekeningen die op dit bestand steunen`,
    keyOne: "prul.ref.pin.een",
    keyMany: "prul.ref.pin.meer",
  },
  {
    table: "ledger_daily",
    column: "document_id",
    one: "een dagstaat die op dit bestand steunt",
    many: (n) => `${n} dagstaten die op dit bestand steunen`,
    keyOne: "prul.ref.dagstaat.een",
    keyMany: "prul.ref.dagstaat.meer",
  },
  {
    table: "bank_transactions",
    column: "statement_document_id",
    one: "een banktransactie die uit dit afschrift is ingelezen",
    many: (n) => `${n} banktransacties die uit dit afschrift zijn ingelezen`,
    keyOne: "prul.ref.banktransactie.een",
    keyMany: "prul.ref.banktransactie.meer",
  },
  {
    // The CASCADE one. Its row is not unlinked but DELETED, and with it the statement's coverage —
    // which is why this phrase says what CHANGES rather than what is attached.
    table: "bank_statement_periods",
    column: "document_id",
    one: "de dekking van dit bankafschrift (verwijderen verandert je kas- en bankstanden)",
    many: (n) => `de dekking van ${n} bankafschriftperiodes (verwijderen verandert je kas- en bankstanden)`,
    keyOne: "prul.ref.dekking.een",
    keyMany: "prul.ref.dekking.meer",
  },
];

/**
 * Postgres codes that mean "this referrer cannot exist on this database".
 *
 * A table or column that is not there carries no foreign key either, so there is no reference to
 * lose and skipping it is correct rather than a gap. Every OTHER error means the probe did not
 * run, and that refuses the delete. The distinction matters because this repo deploys against
 * half-applied schemas on purpose (see bank-ingest's 42703/42P10 branches).
 */
const ABSENT_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

/**
 * Read everything that still points at `documentId`.
 *
 * Scoped by the caller's own client: under RLS the counts are the owner's rows, and a document id
 * belongs to exactly one owner, so no cross-owner row can hide from or inflate the count.
 */
export async function readDocumentReferences(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  documentId: string;
}): Promise<ReferenceVerdict> {
  const { client, documentId } = args;
  const references: DocumentReference[] = [];

  for (const ref of DOCUMENT_REFERRERS) {
    let result: { count: number | null; error: { code?: string; message?: string } | null };
    try {
      result = await client
        .from(ref.table)
        .select("id", { count: "exact", head: true })
        .eq(ref.column, documentId);
    } catch (e) {
      return { ok: false, failed: `${ref.table}.${ref.column}: ${e instanceof Error ? e.message : "onbekend"}` };
    }
    const code = result?.error?.code ?? "";
    if (result?.error) {
      if (ABSENT_CODES.has(code)) continue;
      return { ok: false, failed: `${ref.table}.${ref.column}: ${result.error.message ?? code}` };
    }
    // A successful probe with a null count is not zero — PostgREST returns the count only when it
    // was asked for and produced. Reading null as 0 is the same silence as reading an error as 0.
    if (result.count == null) {
      return { ok: false, failed: `${ref.table}.${ref.column}: geen telling teruggekregen` };
    }
    const n = result.count;
    if (n > 0) {
      references.push({
        table: ref.table,
        count: n,
        key: n === 1 ? ref.keyOne : ref.keyMany,
        phrase: n === 1 ? ref.one : ref.many(n),
      });
    }
  }

  return { ok: true, references };
}

/** The Dutch sentence the owner reads when the delete is refused. */
export function referencesRefusal(references: DocumentReference[]): string {
  const list = references.map((r) => r.phrase);
  const opsomming =
    list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " en " + list[list.length - 1];
  return (
    `Dit bestand kan niet definitief worden verwijderd: je boekhouding verwijst er nog naar — ${opsomming}. ` +
    `Haal het bestand daar eerst los (of verwijder die boeking), dan kun je het hier weggooien. ` +
    `Zo blijft je administratie niet achter met een boeking zonder bewijsstuk.`
  );
}
