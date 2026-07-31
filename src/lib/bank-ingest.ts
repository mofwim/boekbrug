// src/lib/bank-ingest.ts
// [BANK-INGEST] Single source of truth for turning an uploaded bank statement into
// stored transactions + a passthrough copy of the original file. BOTH /api/bank/upload
// and the intake bank branch call this, so the parse → dedup → insert → raw-store
// pipeline can never diverge between the two entry points. (They previously kept two
// copies, and the intake copy had drifted: no passthrough, swallowed parse warnings.)
//
// Discipline preserved from /api/bank/upload:
//   - Parsing is BEST-EFFORT. An unparseable format (bank CSV/PDF) yields 0 transactions
//     but the raw file is STILL stored for the accountant — never rejected.
//   - The raw passthrough copy is stored regardless of the transaction count, deduped by
//     byte-hash so the same file is never stored twice.
//   - Transaction insert is best-effort (the raw file is the safety net); parseWarnings
//     (lines the parser could not read) travel back so the caller can surface them.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows, chunkIds } from "./supabase-paginate";
import { parseBankFile } from "./bank-parser";
import { looksLikeSpreadsheetBinary, detectSheetKind } from "./detect-file";
import { sheetBytesToMatrix } from "./xlsx-adapter";
import { dedupTransactions, mapToRows, dateRange, type ExistingTxKey } from "./bank-import";
import { computeContentHash } from "./content-hash";
import { resolveImportTarget } from "./bestanden";
import { runBankAutoConfirm } from "./bank-auto-confirm";
import { applyLearnedBankCategories } from "./bank-auto-categorize";
import { reconcileStatementBalance, balanceWarning, type BalanceReconciliation } from "./bank-statement-balance";
// [STATEMENT-CONTINUITY] gaten TUSSEN afschriften (ontbrekende periode / saldobreuk).
import { findStatementGaps } from "./bank-statement-continuity";

export interface BankImportResult {
  format: string | null;
  accountIban: string | null;
  parsed: number;            // transactions the parser could read
  inserted: number;          // new rows written
  skipped: number;           // duplicates skipped (already stored)
  parseWarnings: string[];   // lines the parser could NOT read (each = a dropped tx)
  statementStored: boolean;  // raw passthrough copy stored (or already present)
  minDate: string | null;    // earliest tx date (for period tagging / folder)
  // [DETECT] The upload is a spreadsheet (xlsx/xls), not a bank statement (MT940/CAMT).
  // Set so the caller tells the owner the truth ("geen banktransacties geïmporteerd")
  // instead of the old silent 0-transaction passthrough that LOOKED ingested.
  nonBankSpreadsheet: boolean;
  // [BANK-AUTO-FEEDBACK] How many near-certain payments the import auto-booked (marked invoices
  // paid + linked). Surfaced so the owner is told the automatic work happened, not left guessing.
  autoBooked: number;
  // [BANK-BALANCE §2.6] The statement's own completeness check: opening + Σtx must equal closing.
  // null when the format carries no balance (CSV) or the file omits one — never a fabricated pass.
  balanceReconciliation: BalanceReconciliation | null;
  // A ready owner-facing warning when the statement does NOT reconcile (a line is missing/dropped/
  // duplicated), else null. Surfaced ALONGSIDE parseWarnings by both callers.
  balanceWarning: string | null;
  // [STATEMENT-CONTINUITY] Eén zin wanneer dit afschrift niet AANSLUIT op wat er al ligt: een
  // ontbrekende periode ("er ontbreekt een afschrift voor 1-2 t/m 28-2") of een saldobreuk.
  // Dit is de controle TUSSEN bestanden — balanceWarning kijkt binnen één bestand. Null wanneer
  // alles aansluit, wanneer dit het eerste afschrift is, of wanneer we het niet konden bepalen.
  continuityWarning: string | null;
}

