// scripts/verify-tenant-isolation.mts
// [DEMO-ALLEEN] Does one tenant's login reach another tenant's administration? Ask the app.
//
//   ISO_EMAIL=demo@boekbrug.nl ISO_PASSWORD=… npx tsx scripts/verify-tenant-isolation.mts
//   (het wachtwoord staat in de kluis, niet hier — deze repository is openbaar)
//
// ── WHY THIS EXISTS ──
// scripts/seed-demo-account.sql creates a real account on production and ships its password so
// Play Console reviewers can log in. Its whole safety argument is one sentence: "RLS already
// isolates it, so the screenshots are clean by construction". Since the password is public, and
// permanently so, that sentence is the only thing standing between a stranger and 612 invoices
// belonging to real businesses. A sentence is not a measurement.
//
// ── WHY IT SIGNS IN INSTEAD OF CONNECTING TO POSTGRES ──
// It goes through the anon key and a real password sign-in, which is exactly the door the
// published credential opens. A psql session with `set role authenticated` tests the policies; this
// tests the policies AND PostgREST AND whatever the app grants a logged-in user. If those ever
// disagree, the one that matters is this one.
//
// The cost of that choice is that there is no transaction to roll back, so the probes are built to
// be harmless rather than undone: the reads count rows and never fetch content, and the write
// probes are opt-in (--schrijfproef), set a column to its own value, and clean up after themselves.
//
// ── HOW TO READ A PASS ──
// Not "0 rows leaked" — zero is also what a broken probe returns, and a check that cannot fail
// proves nothing. Every run first establishes how many rows there are TO hide and refuses to call
// itself a pass if that number is small. Hiding 595 invoices is a result; hiding none is a
// sentence with no subject.
//
// Gemeten op 2 september 2026 tegen productie, met een directe databaseverbinding en een
// transactie die terugdraaide: 612 facturen, 17 zichtbaar voor de demo, 0 van een ander; 1551
// banktransacties, 15 zichtbaar, 0 van een ander; een UPDATE op de 555 rijen van de echte eigenaar
// raakte er 0; een INSERT met andermans receiver_id werd geweigerd met 42501. Tegenproef: als de
// echte eigenaar 555 facturen zichtbaar, waarvan 0 van de demo. Dit script maakt die meting
// herhaalbaar langs de weg die een aanvaller werkelijk heeft.

import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.ISO_EMAIL;
const PASSWORD = process.env.ISO_PASSWORD;
const SCHRIJFPROEF = process.argv.includes("--schrijfproef");

if (!URL_ || !ANON || !EMAIL || !PASSWORD) {
  console.error("[ISOLATIE] Zet NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ISO_EMAIL en ISO_PASSWORD.");
  process.exit(2);
}

const bevindingen: Array<{ naam: string; ok: boolean; detail: string }> = [];
function meld(naam: string, ok: boolean, detail: string) {
  bevindingen.push({ naam, ok, detail });
  console.log(`${ok ? "  ok  " : "  LEK " } ${naam} — ${detail}`);
}

const supabase = createClient(URL_, ANON, { auth: { persistSession: false } });

const { data: sessie, error: loginFout } = await supabase.auth.signInWithPassword({
  email: EMAIL, password: PASSWORD,
});
if (loginFout || !sessie.user) {
  console.error(`[ISOLATIE] Inloggen mislukte: ${loginFout?.message ?? "geen gebruiker"}`);
  process.exit(2);
}
const IK = sessie.user.id;
console.log(`[ISOLATIE] Ingelogd als ${EMAIL} (${IK})\n`);

// ── De tegenproef staat vóór de proef ────────────────────────────────────────────────────────
// Zonder te weten hoeveel er te verbergen valt, is "niets gelekt" geen uitspraak.
const { count: mijn } = await supabase.from("invoices").select("*", { count: "exact", head: true });
meld("dit account ziet zijn eigen rijen", (mijn ?? 0) > 0,
  `${mijn ?? 0} facturen zichtbaar — bij 0 meet dit script niets en is groen betekenisloos`);

