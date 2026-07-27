// src/lib/vragen.ts
// [BRUG-RETOUR] De terugweg van de brug — pure logica.
//
// WAAROM DIT BESTAAT
// De boekhouder kan al sinds [READINESS-P3] een document op status 'vraag' zetten
// (/api/accountant/subject-status). Die vraag kwam alleen nergens uit: de klant kreeg
// één notificatie die naar /dashboard/bestanden wees — een map met bestanden, zonder
// vraag, zonder tekst, zonder antwoordknop. De vraag "welke bon mis je?" verliet
// BoekBrug dus en kwam terug via WhatsApp. Precies de wrijving waar dit product voor
// is gebouwd.
//
// DE HONESTHEIDSREGEL DIE DIT BESTAND BEWAAKT
// Een status is een BEWERING VAN DE BOEKHOUDER. De klant mag hem lezen, nooit
// schrijven (RLS: acc_status_client_read_document is SELECT-only). Daarom:
//   · wij markeren een vraag NOOIT zelf als beantwoord — dat zou een bewering van de
//     klant in het vakje van de boekhouder zetten;
//   · een vraag zonder tekst tonen wij als "geen toelichting", niet als een verzonnen
//     vraag;
//   · een vraag over een document dat niet meer te vinden is verdwijnt niet stil —
//     hem verbergen is óók een bewering.
// Antwoorden loopt daarom via /api/messages (het bestaande kanaal met koppelingscheck,
// notificatie en e-mail), en de vraag blijft staan tot de boekhouder hem zelf afvinkt.

/** De statuswaarde die een openstaande vraag markeert (accountant_subject_status.status). */
export const VRAAG_STATUS = 'vraag' as const

/** Ruwe statusrij zoals hij uit accountant_subject_status komt. */
export interface VraagStatusRow {
  subject_id: string
  status: string
  vraag_text: string | null
  updated_at: string | null
}

/** Het document waar de vraag over gaat, zoals het uit documents komt. */
export interface VraagDocumentRow {
  id: string
  file_name: string | null
  trashed?: boolean | null
}

/** Een openstaande vraag, klaar om te tonen. */
export interface OpenVraag {
  documentId: string
  /** De bestandsnaam, of null als het document niet (meer) te lezen is. */
  documentName: string | null
  /** In de prullenbak — de vraag geldt nog, het bestand ligt alleen apart. */
  documentTrashed: boolean
  /** Het document bestaat niet meer of is niet leesbaar voor deze gebruiker. */
  documentMissing: boolean
  /** De tekst van de boekhouder. null = hij liet geen toelichting achter. */
  question: string | null
  /** Wanneer de vraag voor het laatst is gezet. null = onbekend, en dat tonen wij zo. */
  askedAt: string | null
}

/**
 * Bouwt de lijst openstaande vragen uit de twee rijenverzamelingen.
 *
 * Alleen rijen met status 'vraag' tellen — 'verwerkt' of 'in_behandeling' is geen vraag
 * aan de klant. Een document dat niet in de meegegeven lijst zit is NIET stil weggelaten:
 * het komt terug met documentMissing = true, zodat het scherm kan zeggen dat er een vraag
 * openstaat over een bestand dat wij niet meer kunnen tonen.
 *
 * Oudste eerst: de vraag die het langst wacht is de vraag die ertoe doet. Rijen zonder
 * datum sluiten achteraan aan — een ontbrekende datum mag nooit als "net gesteld" lezen,
 * maar ook niet als "al weken oud".
 */
export function buildOpenVragen(
  statusRows: readonly VraagStatusRow[],
  documents: readonly VraagDocumentRow[],
): OpenVraag[] {
  const byId = new Map<string, VraagDocumentRow>()
  for (const d of documents) byId.set(d.id, d)

  const open: OpenVraag[] = []
  for (const row of statusRows) {
    if (row.status !== VRAAG_STATUS) continue
    const doc = byId.get(row.subject_id)
    open.push({
      documentId: row.subject_id,
      documentName: doc?.file_name?.trim() || null,
      documentTrashed: doc?.trashed === true,
      documentMissing: !doc,
      question: vraagTekst(row.vraag_text),
      askedAt: row.updated_at ?? null,
    })
  }

  return open.sort((a, b) => {
    if (a.askedAt && b.askedAt) return a.askedAt.localeCompare(b.askedAt)
    if (a.askedAt) return -1
    if (b.askedAt) return 1
    return 0
  })
}

/**
 * De vraagtekst zoals hij getoond mag worden.
 *
 * Leeg of alleen spaties → null. Het scherm zegt dan "je boekhouder gaf geen toelichting",
 * en dat is de waarheid. Er wordt hier nooit een vraag verzonnen die niemand heeft gesteld.
 */
export function vraagTekst(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  return t.length > 0 ? t : null
}

/**
 * De eerste regel van het antwoord van de klant.
 *
 * De boekhouder leest het antwoord in zijn gewone berichtenscherm, ver van het document
 * waar hij de vraag over stelde. Zonder deze regel is "ja die heb ik" een raadsel. De
 * naam wordt begrensd zodat een absurd lange bestandsnaam het bericht niet opeet.
 */
export function vraagAntwoordPrefix(documentName: string | null): string {
  const naam = (documentName ?? '').trim()
  if (!naam) return 'Over je vraag:'
  const kort = naam.length > 80 ? `${naam.slice(0, 77)}…` : naam
  return `Over je vraag bij "${kort}":`
}

/**
 * Het volledige bericht dat naar de boekhouder gaat.
 *
 * Leeg antwoord → null, zodat de aanroeper niet per ongeluk een bericht verstuurt dat
 * alleen uit onze eigen kopregel bestaat.
 */
export function bouwAntwoordBericht(documentName: string | null, antwoord: string): string | null {
  const tekst = antwoord.trim()
  if (!tekst) return null
  return `${vraagAntwoordPrefix(documentName)}\n${tekst}`
}

/**
 * De regel die het dashboard toont zodra er vragen openstaan.
 *
 * Enkelvoud/meervoud klopt, en er staat nooit een getal bij nul — bij nul hoort de balk
 * helemaal niet te verschijnen.
 */
export function vragenBannerTekst(aantal: number): string | null {
  if (aantal <= 0) return null
  return aantal === 1
    ? 'Je boekhouder heeft een vraag'
    : `Je boekhouder heeft ${aantal} vragen`
}
