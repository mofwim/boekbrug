// src/app/api/email/sender-rules/route.ts
// [AFZENDERREGEL] De regels "altijd negeren van deze afzender": lezen, aanmaken, opheffen.
//
// GET    → alle regels van deze gebruiker, nieuwste eerst (het Genegeerd-tabblad toont ze)
// POST   → { from } of { sender_email } → regel aanmaken (idempotent)
// DELETE → ?email=… → regel opheffen
//
// Alles in gebruikerscontext: RLS op email_sender_rules staat alleen eigen rijen toe, en er is
// geen enkele reden om daar met een service-role omheen te gaan.
//
// Dit is het enige mechanisme in de app dat facturen ONGEZIEN wegneemt, dus opheffen moet net zo
// makkelijk zijn als aanmaken — vandaar dat GET en DELETE hier even hard meetellen als POST.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeSenderEmail } from "@/lib/sender-rules";
import { logAuditAction, getClientIP } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data, error } = await supabase
    .from("email_sender_rules")
    .select("id, sender_email, created_at")
    .eq("user_id", user.id)
    .eq("action", "ignore")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    // Twee heel verschillende situaties, en ze mogen NIET hetzelfde antwoord krijgen.
    //
    // (a) De tabel bestaat niet — een omgeving waar email_sender_rules.sql nog niet gedraaid is.
    //     Dan zijn er ook echt geen regels, want er kunnen er geen bestaan. "Geen regels" is dan
    //     het eerlijke antwoord, en een foutscherm op een verder werkend tabblad zou onzin zijn.
    //
    // (b) Iets anders ging mis (RLS, verbinding, time-out). Er zijn dan mogelijk WÉL regels, die
    //     op dit moment post tegenhouden — en als dit scherm dan "geen regels" toont, kan de
    //     eigenaar ze niet opheffen terwijl ze wel werken. Dat is precies het scenario waar dit
    //     hele beheerscherm tegen bedoeld is. Dus: eerlijk falen, zodat de client het zegt.
    const missingTable = error.code === "42P01" || error.code === "PGRST205";
    if (missingTable) return NextResponse.json({ rules: [] });
    console.error("[AFZENDERREGEL] regels ophalen mislukt", error);
    return NextResponse.json(
      { error: "De afzenderregels konden niet worden geladen — ververs de pagina. Let op: regels die je eerder instelde werken gewoon door." },
      { status: 500 }
    );
  }
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  let body: { from?: unknown; sender_email?: unknown; invoice_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }

  // Accepteert een hele From-kop of een kaal adres — normaliseren doet dezelfde functie die de
  // import gebruikt om te vergelijken, dus opslaan en matchen kunnen niet uit elkaar lopen.
  const email =
    normalizeSenderEmail(typeof body.sender_email === "string" ? body.sender_email : null) ??
    normalizeSenderEmail(typeof body.from === "string" ? body.from : null);

  if (!email) {
    return NextResponse.json(
      { error: "Van deze afzender is geen e-mailadres bekend — daar kan geen regel op." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("email_sender_rules")
    .upsert(
      {
        user_id: user.id,
        sender_email: email,
        action: "ignore",
        created_from_invoice_id: typeof body.invoice_id === "string" ? body.invoice_id : null,
      },
      { onConflict: "user_id,sender_email", ignoreDuplicates: true }
    );

  if (error) {
    console.error("[AFZENDERREGEL] regel aanmaken mislukt", error);
    return NextResponse.json(
      { error: "De regel kon niet worden opgeslagen — probeer het opnieuw." },
      { status: 500 }
    );
  }

  // Een regel die post binnenhoudt is een besluit met gevolgen; die hoort in het spoor.
  await logAuditAction({
    userId: user.id,
    action: "email.sender_rule_created",
    entityType: "email_sender_rule",
    entityId: email,
    newValue: { sender_email: email, action: "ignore" },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, sender_email: email });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const email = normalizeSenderEmail(new URL(req.url).searchParams.get("email"));
  if (!email) return NextResponse.json({ error: "Geen geldig adres opgegeven" }, { status: 400 });

  const { error } = await supabase
    .from("email_sender_rules")
    .delete()
    .eq("user_id", user.id)
    .eq("sender_email", email);

  if (error) {
    return NextResponse.json({ error: "De regel kon niet worden opgeheven." }, { status: 500 });
  }

  await logAuditAction({
    userId: user.id,
    action: "email.sender_rule_deleted",
    entityType: "email_sender_rule",
    entityId: email,
    oldValue: { sender_email: email, action: "ignore" },
    ipAddress: getClientIP(req),
  });

  // Vanaf de volgende sync komt post van dit adres weer gewoon binnen. Bewust GEEN terugwerkende
  // kracht: wat overgeslagen is staat in de skip-registry en de mail staat nog in de mailbox —
  // met terugwerkende kracht importeren zou een wachtrij vol oude reclame opleveren.
  return NextResponse.json({ ok: true });
}
