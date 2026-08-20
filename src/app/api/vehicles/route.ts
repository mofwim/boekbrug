// src/app/api/vehicles/route.ts
// [VOERTUIG] The cars a garage works on. User-scoped via the RLS server client.
//
//   GET    → every vehicle, ordered the way a garage reads them (overdue first)
//   POST   → add or update one by plate (same plate = same car, never a second record)
//   DELETE → ?id=
//
// Carries no amount, no rate and no btw, and no financial engine reads this table — see the header
// of supabase/migrations/vehicles.sql for why that boundary is deliberate and must hold.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeKenteken, isKentekenShape, sortByApkUrgency } from "@/lib/vehicle";
import { amsterdamToday } from "@/lib/turnover-import";
import { requireOwner } from "@/lib/owner-only";

export const dynamic = "force-dynamic";

/** Trim a typed field to null, so an empty box never becomes an empty string in the record. */
function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data, error } = await supabase
    .from("vehicles")
    .select("id, kenteken, description, customer_name, customer_phone, apk_expiry, notes")
    .eq("user_id", user.id);

  // A missing table means the migration has not been applied — an empty garage, not an error the
  // owner can do anything about. Every other failure is reported rather than shown as "no cars",
  // because a list that silently reads empty is indistinguishable from a fleet that was lost.
  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message ?? "");
    if (missing) return NextResponse.json({ ok: true, vehicles: [], available: false });
    return NextResponse.json({ error: "Kon de voertuigen niet laden." }, { status: 500 });
  }

  const today = amsterdamToday();
  return NextResponse.json({
    ok: true,
    available: true,
    today,
    // Sorted here rather than in SQL: the order is a RULE (overdue, then due, then the rest, with
    // an unknown APK last but never dropped) and it lives in one tested place, not in an ORDER BY
    // that the home surface would have to reproduce to agree with this screen.
    vehicles: sortByApkUrgency(data ?? [], today),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een voertuig vastleggen");
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  const kenteken = normalizeKenteken(typeof body.kenteken === "string" ? body.kenteken : "");
  if (!kenteken) return NextResponse.json({ error: "Vul een kenteken in." }, { status: 400 });
  // Shape only. Whether a plate was ever ISSUED is something only the RDW knows, so refusing on
  // that basis would reject real cars — an imported classic, a trailer, a plate too new for any
  // list we hold. What can be checked honestly is whether this looks like a Dutch registration.
  if (!isKentekenShape(kenteken)) {
    return NextResponse.json({ error: "Dit lijkt geen Nederlands kenteken. Controleer de tekens." }, { status: 400 });
  }

  const apkRaw = typeof body.apk_expiry === "string" ? body.apk_expiry.trim() : "";
  if (apkRaw && !/^\d{4}-\d{2}-\d{2}$/.test(apkRaw)) {
    return NextResponse.json({ error: "Controleer de APK-datum." }, { status: 400 });
  }

  const record = {
    user_id: user.id,
    kenteken,
    description: text(body.description),
    customer_name: text(body.customer_name),
    customer_phone: text(body.customer_phone, 40),
    apk_expiry: apkRaw || null,
    notes: text(body.notes, 2000),
    updated_at: new Date().toISOString(),
  };

  // Same plate = same car. A garage typing a car it saw last winter should land on that record and
  // extend its history, not start a second one beside it — which is what an INSERT would do and
  // what the unique constraint would then refuse with a message about a database conflict.
  const { data, error } = await supabase
    .from("vehicles")
    .upsert(record, { onConflict: "user_id,kenteken" })
    .select("id, kenteken, description, customer_name, customer_phone, apk_expiry, notes")
    .single();

  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message ?? "");
    return NextResponse.json(
      { error: missing ? "Voertuigen staan nog niet aan op deze omgeving." : "Kon het voertuig niet opslaan." },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, vehicle: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een voertuig verwijderen");
  if (guard.response) return guard.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Geen voertuig opgegeven." }, { status: 400 });

  const { error } = await supabase.from("vehicles").delete().eq("user_id", user.id).eq("id", id);
  if (error) return NextResponse.json({ error: "Kon het voertuig niet verwijderen." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
