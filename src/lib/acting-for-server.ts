// src/lib/acting-for-server.ts
// [NAMENS] De serverkant: wie zit er in deze sessie, en namens wie handelt hij?
//
// De pure regels staan in acting-for.ts en zijn daar getest. Hier staat alleen het opzoeken —
// één query, en de uitkomst gaat door dezelfde resolveActingFor() die de test bewaakt. Zo is er
// geen tweede plek waar iemand per ongeluk een eigen oordeel velt over wie waarbij mag.
//
// De Next-documentatie noemt dit een Data Access Layer, en waarschuwt expliciet dat een controle
// in de proxy/middleware OPTIMISTISCH is: goed genoeg om een menu te verbergen, nooit genoeg om
// een grens te trekken. Elke serverroute en elke servercomponent die iets met geld doet, hoort
// deze functie zelf aan te roepen — niet te vertrouwen op wat er eerder in de keten gebeurde.

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveActingFor, type ActingFor, type MemberLink } from "@/lib/acting-for";

/**
 * Wie handelt hier, namens wie? Geeft `null` als er niemand is ingelogd.
 *
 * `cache()` memoïseert binnen één render/verzoek: een pagina die dit drie keer aanroept doet één
 * query. Het is nadrukkelijk GEEN cache tussen verzoeken — een ingetrokken medewerker moet bij
 * zijn volgende klik buiten staan, niet na een minuut.
 */
export const getActingFor = cache(async (): Promise<ActingFor | null> => {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let link: MemberLink | null = null;
  try {
    // [DEPLOY-SAFE] company_members bestaat pas na de migratie, en staat dus nog niet in de
    // gegenereerde types. Zelfde ontsnapping als elders in deze codebase (cron_runs).
    //
    // Gelezen met service_role, met een expliciete .eq() op de sessiegebruiker. Dat is hier
    // veiliger dan het lijkt: resolveActingFor() gooit de rij alsnog weg als member_id niet
    // klopt, dus zelfs een fout in deze query kan niemand in andermans boekhouding zetten.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = createPipelineClient() as any;
    const { data, error } = await pipeline
      .from("company_members")
      .select("owner_id, member_id, role, revoked_at")
      .eq("member_id", user.id)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    // 42P01 = de migratie is nog niet toegepast. Dan bestaat de rol simpelweg niet en is
    // iedereen eigenaar van zichzelf — precies de toestand van vóór deze functie.
    if (error && error.code !== "42P01") {
      console.error("[NAMENS] koppeling lezen mislukt", { error });
    }
    link = (data as MemberLink | null) ?? null;
  } catch (e) {
    // Faalt de lookup, dan is de gebruiker eigenaar van zichzelf. Dat is de veilige kant: hij
    // ziet zijn eigen (lege) boekhouding in plaats van die van een ander.
    console.error("[NAMENS] koppeling lezen mislukt", { error: String(e) });
    link = null;
  }

  return resolveActingFor(user.id, link, Date.now());
});

/**
 * Wie heeft er, van dit bedrijf, iets aangemaakt — en hoe heet die persoon?
 *
 * WAAROM DIT BESTAAT
 * created_by werd geschreven en door NIEMAND gelezen. Een spoor dat niemand kan lezen is geen
 * spoor: de eigenaar geeft het recht weg om facturen uit te geven op zijn naam en BTW-nummer, en
 * kon vervolgens nergens zien wie welke had gemaakt.
 *
 * WAAROM HET ZO SMAL IS
 * Er wordt hier NOOIT een willekeurige uuid naar een naam vertaald. Alleen mensen die lid zijn
 * (of waren) van DIT bedrijf komen erin — de koppeling is het bewijs dat de eigenaar hun naam
 * mag zien. Ingetrokken leden horen er ook bij: hun facturen bestaan nog, en een factuur van
 * "Onbekend" is precies de vraag die dit moest beantwoorden.
 *
 * Lege map = geen team, of de migratie staat nog open. Beide betekenen: niets te tonen.
 */
export async function loadTeamNames(ownerId: string): Promise<Record<string, string>> {
  const { beschikbaar, leden } = await loadCompanyMembers(ownerId);
  if (!beschikbaar || leden.length === 0) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = createPipelineClient() as any;
    const { data } = await pipeline
      .from("profiles")
      .select("id, full_name, company_name")
      .in("id", leden.map((l) => l.member_id));
    const uit: Record<string, string> = {};
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>) {
      uit[p.id] = p.full_name || p.company_name || "Teamlid";
    }
    // Een lid zonder profielrij (verwijderd account) blijft toch benoembaar: "Teamlid" is
    // waarachtiger dan niets, want de factuur is wél door een ander gemaakt.
    for (const l of leden) if (!uit[l.member_id]) uit[l.member_id] = "Teamlid";
    return uit;
  } catch {
    return {};
  }
}

/**
 * Was deze gebruiker ooit lid van een bedrijf, en is dat ingetrokken?
 *
 * Alleen om het te KUNNEN UITLEGGEN. Een medewerker wiens toegang wordt ingetrokken viel
 * hiervoor terug op zijn eigen lege facturenlijst, zonder één woord — hij zou denken dat de app
 * stuk is of dat zijn facturen verwijderd zijn. Ze zijn niet verwijderd: ze staan bij zijn
 * werkgever, waar ze horen.
 */
export async function loadIngetrokkenLidmaatschap(
  userId: string,
): Promise<{ ownerId: string; revokedAt: string } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = createPipelineClient() as any;
    const { data } = await pipeline
      .from("company_members")
      .select("owner_id, revoked_at")
      .eq("member_id", userId)
      .not("revoked_at", "is", null)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rij = data as { owner_id?: string; revoked_at?: string } | null;
    return rij?.owner_id && rij.revoked_at
      ? { ownerId: rij.owner_id, revokedAt: rij.revoked_at }
      : null;
  } catch {
    return null;
  }
}

export interface CompanyMemberRow {
  id: string;
  member_id: string;
  role: string;
  created_at: string;
  revoked_at: string | null;
}

/**
 * De leden van dit bedrijf — alleen zinvol voor een eigenaar. Actief én ingetrokken.
 *
 * `beschikbaar: false` betekent dat company_members nog niet bestaat: de migratie is niet
 * toegepast. Dat is iets ANDERS dan "je hebt geen team", en die twee mogen op geen enkel scherm
 * op elkaar lijken — anders staat er "Niemand" bij iemand die net drie mensen heeft uitgenodigd,
 * of krijgt hij een uitnodigingsformulier dat het per definitie niet doet.
 */
export async function loadCompanyMembers(
  ownerId: string,
): Promise<{ beschikbaar: boolean; leden: CompanyMemberRow[] }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = createPipelineClient() as any;
    const { data, error } = await pipeline
      .from("company_members")
      .select("id, member_id, role, created_at, revoked_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true });
    // 42P01 = de tabel bestaat nog niet. PGRST205 is dezelfde toestand via de schema-cache.
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "42P01" || code === "PGRST205") return { beschikbaar: false, leden: [] };
      return { beschikbaar: true, leden: [] };
    }
    return { beschikbaar: true, leden: data ?? [] };
  } catch {
    return { beschikbaar: false, leden: [] };
  }
}
