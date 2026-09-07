// src/app/api/assets/route.ts
// [BEDRIJFSMIDDEL] The asset register. User-scoped via the RLS server client; writes are the
// owner's alone (requireOwner) because a row here moves the year's winst.
//
//   GET    → the register with each asset's yearly depreciation and boekwaarde today, plus the
//            purchase invoices worth asking about (asset-candidates.ts)
//   POST   → add an asset ({ description, cost, residual_value, useful_life_years, in_use_from,
//            invoice_id? }), or answer a candidate ({ action: 'dismiss' | 'undismiss', invoice_id })
//   PATCH  → change one ({ id, …fields, disposed_on?, disposal_note? })
//   DELETE → ?id=
//
// The rules live in depreciation.ts; this route only refuses what that module would refuse, in
// Dutch, before the round trip to the database says it in SQL.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { amsterdamToday } from "@/lib/turnover-import";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { assetCandidates, type CandidateInvoiceRow } from "@/lib/asset-candidates";
import { round2 } from "@/lib/invoice-totals";
import {
  yearlyDepreciation, bookValueAt, withinOrdinaryRate, MIN_USEFUL_LIFE_YEARS, MAX_USEFUL_LIFE_YEARS,
} from "@/lib/depreciation";

export const dynamic = "force-dynamic";

const ASSET_FIELDS = "id, invoice_id, description, cost, residual_value, useful_life_years, in_use_from, disposed_on, disposal_note, created_at";
const MISSING = /relation .* does not exist|schema cache|Could not find the table/i;

type AssetRecord = {
  id: string; invoice_id: string | null; description: string; cost: number | string;
  residual_value: number | string; useful_life_years: number; in_use_from: string;
  disposed_on: string | null; disposal_note: string | null; created_at: string;
};

function shape(a: AssetRecord, today: string) {
  const like = {
    cost: Number(a.cost) || 0, residualValue: Number(a.residual_value) || 0,
    usefulLifeYears: Number(a.useful_life_years), inUseFrom: a.in_use_from, disposedOn: a.disposed_on,
  };
  return {
    ...a, cost: like.cost, residual_value: like.residualValue,
    yearly: yearlyDepreciation(like),
    book_value: bookValueAt(like, today),
  };
}

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? round2(n) : null;
};

