// scripts/find-existing-duplicates.mts
// [DUBBEL-TERUGKIJKEN] De dubbele boekingen die er al staan.
//
//   ISO_EMAIL=... ISO_PASSWORD=… npx tsx scripts/find-existing-duplicates.mts
//
// ── WAAROM DIT BESTAAT ──
//
// assessPossibleDuplicate draait bij BINNENKOMST, één keer per document, tegen wat er op dat
// moment al ligt. Dat is de juiste plek en het werkt: sinds 18 augustus heeft het negen facturen
// gevlagd. Maar het kijkt alleen vooruit, en daar zit het gat.
//
// Alles wat vóór die datum binnenkwam is nooit onderzocht. Een administratie die met een
// bulkimport begon, of die simpelweg ouder is dan de controle, draagt de dubbelen die er toen al
// in zaten voor altijd mee — zonder vlag, zonder scherm dat erop wijst, zonder iets dat er ooit
// nog naar kijkt.
//
// Op de productieadministratie leverde dat zes gevallen op, alle zes van vóór 18 augustus:
//
//   Doyum Food     26700385      € 222,05 én € 239,47   — beide betaald
//   Enka Horeca    26701681      € 1.335,68 / € 1.336,14 / € 1.348,14 — twee betaald
//   Ipekci         202603719     € 1.201,07 twee keer
//   Vegimex        202616271     € 732,04 twee keer
//   Altena         26700603      −€ 136 twee keer (e-mail én foto van hetzelfde stuk)
//   WonenBreburg   VHF0001005310 € 73 twee keer (e-mail én foto)
//
// Elk daarvan is dezelfde inkoop twee keer als kostenpost, en dus dezelfde BTW twee keer
// afgetrokken. Dat is geld, en het staat er nu.
//
// ── WAT DIT NIET DOET ──
//
// Niets wijzigen. Geen vlag zetten, geen factuur archiveren, geen status aanraken. Welke van twee
// bijna gelijke facturen de echte is, is een vraag die alleen de ondernemer kan beantwoorden — bij
// Enka staan drie bedragen die 46 cent en 12 euro uit elkaar liggen, en de goede daarvan staat op
// het papier, niet in de database. Dit leest, telt en drukt af.
//
// ── EN WAAROM HET DE BESTAANDE RECHTER GEBRUIKT ──
//
// assessPossibleDuplicate, ongewijzigd, met dezelfde kandidatenvorm. Een tweede set regels
// schrijven zou betekenen dat de terugblik en de intake het over verschillende dingen hebben — en
// dan is een verschil tussen de twee geen bevinding meer maar ruis.

import { createClient } from "@supabase/supabase-js";
import { vindBestaandeDubbelen } from "../src/lib/existing-duplicates";
import { type PossibleDupCandidate } from "../src/lib/safecore";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.ISO_EMAIL;
const PASSWORD = process.env.ISO_PASSWORD;

if (!URL_ || !ANON || !EMAIL || !PASSWORD) {
  console.error("[DUBBEL] Zet NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ISO_EMAIL en ISO_PASSWORD.");
  process.exit(2);
}

const supabase = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: sessie, error: loginFout } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (loginFout || !sessie.user) {
  console.error(`[DUBBEL] Inloggen mislukte: ${loginFout?.message ?? "geen gebruiker"}`);
  process.exit(2);
}

// Alleen wat werkelijk in de boeken staat. Een concept of een gearchiveerd stuk kost niets, en
// meetellen zou de lijst vullen met gevallen die de ondernemer al heeft afgehandeld.
const GEBOEKT = ["received", "paid"];
const { data: rijen, error } = await supabase
  .from("invoices")
  .select("id, invoice_number, client_name, invoice_date, total_inc_btw, status, created_at")
  .eq("direction", "incoming")
  .in("status", GEBOEKT)
  .order("created_at", { ascending: true });

if (error) {
  console.error(`[DUBBEL] Lezen mislukte: ${error.message}`);
  process.exit(2);
}

const alle = (rijen ?? []) as Array<PossibleDupCandidate & { status: string; created_at: string }>;
console.log(`[DUBBEL] ${alle.length} geboekte inkoopfacturen doorgenomen.\n`);

// Elke factuur beoordeeld tegen alles wat ER AL LAG toen hij binnenkwam — dezelfde twee poorten
// die de intake gebruikt, in dezelfde volgorde. Zie existing-duplicates.ts voor waarom de harde
// poort hier apart moet: achteraf is juist het exacte geval het meest voorkomende.
const perId = new Map(alle.map((r) => [r.id, r]));
const gevonden = vindBestaandeDubbelen(alle).map((d) => {
  const f = perId.get(d.id)!;
  const bedrag = f.total_inc_btw != null ? `€ ${f.total_inc_btw.toFixed(2)}` : "onbekend bedrag";
  return (
    `  [${d.zekerheid}] ${f.client_name ?? "onbekende leverancier"} · factuur ${f.invoice_number ?? "zonder nummer"} · ${bedrag} (${f.status})\n` +
    `      lijkt op factuur ${d.lijktOp} — ${d.reden}`
  );
});

if (gevonden.length === 0) {
  console.log("Geen dubbele boekingen gevonden in wat er al staat.");
} else {
  console.log(`${gevonden.length} mogelijke dubbele boeking(en):\n`);
  console.log(gevonden.join("\n\n"));
  console.log(
    "\nElk hiervan is mogelijk dezelfde inkoop twee keer geboekt, en dus dezelfde BTW twee keer\n" +
    "afgetrokken. Er is niets gewijzigd — welke de echte is, staat op het papier.",
  );
}
await supabase.auth.signOut();
