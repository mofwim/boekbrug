// src/app/api/xaf/route.ts
// [XAF] GET ?year=2026[&clientId=…] — the year as an XML Auditfile Financieel 3.2 download.
//
// Dual-path like /api/ib-jaar: the owner exports their own year, a linked accountant exports a
// client's (resolveQuarterOwner + the service-role pipeline). This route is fetch-adapt-refuse
// only — every booking rule lives in xaf-export.ts, and every attribution AUTHORITY is imported,
// never restated: isVerifiedForPackage/effectiveDirection decide which invoices book,
// toResultBankTx decides what a card payout is, liveCashEntries decides which cash rows exist,
// fetchRateShares supplies the mixed-rate split.
//
// [NO-SILENT-EMPTY] Any failed read refuses with 503. An auditfile missing a table's rows is not
// a smaller administration — it is a WRONG administration that an accountant would import whole.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { isVerifiedForPackage, effectiveDirection } from "@/lib/closing-package";
import { toResultBankTx } from "@/lib/financial-result";
import { liveCashEntries } from "@/lib/cash-live";
import { fetchRateShares } from "@/lib/btw-rate-split-fetch";
import { turnoverNetOmzet } from "@/lib/turnover";
import { amsterdamToday } from "@/lib/format-nl";
import { buildXafFile, type XafInput } from "@/lib/xaf-export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }

  const owner = await resolveQuarterOwner(supabase, user.id, req.nextUrl.searchParams.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();
  const ownerId = owner.ownerId;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  try {
    // ── Company ──
    const { data: profile, error: profErr } = await pipeline
      .from("profiles")
      .select("company_name, full_name, kvk_number, btw_number, address, postal_code, city")
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
    }>((from, to) => liveCash.only(pipeline
      .from("cash_entries")
      .select("id, direction, amount, category, btw_rate, entry_date, document_id")
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

    const input: XafInput = {
      year,
      dateCreated: amsterdamToday(),
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
        posSettlement: toResultBankTx(b).posSettlement,
      })),
      cash: cashRows.map((c) => ({
        id: c.id,
        date: c.entry_date,
        direction: c.direction === "in" ? "in" : "out",
        amount: c.amount ?? 0,
        category: c.category,
        btwRate: c.btw_rate,
        documentId: c.document_id,
        coveredByTurnover: c.category === "omzet" && c.entry_date != null && coveredDates.has(c.entry_date),
      })),
      turnover: turnoverRows.map((t) => ({
        date: t.turnover_date,
        base0: t.base_0 ?? 0, base9: t.base_9 ?? 0, base21: t.base_21 ?? 0,
        btw9: t.btw_9 ?? 0, btw21: t.btw_21 ?? 0,
        pinAmount: t.pin_amount ?? 0, cashAmount: t.cash_amount ?? 0, otherAmount: t.other_amount ?? 0,
      })),
    };

    const built = buildXafFile(input);
    const safeName = (input.company.name || "administratie").replace(/[^a-zA-Z0-9._-]/g, "_");
    return new NextResponse(built.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditfile-${year}-${safeName}.xaf"`,
        // The counts travel in headers too, so a caller CAN show them without parsing XML.
        "X-Xaf-Entries": String(built.entryCount),
        "X-Xaf-Skipped": String(built.skipped.length),
      },
    });
  } catch (e) {
    console.error("[XAF] export failed", { ownerId, year, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: "We konden het auditbestand nu niet samenstellen. Er ontbrak een gegevensbron — probeer het zo opnieuw." },
      { status: 503 },
    );
  }
}