/** Validates the money fields of a POST/PATCH body; returns the Dutch refusal or the record part. */
function validateFields(body: Record<string, unknown>, partial: boolean): { error?: string; fields?: Record<string, unknown> } {
  const out: Record<string, unknown> = {};
  if ("description" in body || !partial) {
    const d = typeof body.description === "string" ? body.description.trim().slice(0, 200) : "";
    if (!d) return { error: "Vul een omschrijving in." };
    out.description = d;
  }
  if ("cost" in body || !partial) {
    const c = money(body.cost);
    if (c === null || c < 0) return { error: "Controleer de aanschafwaarde." };
    out.cost = c;
  }
  if ("residual_value" in body || !partial) {
    const r = money(body.residual_value ?? 0);
    if (r === null || r < 0) return { error: "Controleer de restwaarde." };
    out.residual_value = r;
  }
  if ("useful_life_years" in body || !partial) {
    const y = Number(body.useful_life_years);
    if (!withinOrdinaryRate(y)) {
      return { error: `Gebruiksduur: een heel aantal jaren van ${MIN_USEFUL_LIFE_YEARS} tot ${MAX_USEFUL_LIFE_YEARS} (maximaal 20% per jaar).` };
    }
    out.useful_life_years = y;
  }
  if ("in_use_from" in body || !partial) {
    if (!isYmd(body.in_use_from)) return { error: "Controleer de datum van ingebruikname." };
    out.in_use_from = body.in_use_from;
  }
  if ("disposed_on" in body) {
    if (body.disposed_on !== null && !isYmd(body.disposed_on)) return { error: "Controleer de datum van afvoer." };
    out.disposed_on = body.disposed_on;
    out.disposal_note = typeof body.disposal_note === "string" ? body.disposal_note.trim().slice(0, 500) || null : null;
  }
  if (typeof out.cost === "number" && typeof out.residual_value === "number" && out.residual_value > out.cost) {
    return { error: "De restwaarde kan niet hoger zijn dan de aanschafwaarde." };
  }
  return { fields: out };
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const today = amsterdamToday();

  const { data: assets, error } = await supabase.from("assets").select(ASSET_FIELDS).eq("user_id", user.id).order("in_use_from", { ascending: false });
  if (error) {
    if (MISSING.test(error.message ?? "")) return NextResponse.json({ ok: true, available: false, today, assets: [], candidates: [] });
    return NextResponse.json({ error: "We konden het register nu niet lezen. Probeer het zo opnieuw." }, { status: 500 });
  }

  // The threshold follows the btw regime: ex btw when the btw is deducted, incl when it is not.
  const { data: profile } = await supabase.from("profiles").select("vat_exempt_activity, kor_active").eq("id", user.id).maybeSingle();
  const btwDeductible = !(profile?.vat_exempt_activity === true || profile?.kor_active === true);

  const { data: dismissed } = await supabase.from("asset_dismissals").select("invoice_id").eq("user_id", user.id);
  const since = `${Number(today.slice(0, 4)) - 2}-01-01`;
  let candidateRows: CandidateInvoiceRow[] = [];
  let candidatesUnreadable = false;
  try {
    candidateRows = await fetchAllRows<CandidateInvoiceRow>((from, to) => supabase
      .from("invoices")
      .select("id, invoice_date, invoice_number, client_name, supplier_id, total_ex_btw, total_inc_btw, invoice_type, status")
      .eq("receiver_id", user.id).eq("direction", "incoming").in("status", ["received", "paid"])
      .gte("invoice_date", since)
      .order("id", { ascending: true }).range(from, to) as never);
  } catch (e) {
    // [NO-SILENT-EMPTY] No candidates because the read failed is not "no candidates".
    console.error("[BEDRIJFSMIDDEL] candidate read failed", { userId: user.id, error: e instanceof Error ? e.message : String(e) });
    candidatesUnreadable = true;
  }
  const rows = (assets ?? []) as AssetRecord[];
  const registered = new Set(rows.map((a) => a.invoice_id).filter((x): x is string => !!x));
  const candidates = candidatesUnreadable ? [] : assetCandidates(candidateRows, {
    btwDeductible, registered, dismissed: new Set((dismissed ?? []).map((d) => d.invoice_id)),
  });
  // The invoice behind each registered asset, for the row.
  const byId = new Map(candidateRows.map((r) => [r.id, r]));
  return NextResponse.json({
    ok: true, available: true, today, btwDeductible, candidatesUnreadable,
    assets: rows.map((a) => ({
      ...shape(a, today),
      invoice_number: a.invoice_id ? byId.get(a.invoice_id)?.invoice_number ?? null : null,
      supplier_name: a.invoice_id ? byId.get(a.invoice_id)?.client_name ?? null : null,
    })),
    candidates,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een bedrijfsmiddel vastleggen");
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  if (body.action === "dismiss" || body.action === "undismiss") {
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
    if (!invoiceId) return NextResponse.json({ error: "Geen factuur opgegeven." }, { status: 400 });
    const q = body.action === "dismiss"
      ? supabase.from("asset_dismissals").upsert({ user_id: user.id, invoice_id: invoiceId }, { onConflict: "user_id,invoice_id" })
      : supabase.from("asset_dismissals").delete().eq("user_id", user.id).eq("invoice_id", invoiceId);
    const { error } = await q;
    if (error) return NextResponse.json({ error: "Kon het antwoord niet bewaren." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const v = validateFields(body, false);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });

  let invoiceId: string | null = null;
  if (typeof body.invoice_id === "string" && body.invoice_id) {
    // The invoice must be this owner's own purchase — RLS already hides other people's rows, and
    // the direction check keeps a sales invoice from being registered as an asset by accident.
    const { data: inv } = await supabase.from("invoices").select("id, direction, receiver_id").eq("id", body.invoice_id).maybeSingle();
    if (!inv || inv.receiver_id !== user.id || inv.direction !== "incoming") {
      return NextResponse.json({ error: "Deze factuur is geen inkoopfactuur van jou." }, { status: 400 });
    }
    invoiceId = inv.id;
  }

  const { data, error } = await supabase
    .from("assets")
    .insert({ user_id: user.id, invoice_id: invoiceId, ...(v.fields as object), updated_at: new Date().toISOString() } as never)
    .select(ASSET_FIELDS)
    .single();
  if (error) {
    if (MISSING.test(error.message ?? "")) return NextResponse.json({ error: "Het register staat nog niet aan op deze omgeving." }, { status: 503 });
    if (/assets_one_per_invoice/.test(error.message ?? "")) return NextResponse.json({ error: "Deze factuur staat al in het register." }, { status: 409 });
    return NextResponse.json({ error: "Kon het bedrijfsmiddel niet opslaan." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, asset: shape(data as AssetRecord, amsterdamToday()) });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een bedrijfsmiddel wijzigen");
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Geen bedrijfsmiddel opgegeven." }, { status: 400 });

  // Validate against the STORED row, so a partial change (only the restwaarde) is still checked
  // against the cost it will sit beside.
  const { data: current } = await supabase.from("assets").select(ASSET_FIELDS).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Bedrijfsmiddel niet gevonden." }, { status: 404 });
  const merged = { ...body, cost: body.cost ?? current.cost, residual_value: body.residual_value ?? current.residual_value };
  const v = validateFields(merged, true);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
  if (typeof v.fields?.disposed_on === "string" && v.fields.disposed_on < String(current.in_use_from)) {
    return NextResponse.json({ error: "Afgevoerd vóór ingebruikname kan niet." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("assets")
    .update({ ...(v.fields as object), updated_at: new Date().toISOString() } as never)
    .eq("id", id).eq("user_id", user.id)
    .select(ASSET_FIELDS)
    .single();
  if (error) return NextResponse.json({ error: "Kon het bedrijfsmiddel niet opslaan." }, { status: 500 });
  return NextResponse.json({ ok: true, asset: shape(data as AssetRecord, amsterdamToday()) });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een bedrijfsmiddel verwijderen");
  if (guard.response) return guard.response;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Geen bedrijfsmiddel opgegeven." }, { status: 400 });
  const { error } = await supabase.from("assets").delete().eq("user_id", user.id).eq("id", id);
  if (error) return NextResponse.json({ error: "Kon het bedrijfsmiddel niet verwijderen." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
