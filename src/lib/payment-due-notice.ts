// src/lib/payment-due-notice.ts
// [BETAALHERINNERING] Wanneer een openstaande INKOOPfactuur de eigenaar iets moet zeggen, en wat.
//
// DE AANLEIDING, letterlijk: een factuur van € 1.165,73 met vervaldatum vandaag, en de eigenaar
// wist het niet — het scherm toonde hem netjes, maar een scherm dat je niet opent zegt niets. De
// app had één herinneringsmechanisme en dat wees de andere kant op: /api/cron/reminders maant de
// KLANT van een uitgaande factuur. Voor wat de ondernemer zelf moet betalen was er niets.
//
// ── WAAROM DIT GEEN "NAGGING" IS ──
// De ochtendmail stelt de regel van dit huis: "Standing state — open work, totals, streaks — is
// deliberately NOT an event. Nagging belongs nowhere, and standing state belongs on the dashboard."
// Die regel blijft staan, en deze module valt er niet onder. "Je hebt 12 openstaande facturen" is
// standing state. "Deze vervalt morgen" is een DATUM die een grens oversteekt — hij gebeurt op één
// dag, hij gebeurt één keer, en morgen is hij iets anders. Dat is een gebeurtenis.
//
// ── DE LADDER ──
// Drie treden, en niet meer. Eén tik is te laat voor wie iets moet regelen; vijf leert de eigenaar
// ze weg te vegen, en dan is de zesde — de enige die ertoe deed — ook weg. De treden zijn:
//
//   · OVER_DRIE_DAGEN — ruimte om het te regelen (geld klaarzetten, akkoord vragen);
//   · MORGEN          — de laatste avond waarop het nog kan;
//   · VANDAAG         — precies het geval uit de melding hierboven.
//
// Te LAAT staat er met opzet NIET bij. Dat is een ander bericht met een andere handeling (bellen,
// een regeling), en het hoort niet in een ladder die over "op tijd" gaat.
//
// ── DE LAATSTE BANKDAG, NIET DE LAATSTE KALENDERDAG ──
// Een Nederlandse bank verwerkt niet in het weekend. Een overboeking die op zaterdag vertrekt komt
// maandag aan — ná een vervaldatum van zondag. De ladder rekent daarom tegen de laatste BANKDAG:
// voor een vervaldatum in het weekend is dat de vrijdag ervoor. Zonder dat zou de "vandaag"-tik
// vallen op een dag waarop de eigenaar niets meer kán doen, wat precies de klacht is die deze
// module oplost, verplaatst naar het weekend.
//
// Feestdagen zitten er NIET in. Dat vraagt een kalender die per jaar onderhouden moet worden, en
// een dag te vroeg waarschuwen is goedkoop terwijl een verkeerde feestdagtabel duur is.
//
// Puur, en de klok wordt INGEGEVEN — `today` is de Amsterdamse dag van de aanroeper (format-nl.ts),
// nooit een klokleziing hier. Zelfde contract als auto-incasso.ts, en om dezelfde reden: de cron,
// het scherm en de test moeten tegen dezelfde dag oordelen.

/** One payable purchase invoice, as the ladder needs to see it. */
export interface PayableInvoice {
  id: string;
  /** The supplier — what the owner recognises the invoice by. */
  supplierName: string | null;
  invoiceNumber: string | null;
  /** ISO 'YYYY-MM-DD'. An invoice without one can never be on the ladder. */
  dueDate: string | null;
  amountIncBtw: number | null;
  /**
   * [AUTO-INCASSO] The supplier debits this one themselves — the "Automatisch" badge on the card.
   * Telling the owner to pay it is worse than saying nothing: the money leaves anyway, and a
   * second transfer is a real double payment they then have to claw back.
   */
  autoDebit: boolean;
}

/** How close the last banking day is. The order is the order of urgency. */
export type DueTier = "in_three_days" | "tomorrow" | "today";

export interface DueBucket {
  tier: DueTier;
  invoices: PayableInvoice[];
  totalIncBtw: number;
}

/** What one owner should be told today, or null when there is nothing. */
export interface DueNotice {
  tier: DueTier;
  title: string;
  body: string;
  /** The screen that can act on it. */
  link: string;
  /** Only the two urgent rungs earn a push; see pushWorthy. */
  push: boolean;
  invoiceIds: string[];
  totalIncBtw: number;
}

/** Noon UTC on an ISO day — far from every DST edge, so the weekday is never off by one. */
function noonUtc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The last day a transfer can LEAVE and still arrive by the due date.
 *
 * Saturday and Sunday are not banking days here, so a weekend due date moves back to the Friday.
 * Returns the due date itself for every ordinary weekday.
 */
export function lastBankingDay(dueDateIso: string): string | null {
  const d = noonUtc(dueDateIso);
  if (!d) return null;
  const day = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (day === 0) d.setUTCDate(d.getUTCDate() - 2);
  return isoOf(d);
}

/** Whole days from `from` to `to`, both ISO days. Negative when `to` is in the past. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = noonUtc(fromIso);
  const b = noonUtc(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Which rung this invoice is on today, or null when it is on none.
 *
 * Null covers every ordinary case: no due date, still far away, already past, or an invoice that
 * pays itself. Being on NO rung is the answer for almost every invoice on almost every day, and
 * that is the point — this ladder speaks rarely.
 */
