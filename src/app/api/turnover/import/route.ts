// src/app/api/turnover/import/route.ts
// [TURNOVER-IMPORT] Two-step, human-in-the-loop import of a till Z-report into
// daily_turnover. User-scoped (RLS server client).
//
//   1. PREVIEW  — POST multipart/form-data with `file` (an .xls/.xlsx/.csv Z-report).
//                 The SheetJS adapter → cell matrix → the PURE normalizer → returns the
//                 normalized rows + warnings. NOTHING is written; the owner reviews first.
//   2. COMMIT   — POST application/json { rows: DailyTurnover[] } (the reviewed rows).
//                 Upserts into daily_turnover (one row per day; a re-import updates).
//
// The parser (xlsx-adapter) is isolated; this route only orchestrates. It never guesses:
// preview warnings are shown to the owner, and only the owner's confirmed rows are stored.

import { NextRequest, NextResponse } from "next/server";
import { isMissingRelation } from "@/lib/pg-missing";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sheetBytesToMatrix, NotASpreadsheetError } from "@/lib/xlsx-adapter";
// [PDF-ALS-BLAD] A PDF grootboek/Z-rapport laid back out as the table it was printed from.
import { pdfBytesToMatrix } from "@/lib/pdf-sheet";
// [KASSA-OMZETRAPPORT] The POS's own day report — one day, rates as rows.
import { parsePosOmzetReport } from "@/lib/pos-omzet-report";
import {
  normalizeTurnoverSheet,
  isRealCalendarDate,
  turnoverDateOutOfWindow,
  amsterdamToday,
} from "@/lib/turnover-import";
import { detectSheetKind } from "@/lib/detect-file";
// [TURNOVER-ARITHMETIC] The write gate — daily_turnover feeds rubriek 1a/1b directly.
import { checkTurnoverArithmetic, type DailyTurnover } from "@/lib/turnover";
// [TURNOVER-CENTEN] Cents at the door — see the note above the coercers in the commit branch.
import { round2 } from "@/lib/invoice-totals";
import { logAuditAction, getClientIP } from "@/lib/audit";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — a Z-report is tiny; this is generous.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A few years of daily rows in one commit is already far past any real Z-report export.
const MAX_ROWS = 2000;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  // ── 2) COMMIT — the owner-reviewed rows ──
  if (contentType.includes("application/json")) {
    let body: { rows?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
    const rows = Array.isArray(body.rows) ? (body.rows as DailyTurnover[]) : null;
    if (!rows || rows.length === 0) return NextResponse.json({ error: "geen rijen om op te slaan" }, { status: 400 });
    // A Z-report covers a period, not a lifetime. Refuse a payload no real file produces rather
    // than push an unbounded upsert at the BTW-authoritative table (bookLedgerRows caps too).
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `te veel rijen in één keer (max ${MAX_ROWS})` }, { status: 400 });
    }

    // [TURNOVER-CENTEN] Rounded to cents at the door, not merely coerced.
    //
    // The columns are unconstrained `numeric`, and these figures are not display values: btw_9 and
    // btw_21 go straight into rubriek 1a/1b as tax OWED, and cash_amount is summed over all time
    // into the drawer balance the filing gate compares against zero. The parser already rounds
    // every field it derives (r2 throughout turnover-import.ts), so a clean file is unaffected —
    // this closes the JSON commit door, which accepts whatever a caller sends and stored it
    // verbatim. Rounding happens BEFORE the arithmetic gate below, so the numbers that are checked
    // are the numbers that get written. Same rule the cash drawer applies to a movement.
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? round2(v) : 0);
    const nullableNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? round2(v) : null);
    const today = amsterdamToday();
    const records = [];
    for (const r of rows) {
      // [DATE-REAL] The shape test alone is not enough: "2026-02-31" matches this regex, and the
      // turnover_date column is a Postgres `date`, which rejects it and takes the WHOLE upsert
      // with it — the entire file failing on "kon dagomzet niet opslaan", naming nothing. That is
      // the same opaque failure [DAGOMZET-DUP-DAY] below was written to end for duplicate days.
      if (!r || typeof r.turnover_date !== "string" || !ISO_DATE.test(r.turnover_date) || !isRealCalendarDate(r.turnover_date)) {
        return NextResponse.json({ error: `ongeldige datum in een rij: ${String(r?.turnover_date)}` }, { status: 400 });
      }
      // [DATE-WINDOW] …and it has to be a day that can exist. A single slipped digit in the year
      // used to be permanent and nearly invisible: quarter-bounded readers filter the day away,
      // while /api/cash and /api/daily-truth sum daily_turnover.cash_amount over all time with no
      // date bound — so it inflated the drawer balance for good. See turnover-import.ts.
      if (turnoverDateOutOfWindow(r.turnover_date, today)) {
        return NextResponse.json(
          {
            error: "datum_buiten_bereik",
            detail:
              `De datum ${r.turnover_date} kan niet kloppen — een omzetdag ligt niet in de toekomst. ` +
              `Er is niets opgeslagen. Controleer het jaartal in je Z-rapport en importeer opnieuw.`,
          },
          { status: 400 },
        );
      }
      records.push({
        user_id: user.id,
        turnover_date: r.turnover_date,
        base_0: num(r.base_0), base_9: num(r.base_9), base_21: num(r.base_21),
        btw_9: num(r.btw_9), btw_21: num(r.btw_21),
        total_incl: nullableNum(r.total_incl),
        pin_amount: nullableNum(r.pin_amount),
        cash_amount: nullableNum(r.cash_amount),
        other_amount: nullableNum(r.other_amount),
        source: "z_report",
      });
    }

    // [DAGOMZET-DUP-DAY] Refuse a payload that names the same day twice, and NAME the day.
    // Postgres cannot apply ON CONFLICT DO UPDATE to one row twice in a single statement
    // ("command cannot affect row a second time"), so such a file failed the whole import with
    // the flat "kon dagomzet niet opslaan" below — nothing pointing at the duplicate date, and
    // nothing the owner could act on. Nothing was written, which is right; the silence was not.
    //
    // Deliberately not resolved automatically: summing two rows for one day would double the
    // omzet if the file simply repeats a day, and keeping the last would silently drop a second
    // shift. Both guesses land in the BTW. The owner knows which their file is; the app does not.
    const seenDays = new Map<string, number>();
    for (const r of records) seenDays.set(r.turnover_date, (seenDays.get(r.turnover_date) ?? 0) + 1);
    const dupDays = [...seenDays.entries()].filter(([, n]) => n > 1).map(([d]) => d).sort();
    if (dupDays.length > 0) {
      const shown = dupDays.slice(0, 5).join(", ");
      const more = dupDays.length > 5 ? ` (en ${dupDays.length - 5} andere)` : "";
      return NextResponse.json(
        {
          error: "dubbele_dag",
          detail:
            `Dit bestand bevat meerdere regels voor dezelfde dag: ${shown}${more}. ` +
            `Er is niets opgeslagen. Staat er per dag één totaal in je Z-rapport? Verwijder dan de ` +
            `dubbele regel. Zijn het losse shifts van dezelfde dag? Tel ze eerst bij elkaar op — ` +
            `anders zou de omzet van die dag dubbel in je BTW terechtkomen.`,
        },
        { status: 400 },
      );
    }

    // [TURNOVER-ARITHMETIC] Can these days be true at all?
    //
    // Everything above this point checks the DATE — a real calendar day, not in the future, no day
    // twice — and nothing checked the money. But daily_turnover is BTW-authoritative: /api/aangifte
    // reads btw_9 and btw_21 straight out of it into rubriek 1a/1b as tax OWED. So a day arriving
    // with base_9 = 100 and btw_9 = 52 went into the return, and both directions cost real money:
    // overstated you pay what you do not owe, understated the return is wrong.
    //
    // The parser derives the split correctly. That is not the point — a server that trusts the
    // client's arithmetic is not a guard, which is the same sentence written over the amount-
    // correction route.
    //
    // REFUSES the whole file, and names the days. That is this route's established contract: the
    // duplicate-day check three lines up does exactly the same, for the same reason — a half-imported
    // month is worse than an unimported one, because nobody can tell which half is in.
    const badDays: string[] = [];
    for (const r of records) {
      const breaks = checkTurnoverArithmetic({
        turnover_date: r.turnover_date,
        base_0: r.base_0, base_9: r.base_9, base_21: r.base_21,
        btw_9: r.btw_9, btw_21: r.btw_21,
        total_incl: r.total_incl, pin_amount: r.pin_amount,
        cash_amount: r.cash_amount, other_amount: r.other_amount,
      });
      if (breaks.length > 0) badDays.push(`${r.turnover_date} (${breaks[0].note})`);
    }
    if (badDays.length > 0) {
      const shown = badDays.slice(0, 3).join("; ");
      const more = badDays.length > 3 ? ` en ${badDays.length - 3} andere dag(en)` : "";
      return NextResponse.json(
        {
          error: "bedragen_kloppen_niet",
          detail:
            `De bedragen van ${badDays.length === 1 ? "één dag" : `${badDays.length} dagen`} kunnen niet kloppen: ` +
            `${shown}${more}. Er is niets opgeslagen. Deze bedragen gaan rechtstreeks naar je ` +
            `btw-aangifte, dus controleer ze eerst in je Z-rapport en importeer daarna opnieuw.`,
        },
        { status: 400 },
      );
    }

    // One row per day: a re-import of the same date UPDATES (the unique constraint
    // daily_turnover_unique_day (user_id, turnover_date) drives the upsert).
    const { error } = await supabase
      .from("daily_turnover")
      .upsert(records, { onConflict: "user_id,turnover_date" });
    if (error) return NextResponse.json({ error: "kon dagomzet niet opslaan" }, { status: 500 });

    // [DAGOMZET-AUDIT] This is a money mutation into the BTW-authoritative daily_turnover — audit it
    // (the intake/reprocess paths already do). Constraint (4): every money write is auditable.
    await logAuditAction({
      userId: user.id, action: "turnover.auto_imported", entityType: "turnover", entityId: user.id,
      newValue: {
        via: "dagomzet_manual_commit",
        days: records.map((r) => r.turnover_date),
        count: records.length,
        total_incl: records.reduce((s, r) => s + (r.total_incl ?? 0), 0),
      },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ ok: true, committed: records.length });
  }

  // ── 1) PREVIEW — parse + normalize, write nothing ──
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "verwacht een bestand" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "geen bestand ontvangen" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bestand is leeg of te groot (max 10MB)" }, { status: 400 });
  }

  let matrix;
  // Read once: the PDF fallback below needs the same bytes, and re-reading a File to recover
  // from a refusal is a second chance for the read itself to be the thing that fails.
  const bytes = new Uint8Array(await file.arrayBuffer()); // binary-safe (never file.text())
  try {
    matrix = sheetBytesToMatrix(bytes);
  } catch (e) {
    // [GEEN-SPREADSHEET] Name the format, not the content. "kon het bestand niet lezen als
    // spreadsheet" is true of a PDF and tells the owner nothing they can act on; the one thing
    // they need is that the same export exists as Excel and that is what to ask for.
    if (e instanceof NotASpreadsheetError) {
      // [PDF-ALS-BLAD] Before refusing a PDF, try to read it. The owner's bookkeeper sends the
      // grootboek as PDF and his POS prints the Z-report as one; both carry every figure the
      // import needs, laid out as a table whose coordinates the file still declares. Falling
      // back to the refusal below when that does not work keeps the honest answer intact.
      if (e.mime === "application/pdf") {
        const fromPdf = await pdfBytesToMatrix(bytes);
        if (fromPdf && fromPdf.length > 0) matrix = fromPdf as never;
      }
      if (!matrix) {
        return NextResponse.json({
          ok: false,
          error: e.mime === "application/pdf"
            ? "Ik kon deze PDF niet als tabel lezen. Vraag je boekhouder of kassaleverancier om dezelfde export als Excel-bestand (.xls, .xlsx) of .csv."
            : "Dit is een afbeelding, geen spreadsheet. Ik kan alleen .xls, .xlsx of .csv lezen.",
          format: e.mime,
        }, { status: 422 });
      }
    } else {
      return NextResponse.json({ error: "kon het bestand niet lezen als spreadsheet" }, { status: 422 });
    }
  }

  // [DETECT] A grootboek/kas export (OVERZICHT/KASBOEK) is NOT a Z-report — its per-rate
  // omzet columns are absent, so the normalizer would return a confusing "no_header". Catch
  // it and point the owner to the right place instead of a dead end.
  if (detectSheetKind(matrix) === "ledger") {
    return NextResponse.json({
      ok: false,
      wrongKind: "ledger",
      error: "Dit lijkt een grootboek/kas-overzicht (OVERZICHT/KASBOEK), geen kassa-Z-rapport. De dagomzet-import verwacht een Z-rapport met 'Omzet incl.' en BTW-tarief kolommen.",
    }, { status: 422 });
  }

  const { rows, warnings } = normalizeTurnoverSheet(matrix);

  // [KASSA-OMZETRAPPORT] The column reader found no header — try the POS's own day report, which
  // is the same information transposed: one day, rates as rows. It is a separate reader because
  // one function with two ideas of what a row is fails silently; this one refuses anything whose
  // own arithmetic does not close, so reaching for it costs nothing when the file is something
  // else entirely.
  if (rows.length === 0 && warnings.some((w) => w.code === "no_header")) {
    const pos = parsePosOmzetReport(matrix as never);
    if (pos.day) {
      return NextResponse.json({ ok: true, preview: true, count: 1, rows: [pos.day], warnings: [] });
    }
    // A report we recognised and could not trust is a different answer from a file we do not
    // know, and the owner is told which — a total that does not add up is something he can check.
    if (pos.refusal === "rate_math_failed" || pos.refusal === "total_mismatch") {
      return NextResponse.json({
        ok: false,
        error: pos.refusal === "total_mismatch"
          ? `Dit kassa-omzetrapport telt niet op: de tarieven samen zijn € ${(pos.detail?.found ?? 0).toFixed(2).replace(".", ",")} terwijl het rapport € ${(pos.detail?.expected ?? 0).toFixed(2).replace(".", ",")} als totaal noemt. Er is niets geboekt.`
          : "In dit kassa-omzetrapport klopt een tarief niet met zichzelf (basis + btw ≠ inclusief). Er is niets geboekt.",
      }, { status: 422 });
    }
  }

  return NextResponse.json({ ok: true, preview: true, count: rows.length, rows, warnings });
}

