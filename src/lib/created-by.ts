// src/lib/created-by.ts
// [NAMENS] Schrijven en lezen van `created_by` op een database die de kolom misschien nog NIET heeft.
// Run: npx tsx --test src/lib/created-by.test.ts
//
// ═══ DE FOUT DIE DIT BESTAND REPAREERT ═══
//
// company_members_sales_role.sql voegt `created_by` toe aan invoices en clients. De code die die
// kolom gebruikt stond al op main — met een `as any` erbij, want de gegenereerde types kennen hem
// nog niet.
//
// Die `as any` zwijgt de TYPECONTROLE, niet de DATABASE. Op een installatie waar de migratie nog
// niet is toegepast antwoordt PostgREST met PGRST204 ("Could not find the 'created_by' column")
// en faalt het hele verzoek. Gevolg, met de migratie nog open:
//
//   · /api/invoice/draft      → EEN FACTUUR AANMAKEN LUKT NIET. Voor iedereen.
//   · /api/clients            → een klant toevoegen lukt niet
//   · /api/invoice/[id]       → een concept bewerken of verwijderen lukt niet
//   · /api/invoice/duplicate  → dupliceren lukt niet
//   · /api/invoice/creditnota → een creditnota maken lukt niet
//
// Dat is geen randgeval maar de kern van het product, en het zou pas zichtbaar zijn geworden bij
// de eerste factuur ná de deploy. tsc was schoon, de tests waren groen en de build slaagde — geen
// van drieën kijkt naar de echte database. Precies de vorm van fout waar dit product niet tegen kan.
//
// ═══ DE OPLOSSING ═══
//
// Niet cachen of vooraf peilen: een gecachte "de kolom bestaat niet" blijft hangen tot de
// volgende deploy, dus dan werkt de migratie pas na een herstart. In plaats daarvan: PROBEER het
// met het spoor, en val bij precies die twee foutcodes terug op zonder. Zodra de migratie draait,
// slaagt de eerste poging en wordt de terugval nooit meer aangeraakt.
//
// Wat er verloren gaat zonder de kolom is het SPOOR (wie maakte deze rij), niet het werk. En dat
// is de juiste kant om op te vallen: zonder migratie bestaat de verkoopmedewerker sowieso niet —
// er is dan één mens per boekhouding, en die is per definitie de eigenaar.

/** De twee manieren waarop PostgREST/Postgres zegt: die kolom ken ik niet. */
export const KOLOM_ONBEKEND = ["PGRST204", "42703"] as const;

/**
 * Gaat deze fout over een kolom die (nog) niet bestaat?
 *
 * De code is leidend. De boodschap wordt er alleen bij gebruikt als er géén code is — sommige
 * clients geven bij een schema-cache-misser alleen tekst terug.
 */
export function isKolomOnbekend(error: unknown, kolom = "created_by"): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if ((KOLOM_ONBEKEND as readonly string[]).includes(code)) return true;
  if (code) return false;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes(kolom.toLowerCase()) && (msg.includes("column") || msg.includes("kolom"));
}

export interface PogingResultaat<T> {
  data: T | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
}

export interface SpoorResultaat<T> extends PogingResultaat<T> {
  /** false ⇒ de rij is geschreven ZONDER created_by, omdat de kolom nog niet bestaat. */
  spoorGezet: boolean;
}

/**
 * Voert een schrijfactie uit MET het spoor, en zonder als de kolom nog niet bestaat.
 *
 * `uitvoeren` krijgt de extra velden mee en moet de query bouwen én uitvoeren. Twee aanroepen in
 * het slechtste geval, één in het normale — en na de migratie altijd één.
 */
export async function schrijfMetSpoor<T>(
  uitvoeren: (extra: Record<string, unknown>) => PromiseLike<PogingResultaat<T>>,
  spoor: Record<string, unknown>,
): Promise<SpoorResultaat<T>> {
  const eerste = await uitvoeren(spoor);
  if (!eerste.error || !isKolomOnbekend(eerste.error)) {
    return { ...eerste, spoorGezet: true };
  }
  // Luid, want dit hoort tijdelijk te zijn: het betekent dat de migratie nog open staat.
  console.warn(
    "[NAMENS] created_by bestaat nog niet — rij geschreven zonder spoor. " +
      "Pas supabase/migrations/company_members_sales_role.sql toe.",
    { velden: Object.keys(spoor) },
  );
  const tweede = await uitvoeren({});
  return { ...tweede, spoorGezet: false };
}

/**
 * Zelfde truc voor een SELECT: probeer de kolommenlijst mét het spoor, en zonder als hij ontbreekt.
 *
 * `uitvoeren` krijgt de kolommenreeks die hij moet selecteren.
 */
export async function leesMetSpoor<T>(
  uitvoeren: (kolommen: string) => PromiseLike<PogingResultaat<T>>,
  kolommenMet: string,
  kolommenZonder: string,
): Promise<SpoorResultaat<T>> {
  const eerste = await uitvoeren(kolommenMet);
  if (!eerste.error || !isKolomOnbekend(eerste.error)) {
    return { ...eerste, spoorGezet: true };
  }
  const tweede = await uitvoeren(kolommenZonder);
  return { ...tweede, spoorGezet: false };
}
