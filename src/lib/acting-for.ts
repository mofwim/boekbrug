// src/lib/acting-for.ts
// [NAMENS] Wie handelt er, namens wie, en wat mag dat? Puur, geen I/O.
// Run: npx tsx --test src/lib/acting-for.test.ts
//
// WAAROM DIT BESTAAT
//
// Tot nu toe was BoekBrug één mens per boekhouding: elke rij hangt aan `user_id`, en de vraag
// "mag jij hierbij?" had één antwoord — is deze rij van jou? Er komt nu één tweede rol bij: een
// verkoopmedewerker die facturen maakt en verstuurt VOOR het bedrijf van zijn baas.
//
// DE VALKUIL DIE DIT BESTAND BEWAAKT
//
// Het ligt voor de hand om zo'n medewerker gewoon een account te geven. Dan schrijft hij
// facturen met sender_id = ZIJN id, en dus met ZIJN nummerreeks. Twee mensen, twee reeksen,
// één bedrijf. invoice-numbering.ts zegt in zijn kop waarom dat niet mag:
//
//   "per Dutch Belastingdienst (Article 35 — Wet OB 1968): numbers must be sequential
//    without gaps, and forward-only (no rollback once issued)."
//
// Twee parallelle reeksen onder één BTW-nummer zijn bij een controle geen slordigheid maar
// gaten in de nummering. En het is niet terug te draaien: een uitgegeven nummer blijft uitgegeven.
//
// DE REGEL DIE ALLES OPLOST
//
//   De medewerker BEZIT niets. Hij HANDELT NAMENS de eigenaar.
//
// Alles wat de boekhouding raakt — het factuurnummer, sender_id, het PDF-pad, de eerlijk-
// gebruikteller — hangt aan `ownerId`. Wie er achter het toetsenbord zat, staat in `actorId` en
// belandt in created_by: een spoor, nooit een eigendom. Eén reeks per bedrijf, per constructie.
//
// EN DE TWEEDE REDEN DAT DIT ZO IS OPGEZET
//
// RLS is in dit product de ENIGE echte grens (131 policies, 184 keer auth.uid()). Een rollen-
// systeem dat die 131 policies verbouwt tot "mag deze actor dit doen" is geen functie maar een
// nieuw fundament — en een fout daarin is niet een schermpje dat raar staat, maar een
// medewerker die de winst van zijn baas leest. Door de medewerker NOOIT rechtstreeks op de
// rijen van de eigenaar te laten lezen, blijft elke bestaande policy exact zoals hij was.

/** De rollen binnen één bedrijf. Bewust twee — zie de kop: dit is geen rollensysteem. */
export type CompanyRole = "eigenaar" | "verkoop";

/** Eén rij uit company_members, zoals de database hem teruggeeft. */
export interface MemberLink {
  owner_id: string;
  member_id: string;
  role: string;
  /** Gezet ⇒ de koppeling is ingetrokken en verleent vanaf dat moment niets meer. */
  revoked_at: string | null;
}

export interface ActingFor {
  /**
   * Wiens boekhouding dit is. ALLES wat de boeken raakt wordt hieronder geschreven:
   * het factuurnummer, sender_id, het PDF-pad, de eerlijk-gebruikteller.
   */
  ownerId: string;
  /**
   * Wie er achter het toetsenbord zat. Gaat naar created_by — een spoor, geen eigendom.
   * Voor een eigenaar is dit hetzelfde als ownerId.
   */
  actorId: string;
  role: CompanyRole;
}

/** Handelt deze persoon namens iemand anders? */
export function isNamens(a: ActingFor): boolean {
  return a.ownerId !== a.actorId;
}

/**
 * Wie handelt hier, namens wie?
 *
 * FAALT ALTIJD NAAR "ALLEEN JEZELF". Elke twijfel — geen koppeling, ingetrokken, een rol die we
 * niet kennen, een rij die niet over deze gebruiker gaat — levert een eigenaar-van-zichzelf op.
 * Dat is de veilige kant: iemand ziet dan zijn eigen (lege) boekhouding in plaats van die van een
 * ander. De omgekeerde faalrichting is een vreemde in andermans cijfers.
 *
 * `nowMs` wordt meegegeven — geen klok in een pure functie, en het maakt de test exact.
 */