// [DAGOMZET-DELETE] Clear a booked turnover day. A wrong-date/wrong-month row fed the BTW return and
// there was no way to reverse it (re-import only overwrites the SAME date). This removes exactly one
// day (?date=YYYY-MM-DD) for the owner and audits the reversal. Reversible + audited (constraint 4).
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !ISO_DATE.test(date)) return NextResponse.json({ error: "ongeldige of ontbrekende datum" }, { status: 400 });

  // Capture the row first so the audit records exactly what was removed (and a no-op is a clean 404).
  // The error is READ, not dropped: it used to be ignored, so a failed lookup left `existing` null
  // and the owner — looking straight at the row in the manage list — was told "geen dagomzet op
  // deze datum". "We could not check" and "it is not there" are not the same answer.
  const { data: existing, error: readErr } = await supabase
    .from("daily_turnover").select("turnover_date, total_incl, source")
    .eq("user_id", user.id).eq("turnover_date", date).maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { error: "We konden deze dag nu niet opzoeken. Er is niets verwijderd — probeer het zo meteen opnieuw." },
      { status: 500 },
    );
  }
  if (!existing) return NextResponse.json({ error: "geen dagomzet op deze datum" }, { status: 404 });

  // [KASSA-DAG-WEG] Een door de Kassa opgebouwde dag mag hier niet verdwijnen.
  //
  // De rij in daily_turnover is het ENIGE geldbedrag van zo'n dag: till-book.ts bouwt hem uit de
  // tickets (salesToTurnoverRow → bookTurnoverRows) en niets leest till_sales voor omzet of BTW.
  // Verdwijnt de rij, dan blijven de tickets staan en verdwijnt de dag uit rubriek 1a/1b, uit het
  // resultaat en uit de kasbalans — bij 40 tickets van samen € 1.815 is dat € 1.500 omzet en € 315
  // BTW weg, waarvan € 600 contant dat de lade wél heeft gezien. Niets bouwt hem opnieuw op: de
  // Kassa herbouwt de dag alleen wanneer er een NIEUW ticket wordt aangeslagen.
  //
  // En op het scherm is zo'n dag niet te onderscheiden van een met de hand getypte dag — beide
  // dragen dezelfde `source` — dus de eigenaar tikt het prullenbakje in 'Beheer dagen' zonder te
  // kunnen weten dat hij hier iets anders weghaalt dan hij zelf heeft ingevuld.
  //
  // Dezelfde regel als daySourceConflict hanteert: één dag, één bron, en de eigenaar ruimt de bron
  // op die hij bedoelde. Een MISLUKTE telling weigert ook — verwijderen is onomkeerbaar, dus
  // "ik weet het niet" hoort hier aan de veilige kant te vallen. Een ONTBREKENDE tabel telt als
  // nul: dan heeft er nooit een Kassa gedraaid.
  const tillRes = await supabase
    .from("till_sales").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("sale_date", date);
  if (tillRes.error && !isMissingRelation(tillRes.error.message)) {
    return NextResponse.json(
      { error: "We konden niet nagaan of deze dag op de Kassa is aangeslagen. Er is niets verwijderd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  if ((tillRes.count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          `Deze dag is opgebouwd uit ${tillRes.count} kassabon${(tillRes.count ?? 0) === 1 ? "" : "nen"}. ` +
          "Als je hem hier weghaalt verdwijnt de omzet en de BTW van die dag uit je boeken terwijl de bonnen blijven staan. " +
          "Corrigeer de bonnen op de Kassa; het dagtotaal volgt dan vanzelf.",
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("daily_turnover").delete().eq("user_id", user.id).eq("turnover_date", date);
  if (error) return NextResponse.json({ error: "kon dagomzet niet verwijderen" }, { status: 500 });

  // [DAGOMZET-AUDIT] Its OWN action. Removing a day is a money REVERSAL out of the
  // BTW-authoritative table, and it was logged as 'turnover.auto_imported' — the same name the
  // import writes — so the trail called a deletion an import, and the only thing separating them
  // was a `via` string buried in the JSON. Anyone asking the audit log "which turnover days were
  // removed, and by whom" got nothing back.
  await logAuditAction({
    userId: user.id, action: "turnover.day_removed", entityType: "turnover", entityId: user.id,
    oldValue: { turnover_date: existing.turnover_date, total_incl: existing.total_incl, source: existing.source },
    newValue: { via: "dagomzet_delete", removed_day: date },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, removed: date });
}
