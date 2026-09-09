// src/app/api/werk/[id]/factuur/route.ts
// [WERK] "Maak factuur": one tap on finished work, and the invoice exists as a draft.
//
// Through the ordinary draft door (/api/invoice/draft), never beside it: numbering, the client
// row, the line arithmetic and the audit trail of an invoice all live there and are not repeated
// here. This route only decides WHAT goes on the lines — workInvoiceLines in werk.ts, the same
// builder the verzamelfactuur uses — and what is stamped afterwards:
//
//   · one-off work: the hours attached and not yet billed are stamped with the invoice, the row
//     gets invoice_id and moves to 'gefactureerd', once;
//   · [WERK-BEURT] repeating work: the beurten that were not on an invoice yet are stamped with
//     it and the row STAYS OPEN — next week's beurt starts clean, and the invoice can be found
//     from every beurt it covers.
//
// Nothing is invented: an hour without a rate is left unbilled and NAMED in the answer, and work
// with no lines and no billable hours is refused rather than turned into an empty invoice. The
// draft is editable; the owner reads it before it is sent, as with every invoice in this app.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { amsterdamToday } from "@/lib/format-nl";
import { canInvoice, unbilledVisits, contractFee, canInvoicePeriod, periodInvoiceLines, periodOf, isPeriod, bundleHours, canInvoiceBundle, bundleInvoiceLines } from "@/lib/werk";
import { loadWorkForInvoice, openDraftFor, stampHours, stampVisits, stampPeriod, stampBundle, closeWork, rollbackDraft, type WorkLoaded } from "@/lib/werk-factuur";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een factuur maken van werk");
  if (guard.response) return guard.response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const loaded = await loadWorkForInvoice(db, user.id, [id]);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const work: WorkLoaded = loaded.works[0];
  const row = work.row;

  // [CONTRACT] A fee contract is billed per period: one line, the fee, the month named. The
  // period comes from the body or is this month; a future month and a billed month are refused.
  if (contractFee(row) !== null) {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const today = amsterdamToday();
    const period = isPeriod(body.period) ? body.period : periodOf(today);
    if (!canInvoicePeriod(row, period, today)) {
      return NextResponse.json({ error: "Deze periode is al gefactureerd, of ligt nog in de toekomst.", code: "period_not_invoiceable" }, { status: 409 });
    }
    const clientName = (row.client_name ?? "").trim();
    if (!clientName) return NextResponse.json({ error: "Zet eerst een klant op dit werk.", code: "no_client" }, { status: 409 });
    const lines = periodInvoiceLines(row, period);
    const opened = await openDraftFor(req, { client_id: row.client_id, client_name: clientName, lines });
    if (!opened.ok) return NextResponse.json({ error: opened.error, from: "draft" }, { status: opened.status });
    const stamped = await stampPeriod(db, user.id, id, period, opened.invoiceId);
    if (!stamped.ok) {
      await rollbackDraft(db, user.id, opened.invoiceId);
      return NextResponse.json({ error: stamped.reason === "already_billed" ? "Deze periode is inmiddels gefactureerd." : "De periode kon niet worden vastgezet. Probeer het opnieuw.", code: stamped.reason }, { status: 409 });
    }
    await logAuditAction({
      userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: id,
      newValue: { invoice_id: opened.invoiceId, title: row.title, period, fee: contractFee(row) },
      ipAddress: getClientIP(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, invoiceId: opened.invoiceId, lines: lines.length, hoursBilled: 0, hoursWithoutRate: 0, visitsBilled: 0, period });
  }

  // [STRIPPENKAART] A bundle is billed up front and the row STAYS OPEN: the hours that draw it
  // down are written on it for months afterwards. Only the row's own lines go on the invoice —
  // the hours are its delivery, not its lines, and stamping them would bill them twice.
  if (bundleHours(row) !== null) {
    if (!canInvoiceBundle(row)) {
      return NextResponse.json({ error: "Deze strippenkaart is al gefactureerd, of heeft nog geen bedrag.", code: "bundle_not_invoiceable" }, { status: 409 });
    }
    const clientName = (row.client_name ?? "").trim();
    if (!clientName) return NextResponse.json({ error: "Zet eerst een klant op dit werk.", code: "no_client" }, { status: 409 });
    const lines = bundleInvoiceLines(row);
    const opened = await openDraftFor(req, { client_id: row.client_id, client_name: clientName, lines });
    if (!opened.ok) return NextResponse.json({ error: opened.error, from: "draft" }, { status: opened.status });
    const stamped = await stampBundle(db, user.id, id, opened.invoiceId);
    if (!stamped.ok) {
      await rollbackDraft(db, user.id, opened.invoiceId);
      return NextResponse.json({ error: "Deze strippenkaart is inmiddels gefactureerd.", code: stamped.reason }, { status: 409 });
    }
    await logAuditAction({
      userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: id,
      newValue: { invoice_id: opened.invoiceId, title: row.title, bundel_uren: bundleHours(row) },
      ipAddress: getClientIP(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, invoiceId: opened.invoiceId, lines: lines.length, hoursBilled: 0, hoursWithoutRate: 0, visitsBilled: 0 });
  }

  if (!canInvoice({ status: row.status, invoice_id: row.invoice_id ?? null, repeat_every: row.repeat_every, visits: row.visits, fields: row.fields })) {
    return NextResponse.json({ error: "Alleen werk dat klaar is en nog geen factuur heeft, wordt een factuur.", code: "not_invoiceable" }, { status: 409 });
  }
  const clientName = (row.client_name ?? "").trim();
  if (!clientName) return NextResponse.json({ error: "Zet eerst een klant op dit werk.", code: "no_client" }, { status: 409 });

  // The beurten this invoice will cover — fixed BEFORE the draft is made, so a beurt ticked off
  // while the invoice was being written is not stamped as billed by it.
  const billedVisits = row.repeat_every ? unbilledVisits(row.visits) : [];
  const lines = work.lines;
  if (lines.filter((l) => l.unit_price > 0).length === 0) {
    return NextResponse.json({ error: "Zet eerst regels op het werk, of koppel uren met een tarief.", code: "no_lines" }, { status: 409 });
  }

  const opened = await openDraftFor(req, { client_id: row.client_id, client_name: clientName, lines });
  if (!opened.ok) return NextResponse.json({ error: opened.error, from: "draft" }, { status: opened.status });
  const invoiceId = opened.invoiceId;
  const today = amsterdamToday();

  // From here every step must PROVE itself, or the draft goes away again: a draft whose lines
  // name hours or beurten that are still billable elsewhere is the one outcome money cannot have.
  const stamped = await stampHours(db, user.id, [work], invoiceId);
  if (!stamped.ok) {
    await rollbackDraft(db, user.id, invoiceId);
    return NextResponse.json({ error: "De uren staan inmiddels op een andere factuur. Ververs en probeer opnieuw.", code: "uren_not_linked" }, { status: 409 });
  }
  if (row.repeat_every) {
    const v = await stampVisits(db, user.id, id, billedVisits, invoiceId);
    if (!v.ok) {
      await rollbackDraft(db, user.id, invoiceId);
      return NextResponse.json({ error: v.reason === "already_billed" ? "Deze beurten staan inmiddels op een andere factuur." : "De beurten konden niet worden vastgezet. Probeer het opnieuw.", code: v.reason }, { status: 409 });
    }
  } else {
    const closed = await closeWork(db, user.id, [id], invoiceId, today);
    if (closed.error || closed.closed !== 1) {
      await rollbackDraft(db, user.id, invoiceId);
      return NextResponse.json({ error: "Dit werk is inmiddels gefactureerd.", code: "already_invoiced" }, { status: 409 });
    }
  }

  await logAuditAction({
    userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: id,
    newValue: { invoice_id: invoiceId, title: row.title, lines: lines.length, hours_billed: work.billedHourIds.length, hours_without_rate: work.hoursWithoutRate, visits_billed: billedVisits.length },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true, invoiceId, lines: lines.length,
    hoursBilled: work.billedHourIds.length,
    hoursWithoutRate: work.hoursWithoutRate,
    visitsBilled: billedVisits.length,
  });
}