export function resolveActingFor(
  sessionUserId: string,
  link: MemberLink | null | undefined,
  nowMs: number,
): ActingFor {
  const alleen: ActingFor = { ownerId: sessionUserId, actorId: sessionUserId, role: "eigenaar" };
  if (!sessionUserId) throw new Error("[NAMENS] resolveActingFor zonder gebruiker");
  if (!link) return alleen;

  // De rij MOET over deze sessie gaan. Zou een verkeerde rij hier ooit binnenkomen (een bug in
  // de query, een verwisselde parameter), dan is dat precies het geval waarin doorgaan iemand in
  // andermans boekhouding zet. Dus: negeren.
  if (link.member_id !== sessionUserId) return alleen;

  // Een zelf-koppeling is onzin en zou iemand met de LEESFILTER van een medewerker naar zijn
  // eigen boekhouding laten kijken — hij zou zijn eigen oudere facturen kwijt zijn.
  if (link.owner_id === link.member_id) return alleen;
  if (!link.owner_id) return alleen;

  // Ingetrokken is onmiddellijk. Geen respijt, geen "tot einde dag".
  if (link.revoked_at) {
    const ms = Date.parse(link.revoked_at);
    // Onleesbare datum ⇒ behandelen als ingetrokken. Liever een medewerker die te vroeg buiten
    // staat dan een ingetrokken medewerker die binnen blijft.
    if (!Number.isFinite(ms) || ms <= nowMs) return alleen;
  }

  // Een rol die we niet kennen verleent NIETS. Zo kan een toekomstige rol nooit per ongeluk de
  // rechten van 'verkoop' erven omdat iemand vergat hem hier te noemen.
  if (link.role !== "verkoop") return alleen;

  return { ownerId: link.owner_id, actorId: sessionUserId, role: "verkoop" };
}

// ── Wat mag deze actor? ───────────────────────────────────────────────────────────────────────

/**
 * De schermen die een verkoopmedewerker MAG zien. Een gesloten lijst, en dat is het hele punt.
 *
 * Alles wat hier niet staat is dicht — ook een scherm dat morgen wordt toegevoegd. Dat is de
 * juiste faalrichting: een nieuw scherm dat per ongeluk openstaat voor een medewerker is een
 * lek dat niemand opmerkt, een nieuw scherm dat per ongeluk dicht staat is een klacht binnen een
 * dag. Openzetten is een bewuste handeling, precies één regel hieronder.
 */
export const VERKOOP_SCHERMEN: readonly string[] = [
  // Zijn eigen scherm: de facturen die hij maakte.
  "/dashboard/verkoop",
  // Maken, bekijken en bewerken van één factuur. Dit dekt bewust ook /dashboard/invoice/<id>:
  // zonder die tak liep de eigen lijst dood — elke rij verwijst naar het detailscherm. Veilig
  // omdat die schermen met de SESSIE van de medewerker lezen, en RLS hem alleen zijn eigen
  // rijen geeft (invoices_member_read). Een geraden id levert dus niets op.
  "/dashboard/invoice",
  // Zijn klanten. Ook hier: RLS (clients_member_read) beperkt het tot wat hij zelf invoerde.
  "/dashboard/klanten",
];

/**
 * Mag deze actor bij dit pad?
 *
 * Een eigenaar: overal (zijn eigen boekhouding). Een medewerker: alleen de lijst hierboven, en
 * alleen als exacte match of als submap — zodat /dashboard/verkoop/x meekomt maar
 * /dashboard/verkoopcijfers NIET (een prefixvergelijking zonder grens is hoe dit soort wachten
 * stilletjes te ruim worden).
 */
export function magScherm(a: ActingFor, pad: string): boolean {
  if (a.role === "eigenaar") return true;
  return VERKOOP_SCHERMEN.some((s) => pad === s || pad.startsWith(s + "/"));
}

/**
 * Onder wiens naam wordt deze factuur geboekt? ALTIJD de eigenaar — zie de kop van dit bestand.
 * Deze functie bestaat zodat er nergens anders in de codebase een keuze te maken valt.
 */
export function factuurEigenaar(a: ActingFor): string {
  return a.ownerId;
}

/** Wie maakte hem? Het spoor, nooit het eigendom. */
export function factuurGemaaktDoor(a: ActingFor): string {
  return a.actorId;
}

/**
 * De filter waarmee deze actor facturen mag LEZEN.
 *
 * De eigenaar ziet alles van zichzelf. De medewerker ziet alleen wat hij zelf aanmaakte — niet
 * de omzet van zijn baas, niet de facturen van een collega. `created_by` is daarmee geen
 * sierveld: het is de leesgrens.
 */
export function factuurLeesFilter(a: ActingFor): { sender_id: string; created_by?: string } {
  return a.role === "eigenaar"
    ? { sender_id: a.ownerId }
    : { sender_id: a.ownerId, created_by: a.actorId };
}

/**
 * Mag deze actor DEZE factuur openen/versturen?
 *
 * Bewust een aparte functie naast de leesfilter: een lijst filteren en één rij toetsen zijn twee
 * verschillende momenten, en het tweede is het moment waarop een geraden id binnenkomt.
 */
export function magFactuur(
  a: ActingFor,
  factuur: { sender_id: string | null; created_by?: string | null },
): boolean {
  if (factuur.sender_id !== a.ownerId) return false;
  if (a.role === "eigenaar") return true;
  return factuur.created_by === a.actorId;
}

/**
 * Mag deze actor versturen?
 *
 * Ja — dat is de gekozen inrichting: de medewerker maakt de factuur áf, inclusief het nummer en
 * de mail. Maar het nummer komt uit de reeks van de EIGENAAR (factuurEigenaar), en dat is wat
 * deze hele module bewaakt. Versturen is onomkeerbaar; de eigenaar houdt de controle via het
 * intrekken van de koppeling, niet via een knop per factuur.
 */
export function magVersturen(a: ActingFor, factuur: { sender_id: string | null; created_by?: string | null }): boolean {
  return magFactuur(a, factuur);
}