export function tierFor(inv: PayableInvoice, today: string): DueTier | null {
  // [AUTO-INCASSO] Money that leaves by itself is not money to chase. First, because every other
  // check is irrelevant once this is true.
  if (inv.autoDebit) return null;
  if (!inv.dueDate) return null;
  const laatste = lastBankingDay(inv.dueDate);
  if (!laatste) return null;
  const over = daysBetween(today, laatste);
  if (over === null) return null;
  if (over === 0) return "today";
  if (over === 1) return "tomorrow";
  if (over === 3) return "in_three_days";
  // 2 days out says nothing: it sits between two rungs that both speak, and a tik on every one of
  // three consecutive days is how an owner learns to ignore all three.
  return null;
}

/** Only the rungs the owner can still act on tonight earn a push. */
export function pushWorthy(tier: DueTier): boolean {
  return tier === "today" || tier === "tomorrow";
}

const euro = (n: number): string =>
  `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The supplier as the owner reads it on the card, or an honest stand-in. */
function wie(inv: PayableInvoice): string {
  const naam = inv.supplierName?.trim();
  if (naam) return naam;
  const nummer = inv.invoiceNumber?.trim();
  return nummer ? `factuur ${nummer}` : "een factuur zonder afzender";
}

/**
 * Group today's payable invoices onto the ladder.
 *
 * Deliberately returns the buckets rather than the messages, so the caller can decide what to do
 * with each rung and the wording lives in one place below.
 */
export function bucketsFor(invoices: readonly PayableInvoice[], today: string): DueBucket[] {
  const byTier = new Map<DueTier, PayableInvoice[]>();
  for (const inv of invoices) {
    const tier = tierFor(inv, today);
    if (!tier) continue;
    byTier.set(tier, [...(byTier.get(tier) ?? []), inv]);
  }
  // Urgency order, so a caller that sends only one sends the sharpest.
  const order: DueTier[] = ["today", "tomorrow", "in_three_days"];
  return order
    .filter((t) => (byTier.get(t)?.length ?? 0) > 0)
    .map((tier) => {
      const list = (byTier.get(tier) ?? []).slice().sort((a, b) => {
        const va = Math.abs(Number(b.amountIncBtw) || 0) - Math.abs(Number(a.amountIncBtw) || 0);
        return va !== 0 ? va : a.id < b.id ? -1 : 1; // largest first, id breaks the tie
      });
      const total = list.reduce((s, i) => s + Math.abs(Number(i.amountIncBtw) || 0), 0);
      return { tier, invoices: list, totalIncBtw: total };
    });
}

/** How many suppliers a message names before it turns into a wall of text. */
const NAMES_IN_BODY = 3;

/**
 * The message for one rung. Dutch, because a notification is stored as one string in the source
 * language — the same rule every other notification in this app follows ([TAAL-DB]).
 *
 * The AMOUNT and the SUPPLIER are in the title on purpose. A title that says "1 factuur vervalt
 * vandaag" makes the owner open the app to find out whether it matters; "€ 1.165,73 aan CAN
 * Vleesgroothandel" is the same length and already answers it.
 */
export function noticeFor(bucket: DueBucket): DueNotice {
  const n = bucket.invoices.length;
  const bedrag = euro(bucket.totalIncBtw);
  const eerste = bucket.invoices[0];

  const wanneer =
    bucket.tier === "today" ? "vandaag" : bucket.tier === "tomorrow" ? "morgen" : "over 3 dagen";

  const title =
    n === 1
      ? `${bedrag} aan ${wie(eerste)} — ${wanneer} de laatste dag`
      : `${bedrag} aan ${n} facturen — ${wanneer} de laatste dag`;

  const namen = bucket.invoices.slice(0, NAMES_IN_BODY).map((i) => `${wie(i)} (${euro(Math.abs(Number(i.amountIncBtw) || 0))})`);
  const rest = n - namen.length;
  const lijst = rest > 0 ? `${namen.join(", ")} en nog ${rest}` : namen.join(", ");

  // Waarom de zin het WEEKEND noemt: als de vervaldatum zaterdag of zondag is, is vandaag de
  // laatste dag waarop een overboeking nog op tijd aankomt — en dat is niet af te lezen aan de
  // datum op de factuur. Zonder deze zin lijkt de melding een dag te vroeg.
  const weekendUitleg =
    bucket.tier === "today" && bucket.invoices.some((i) => i.dueDate && lastBankingDay(i.dueDate) !== i.dueDate.slice(0, 10))
      ? " De vervaldatum valt in het weekend, dus een overboeking vandaag is de laatste die op tijd aankomt."
      : "";

  const staart =
    bucket.tier === "today"
      ? "Betaal je vandaag, dan is hij op tijd."
      : bucket.tier === "tomorrow"
        ? "Morgen is de laatste dag."
        : "Je hebt nog even, maar dan weet je het.";

  return {
    tier: bucket.tier,
    title,
    body: `${lijst}. ${staart}${weekendUitleg}`,
    // Naar de lijst waar hij ze kan afvinken, niet naar een algemeen scherm: een melding die je
    // op een dashboard afzet laat je zelf zoeken welke factuur ze bedoelde.
    link: "/dashboard/vandaag",
    push: pushWorthy(bucket.tier),
    invoiceIds: bucket.invoices.map((i) => i.id),
    totalIncBtw: bucket.totalIncBtw,
  };
}

/** Everything one owner should hear today, sharpest first. Empty on almost every day. */
export function noticesFor(invoices: readonly PayableInvoice[], today: string): DueNotice[] {
  return bucketsFor(invoices, today).map(noticeFor);
}
