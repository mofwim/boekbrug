// src/app/api/account/delete/route.ts
// [BOEK-032] Account deactivation (GDPR + Bewaarplicht). NO physical DELETE.
//
// Flow: verify session → require export_confirmed (gate) → re-authenticate with
//       email + password on a SEPARATE client (persistSession:false, never
//       stored) → ban the auth user (~100y, effectively permanent) → record
//       deletion_requests (deleted_at + data_eligible_for_deletion_at = now+7y)
//       → audit → sign out this session. Financial rows are NEVER deleted.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { eligibleForDeletionISO } from "@/lib/retention";
import { logAuditAction, getClientIP } from "@/lib/audit";

// Supabase has no "permanent" ban literal; ~100 years is effectively permanent.
const PERMANENT_BAN = "876000h";

export async function POST(req: NextRequest) {
  const supabaseSession = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabaseSession.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "E-mailadres en wachtwoord zijn verplicht" },
      { status: 400 },
    );
  }

  const pipeline = createPipelineClient();

  // GATE: the export must be confirmed first. No row / not confirmed → 409.
  // deletion_requests has no UNIQUE(user_id), so two concurrent exports can insert two
  // rows; .maybeSingle() then ERRORS on >1 row and the user is stuck at a permanent 409
  // "export first" with no exit. Take the most recent row instead of assuming exactly one.
  const { data: drRows } = await pipeline
    .from("deletion_requests")
    .select("id, export_confirmed")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const dr = drRows?.[0];

  if (!dr || dr.export_confirmed !== true) {
    return NextResponse.json(
      { error: "Exporteer eerst je gegevens voordat je je account verwijdert" },
      { status: 409 },
    );
  }

  // RE-AUTH on a SEPARATE client. persistSession:false → never touches cookies
  // or the current session. The password is used once and never stored.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[BOEK-032] missing Supabase public env for re-auth");
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
  // [GEEN-WACHTWOORD] Heeft dit account überhaupt een wachtwoord?
  //
  // Registreren met Google is prominent aanwezig op /register, en zo'n account heeft alleen een
  // google-identiteit — geen wachtwoord, want er is er nooit een gekozen. Hieronder wordt
  // uitsluitend met een wachtwoord opnieuw ingelogd, dus voor die gebruiker eindigde ELKE poging
  // in "Verkeerd e-mailadres of wachtwoord": een melding die hem op zoek stuurt naar iets wat niet
  // bestaat. Hij kon zijn account dus niet zelf opzeggen — terwijl dit product het weggaan
  // uitdrukkelijk ontwerpt (exporteren vóór verwijderen, zeven jaar bewaren, EXIT_PLAN.md).
  //
  // De eis zelf blijft staan: verwijderen is onomkeerbaar en vraagt een verse bewijs van identiteit.
  // Wat verandert is dat we het juiste ANTWOORD geven — zet eerst een wachtwoord, hier is de weg —
  // in plaats van een onwaarheid over wat hij intikte.
  const { data: authUser } = await pipeline.auth.admin.getUserById(user.id);
  const identiteiten = authUser?.user?.identities ?? [];
  const heeftWachtwoord = identiteiten.some((i) => i.provider === "email");
  if (identiteiten.length > 0 && !heeftWachtwoord) {
    return NextResponse.json(
      {
        error:
          "Je hebt een account zonder wachtwoord (ingelogd via Google). Stel eerst een wachtwoord in — daarna kun je je account hier definitief verwijderen.",
        // De code, zodat het scherm de knop kan tonen die de wachtwoordlink verstuurt. De zin
        // hierboven blijft de bron voor wie hem alleen leest.
        code: "geen_wachtwoord",
      },
      { status: 409 },
    );
  }

  const reauth = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } =
    await reauth.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.user || signIn.user.id !== user.id) {
    return NextResponse.json(
      { error: "Verkeerd e-mailadres of wachtwoord" },
      { status: 401 },
    );
  }

  // DEACTIVATE — ban the auth user. NO physical DELETE (Bewaarplicht 7y).
  const now = new Date();
  const { error: banError } = await pipeline.auth.admin.updateUserById(user.id, {
    ban_duration: PERMANENT_BAN,
  });
  if (banError) {
    console.error("[BOEK-032] ban failed:", banError.message);
    return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
  }

  // Record retention: deleted_at + data_eligible_for_deletion_at (now + 7y).
  await pipeline
    .from("deletion_requests")
    .update({
      deleted_at: now.toISOString(),
      data_eligible_for_deletion_at: eligibleForDeletionISO(now),
    })
    .eq("id", dr.id);

  // Audit (non-fatal). Uses an existing AuditAction union code.
  await logAuditAction({
    userId: user.id,
    action: "user.account_deletion_requested",
    entityType: "profile",
    entityId: user.id,
    ipAddress: getClientIP(req),
  });

  // Best-effort: invalidate this session's cookies. The ban already blocks
  // token refresh; any existing access token expires shortly after.
  try {
    await supabaseSession.auth.signOut();
  } catch {
    // non-fatal
  }

  return NextResponse.json({ ok: true });
}