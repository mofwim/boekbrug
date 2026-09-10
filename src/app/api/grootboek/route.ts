// src/app/api/grootboek/route.ts
// [GROOTBOEK] Which cost account each purchase invoice belongs on: what still has to be answered,
// and the owner's answer.
//
// GET lists the incoming invoices that carry no account yet, each with a SUGGESTION and what that
// suggestion rests on. The suggestion is computed here and stored nowhere — see grootboek.ts for
// why it may never book on its own. What IS stored is only ever what a human confirmed.
//
// PATCH records one answer. It writes a single column on a single row, guarded on ownership, and
// accepts only an account that exists in the rekeningschema — an accID that is not in the chart
// makes the whole auditfile invalid, so it is refused at the door rather than at export time.
//
// [NO-SILENT-EMPTY] A failed read is a 503 with a sentence. "Everything has an account" and "we
// could not look" are opposite answers, and the first is the dangerous direction here: it tells
// the owner their administratie is finished.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { logAuditAction } from "@/lib/audit";
import {
  suggestLedgerAccount, isLedgerAccount, LEDGER_ACCOUNTS,
  type LedgerSuggestion,
} from "@/lib/grootboek";

export const dynamic = "force-dynamic";

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  client_name: string | null;
  supplier_id: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
  ledger_account: string | null;
}

/** The supplier key an invoice is remembered under: its link first, else its printed name. */
function supplierKey(row: { supplier_id: string | null; client_name: string | null }): string {
  const id = (row.supplier_id ?? "").trim();
  if (id) return `id:${id}`;
  const name = (row.client_name ?? "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const pipeline = createPipelineClient();

  try {
    // Every incoming invoice, decided or not: the DECIDED ones are what the suggestion for the
    // undecided ones rests on. Reading only the open ones would throw away the owner's own
    // history, which is the strongest signal this endpoint has.
    const rows = await fetchAllRows<InvoiceRow>((from, to) =>
      // [GROOTBOEK] ledger_account is newer than the generated types → relaxed client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from("invoices")
        .select("id, invoice_number, invoice_date, client_name, supplier_id, total_ex_btw, total_inc_btw, ledger_account")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .not("status", "in", "(draft,archived,cancelled)")
        .order("id", { ascending: true })
        .range(from, to));

    // What this owner has actually done, per supplier. Only real accounts count — a stored value
    // this app no longer knows is not evidence of a habit.
    const historyBySupplier = new Map<string, string[]>();
    for (const r of rows) {
      const account = (r.ledger_account ?? "").trim();
      if (!isLedgerAccount(account)) continue;
      const key = supplierKey(r);
      if (!key) continue;
      historyBySupplier.set(key, [...(historyBySupplier.get(key) ?? []), account]);
    }

    const open = rows
      .filter((r) => !isLedgerAccount(r.ledger_account))
      .map((r) => {
        const suggestion: LedgerSuggestion = suggestLedgerAccount({
          vendor: r.client_name,
          supplierHistory: historyBySupplier.get(supplierKey(r)) ?? [],
        });
        return {
          id: r.id,
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          vendor: r.client_name,
          // The gross is what the owner recognises the invoice by; the base is what will book.
          totalIncBtw: r.total_inc_btw,
          totalExBtw: r.total_ex_btw,
          suggestion,
        };
      })
      // Newest first: the invoice they remember is the one they can answer.
      .sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));

    return NextResponse.json({
      ok: true,
      accounts: LEDGER_ACCOUNTS,
      open,
      decided: rows.length - open.length,
      total: rows.length,
    });
  } catch (e) {
    console.error("[GROOTBOEK] openstaande rekeningen lezen mislukt", {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "We konden nu niet ophalen welke facturen nog een rekening nodig hebben." },
      { status: 503 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => null) as { id?: string; account?: string | null } | null;
  const id = (body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Geen factuur opgegeven" }, { status: 400 });

  // null clears the answer — an owner who realises they picked the wrong account must be able to
  // put the invoice back on the list rather than having to pick a second wrong one.
  const raw = body?.account === null ? null : (body?.account ?? "").trim();
  if (raw !== null && !isLedgerAccount(raw)) {
    return NextResponse.json(
      { error: "Die grootboekrekening kennen we niet.", code: "unknown_account" },
      { status: 400 },
    );
  }

  const pipeline = createPipelineClient();
  // Guarded on receiver_id AND direction: this column means nothing on a sales invoice, and a
  // route that would write it there is a route that can be pointed at somebody else's row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (pipeline as any)
    .from("invoices")
    .update({ ledger_account: raw })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[GROOTBOEK] rekening opslaan mislukt", { id, error: error.message });
    return NextResponse.json({ error: "Opslaan mislukt — probeer het nog een keer." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });

  // The account decides where money lands in the auditfile, so the change is part of the trail.
  await logAuditAction({
    userId: user.id,
    action: "invoice.ledger_account_set",
    entityType: "invoice",
    entityId: id,
    newValue: { ledger_account: raw },
  }).catch(() => {});

  return NextResponse.json({ ok: true, id, account: raw });
}
