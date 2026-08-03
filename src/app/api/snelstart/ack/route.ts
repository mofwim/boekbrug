// app/api/snelstart/ack/route.ts
// [PUSH-ACK] "Ik weet het, stuur toch door" — augustus 2026
//
// POST /api/snelstart/ack  { invoiceId }
//
// De sleutel op het slot dat isPushable legt. Een factuur met een openstaand voorbehoud —
// mogelijk dubbel, een betalingsherinnering, meerdere facturen in één bestand, een gewijzigd
// rekeningnummer — gaat niet vanzelf de administratie van de boekhouder in. Maar zij mag er wél
// in: de eigenaar kan naar het papier hebben gekeken en weten dat die "mogelijke dubbele" een
// tweede echte levering is. Zonder deze route zou dat slot data laten verdwijnen, en dat is geen
// voorzichtigheid.
//
// ── WAAROM DIT EEN ROUTE IS EN GEEN VINKJE IN DE UI ──
// De poort staat op de server (snelstart-mapping.ts). Een akkoord dat alleen in de browser leeft,
// bestaat voor die poort niet — en een akkoord dat de poort niet ziet, is geen akkoord maar een
// knop die niets doet. Bovendien is dit een besluit over een BOEKING in een wettelijke
// administratie: het hoort in het audit-spoor, met wie, wanneer, en waarvoor precies.
//
// ── WAAROM HET DE VLAGGEN OPSOMT DIE ER NÚ ZIJN ──
// Het akkoord geldt voor de voorbehouden van dit moment. Zou het de factuur in het algemeen
// vrijgeven, dan ontwapende één tik ook elke LATERE waarschuwing — bijvoorbeeld een gewijzigd
// rekeningnummer dat pas bij een volgende import wordt ontdekt, de handtekening van factuurfraude.
// "Ik heb hiernaar gekeken" en "kijk hier nooit meer naar" zijn verschillende dingen, en alleen het
// eerste is wat iemand bedoelt als hij op die knop drukt.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { pushHoldFlagsOf, pushHoldReason, SNELSTART_ACK_SELECT } from "@/lib/snelstart-mapping";
import type { SnelStartInvoice } from "@/lib/snelstart-mapping";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Doorsturen naar de boekhouder is een eigenaarshandeling, net als de push zelf.
  { const w = await requireOwner('Een factuur met een voorbehoud toch naar SnelStart doorsturen'); if (w.response) return w.response }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  if (!invoiceId) return NextResponse.json({ error: "Geen factuur opgegeven" }, { status: 400 });

  // [NO-SILENT-EMPTY] Een mislukte lees is geen "factuur niet gevonden". Zonder deze controle zou
  // een storing de eigenaar vertellen dat zijn factuur niet bestaat, op het scherm waar hij hem
  // ziet staan — en hij zou blijven tikken op een knop die niet kán werken.
  const { data: invoice, error: readErr } = await supabase
    .from("invoices")
    .select(SNELSTART_ACK_SELECT)
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();

  if (readErr) {
    console.error("[PUSH-ACK] read failed — refusing to write", { invoiceId, userId: user.id, error: readErr.message });
    return NextResponse.json(
      { error: "We konden deze factuur nu niet ophalen. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  if (!invoice) return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });

  const row = invoice as unknown as SnelStartInvoice;
  const open = pushHoldFlagsOf(row);
  if (open.length === 0) {
    // Niets tegen te houden. Geen fout — de eigenaar heeft geklikt op iets dat inmiddels al klopt
    // (een tweede tabblad, of een correctie die het voorbehoud wegnam). Zeg dat, schrijf niets.
    return NextResponse.json({ ok: true, acknowledged: [], message: "Deze factuur had geen openstaand voorbehoud meer." });
  }

  // Bestaand akkoord aanvullen, nooit vervangen: een eerder afgetikte vlag blijft afgetikt, ook
  // wanneer er later een nieuwe bijkomt.
  const fc = (row.field_confidence && typeof row.field_confidence === "object" && !Array.isArray(row.field_confidence)
    ? { ...(row.field_confidence as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const prior = fc._push_ack as { flags?: unknown } | undefined;
  const priorFlags = Array.isArray(prior?.flags) ? (prior!.flags as unknown[]).filter((f): f is string => typeof f === "string") : [];
  const merged = [...new Set([...priorFlags, ...open])];
  fc._push_ack = { at: new Date().toISOString(), by: user.id, flags: merged };

  const { data: written, error: writeErr } = await supabase
    .from("invoices")
    .update({ field_confidence: fc as never, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .select("id");

  if (writeErr) {
    // De B.4-trigger bevriest een factuur die de boekhouder al verwerkt heeft. Dan is doorsturen
    // sowieso niet meer aan de orde, en dat is een ander gesprek dan "opslaan mislukt".
    if (/verwerkt/i.test(writeErr.message)) {
      return NextResponse.json(
        { error: "Je boekhouder heeft deze factuur al verwerkt — doorsturen kan niet meer.", code: "verwerkt" },
        { status: 409 },
      );
    }
    console.error("[PUSH-ACK] write failed", { invoiceId, userId: user.id, error: writeErr.message });
    return NextResponse.json({ error: "Opslaan mislukt — er is niets gewijzigd." }, { status: 500 });
  }
  // .select() zodat nul rijen te onderscheiden is van succes: zonder dat zou een WHERE die niets
  // raakte als "akkoord opgeslagen" terugkomen en zou de knop niets doen terwijl hij dat wel claimt.
  if (!written || written.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur is intussen veranderd — ververs de pagina en probeer het opnieuw.", code: "stale" },
      { status: 409 },
    );
  }

  // Het spoor draagt WAT er is afgetikt, niet alleen DAT er iets is afgetikt. Een jaar later is de
  // vraag van de boekhouder "waarom staat deze dubbele erin?", en het antwoord hoort te zijn
  // "omdat de eigenaar op 3 augustus zei dat het een tweede echte levering was".
  await logAuditAction({
    userId: user.id,
    action: "snelstart.hold_acknowledged",
    entityType: "invoice",
    entityId: invoiceId,
    newValue: {
      acknowledged: open,
      reasons: open.map((f) => pushHoldReason(f)),
      all_acknowledged: merged,
      via: "snelstart_card",
    },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, acknowledged: open });
}
