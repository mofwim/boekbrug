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

  // [BANK-TX-SOURCE-ID] Which door and which account this batch came from. The bank's per-line id
  // is only promised unique inside one export of one account, so it is stored under this scope and
  // never compared across it. An account-less file (a format that carries no IBAN) degrades to the
  // format alone — still scoped per user, just coarser.
  const source = parsed ? `${parsed.format}:${parsed.accountIban ?? ""}` : null;

  // ── LAYER 1: the file itself ──────────────────────────────────────────────────────────────
  // Identical bytes are the same statement, and this is the ONLY layer that can say so about a
  // line the bank gave no id and whose fingerprint has since moved — which is exactly what
  // happens when the parser improves between two uploads of one file (the MT940 reference fix did
  // precisely that). Checked BEFORE the dedup/insert below, where it can still prevent work.
  //
  // Deliberately NOT a blind skip. The hash proves the FILE was seen, not that its transactions
  // landed: the insert below is best-effort, so a previous run could have stored the passthrough
  // copy and lost the rows. So we short-circuit only with evidence that they landed — at least one
  // stored transaction pointing at that document. With no evidence we fall through and let layers
  // 2 and 3 repair the gap instead of freezing it in place.
  const contentHash = computeContentHash(buffer);
  let priorDocId: string | null = null;
  let alreadyImported = false;
  try {
    const { data: existingDoc } = await pipeline
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .limit(1)
      .maybeSingle();
    if (existingDoc) {
      priorDocId = existingDoc.id as string;
      const { count } = await pipeline
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("statement_document_id", priorDocId);
      // EVERY line, not merely some. "Some" would also be true after a previous import failed
      // half-way, or after the owner deleted individual transactions and re-uploaded the file to
      // get them back — and in both cases short-circuiting would freeze the gap permanently
      // instead of repairing it. Equality is the only count that proves nothing is missing;
      // anything less falls through to layers 2 and 3, which insert exactly what is absent.
      alreadyImported = transactions.length > 0 && (count ?? 0) === transactions.length;
    }
  } catch {
    // Best-effort: an unreadable documents table must never block an import. Layers 2 and 3 still
    // stand, so the worst case is the work we hoped to skip.
  }

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
  if (alreadyImported) {
    // The same bytes, and its rows are provably in the table. Nothing to decide.
    skipped = transactions.length;
  } else if (transactions.length > 0) {
    let existing: ExistingTxKey[] = [];
    const { max } = dateRange(transactions);
    if (min && max) {
      // [PAGINATE] MUST fetch ALL rows in the window, not PostgREST's silent ~1000-row first page.
      // This SELECT is the dedup gate: a busy shop with >1000 transactions in the statement's date
      // range got a TRUNCATED "existing" set on re-upload, so hundreds of already-stored lines found
      // no fingerprint and were inserted a SECOND time — double-counting omzet/kosten everywhere
      // downstream while the import honestly reported "N skipped". Every other consumer of this
      // table already paginates (supabase-paginate.ts documents this exact trap); now the gate does.
      const readExisting = (columns: string) =>
        fetchAllRows((from, to) =>
          pipeline
            .from("bank_transactions")
            .select(columns)
            .eq("user_id", userId)
            .gte("date", min)
            .lte("date", max)
            .order("id", { ascending: true })
            .range(from, to),
        );
      // A runtime-chosen column list defeats supabase-js's literal-type inference, so the cast is
      // unavoidable here; the shapes are asserted by bank-import.test.ts instead.
      const BASE_COLUMNS = "date, amount, description, counterpart_name, reference";
      try {
        existing = (await readExisting(`${BASE_COLUMNS}, source, external_id`)) as unknown as ExistingTxKey[];
      } catch {
        // [BANK-TX-SOURCE-ID] bank_tx_source_identity.sql not applied yet. fetchAllRows THROWS on a
        // query error, and an unhandled throw here would empty the dedup gate — every stored line
        // would find no match and import a second time. So the identity layer degrades to nothing
        // and the fingerprint carries the import alone, exactly as it did before this column.
        existing = (await readExisting(BASE_COLUMNS)) as unknown as ExistingTxKey[];
      }
    }
    const dd = dedupTransactions(transactions, existing, source);
    skipped = dd.skipped;
    if (dd.toInsert.length > 0) {
      const rows = mapToRows(dd.toInsert, userId, source);
      // [BANK-TX-SOURCE-ID] upsert-ignore, not insert: uniq_bank_tx_source_identity is the backstop
      // for the race the dedup above cannot cover (an upload while the cron sync writes). A plain
      // insert would lose the WHOLE batch to one raced line; this drops the raced line and keeps
      // the rest. Rows whose source gave no id carry NULLs, which Postgres treats as distinct, so
      // they are unconstrained and reach the table exactly as before.
      let { data: insData, error } = await pipeline
        .from("bank_transactions")
        .upsert(rows, { onConflict: "user_id,source,external_id", ignoreDuplicates: true })
        .select("id");
      // Resilient to a HALF-applied schema, in both directions it can be half-applied. Getting
      // this wrong does not degrade a hint — it fails the insert, and a failed insert is money
      // that silently never arrives.
      //   · 42703 undefined_column — the columns are not there at all. Strip them and plain-insert.
      //     [BANK-IBAN] counterpart_iban rides the same path; it is a matching hint, never truth.
      //   · 42P10 — the columns exist but uniq_bank_tx_source_identity does not, so Postgres has
      //     no constraint to match ON CONFLICT against. Keep the values (they are still worth
      //     storing for the NEXT import) and plain-insert without the conflict clause.
      const failureCode = (error as { code?: string } | null)?.code;
      if (failureCode === "42703") {
        const stripped = rows.map(({ counterpart_iban: _iban, source: _src, external_id: _ext, ...r }) => r);
        ({ data: insData, error } = await pipeline.from("bank_transactions").insert(stripped).select("id"));
      } else if (failureCode === "42P10") {
        ({ data: insData, error } = await pipeline.from("bank_transactions").insert(rows).select("id"));
      }
      if (!error) {
        insertedIds = (insData ?? []).map((r) => r.id as string);
        inserted = rows.length;
        // [BANK-TX-STATEMENT-LINK] Fewer ids back than rows sent has two possible causes now, and
        // they want opposite responses:
        //   · uniq_bank_tx_source_identity rejected a raced duplicate (ON CONFLICT DO NOTHING
        //     returns nothing for it). That row was NOT written and must not be counted as
        //     inserted — the constraint did its job and the count should say so.
        //   · the returned representation hit the same ~1000-row cap as any other read, so rows
        //     that WERE written handed back no id. Those never get stamped with their statement,
        //     and deleting it would leave their bookings behind.
        // A short page tells them apart: only the cap can truncate at exactly the page size.
        if (insertedIds.length !== rows.length) {
          const cappedByRead = rows.length > 1000;
          if (cappedByRead) {
            console.error("[BANK-TX-STATEMENT-LINK] insert returned fewer ids than rows — those transactions will not carry their statement", {
              userId, inserted: rows.length, returned: insertedIds.length,
            });
          } else {
            // Raced duplicates. Count only what was actually written.
            inserted = insertedIds.length;
            skipped += rows.length - insertedIds.length;
          }
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
    // [BANK-TX-SOURCE-ID] The hash and the lookup already happened above, where they could still
    // prevent work. Reusing them here keeps ONE answer to "have we seen this file?" — two lookups
    // could disagree, and the one that decided the import is the one that must decide the storage.
    if (priorDocId) {
      statementStored = true;
      statementDocId = priorDocId;
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
