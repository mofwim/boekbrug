// src/lib/bank-overapplied.ts
// [BANK-OVERAPPLIED-LOUD] Is er méér aan facturen op deze bankregel geboekt dan er binnenkwam?
//
// ── WAAROM DIT BESTAAT, EN WAAROM HET MAAR HALF BESCHERMT ──
//
// Twee gelijktijdige boekingen op DEZELFDE bankregel lezen allebei de zusterkoppelingen vóórdat
// een van beide heeft geschreven. Allebei denken ze dan de hele regel te mogen besteden, en
// Σ amount_applied komt boven het bedrag van de regel uit. Het schrijfpad heeft geen mutex over
// verzoeken heen — alleen een atomaire RPC sluit dat volledig, en dat staat gedocumenteerd als
// uitgesteld. Wat er in plaats daarvan is beloofd is dit: de stand kan nooit STIL verkeerd zijn.
// De som wordt NA de eigen schrijving herlezen, en boven het bedrag van de regel volgt een
// auditregel plus een melding aan de eigenaar, met de bedragen erin.
//
// Gemeten in de productiedatabase toen dit werd geschreven: twee bankregels stonden werkelijk
// over-besteed — één met € 39,86 te veel over vier koppelingen, en één van € 0,59 waarop precies
// tweemaal € 0,59 was geboekt. De race is dus niet theoretisch.
//
// ── WAAROM ÉÉN FUNCTIE EN NIET DRIE KOPIEËN ──
//
// Er zijn drie deuren die een factuur aan een bankregel koppelen:
//
//   · /api/bank/allocate      → gaat door allocate_bank_payment, die het budget ONDER EEN
//                               RIJVERGRENDELING herberekent. Veilig van constructie.
//   · /api/bank/confirm       → had deze controle, met de hand geschreven.
//   · /api/bank/attach-invoice→ had geen van beide. En dat is de deur die een factuur AANMAAKT
//                               die meteen op 'betaald' staat: over-besteden betekent daar een
//                               factuur die is voldaan uit geld dat de regel niet had.
//
// Die derde deur erbij schrijven als tweede kopie is precies hoe de vier lezers van deze som ooit
// uit elkaar zijn gaan lopen ([LIJN-BUDGET]). Dus: één functie, twee aanroepers.
//
// ── EN WAAROM GETEKEND ──
//
// De handgeschreven versie telde MAGNITUDES (`Math.max(0, amount_applied)`). Per FACTUUR is dat
// juist; per REGEL niet, want een creditnota geeft geld terug aan de regel. Een regel van € 850
// die bestaat uit een inkoopfactuur van € 1.000 en een inkoopcredit van € 150 telt dan € 1.150 en
// slaat alarm over een boeking die precies klopt. Vandaag draagt geen enkele regel in de database
// beide tegelijk, dus het was nog geen vals alarm — maar het is wel dezelfde tekenblindheid die
// allocatedOnLine bestaat om te voorkomen, en een vals alarm op een geldwaarschuwing is duur:
// het is de tweede keer dat je hem negeert.

import { allocatedOnLine } from "./bank-line-budget";
import { fetchAllRowsForIds } from "./supabase-paginate";
import { round2 } from "./invoice-totals";

/** Wat de controle heeft vastgesteld. `null` = de controle kon niet draaien. */
export interface OverAppliedVerdict {
  /** Getekend: wat deze regel volgens haar koppelingen heeft weggegeven. */
  appliedSum: number;
  /** Het bedrag van de bankregel zelf, als magnitude. */
  lineAmount: number;
  /** Staat er meer op geboekt dan er binnenkwam? */
  over: boolean;
}

/**
 * Herlees de som van deze bankregel en zeg of hij over-besteed is.
 *
 * GOOIT NIET. Een leesfout komt terug als `null` — "de controle heeft niet gedraaid" — en dat is
 * iets anders dan "er is niets aan de hand". De aanroeper legt dat verschil vast; hier wordt het
 * alleen niet weggemoffeld tot een nul. supabase-js gooit niet op een queryfout, dus zonder deze
 * scheiding gaf een mislukte herlezing een som van 0, en 0 is nooit groter dan het regelbedrag:
 * de enige waarborg tegen de enige race die dit pad openlaat verdween dan in stilte.
 */
export async function readOverApplied(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  userId: string;
  transactionId: string;
  /** Het bedrag van de bankregel. Getekend of niet — de magnitude wordt hier genomen. */
  txAmount: number;
}): Promise<OverAppliedVerdict | null> {
  const { client, userId, transactionId, txAmount } = args;
  try {
    const { data: links, error } = await client
      .from("bank_tx_invoices")
      .select("invoice_id, amount_applied")
      .eq("user_id", userId)
      .eq("transaction_id", transactionId);
    if (error) return null;
    const rows = (links ?? []) as Array<{ invoice_id: string; amount_applied: number | null }>;
    if (rows.length === 0) return null;

    // De facturen erbij, want allocatedOnLine heeft ze nodig: een koppeling met een NULL bedrag
    // stamt van vóór de kolom en heeft haar factuur VOLLEDIG voldaan, dus het eigen totaal van die
    // factuur is wat ze nam. NULL als 0 lezen maakt de regel rijker dan ze is.
    const invoices = await fetchAllRowsForIds<
      { id: string; direction: string | null; invoice_type: string | null; total_inc_btw: number | null },
      string
    >(rows.map((r) => r.invoice_id), (chunk, from, to) =>
      client
        .from("invoices")
        .select("id, direction, invoice_type, total_inc_btw")
        .in("id", chunk)
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const sum = allocatedOnLine(rows, invoices, txAmount);
    // Een zusterkoppeling waarvan de factuur onleesbaar is, is niet meetbaar — en een niet
    // meetbare som mag geen alarm slaan én geen stilte rechtvaardigen. Zelfde behandeling als
    // een leesfout: de controle heeft niet gedraaid.
    if (sum.unknownInvoiceIds.length > 0) return null;

    const lineAmount = Math.abs(Number(txAmount) || 0);
    return {
      appliedSum: round2(sum.allocated),
      lineAmount: round2(lineAmount),
      // Een cent marge, zoals de handgeschreven versie had: afrondingsstof is geen over-besteding.
      over: sum.allocated > lineAmount + 0.01,
    };
  } catch {
    return null;
  }
}

/** De zin die de eigenaar leest. Eén formulering, want twee deuren melden hetzelfde feit. */
export function overAppliedNotice(v: OverAppliedVerdict): { title: string; body: string } {
  return {
    title: "Controleer deze betaling",
    body:
      `Op een betaling van € ${v.lineAmount.toFixed(2)} is samen € ${v.appliedSum.toFixed(2)} aan ` +
      `facturen geboekt — dat is meer dan er binnenkwam. Ontkoppel de koppeling die niet klopt ` +
      `onder "Bevestigd".`,
  };
}
