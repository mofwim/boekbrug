// src/lib/trashed-dedup.ts
// [DUP-TRASHED] De byte-hash-poort en de prullenbak.
//
// Botst een upload op een bestand dat de eigenaar ZELF heeft weggegooid, dan is "dit bestand staat
// al in: Facturen / 2026" niet waar. Het staat niet in die map — het staat in de prullenbak, en daar
// kijkt hij niet als hij iets opnieuw probeert toe te voegen. De mapnaam in die melding werd zelfs
// gewoon uit de weggegooide rij opgebouwd, dus we wezen hem naar een plek waar het bestand voor hem
// onzichtbaar is.
//
// Erger dan verwarrend: dit is een doodlopende weg. De byte-hash-poort is met OPZET niet te forceren
// (identieke bytes zijn hetzelfde bestand), dus zonder deze uitzondering kan de eigenaar dat bestand
// nooit meer toevoegen. Weggooien is bij ons omkeerbaar — trashed=true, de rij en het bestand blijven
// staan — dus "weg" mag nooit "voorgoed geblokkeerd" betekenen.
//
// ── WAAROM EEN UPDATE EN NIET EEN FILTER OP DE SELECT ──
// De UNIQUE index uit documents_content_hash_unique.sql staat op (user_id, content_hash) WHERE
// content_hash IS NOT NULL en kent het verschil tussen weggegooid en niet. Een weggegooide rij bezet
// die sleutel dus nog steeds. Een `.eq("trashed", false)` in de SELECT zou de 409 alleen verplaatsen
// naar een 23505 op de insert erna: van een verwarrende melding naar een 500. Beter bedoeld, slechter
// afgelopen. We halen daarom de hash van díe ene rij af — de rij, het bestand en de prullenbak blijven
// ongemoeid, alleen de claim op de dedup-sleutel vervalt.
//
// ── WAAROM DIT EEN GEDEELDE MODULE IS ──
// Vier routes doen dezelfde byte-hash-poort: /api/intake (op vier plekken), /api/email/upload,
// /api/bank/attach-invoice en de mailsync in email-integration.ts. Ze hadden allemaal dezelfde
// blinde vlek. Eén implementatie, want vier kopieën van deze redenering zijn drie kansen dat er één
// uit de pas gaat lopen — en de fout die dan terugkomt is onzichtbaar tot een ondernemer vastloopt.
//
// De tweede poort blijft overal staan: hoort er nog een LEVENDE factuur bij het weggegooide bestand,
// dan vangt de semantische duplicaatcontrole (SAFECORE Rule 2) de dubbele boeking af — met canForce,
// zodat de eigenaar het gesprek kan winnen. Dat is de rolverdeling die we willen: de bytes-poort
// blokkeert nooit onherroepelijk, de betekenis-poort mag dat wél (en is te overrulen).

import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/** Het minimum dat een aanroeper moet opvragen om deze beslissing te kunnen nemen. */
export interface HashDupRow {
  id: string;
  trashed?: boolean | null;
}

/**
 * Haal de content_hash van één weggegooide rij af, zodat de dedup-sleutel vrijkomt.
 *
 * Geeft `false` terug wanneer dat niet lukte. De aanroeper hoort dan te blokkeren zoals vroeger:
 * dat is de oude (verwarrende) melding, maar nog altijd beter dan doorlopen naar een insert die even
 * later op de UNIQUE index stukloopt en de eigenaar een 500 geeft. Nooit een nieuwe fout maken bij
 * het repareren van een oude.
 */
export async function releaseTrashedHash(
  supabase: Client,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("documents")
    .update({ content_hash: null })
    .eq("id", documentId)
    .eq("user_id", userId);
  return !error;
}

/**
 * Mag deze upload doorlopen ondanks de gevonden hash-botsing?
 *
 * `true`  — de botsing was een WEGGEGOOID bestand én de sleutel is vrijgegeven: behandel de upload
 *           als een vers bestand.
 * `false` — een levend duplicaat (of het vrijgeven mislukte): blokkeren, precies zoals vroeger.
 *
 * `trashed` kan NULL zijn op oude rijen, dus expliciet op `=== true` vergelijken — een `!row.trashed`
 * zou een legacy-rij met NULL als "weggegooid" lezen en de poort openzetten voor een levend bestand.
 */
export async function trashedDuplicateCleared(
  supabase: Client,
  userId: string,
  dup: HashDupRow,
): Promise<boolean> {
  if (dup.trashed !== true) return false;
  return releaseTrashedHash(supabase, userId, dup.id);
}
