// src/lib/skipped-import.ts
// [OBSERVABILITY] Welke documenten tellen als "overgeslagen bij import"? Pure, geen I/O.
// Run: npx tsx --test src/lib/skipped-import.test.ts
//
// WAAROM DIT EEN EIGEN BESTAND IS
// Het paneel "Overgeslagen bij import (en waarom)" is de enige plek waar de app toegeeft dat
// er iets binnenkwam dat zij niet kon lezen. Het is dus precies de plek die niet mag liegen —
// en het loog, doordat de SCHRIJVER en de LEZER een andere waarde gebruikten:
//
//   · /api/intake schreef `ai_doc_type: v.document_kind ?? "other"`, óók wanneer de AI het
//     document niet had kunnen lezen (het wist dat zelfs: `ai_processed: !couldNotRead`);
//   · /api/email/skipped las `.eq('ai_doc_type', 'could_not_read')`.
//
// Een gefotografeerde bon die niet te lezen was, kwam dus netjes in bestanden te staan en werd
// door niets geteld. Het paneel meldde "Niets overgeslagen — alles wat binnenkwam is verwerkt".
// Dat is de zin die een ondernemer laat ophouden met zoeken.
//
// Twee kanten van dezelfde waarheid horen niet in twee bestanden los van elkaar te leven, dus
// staan ze hier — met een test die faalt zodra iemand er één verplaatst.

/**
 * De `ai_doc_type`-waarde voor een bestand dat is BEWAARD maar niet GELEZEN.
 * Elke opnameweg die dat overkomt, hoort deze waarde weg te schrijven.
 */
export const DOC_TYPE_COULD_NOT_READ = "could_not_read" as const;

/**
 * Bewaard, maar het bestandstype kon sowieso niet worden verwerkt (bijv. een formaat waar geen
 * lezer voor is). Een andere diagnose dan hierboven — de ondernemer moet er hetzelfde mee: even
 * kijken — dus telt hij mee in hetzelfde paneel.
 */
export const DOC_TYPE_UNSUPPORTED = "unsupported_type" as const;

/**
 * De volledige lijst die het overgeslagen-paneel moet tellen.
 *
 * DIT IS DE ENIGE PLEK waar die lijst staat. Voegt een nieuwe opnameweg ooit een derde reden
 * toe, dan hoort hij hier bij — anders valt hij weer stil buiten beeld, precies zoals
 * 'could_not_read' dat deed.
 */
export const SKIPPED_DOC_TYPES: readonly string[] = [
  DOC_TYPE_COULD_NOT_READ,
  DOC_TYPE_UNSUPPORTED,
];

/**
 * Welke `ai_doc_type` hoort een opgeslagen document te krijgen?
 *
 * `couldNotRead` wint van alles: kon de AI het niet lezen, dan is haar classificatie een gok en
 * mag die de reden niet overschrijven. Zonder die voorrang schreef intake "other" over een
 * onleesbaar bestand heen — de bug die dit bestand bestaat om te voorkomen.
 */
export function docTypeForStoredFile(
  couldNotRead: boolean,
  aiDocumentKind: string | null | undefined,
): string {
  if (couldNotRead) return DOC_TYPE_COULD_NOT_READ;
  const kind = (aiDocumentKind ?? "").trim();
  return kind.length > 0 ? kind : "other";
}

/** Telt dit document mee in "Overgeslagen bij import"? */
export function isSkippedDocType(aiDocType: string | null | undefined): boolean {
  return SKIPPED_DOC_TYPES.includes((aiDocType ?? "").trim());
}
