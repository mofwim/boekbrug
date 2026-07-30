// src/lib/supplier-cadence.ts
// [RITME] De factuur die NIET kwam.
//
// Alles in dit systeem kijkt naar wat binnenkomt: is het echt, is het dubbel, klopt de rekensom.
// Maar de duurste fout in een ZZP-boekhouding is de factuur die er nooit was. Een maandelijkse
// leverancier slaat een maand over — de mail belandde in spam, de bijlage ontbrak, de leverancier
// vergat het — en niemand merkt het. Er is namelijk niets om te merken: een lege wachtrij ziet er
// precies zo uit als een afgehandelde wachtrij. Pas bij de aangifte klopt de voorbelasting niet,
// en dan is de vraag "welke factuur mis ik?" praktisch onbeantwoordbaar.
//
// De gegevens om het wél te merken liggen er al: de facturen die de eigenaar de afgelopen maanden
// van dezelfde leverancier ontving. Daar zit een ritme in, en een ritme dat stokt is een vraag.
//
// GEEN AI. Dit is rekenkunde over data die er al staat: de tussenpozen tussen opeenvolgende
// facturen, de mediaan daarvan, en de vraag of er inmiddels te veel tijd voorbij is.
//
// DRIE REGELS DIE BEPALEN WANNEER WE ONZE MOND HOUDEN — belangrijker dan de detectie zelf, want
// een melding die te vaak onterecht komt, leert de eigenaar om álle meldingen weg te klikken:
//
//   1. Genoeg geschiedenis. Vier facturen (drie tussenpozen) minimaal. Twee facturen zijn geen
//      ritme, dat is een toeval.
//   2. Een ECHT ritme. Elke tussenpoos moet dicht bij de mediaan liggen. Een leverancier die
//      onregelmatig factureert heeft geen ritme, en dan valt er ook niets te missen.
//   3. Een venster, geen eeuwigheid. Voorbij één extra volledige cyclus zwijgen we: dan is het
//      waarschijnlijker dat het contract is gestopt dan dat er een factuur zoek is. Een banner
//      die nooit meer weggaat is geen signaal meer, dat is meubilair.

/** De herkende ritmes. Alles daarbuiten heet "geen ritme" en levert nooit een melding op. */
export type Cadence = 'wekelijks' | 'maandelijks' | 'per kwartaal' | 'jaarlijks'

export interface CadenceVerdict {
  cadence: Cadence
  /** De mediane tussenpoos in dagen — waar de verwachting op gebaseerd is. */
  gapDays: number
  /** De datum van de laatste factuur die we van deze leverancier zagen (ISO). */
  lastSeen: string
  /** Uiterlijk deze dag had de volgende er moeten zijn, coulance meegerekend (ISO). */
  expectedBy: string
  /** Hoeveel dagen die datum inmiddels voorbij is. Altijd ≥ 1 als er een verdict is. */
  daysLate: number
}

// Een ritme is pas een ritme na drie tussenpozen; daarvoor is het een toeval.
const MIN_INVOICES = 4

// Hoeveel een losse tussenpoos van de mediaan mag afwijken voordat we het "onregelmatig" noemen.
// 40% is ruim genoeg voor de normale schommeling (een factuur op de 28e, de volgende op de 3e)
// en streng genoeg om een leverancier die willekeurig factureert eruit te houden.
const GAP_TOLERANCE = 0.4

// De buckets. Ruim genomen: een "maandelijkse" leverancier factureert in de praktijk tussen de
// 26 en 35 dagen. Valt de mediaan in geen enkele bucket, dan is er geen ritme — en zwijgen we.
const BUCKETS: { cadence: Cadence; min: number; max: number }[] = [
  { cadence: 'wekelijks', min: 5, max: 9 },
  { cadence: 'maandelijks', min: 26, max: 35 },
  { cadence: 'per kwartaal', min: 82, max: 98 },
  { cadence: 'jaarlijks', min: 350, max: 380 },
]

const DAY_MS = 86_400_000

function toUtcDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(t) ? t : null
}

function isoFromDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Ontbreekt er een factuur van deze leverancier?
 *
 * @param datesIso  factuurdatums van ÉÉN leverancier, in willekeurige volgorde (YYYY-MM-DD)
 * @param todayIso  de dag van vandaag (YYYY-MM-DD) — meegegeven, nooit zelf geklokt, zodat deze
 *                  functie puur blijft en in een test een vaste dag kan krijgen
 * @returns het verdict, of null wanneer er niets te melden valt (dat is verreweg het vaakst)
 */
export function assessSupplierCadence(datesIso: string[], todayIso: string): CadenceVerdict | null {
  const today = toUtcDay(todayIso)
  if (today === null) return null

  // Ontdubbelen: twee facturen op dezelfde dag zijn één moment in het ritme, geen tussenpoos van
  // nul dagen — anders zou één dubbele levering de hele mediaan omlaag trekken.
  const days = Array.from(
    new Set(datesIso.map(toUtcDay).filter((d): d is number => d !== null))
  ).sort((a, b) => a - b)

  // REGEL 1 — genoeg geschiedenis.
  if (days.length < MIN_INVOICES) return null

  const gaps: number[] = []
  for (let i = 1; i < days.length; i++) gaps.push(Math.round((days[i] - days[i - 1]) / DAY_MS))
  if (gaps.some((g) => g <= 0)) return null

  const gapDays = median([...gaps].sort((a, b) => a - b))
  if (gapDays <= 0) return null

  // REGEL 2 — een ECHT ritme: elke tussenpoos dicht bij de mediaan.
  const slack = Math.max(2, gapDays * GAP_TOLERANCE)
  if (gaps.some((g) => Math.abs(g - gapDays) > slack)) return null

  const bucket = BUCKETS.find((b) => gapDays >= b.min && gapDays <= b.max)
  if (!bucket) return null

  // Coulance: facturen schuiven een paar dagen. Een kwart van de tussenpoos, minimaal vijf dagen —
  // zo meldt een maandelijkse leverancier pas na ~37 dagen stilte, niet op dag 31.
  const grace = Math.max(5, Math.round(gapDays * 0.25))
  const lastSeenDay = days[days.length - 1]
  const expectedByDay = lastSeenDay + (gapDays + grace) * DAY_MS
  const daysLate = Math.round((today - expectedByDay) / DAY_MS)
  if (daysLate < 1) return null

  // REGEL 3 — een venster, geen eeuwigheid. Voorbij één extra volledige cyclus is "gestopt"
  // waarschijnlijker dan "zoek", en blijven melden maakt de melding waardeloos.
  if (daysLate > gapDays) return null

  return {
    cadence: bucket.cadence,
    gapDays,
    lastSeen: isoFromDay(lastSeenDay),
    expectedBy: isoFromDay(expectedByDay),
    daysLate,
  }
}

/** De zin die de eigenaar leest. Benoemt het ritme, het laatste moment, en wat hij kan doen. */
export function cadenceReason(supplierName: string, v: CadenceVerdict): string {
  const naam = supplierName.trim() || 'Deze leverancier'
  return (
    `${naam} factureert normaal ${v.cadence}, maar er is sinds ${formatDutchDate(v.lastSeen)} niets ` +
    `meer binnengekomen. Controleer je spam-map of vraag de factuur op — zonder factuur kun je de ` +
    `btw niet terugvragen.`
  )
}

/** "3 maart 2026" — lokaal geformatteerd zonder van een locale-API af te hangen. */
export function formatDutchDate(iso: string): string {
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}
