// src/lib/xaf-fetch.ts
// [XAF-BRON] The reads behind an auditfile, in ONE place, because there are now two doors to it.
//
// This code was the body of /api/xaf. That was fine while the download was the only way to get an
// XAF — and it was not: email.ts tells every accountant that the quarterly package "bevat de PDF's,
// een CSV-overzicht en het XAF 3.2-auditbestand", and the recipient of that mail has NO ACCOUNT
// ("Je hebt hiervoor geen account nodig"). So the one caller of buildXafFile sat behind a login the
// promised reader cannot pass, and closing-package.ts wrote sixteen files, none of them .xaf.
//
// Copying the reads into the package builder would have made two answers to "what books into the
// auditfile", diverging on the first change — the failure mode AGENTS.md and half the gates in this
// repo are written about. So the reads move here and both doors call them.
//
// [NO-SILENT-EMPTY] Every read THROWS on failure. An auditfile missing a table's rows is not a
// smaller administration, it is a WRONG one that an accountant imports whole. The route turns that
// into a 503; the package builder turns it into a stated warning and ships without the file.
//
// Every attribution AUTHORITY is imported, never restated: isVerifiedForPackage/effectiveDirection
// decide which invoices book, toResultBankTx decides what a card payout is, liveCashEntries decides
// which cash rows exist, fetchRateShares supplies the mixed-rate split.

