// src/app/dashboard/beheer/page.tsx
// [BEHEER] The operator's one page: every account, every accountant↔client link, in one view.
//
// Read-only by design in v1. The parties themselves already hold the write actions (linking,
// unlinking, roles) behind their own guards; duplicating those here would create a second door
// with weaker context. What the operator lacked was SIGHT — who registered, who is linked to
// whom, who pays — and sight is what this ships.
//
// Access: isBeheerder (BEHEER_EMAILS env). Everyone else gets notFound() — indistinguishable
// from a route that was never built, so the page leaks nothing about its own existence.
//
// Reads use the service-role pipeline AFTER the gate: the operator sees across accounts, which
// is exactly what RLS correctly forbids a normal session.

import { notFound } from "next/navigation";

import { getSessionUser } from "@/lib/session-user";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { isBeheerder, buildBeheerOverview } from "@/lib/beheer";
// [BEHEER-GEZOND] Draaien de achtergrondtaken nog? Dat oordeel bestond al (judgeCron) en had één
// lezer: een endpoint dat je moet curlen. Hier kijkt een mens ernaar.
import { readSystemHealth, readEventSummary } from "@/lib/beheer-health";
// [LEESKWALITEIT] Hoe vaak moest een mens de lezer verbeteren, en bij welke leverancier.
import { readReaderQuality } from "@/lib/reader-quality";
// [WAAROM-VASTGEHOUDEN] En waarom de rest niet vanzelf ging — de werklijst op tijd geordend.
import { readHoldReasons } from "@/lib/hold-reasons";
import { decidePlan } from "@/lib/subscription";
import { BeheerScherm } from "./BeheerScherm";

export const dynamic = "force-dynamic";

export default async function BeheerPage() {
  // [WATERVAL] Dezelfde gecachte sessie-lezing als elke andere serverpagina — geen tweede
  // auth-rondgang achter de layout om.
  const user = await getSessionUser();
  if (!user || !isBeheerder(user.email)) notFound();

  const pipeline = createPipelineClient();

  // [BEHEER-GEZOND] Eén lezer voor de hartslag, gedeeld met de cron die het alarm mailt — twee
  // lezers van dezelfde tabel drijven uit elkaar, en dan staat deze pagina groen terwijl de mail
  // iets anders rekende. De klok wordt daar gelezen, niet hier: in een servercomponent is dat een
  // onzuivere aanroep tijdens de render.
  const systeem = await readSystemHealth(pipeline);
  // [STORINGSBEELD] Wat er de laatste week misging. Zelfde vorm: één lezer, klok daarbinnen.
  const storingen = await readEventSummary(pipeline);

  // [PAGINATION] Both reads paged: the day this app has more than ~1000 accounts is exactly the
  // day the operator page matters most, and a silently truncated user list on an operator screen
  // reads as "these are all of them".
  const profiles = await fetchAllRows<{
    id: string; company_name: string | null; full_name: string | null; email: string | null;
    role: string | null; created_at: string | null; subscription_status: string | null;
    current_period_end: string | null;
  }>((lo, hi) =>
    // De abonnementskolommen komen uit billing_subscription.sql (met de hand toegepast) en staan
    // niet in de gegenereerde typen — zelfde ontspannen client als planForUser, om dezelfde reden.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipeline as any)
      .from("profiles")
      .select("id, company_name, full_name, email, role, created_at, subscription_status, current_period_end")
      .order("id", { ascending: true })
      .range(lo, hi),
  ).catch(() => null);

  // [DEPLOY-SAFE] The subscription columns arrive with a hand-applied migration; without them the
  // richer select fails. Fall back to the base projection — the page then shows every account
  // with plan 'free', which is also the truth of a deployment without billing.
  const rows =
    profiles ??
    (await fetchAllRows<{
      id: string; company_name: string | null; full_name: string | null; email: string | null;
      role: string | null; created_at: string | null;
    }>((lo, hi) =>
      pipeline
        .from("profiles")
        .select("id, company_name, full_name, email, role, created_at")
        .order("id", { ascending: true })
        .range(lo, hi),
    ).catch(() => []));

  const linkRows = await fetchAllRows<{ accountant_id: string | null; zzper_id: string | null; created_at: string | null }>(
    (lo, hi) =>
      pipeline
        .from("accountant_clients")
        .select("accountant_id, zzper_id, created_at")
        .order("id", { ascending: true })
        .range(lo, hi),
  ).catch(() => []);
  const links: Array<{ accountant_id: string; zzper_id: string; created_at: string | null }> =
    linkRows.flatMap((l) =>
      l.accountant_id && l.zzper_id
        ? [{ accountant_id: l.accountant_id, zzper_id: l.zzper_id, created_at: l.created_at }]
        : [],
    );

  // Eén klokstand voor de hele lijst — en buiten de render-expressie, want een servercomponent
  // is ook een component en de lint-regel over onzuivere functies geldt er onverkort.
  const nowMs = new Date().getTime();

  // [LEESKWALITEIT] Over 90 dagen, en over ELK account — dit is de enige plek waar de lezer over
  // administraties heen te beoordelen is. Faalt de lezing, dan komt er null uit en zegt het paneel
  // dat het niet kon kijken, in plaats van een geruststellende nul.
  const leeskwaliteit = await readReaderQuality(pipeline, { nowMs, windowDays: 90, recentLimit: 12 });
  // [WAAROM-VASTGEHOUDEN] Zelfde venster, zelfde regel: null betekent "niet kunnen kijken", en
  // het paneel zegt dat dan hardop in plaats van een lege wachtrij te tonen.
  const vastgehouden = await readHoldReasons(pipeline, { nowMs, windowDays: 90 });
  const overview = buildBeheerOverview(
    rows,
    links,
    (p) => decidePlan({ role: p.role, subscriptionStatus: p.subscriptionStatus, currentPeriodEnd: p.currentPeriodEnd, nowMs }).plan,
  );

  return <BeheerScherm overview={overview} systeem={systeem} storingen={storingen} leeskwaliteit={leeskwaliteit} vastgehouden={vastgehouden} />;
}