export async function importBankStatement(args: {
  buffer: Buffer;
  filename: string;
  fileType: string;
  userId: string;
  pipeline: PipelineClient;
}): Promise<BankImportResult> {
  const { buffer, filename, fileType, userId, pipeline } = args;

  // [DETECT] A bank statement is MT940 (text) or CAMT.053 (XML). A spreadsheet (xlsx/xls)
  // is a binary ZIP/OLE2 container — decoding it as UTF-8 and running parseBankFile yields
  // ZERO transactions while looking successful (the old false-green trap). Detect the
  // binary up front, skip the fake parse, and tell the caller the truth. The raw file is
  // still stored below so the accountant always has it.
  let parsed: ReturnType<typeof parseBankFile> | null = null;
  let nonBankSpreadsheet = false;
  const extraWarnings: string[] = [];
  if (looksLikeSpreadsheetBinary(buffer)) {
    nonBankSpreadsheet = true;
    let hint = "Dit bestand is een spreadsheet (xlsx/xls), geen bankafschrift (MT940/CAMT). Er zijn GEEN banktransacties geïmporteerd.";
    try {
      const kind = detectSheetKind(sheetBytesToMatrix(new Uint8Array(buffer)));
      if (kind === "ledger") hint += " Het lijkt een grootboek/kas-export — importeer het via de dagomzet/kas-kant, niet als bankafschrift.";
      else if (kind === "turnover") hint += " Het lijkt een kassa-omzetbestand (Z-rapport) — importeer het via Dagomzet.";
      else hint += " Upload een MT940- of CAMT.053-bestand van je bank voor de banktransacties.";
    } catch { /* detection is best-effort */ }
    extraWarnings.push(hint);
  } else {
    const content = buffer.toString("utf8");
    try {
      parsed = parseBankFile(content, filename);
    } catch {
      parsed = null; // unparseable format — still stored as passthrough below
    }
  }

  const transactions = parsed?.transactions ?? [];
  const { min } = dateRange(transactions);

  // [BANK-BALANCE §2.6] Prove the FILE is internally complete: opening + Σ(every parsed line) must
  // equal the statement's declared closing balance. Runs on the full parse (NOT the deduped/inserted
  // subset) so it validates the file itself — and because a line the parser DROPPED (parseErrors) is
  // absent from the sum, this also catches a dropped line, not just a user-truncated upload. When the
  // format carries no balance, it degrades to "not checkable" (never a fabricated pass).
  const sb = parsed?.statementBalance ?? null;
  const balanceReconciliation = sb
    ? reconcileStatementBalance(sb.opening, sb.closing, transactions.map((t) => t.amount))
    : null;
  const balWarning = balanceReconciliation ? balanceWarning(balanceReconciliation) : null;
  // [STATEMENT-CONTINUITY] Sluit dit afschrift aan op wat er al ligt? Gevuld verderop, zodra
  // het bestand is opgeslagen en zijn periode bekend is. Null = geen gat gevonden (of niet te
  // bepalen, bijvoorbeeld bij het allereerste afschrift).
  let continuityWarning: string | null = null;

  // ── dedup + insert transactions (only when the parse yielded some) ──
  let inserted = 0;
  let skipped = 0;
  let insertedIds: string[] = [];      // [BANK-TX-STATEMENT-LINK] the rows THIS import created
  if (transactions.length > 0) {
    let existing: ExistingTxKey[] = [];
    const { max } = dateRange(transactions);
    if (min && max) {
      // [PAGINATE] MUST fetch ALL rows in the window, not PostgREST's silent ~1000-row first page.
      // This SELECT is the dedup gate: a busy shop with >1000 transactions in the statement's date
      // range got a TRUNCATED "existing" set on re-upload, so hundreds of already-stored lines found
      // no fingerprint and were inserted a SECOND time — double-counting omzet/kosten everywhere
      // downstream while the import honestly reported "N skipped". Every other consumer of this
      // table already paginates (supabase-paginate.ts documents this exact trap); now the gate does.
      const rows = await fetchAllRows((from, to) =>
        pipeline
          .from("bank_transactions")
          .select("date, amount, description, counterpart_name, reference")
          .eq("user_id", userId)
          .gte("date", min)
          .lte("date", max)
          .order("id", { ascending: true })
          .range(from, to),
      );
      existing = rows as ExistingTxKey[];
    }
    const dd = dedupTransactions(transactions, existing);
    skipped = dd.skipped;
    if (dd.toInsert.length > 0) {
      const rows = mapToRows(dd.toInsert, userId);
      let { data: insData, error } = await pipeline.from("bank_transactions").insert(rows).select("id");
      // [BANK-IBAN] Resilient to a not-yet-applied migration: if counterpart_iban doesn't exist yet
      // (42703 undefined_column), retry WITHOUT it so bank import never breaks — the IBAN is a
      // matching hint, never money-truth. Once bank_tx_counterpart_iban.sql is applied it stores.
      if (error && (error as { code?: string }).code === "42703") {
        const stripped = rows.map(({ counterpart_iban: _omit, ...r }) => r);
        ({ data: insData, error } = await pipeline.from("bank_transactions").insert(stripped).select("id"));
      }
      if (!error) {
        inserted = rows.length;
        insertedIds = (insData ?? []).map((r) => r.id as string);
        // [BANK-TX-STATEMENT-LINK] The returned representation is subject to the same row cap as
        // any other read, so a statement of >1000 new lines can hand back fewer ids than it
        // inserted. Those rows would then never be stamped with their statement, and deleting it
        // would silently leave their bookings behind. We cannot recover the missing ids here —
        // but a gap this consequential must not pass unrecorded.
        if (insertedIds.length !== rows.length) {
          console.error("[BANK-TX-STATEMENT-LINK] insert returned fewer ids than rows — those transactions will not carry their statement", {
            userId, inserted: rows.length, returned: insertedIds.length,
          });
        }
      }
    }
  }

  // [BANK-CIRCLE-SERVER] Close the circle on the SERVER the moment new transactions land —
  // book the near-certain payments (reference printed + amount to the cent) without waiting
  // for the owner to open /dashboard/bank. No session here, so the pay write uses the
  // service-role pipeline; the isEligible guard inside is authoritative. Best-effort: a
  // reconcile hiccup must never fail the import (the /bank load pass remains the backstop).
  let autoBooked = 0;
  if (inserted > 0) {
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId });
      autoBooked = confirmed.length;
    } catch (e) {
      console.error("[BANK-INGEST] auto-confirm after import failed (non-fatal)", e);
    }
    // [BANK-AUTO-CATEGORIZE] Immediately code the fresh lines the owner has taught us before, so a
    // just-uploaded statement lands mostly categorized instead of a wall of uncategorized money.
    try {
      await applyLearnedBankCategories({ pipeline, userId });
    } catch (e) {
      console.error("[BANK-INGEST] auto-categorize after import failed (non-fatal)", e);
    }
  }

  // [JET-GAP0] The "X facturen automatisch gekoppeld" bell now fires from INSIDE runBankAutoConfirm
  // (above), so it reaches the owner from every entry point — not only this import path — and can
  // never be forgotten by a caller. `autoBooked` still travels back for the upload UI's toast.

  // ── raw passthrough store (best-effort — the transactions above are unaffected) ──
  let statementStored = false;
  let statementDocId: string | null = null; // [BANK-TX-STATEMENT-LINK] the statement this import created/reused
  try {
    const contentHash = computeContentHash(buffer);
    const { data: existingDoc } = await pipeline
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .limit(1)
      .maybeSingle();
    if (existingDoc) {
      statementStored = true;
      statementDocId = existingDoc.id as string;
    } else {
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${userId}/bank/${Date.now()}-${safeName}`;
      const { error: upErr } = await pipeline.storage
        .from("documents")
        .upload(storagePath, buffer, { contentType: fileType, upsert: false });
      if (!upErr) {
        const folderId = await resolveImportTarget(userId, min ?? null, "bank", "pipeline");
        const stmtYear = min ? Number(min.slice(0, 4)) : null;
        const stmtPeriod = min ? `${min.slice(0, 4)}-Q${Math.ceil(Number(min.slice(5, 7)) / 3)}` : null;
        const { data: sdoc } = await pipeline
          .from("documents")
          .insert({
            user_id: userId,
            file_name: filename,
            file_url: storagePath,
            file_size: buffer.length,
            file_type: fileType,
            doc_type: "bankafschrift",
            folder_id: folderId,
            source: "upload",
            content_hash: contentHash,
            year: stmtYear,
            period: stmtPeriod,
            // [BRUG] Een bankafschrift is per definitie een stuk dat de boekhouder nodig
            // heeft, en de eigenaar heeft het zelf geüpload — er is niets aan te
            // "controleren" zoals bij een factuur (AV §7.3 gaat over concepten en
            // ongecontroleerde inkoopfacturen, niet hierover).
            //
            // Zonder deze regel bleef `shared` false (NOT NULL DEFAULT false), en
            // documents_accountant_read eist `shared = true AND trashed IS NOT TRUE`. De
            // boekhouder zag dus op /brug NOOIT één bankafschrift, terwijl de
            // closing-package-ZIP het wél meestuurde: één grens, twee antwoorden.
            //
            // De omgekeerde reparatie — een shared-filter op de ZIP-packer — zou de
            // banksectie van élk pakket legen, en dat pakket is het enige artefact
            // waarvoor dit product bestaat.
            shared: true,
          })
          .select("id")
          .single();
        statementStored = sdoc?.id != null;
        statementDocId = (sdoc?.id as string | undefined) ?? null;
      }
    }
  } catch {
    // best-effort — the transactions are stored regardless; only the passthrough is missing
  }

  // [STATEMENT-CONTINUITY] Onthoud WELKE PERIODE dit afschrift beslaat en met welke saldi het
  // begint en eindigt. De parser las dat al (statementBalance + de transactiedata); het werd
  // alleen nergens bewaard, en daardoor kon niemand zien dat er een maand ontbrak: twee
  // afschriften die allebei intern kloppen verbergen samen een gat van vier weken. Met deze rij
  // vergelijkt bank-statement-continuity.ts de afschriften ONDERLING (datum én saldo-aansluiting).
  //
  // Best-effort en zonder await-afhankelijkheid van de rest: mislukt de insert — of bestaat de
  // tabel nog niet omdat de migratie nog niet gedraaid is — dan verliest de eigenaar alleen deze
  // extra controle, nooit zijn transacties of zijn bestand.
  if (statementDocId) {
    try {
      const { max: maxDate } = dateRange(transactions);
      await pipeline.from("bank_statement_periods").upsert(
        {
          document_id: statementDocId,
          user_id: userId,
          iban: parsed?.accountIban ?? null,
          period_start: min ?? null,
          period_end: maxDate ?? null,
          opening_balance: sb?.opening ?? null,
          closing_balance: sb?.closing ?? null,
          currency: sb?.currency ?? null,
        },
        { onConflict: "document_id" },
      );
      // [STATEMENT-CONTINUITY] Meteen kijken of dit NIEUWE afschrift aansluit op wat er al ligt.
      // Dit is het moment waarop de eigenaar het bestand in handen heeft: hoort hij nu dat er een
      // maand tussen zit, dan haalt hij die er in dezelfde beweging bij. Ontdekt hij het pas bij
      // de kwartaalafsluiting, dan is het een zoektocht van maanden terug. Alleen de gaten die
      // DIT afschrift raken — de rest hoort thuis op het klaar-scherm, niet in een uploadmelding.
      const { data: neighbours } = await pipeline
        .from("bank_statement_periods")
        .select("document_id, iban, period_start, period_end, opening_balance, closing_balance")
        .eq("user_id", userId)
        .order("period_start", { ascending: true })
        .limit(400);
      const usable = (neighbours ?? []).filter((p) => p.period_start && p.period_end);
      if (usable.length >= 2) {
        const { issues } = findStatementGaps(
          usable.map((p) => ({
            documentId: p.document_id,
            iban: p.iban,
            from: p.period_start as string,
            to: p.period_end as string,
            opening: p.opening_balance,
            closing: p.closing_balance,
          })),
        );
        const mine = issues.find(
          (i) => i.before.documentId === statementDocId || i.after.documentId === statementDocId,
        );
        if (mine) continuityWarning = mine.message;
      }
    } catch {
      /* non-fatal — zonder deze rij vervalt alleen de continuïteitscontrole voor dit bestand */
    }
  }

  // [BANK-TX-STATEMENT-LINK] Stamp the statement onto the rows THIS import created, so deleting
  // the statement can later reverse exactly its own bookings (and re-import can't double). Only
  // the freshly-inserted rows — never rows a prior import already owns. Best-effort.
  if (statementDocId && insertedIds.length > 0) {
    // [IN-CHUNK] Chunked, and the result is now CHECKED. It was one `.in()` over every id this
    // import created, with no `error` destructuring at all — and supabase-js reports a failure as
    // `{ error }` rather than throwing, so the try/catch around it could never fire. On a large
    // statement the id list alone outgrows the request URL, and the write then failed in total
    // silence, leaving statement_document_id NULL on every row.
    //
    // That is not a cosmetic link: it is the ONLY thing delete-statement selects on. Without it
    // deleting the statement reverses nothing while answering ok:true, and re-importing the
    // corrected file adds its lines on top of the stranded originals — the doubled omzet +
    // commission that [BANK-STATEMENT-DELETE-CASCADE] was written to end. Loud on failure.
    for (const chunk of chunkIds(insertedIds)) {
      const { error: linkErr } = await pipeline
        .from("bank_transactions")
        .update({ statement_document_id: statementDocId })
        .in("id", chunk)
        .eq("user_id", userId);
      if (linkErr) {
        console.error("[BANK-TX-STATEMENT-LINK] stamping the statement onto its transactions failed — deleting this statement will not reverse its bookings", {
          userId, statementDocId, rows: chunk.length, error: linkErr.message,
        });
      }
    }
  }

  return {
    format: parsed?.format ?? null,
    accountIban: parsed?.accountIban ?? null,
    parsed: transactions.length,
    inserted,
    skipped,
    parseWarnings: [...extraWarnings, ...(parsed?.parseErrors ?? [])],
    statementStored,
    minDate: min,
    nonBankSpreadsheet,
    autoBooked, // [BANK-AUTO-FEEDBACK] how many payments the import auto-booked (for the upload UI)
    balanceReconciliation,     // [BANK-BALANCE §2.6] statement completeness result (or null)
    // [STATEMENT-CONTINUITY] Eén zin wanneer dit afschrift NIET aansluit op het vorige — een
    // ontbrekende periode of een saldobreuk. Null wanneer alles aansluit.
    continuityWarning,
    balanceWarning: balWarning, // owner-facing "afschrift sluit niet aan" message (or null)
  };
}