import type { PipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { isVerifiedForPackage, effectiveDirection } from "@/lib/package-attribution";
import { toResultBankTx } from "@/lib/financial-result";
import { liveCashEntries } from "@/lib/cash-live";
import { fetchRateShares } from "@/lib/btw-rate-split-fetch";
import { turnoverNetOmzet } from "@/lib/turnover";
import { amsterdamToday } from "@/lib/format-nl";
import type { XafInput } from "@/lib/xaf-export";

/**
 * Assemble the XafInput for one owner and one year.
 *
 * `through` is the LAST day to include, inclusive. It exists for the quarterly package: a package
 * for Q2 may not carry Q3's bookings, and an auditfile whose header says 31 December while its
 * entries stop in June is a file that lies about its own scope. Absent → the whole year.
 *
 * The declared endDate is clamped to today either way ([XAF-PERIODE]): a file may not declare days
 * that have not happened.
 *
 * Note what this does NOT do: it does not window the START. XAF 3.2 as this repo emits it opens on
 * 1 January and declares MONTH periods (xaf-export.ts:567,633) — it is a year-to-date file by
 * construction, and pretending otherwise by moving startDate would leave the periods contradicting
 * the header. So a quarterly package carries a year-to-date file, and says so in LEESMIJ.txt in
 * the one sentence that matters: a later quarter REPLACES this file, it does not add to it.
 */
export async function buildXafInputForOwner(args: {
  pipeline: PipelineClient;
  ownerId: string;
  year: number;
  through?: string | null;
}): Promise<XafInput> {
  const { pipeline, ownerId, year } = args;
  const start = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const through = args.through && args.through < yearEnd ? args.through : yearEnd;
  const end = through;

  // ── Company ──
  const { data: profile, error: profErr } = await pipeline
    .from("profiles")
    .select("company_name, full_name, kvk_number, btw_number, address, postal_code, city, kor_active")
    .eq("id", ownerId)
    .maybeSingle();
  if (profErr) throw new Error(`profiel: ${profErr.message}`);

  // ── Invoices, both directions, through the package's own verified/direction rules ──
  const invRows = await fetchAllRows<{
    id: string; invoice_number: string | null; direction: string | null; status: string | null;
    invoice_type: string | null; total_ex_btw: number | null; btw_amount: number | null;
    invoice_date: string | null; receiver_id: string | null; client_name: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("id, invoice_number, direction, status, invoice_type, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));
  const attributed = invRows
    .map((r) => ({ ...r, direction: effectiveDirection(r, ownerId) }))
    .filter(isVerifiedForPackage);
  const outgoing = attributed.filter((r) => r.direction === "outgoing");
  const incoming = attributed.filter((r) => r.direction === "incoming");
  const { rateShares } = await fetchRateShares(pipeline, outgoing.map((r) => ({ id: r.id, total_ex_btw: r.total_ex_btw, btw_amount: r.btw_amount })));

  // ── Bank lines + the direction of whatever invoice each one settles ──
  const bankRows = await fetchAllRows<{
    id: string; amount: number | null; category: string | null; invoice_id: string | null;
    date: string | null; description: string | null; counterpart_name: string | null;
  }>((from, to) => pipeline
    .from("bank_transactions")
    .select("id, amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  const linkedIds = bankRows.map((b) => b.invoice_id).filter((x): x is string => !!x);
  // A linked invoice may be dated in ANOTHER year — fetch by id, not by window.
  const linkedRows = await fetchAllRowsForIds<{ id: string; direction: string | null; receiver_id: string | null }, string>(
    linkedIds,
    (chunk, from, to) => pipeline
      .from("invoices")
      .select("id, direction, receiver_id")
      .in("id", chunk)
      .order("id", { ascending: true }).range(from, to),
  );
  const linkedDirection = new Map(linkedRows.map((r) => [r.id, effectiveDirection(r, ownerId)]));

  // ── Cash rows ([KAS-ZACHT]: live ones only) ──
  const liveCash = await liveCashEntries(pipeline);
  const cashRows = await fetchAllRows<{
    id: string; direction: string | null; amount: number | null; category: string | null;
    btw_rate: number | null; entry_date: string | null; document_id: string | null;
    invoice_id: string | null;
  }>((from, to) => liveCash.only(pipeline
    .from("cash_entries")
    .select("id, direction, amount, category, btw_rate, entry_date, document_id, invoice_id")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end))
    .order("id", { ascending: true }).range(from, to));

  // ── Till Z-days + the covered set (same predicate as the result engine) ──
  const turnoverRows = await fetchAllRows<{
    turnover_date: string; base_0: number | null; base_9: number | null; base_21: number | null;
    btw_9: number | null; btw_21: number | null; total_incl: number | null;
    pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
  }>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", start)
    .lte("turnover_date", end)
    .order("turnover_date", { ascending: true }).range(from, to));
  const coveredDates = new Set(
    turnoverRows
      .filter((t) => turnoverNetOmzet({
        turnover_date: t.turnover_date,
        base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
        btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
        total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
      }) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => t.turnover_date),
  );

  // [XAF-PERIODE] The file may not declare days that have not happened — nor days it did not
  // read. `through` is already <= 31 December; today is the second ceiling.
  const vandaag = amsterdamToday();
  const endDate = through < vandaag ? through : vandaag;

  // [XAF-REGIME] The honest limits, said inside the file: under KOR there is no right of
  // deduction (the 1400 lines then need the accountant's judgement), and 0%-omzet is not split
  // into verlegd/vrijgesteld/export here — the aangifte screen is where that split lives.
  const regimeNotes: string[] = [];
  if ((profile as { kor_active?: boolean | null } | null)?.kor_active) {
    regimeNotes.push("Deze onderneming valt onder de KOR: er bestaat geen recht op aftrek van voorbelasting. Beoordeel de 1400-regels in dit bestand voordat je ze overneemt.");
  }
  regimeNotes.push("Omzet op rekening 8020 is 0%/verlegd/vrijgesteld ZONDER onderscheid — de BTW-aangifte in BoekBrug draagt de rubriekverdeling.");

  return {
    year,
    dateCreated: vandaag,
    endDate,
    regimeNotes,
    company: {
      name: profile?.company_name || profile?.full_name || "Onbekende onderneming",
      kvkNumber: profile?.kvk_number ?? null,
      btwNumber: profile?.btw_number ?? null,
      address: profile?.address ?? null,
      postalCode: profile?.postal_code ?? null,
      city: profile?.city ?? null,
    },
    sales: outgoing.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      clientName: r.client_name,
      totalExBtw: r.total_ex_btw ?? 0,
      btwAmount: r.btw_amount ?? 0,
      invoiceType: r.invoice_type,
      rateLines: rateShares.get(r.id) ?? null,
    })),
    purchases: incoming.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      vendorName: r.client_name,
      totalExBtw: r.total_ex_btw ?? 0,
      btwAmount: r.btw_amount ?? 0,
    })),
    bank: bankRows.map((b) => ({
      id: b.id,
      date: b.date,
      amount: b.amount ?? 0,
      description: b.description,
      category: b.category,
      linkedInvoiceDirection: b.invoice_id ? linkedDirection.get(b.invoice_id) ?? null : null,
      posSettlement: toResultBankTx(b).posSettlement === true,
    })),
    cash: cashRows.map((c) => ({
      id: c.id,
      date: c.entry_date,
      direction: c.direction === "in" ? "in" : "out",
      amount: c.amount ?? 0,
      category: c.category,
      btwRate: c.btw_rate,
      documentId: c.document_id,
      invoiceId: c.invoice_id,
      coveredByTurnover: c.category === "omzet" && c.entry_date != null && coveredDates.has(c.entry_date),
    })),
    turnover: turnoverRows.map((t) => ({
      date: t.turnover_date,
      base0: t.base_0 ?? 0, base9: t.base_9 ?? 0, base21: t.base_21 ?? 0,
      btw9: t.btw_9 ?? 0, btw21: t.btw_21 ?? 0,
      pinAmount: t.pin_amount ?? 0, cashAmount: t.cash_amount ?? 0, otherAmount: t.other_amount ?? 0,
      totalIncl: t.total_incl,
    })),
  };
}
