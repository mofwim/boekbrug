// src/app/api/supplier/incasso/route.ts
// [AUTO-INCASSO] "Deze leverancier schrijft zelf af."
//
// POST /api/supplier/incasso  { supplierName | supplierId, on: boolean }
//
// One sentence from the owner about a RELATIONSHIP — they signed a machtiging once, and from then
// on this supplier collects its own invoices. Everything the app does with it follows from that:
// the invoices lose the "te laat" badge (the owner is not late, the bank simply has not run yet),
// they leave Vandaag's "Te betalen", and above all they lose the "Betalen" button — which on an
// already-collected invoice hands the supplier a SECOND copy of the money.
//
// ── WHY THE FIRST SETTLEMENT RUNS HERE, IN THE REQUEST ──
// The hourly reconcile books collections on its own, so this route could simply flip a flag and
// let the cron catch up. It does not, for one reason: the owner who flips this switch is looking
// at a screen full of invoices the bank paid weeks ago. A switch that changes nothing visible for
// up to an hour reads as a switch that does not work, and the second thing that owner does is tap
// "Betaald" on all of them by hand — which is exactly the work this was meant to remove.
//
// So the pass runs now, and the answer says precisely what it did: which invoices were booked, for
// how much, and which were deliberately held back and why. A bulk change to the books that reports
// only "gelukt" is the kind of quiet money movement this codebase spends its comments on.
//
// ── WHY IT MAY CREATE A SUPPLIER ROW ──
// The registry only creates a supplier when an import gives it a reliable key, so a company whose
// invoices predate it — years of rent — may have no row at all. The owner naming it IS a reliable
// statement about it, so the row is created on the spot. Without that, the feature would silently
// do nothing for precisely the suppliers it is for.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { amsterdamToday } from "@/lib/format-nl";
import { supplierNameKey, isReliableSupplierName } from "@/lib/supplier-registry";
import { incassoSupported, settleIncassoForUser } from "@/lib/incasso-settle";

export const dynamic = "force-dynamic";

// The settle pass walks every open purchase invoice and books one payment per collected one. An
// owner switching this on for their landlord after two years has a real batch to work through, and
// a kill halfway leaves the rest for the hourly cron — but the ceiling should not be what causes it.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Marking a supplier as self-collecting decides that invoices get booked as PAID without anyone
  // watching the money leave. That is an owner's decision, like every other door into the books.
  { const w = await requireOwner('Een leverancier op automatische incasso zetten'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const on = body.on === true;
  const supplierId = typeof body.supplierId === "string" ? body.supplierId.trim() : "";
  const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim() : "";
  if (!supplierId && !supplierName) {
    return NextResponse.json({ error: "Geen leverancier opgegeven" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // [DEPLOY-SAFE] The column arrives with a migration, and code ships before migrations are
  // applied. Refuse in Dutch instead of failing with a Postgres error — and refuse rather than
  // pretend, because a switch that silently does nothing is worse than one that is honestly off.
  if (!(await incassoSupported(pipeline))) {
    return NextResponse.json(
      { error: "Automatische incasso is nog niet beschikbaar. Probeer het straks opnieuw." },
      { status: 503 },
    );
  }

  // ── Find the supplier row, or make one ──
  let row: { id: string; name: string } | null = null;
  if (supplierId) {
    const { data, error } = await pipeline
      .from("suppliers").select("id, name").eq("id", supplierId).eq("user_id", user.id).maybeSingle();
    // [NO-SILENT-EMPTY] A failed read must not read as "this supplier does not exist" — that would
    // send us down the create branch and quietly open a second row for the same company.
    if (error) return NextResponse.json({ error: "We konden deze leverancier niet opzoeken. Probeer het opnieuw." }, { status: 503 });
    row = (data as { id: string; name: string } | null) ?? null;
  }
  if (!row && supplierName) {
    if (!isReliableSupplierName(supplierName)) {
      // A placeholder name ("Onbekende afzender") as a key would put every unidentified invoice in
      // the app on one mandate. There is nothing safe to do with it.
      return NextResponse.json(
        { error: "Deze leverancier heeft nog geen duidelijke naam. Vul eerst de naam op de factuur aan." },
        { status: 400 },
      );
    }
    const key = supplierNameKey(supplierName);
    const { data, error } = await pipeline
      .from("suppliers").select("id, name").eq("user_id", user.id).eq("name_key", key)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: "We konden deze leverancier niet opzoeken. Probeer het opnieuw." }, { status: 503 });
    row = (data as { id: string; name: string } | null) ?? null;

    if (!row) {
      const { data: made, error: makeErr } = await pipeline
        .from("suppliers").insert({ user_id: user.id, name: supplierName, name_key: key })
        .select("id, name").maybeSingle();
      if (makeErr || !made) {
        return NextResponse.json({ error: "We konden deze leverancier niet opslaan. Probeer het opnieuw." }, { status: 503 });
      }
      row = made as { id: string; name: string };
    }
  }
  if (!row) return NextResponse.json({ error: "Leverancier niet gevonden" }, { status: 404 });

  const today = amsterdamToday();
  const { error: updErr } = await pipeline
    .from("suppliers")
    // `since` is stamped on the way ON and left alone on the way OFF: it records when the owner
    // said so, and the audit trail should keep the last statement rather than erase it.
    // auto_incasso is added by auto_incasso.sql and not yet in the generated types — same cast the
    // bank auto-matcher uses for its own post-migration column. incassoSupported() above is what
    // makes the write safe; this only silences the stale type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((on ? { auto_incasso: true, auto_incasso_since: today } : { auto_incasso: false }) as any)
    .eq("id", row.id)
    .eq("user_id", user.id);
  if (updErr) {
    return NextResponse.json({ error: "We konden dit niet opslaan. Probeer het opnieuw." }, { status: 503 });
  }

  await logAuditAction({
    userId: user.id,
    action: on ? "supplier.auto_incasso_on" : "supplier.auto_incasso_off",
    entityType: "supplier", entityId: row.id,
    oldValue: { auto_incasso: !on },
    newValue: { auto_incasso: on, supplier: row.name, since: on ? today : null },
    ipAddress: getClientIP(req),
  });

  // Switching OFF changes nothing that has already been booked. Those collections really happened;
  // undoing them is the per-invoice "Toch niet betaald", which exists and detaches properly.
  if (!on) return NextResponse.json({ ok: true, on: false, supplier: row.name, booked: [], held: [] });

  // The session client for the payment, so the database's own 'verwerkt' trigger fires with a real
  // auth.uid() — the same client the "Betaald" toggle uses for exactly that reason.
  const summary = await settleIncassoForUser(pipeline, supabase, user.id, today);
  if (!summary.ok) {
    // The flag IS saved — from here on the invoices are treated as incasso and the hourly pass will
    // book them. Only this immediate catch-up did not run, and saying so is the difference between
    // "nothing was collected yet" and "we could not look".
    return NextResponse.json({
      ok: true, on: true, supplier: row.name, booked: [], held: [],
      warning: "De leverancier is opgeslagen, maar we konden de openstaande facturen nu niet nalopen. Dat gebeurt vanzelf binnen een uur.",
    });
  }

  return NextResponse.json({
    ok: true, on: true, supplier: row.name,
    booked: summary.booked, held: summary.held,
  });
}
