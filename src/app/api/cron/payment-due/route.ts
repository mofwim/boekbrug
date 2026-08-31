// src/app/api/cron/payment-due/route.ts
// [BETAALHERINNERING] De herinnering die de ANDERE kant op wijst.
//
// /api/cron/reminders maant de KLANT van een uitgaande factuur. Voor wat de ondernemer zelf moet
// betalen was er niets: een inkoopfactuur stond netjes op /dashboard/vandaag en zweeg verder, dus
// wie het scherm die dag niet opende hoorde het niet. Dat is precies zoals het misging — een
// factuur van € 1.165,73 met vervaldatum vandaag, en de eigenaar wist het niet.
//
// Wat er gezegd wordt en wanneer, staat in payment-due-notice.ts en is puur. Deze route doet de
// I/O: lezen, versturen, en vastleggen dat het gebeurd is.
//
// ── ÉÉN KEER PER DAG ──
// Dezelfde waarborg als de ochtendmail, en om dezelfde reden: een tweede firing — een handmatige
// curl met het secret, een dubbele fire van het platform, een retry na een time-out die de helft
// al verstuurd had — zou iedereen zijn meldingen nóg een keer sturen. De hartslagtabel weet of
// vandaag al een groene run is begonnen. Best-effort: een onleesbare tabel blokkeert nooit, hij
// faalt naar één extra verzending in plaats van naar stilte.
//
// SECURITY: loopt langs élke eigenaar, dus nooit publiek aanroepbaar. Bearer CRON_SECRET,
// constant-time vergelijking, fail-closed — dezelfde bewaker als de andere crons.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { beginCronRun, finishCronRun, alreadyRanToday } from "@/lib/cron-heartbeat";
import { amsterdamToday, amsterdamMidnightUtc } from "@/lib/format-nl";
import { createNotification } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push";
import { wasAutoIncasso } from "@/lib/auto-incasso";
// [EEN-DEFINITIE] De boeking en de aanmaning stellen dezelfde vraag; die staat één keer.
import { belongsToIncassoSupplier, type IncassoSupplier } from "@/lib/incasso-settle";
import { incassoSupported } from "@/lib/incasso-settle";
import { noticesFor, type PayableInvoice } from "@/lib/payment-due-notice";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The rung furthest from the due date still costs a read; anything beyond it cannot speak. */
const LADDER_DAYS = 3;

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  let cronRunId: string | null = null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[BETAALHERINNERING] CRON_SECRET is not configured — payment reminders are DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const today = amsterdamToday();

  // [EENMAAL] Zie de kop. Zelfde vorm als /api/cron/ochtend.
  if (await alreadyRanToday(pipeline, "payment-due", amsterdamMidnightUtc(today))) {
    return NextResponse.json({ ok: true, alreadyRan: true, sent: 0 });
  }

  cronRunId = await beginCronRun(pipeline, "payment-due", cronStartedAt);

  try {
    // ── Elke openstaande inkoopfactuur waarvan de vervaldatum binnen de ladder valt ──
    //
    // Eén gepagineerde lezing app-breed in plaats van één per eigenaar: het aantal eigenaren
    // groeit en het aantal facturen in een venster van vier dagen niet noemenswaardig.
    //
    // De ondergrens is de dag ZELF: wie te laat is hoort hier niet meer thuis (andere melding,
    // andere handeling). De bovengrens is drie dagen plus twee, omdat de laatste bankdag van een
    // vervaldatum in het weekend twee dagen eerder ligt — zonder die marge zou een factuur die op
    // zondag vervalt nooit zijn "vandaag is de laatste dag" op vrijdag krijgen.
    const grens = new Date(amsterdamMidnightUtc(today).getTime() + (LADDER_DAYS + 2) * 86_400_000);
    const tot = amsterdamToday(grens);

    // ── Welke leveranciers schrijven zelf af ────────────────────────────────
    //
    // [AUTO-INCASSO-BRON] Dit is de bron, en het was bijna de verkeerde. De eerste versie las
    // alleen `wasAutoIncasso(field_confidence)`, en die vlag betekent iets ANDERS dan ze lijkt:
    // hij wordt op de factuur gezet wanneer incasso-settle hem als betaald BOEKT, en dat gebeurt
    // strikt ná de vervaldatum ("not-yet-due" houdt hem tot dan tegen). Deze ladder spreekt vóór
    // en óp de vervaldatum. Op het moment dat wij kijken draagt een incassofactuur die vlag dus
    // nooit — de uitsluiting was in de praktijk dode code, en élke automatisch afgeschreven
    // factuur zou op alle drie de treden zijn opgeëist. Dat is geen ruis: de eigenaar maakt dan
    // een tweede keer over en moet dat bij zijn leverancier terugvragen.
    //
    // De waarheid staat op de LEVERANCIER (suppliers.auto_incasso) — dat is wat de schakelaar op
    // de kaart aanzet. De factuurvlag blijft ernaast staan: een al geboekte incasso hoort evenmin
    // opgeëist te worden, en twee bronnen die beide "laat met rust" zeggen kosten niets.
    const incassoSuppliers = new Set<string>();
    const incassoByOwner = new Map<string, IncassoSupplier[]>();
    if (await incassoSupported(pipeline)) {
      // [NO-SILENT-EMPTY] Een mislukte lezing mag hier NOOIT als "niemand incasseert" doorgaan:
      // dat is precies het antwoord dat iedereen een betaalverzoek stuurt voor geld dat al
      // onderweg is. Een dag zonder herinneringen is oneindig veel goedkoper dan een dag met
      // verkeerde. Vandaar: gooien, en de run eindigt in de catch hieronder als mislukt.
      const sups = await fetchAllRows<{ id: string; user_id: string | null; name: string | null; name_key: string | null }>((from, to) => pipeline
        .from("suppliers")
        .select("id, user_id, name, name_key")
        .eq("auto_incasso", true)
        .order("id", { ascending: true })
        .range(from, to));
      for (const s of sups) {
        incassoSuppliers.add(s.id);
        // [AUTO-INCASSO-BRON] …and the same rows again in the shape the BOOKING module's own
        // decision takes, per owner. See the note at autoDebit below for why the id alone was not
        // enough. Scoped by user_id because this cron reads every owner's suppliers at once, while
        // readIncassoSuppliers (which builds exactly this list for one owner) cannot be reused here.
        if (!s.user_id) continue;
        const list = incassoByOwner.get(s.user_id) ?? [];
        list.push({ id: s.id, name: s.name ?? "", nameKey: s.name_key });
        incassoByOwner.set(s.user_id, list);
      }
    }

    const rows = await fetchAllRows<{
      id: string; receiver_id: string | null; client_name: string | null; invoice_number: string | null;
      due_date: string | null; total_inc_btw: number | null; field_confidence: unknown; supplier_id: string | null;
    }>((from, to) => pipeline
      .from("invoices")
      .select("id, receiver_id, client_name, invoice_number, due_date, total_inc_btw, field_confidence, supplier_id")
      .eq("direction", "incoming")
      // 'received' is de geverifieerde, nog niet betaalde inkoopfactuur — dezelfde stand die
      // /dashboard/vandaag onder "Te betalen" zet. 'processing' staat nog in de controlewachtrij
      // en is dus geen schuld waarvan de eigenaar de vervaldatum moet bewaken.
      .eq("status", "received")
      .not("due_date", "is", null)
      .gte("due_date", today)
      .lte("due_date", tot)
      .order("id", { ascending: true })
      .range(from, to));

    // Per eigenaar bundelen. Een melding per factuur is hoe iemand met veertig facturen leert
    // alle meldingen weg te vegen — en dan is de ene die ertoe deed ook weg.
    const perOwner = new Map<string, PayableInvoice[]>();
    for (const r of rows) {
      const owner = r.receiver_id;
      if (!owner) continue;
      const payable: PayableInvoice = {
        id: r.id,
        supplierName: r.client_name,
        invoiceNumber: r.invoice_number,
        dueDate: r.due_date,
        amountIncBtw: r.total_inc_btw,
        // [AUTO-INCASSO-BRON] De schakelaar op de LEVERANCIER is de waarheid — zie de toelichting
        // bij incassoSuppliers hierboven. De factuurvlag staat ernaast en dekt de factuur die al
        // als geïncasseerd is geboekt.
        //
        // [EEN-DEFINITIE] En het is nu LETTERLIJK dezelfde vraag als die de boeking stelt, want dit
        // was hem twee keer gespeld. Deze regel las alleen supplier_id; belongsToIncassoSupplier —
        // wat incasso-settle gebruikt om te bepalen of hij de factuur automatisch als betaald boekt
        // — valt terug op de naamsleutel wanneer supplier_id leeg is of naar een niet-gemarkeerde
        // rij wijst. Dat is geen detail: de kop van díe functie legt uit dat de naamsleutel juist de
        // rijen bereikt die vóór het leveranciersregister zijn geïmporteerd, "op een scherm vol
        // jarenoude huurfacturen de meeste".
        //
        // Een factuur in dat gat werd dus wél automatisch afgeschreven én aangemaand alsof niemand
        // incasseert. Wat dat kost staat al in de toelichting hierboven, in eigen woorden: "de
        // eigenaar maakt dan een tweede keer over en moet dat bij zijn leverancier terugvragen."
        // Gemeten op de productiedatabase op het moment van deze wijziging: twee facturen stonden
        // in dat gat.
        autoDebit:
          !!belongsToIncassoSupplier(r, incassoByOwner.get(owner) ?? []) || wasAutoIncasso(r.field_confidence),
      };
      perOwner.set(owner, [...(perOwner.get(owner) ?? []), payable]);
    }

    let sent = 0;
    let pushed = 0;
    for (const [ownerId, invoices] of perOwner) {
      for (const notice of noticesFor(invoices, today)) {
        // De melding eerst: die blijft staan in het klokje, ook als het toestel uit was. De push
        // is de tik erbovenop en mag nooit de voorwaarde zijn — een eigenaar zonder push-abonnement
        // hoort het anders helemaal niet.
        const result = await createNotification({
          userId: ownerId,
          title: notice.title,
          body: notice.body,
          type: "payment",
          link: notice.link,
        });
        if (!result.ok) {
          console.error("[BETAALHERINNERING] melding niet opgeslagen", { ownerId, tier: notice.tier });
          continue;
        }
        sent++;
        if (notice.push) {
          // Best-effort: een dood abonnement of een uitgeschakelde VAPID-sleutel mag de melding
          // die al staat nooit ongedaan maken.
          pushed += await sendPushToUser(ownerId, {
            title: notice.title, body: notice.body, link: notice.link, type: "payment",
          });
        }
      }
    }

    await finishCronRun(pipeline, cronRunId, { ok: true, result: { sent, pushed, owners: perOwner.size } });
    return NextResponse.json({ ok: true, owners: perOwner.size, sent, pushed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[BETAALHERINNERING] run failed", { error: message });
    await finishCronRun(pipeline, cronRunId, { ok: false, error: message });
    return NextResponse.json({ error: "run_failed", detail: message }, { status: 500 });
  }
}