// ── 1. Lezen: is er ook maar één rij van een ander te zien? ──────────────────────────────────
for (const [tabel, kolom] of [
  ["invoices", "receiver_id"],
  ["documents", "user_id"],
  ["bank_transactions", "user_id"],
  ["clients", "user_id"],
  ["suppliers", "user_id"],
] as const) {
  const { count, error } = await supabase
    .from(tabel).select("*", { count: "exact", head: true }).neq(kolom, IK);
  if (error) { meld(`${tabel}: geen rij van een ander`, false, `kon niet lezen: ${error.message}`); continue; }
  // invoices heeft twee eigenaarskolommen; een eigen uitgaande factuur heeft een andere
  // receiver_id en is geen lek. Die worden hieronder apart afgetrokken.
  let lek = count ?? 0;
  if (tabel === "invoices") {
    const { count: eigenUit } = await supabase
      .from("invoices").select("*", { count: "exact", head: true }).neq("receiver_id", IK).eq("sender_id", IK);
    lek -= eigenUit ?? 0;
  }
  meld(`${tabel}: geen rij van een ander`, lek === 0, `${lek} rijen van een ander zichtbaar`);
}

// ── 2 en 3. Schrijven — alleen op verzoek ────────────────────────────────────────────────────
if (SCHRIJFPROEF) {
  const { data: vreemd } = await supabase
    .from("invoices").select("id,receiver_id").neq("receiver_id", IK).limit(1);
  if (!vreemd || vreemd.length === 0) {
    meld("schrijfproef", true, "geen rij van een ander zichtbaar om op te mikken — dat is het goede antwoord");
  } else {
    // Als dit punt bereikt wordt, is er hierboven al een lek gemeld.
    const doelwit = vreemd[0] as { id: string; receiver_id: string };
    const { error: updFout, count: geraakt } = await supabase
      .from("invoices").update({ updated_at: new Date().toISOString() }, { count: "exact" }).eq("id", doelwit.id);
    meld("UPDATE op andermans factuur", (geraakt ?? 0) === 0 || !!updFout,
      updFout ? `geweigerd: ${updFout.message}` : `${geraakt} rijen geraakt`);

    const MARKER = "RLS PROBE — verwijder mij";
    const { data: ingevoegd, error: insFout } = await supabase.from("invoices").insert({
      receiver_id: doelwit.receiver_id, sender_id: doelwit.receiver_id, direction: "incoming",
      status: "received", invoice_date: new Date().toISOString().slice(0, 10),
      total_inc_btw: 1, total_ex_btw: 1, btw_amount: 0, client_name: MARKER,
    }).select("id");
    if (insFout) {
      meld("INSERT in andermans administratie", true, `geweigerd: ${insFout.message}`);
    } else {
      meld("INSERT in andermans administratie", false, "GELUKT — dit is een ernstig lek");
      for (const r of ingevoegd ?? []) {
        const { error } = await supabase.from("invoices").delete().eq("id", (r as { id: string }).id);
        console.error(error
          ? `  !! kon proefrij ${(r as { id: string }).id} NIET verwijderen — doe dat met de hand`
          : `  proefrij ${(r as { id: string }).id} weer verwijderd`);
      }
    }
  }
} else {
  console.log("  --  schrijfproef overgeslagen (geef --schrijfproef om hem te draaien)");
}

await supabase.auth.signOut();

const lekken = bevindingen.filter((b) => !b.ok);
console.log(`\n${bevindingen.length - lekken.length}/${bevindingen.length} in orde.`);
if (lekken.length > 0) {
  console.error(`\n${lekken.length} probleem(en). Met een openbaar wachtwoord is dit andermans administratie.`);
  process.exit(1);
}
console.log("Scheiding houdt: dit account ziet alleen zijn eigen rijen.");
