// src/lib/mollie.ts
// [MOLLIE] Betaallinks via Mollie's Payment Links API — augustus 2026
//
// Twee soorten code in één bestand, met een scherpe grens ertussen:
//
//   · De PURE beslissers (mollieAmountValue, linkVerdict, linkIsStale) — geen I/O, exhaustief
//     getest in mollie.test.ts. Al het geld-oordeel zit hier: welk bedrag vragen we, wanneer is
//     een link verouderd, en wanneer mag een webhookbezoek een factuur betaald verklaren.
//
//   · De dunne HTTP-laag naar api.mollie.com/v2 (createMolliePaymentLink, getMolliePaymentLink,
//     validateMollieKey). Bewust dom: velden doorgeven, fouten benoemen, niets beslissen.
//
// HET VERIFICATIEMODEL, want dit is een geldpad ("لا 1%"):
// Een Mollie-webhook draagt geen handtekening. Mollie's eigen model is: het POST-lichaam is een
// DEURBEL, nooit een bewijs — de ontvanger haalt de bron zelf op, geauthenticeerd, en gelooft
// alleen wat hij zelf ophaalde. Onze webhook leest daarom uitsluitend zijn eigen opgeslagen
// pl_-id na bij Mollie (met de sleutel van de eigenaar) en geeft dat antwoord aan linkVerdict.
// Een aanvaller die het webhook-adres kent kan ons hoogstens laten NAKIJKEN — nooit laten boeken.
// Veldnamen en endpoints zijn geverifieerd tegen Mollie's eigen API-client
// (mollie/mollie-api-python: resources/payment_links.py — pad "payment-links", prefix "pl_",
// paidAt/amount/_links.paymentLink; auth "Authorization: Bearer <key>").

import { round2 } from "./invoice-totals";

// ── Pure beslissers ──────────────────────────────────────────────────────────────────────────────

/**
 * Een bedrag zoals Mollie het eist: string, exact twee decimalen, punt als scheider.
 * Weigert (null) wat geen positief eurobedrag is — een betaallink van €0,00 of van een
 * creditnota is geen betaalverzoek maar een vergissing.
 */
export function mollieAmountValue(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const r = round2(n);
  if (r <= 0) return null;
  return r.toFixed(2);
}

export interface FetchedPaymentLink {
  id: string;
  paidAt: string | null;
  amount: { currency: string; value: string } | null;
}

export type LinkVerdict =
  | { action: "mark_paid"; paidAt: string }
  | { action: "not_paid" }
  | { action: "refuse"; reason: string };

/**
 * Mag dit — door ONS bij Mollie opgehaalde — linkantwoord de factuur betaald verklaren?
 *
 * De faalrichting is overal WEIGEREN: een gemiste betaling wordt door de eigenaar gezien
 * (de factuur blijft open, de klant klaagt), maar een ten onrechte betaald verklaarde
 * factuur stopt de aanmaningen en verdwijnt geruisloos — dat is de onherstelbare kant.
 */
export function linkVerdict(fetched: FetchedPaymentLink, stored: { linkId: string; amountValue: string }): LinkVerdict {
  if (fetched.id !== stored.linkId) {
    return { action: "refuse", reason: "antwoord gaat over een andere link dan opgeslagen" };
  }
  if (!fetched.paidAt) return { action: "not_paid" };
  if (!fetched.amount || fetched.amount.currency !== "EUR") {
    return { action: "refuse", reason: "valuta ontbreekt of is geen EUR" };
  }
  if (fetched.amount.value !== stored.amountValue) {
    return { action: "refuse", reason: `bedrag wijkt af: link zegt ${fetched.amount.value}, vastgelegd is ${stored.amountValue}` };
  }
  return { action: "mark_paid", paidAt: fetched.paidAt };
}

/**
 * Is een eerder aangemaakte link nog het juiste betaalverzoek? Zodra het OPEN bedrag van de
 * factuur is veranderd (deelbetaling, creditering) vraagt de oude link te veel of te weinig —
 * dan wordt hij vervangen, nooit stilzwijgend hergebruikt.
 */
export function linkIsStale(storedAmountValue: string, currentOpenAmount: number): boolean {
  const current = mollieAmountValue(currentOpenAmount);
  return current === null || current !== storedAmountValue;
}

/**
 * [MOLLIE-C7-RACE] Hoe lang een placeholder-rij het voordeel van de twijfel krijgt.
 *
 * Ruim genomen, met opzet: de aanroep naar Mollie heeft geen eigen timeout, dus wat hem begrenst
 * is de request-timeout van het platform. Te KRAP kiezen verwijdert een rij waar op dat moment
 * nog een klant aan hangt; te ruim laat een écht gestrande rij twee minuten langer staan en de
 * klant ziet zolang "probeer het zo nog eens". Die twee fouten zijn niet elkaars gelijke.
 */
export const PLACEHOLDER_GRACE_MS = 2 * 60 * 1000;

/** Wat er met een gevonden placeholder-rij moet gebeuren. */
export type PlaceholderVerdict = "in_flight" | "stranded";

/**
 * Is deze placeholder-rij gestrand, of is er op dit moment iemand mee bezig?
 *
 * ── WAAROM DIT EEN VRAAG IS EN GEEN FEIT ──
 *
 * Een placeholder (link_id `pending-…`, lege checkout_url) is precies wat de aanmaakroute ZELF
 * neerzet vlak voordat hij Mollie belt. Tijdens die netwerkronde is de rij niet stuk — hij is in
 * gebruik. Toch werd elke placeholder als "halverwege gestrand" opgeruimd, en dat opruimen is een
 * DELETE.
 *
 * Wat er dan gebeurt, met twee tabbladen die tegelijk op "Betaal met iDEAL" drukken:
 *
 *   A zet zijn placeholder neer en belt Mollie.
 *   B vindt A's rij, noemt hem gestrand, en verwijdert hem.
 *   A komt terug van Mollie en werkt zijn rij bij — nul rijen geraakt, en PostgREST meldt daar
 *     geen fout over, dus A deelt zijn checkout-URL gewoon uit.
 *   De klant betaalt via die URL. Mollie belt de webhook met ?link=<A's rij-id>. Die rij bestaat
 *     niet meer, en de webhook antwoordt op een onbekende rij `ok: true` — waarna Mollie stopt
 *     met opnieuw proberen.
 *
 * De klant heeft betaald, de factuur staat open, en er is nergens een spoor. Dat is de duurste
 * vorm die "stil verkeerd" in dit product kan aannemen: niet een verkeerd bedrag, maar geld dat
 * binnen is en in de boekhouding niet bestaat.
 *
 * Merk op dat de route de tegenovergestelde lezing al kende: de 23505-tak zegt met zoveel woorden
 * dat een lege checkout_url betekent dat de winnaar zelf nog bezig is. Twee plekken lazen hetzelfde
 * teken en trokken de omgekeerde conclusie.
 *
 * Een rij zonder leesbare datum heet IN FLIGHT. Niet weten hoe oud iets is, is geen reden om het
 * weg te gooien — en dit is de kant waar de fout onherstelbaar is.
 */
export function placeholderVerdict(createdAt: unknown, now: Date): PlaceholderVerdict {
  const t = typeof createdAt === "string" || createdAt instanceof Date ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return "in_flight";
  const age = now.getTime() - t;
  // Een rij met een datum in de TOEKOMST (klokverschil tussen database en server) is ook geen
  // bewijs van stranding — negatieve leeftijd valt vanzelf onder de grens.
  return age > PLACEHOLDER_GRACE_MS ? "stranded" : "in_flight";
}

// ── HTTP-laag ────────────────────────────────────────────────────────────────────────────────────

const MOLLIE_API = "https://api.mollie.com/v2";

async function mollieFetch(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${MOLLIE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Werkt deze sleutel? Eén onschuldige lees-call; geen betaling, geen mutatie. */
export async function validateMollieKey(apiKey: string): Promise<boolean> {
  try {
    const res = await mollieFetch(apiKey, "/payment-links?limit=1");
    return res.ok;
  } catch {
    return false;
  }
}

export async function createMolliePaymentLink(
  apiKey: string,
  params: { amountValue: string; description: string; redirectUrl: string; webhookUrl: string },
): Promise<{ id: string; checkoutUrl: string } | { error: string }> {
  try {
    const res = await mollieFetch(apiKey, "/payment-links", {
      method: "POST",
      body: JSON.stringify({
        amount: { currency: "EUR", value: params.amountValue },
        description: params.description.slice(0, 250),
        redirectUrl: params.redirectUrl,
        webhookUrl: params.webhookUrl,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `Mollie weigerde de link (${res.status}): ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as {
      id?: string;
      _links?: { paymentLink?: { href?: string } };
    };
    const checkoutUrl = json._links?.paymentLink?.href;
    if (!json.id || !checkoutUrl) return { error: "Mollie-antwoord zonder id of paymentLink" };
    return { id: json.id, checkoutUrl };
  } catch (e) {
    return { error: `Mollie onbereikbaar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function getMolliePaymentLink(
  apiKey: string,
  linkId: string,
): Promise<FetchedPaymentLink | { error: string }> {
  try {
    const res = await mollieFetch(apiKey, `/payment-links/${encodeURIComponent(linkId)}`);
    if (!res.ok) return { error: `Mollie-link nalezen mislukt (${res.status})` };
    const json = (await res.json()) as {
      id?: string;
      paidAt?: string | null;
      amount?: { currency?: string; value?: string } | null;
    };
    if (!json.id) return { error: "Mollie-antwoord zonder id" };
    return {
      id: json.id,
      paidAt: json.paidAt ?? null,
      amount: json.amount?.currency && json.amount?.value
        ? { currency: json.amount.currency, value: json.amount.value }
        : null,
    };
  } catch (e) {
    return { error: `Mollie onbereikbaar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── [MOLLIE-AFREKENING] Settlements ─────────────────────────────────────────────────────────────
//
// Read-only. The settlement is the one document that carries the fee (a cost the app never saw)
// and explains the payout bank line. Every function answers `{ error }` rather than throwing, and
// an error is a reason to book NOTHING for that settlement — never a reason to guess.

import type { MollieSettlement, MollieSettlementPayment } from "./mollie-settlement";

type Page<T> = { items: T[]; next: string | null };

async function molliePage<T>(apiKey: string, path: string, key: string): Promise<Page<T> | { error: string }> {
  try {
    const res = await mollieFetch(apiKey, path);
    if (!res.ok) return { error: `Mollie ${path} antwoordde ${res.status}` };
    const json = (await res.json()) as { _embedded?: Record<string, T[]>; _links?: { next?: { href?: string } | null } };
    const items = json._embedded?.[key] ?? [];
    const nextHref = json._links?.next?.href ?? null;
    // Mollie's next link is absolute; keep only the path+query so mollieFetch can prefix it.
    const next = nextHref ? nextHref.replace(/^https?:\/\/[^/]+\/v2/, "") : null;
    return { items, next };
  } catch (e) {
    return { error: `Mollie onbereikbaar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Every page, bounded: a runaway pagination must not run a cron into its deadline. */
async function molliePages<T>(apiKey: string, path: string, key: string, maxPages = 20): Promise<T[] | { error: string }> {
  const out: T[] = [];
  let next: string | null = path;
  for (let i = 0; next && i < maxPages; i++) {
    const page: Page<T> | { error: string } = await molliePage<T>(apiKey, next, key);
    if ("error" in page) return page;
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

/** The most recent settlements, newest first, with their periods (the list carries them). */
export async function listMollieSettlements(apiKey: string, limit = 50): Promise<MollieSettlement[] | { error: string }> {
  return molliePages<MollieSettlement>(apiKey, `/settlements?limit=${Math.min(250, Math.max(1, limit))}`, "settlements", 4);
}

export async function getMollieSettlement(apiKey: string, settlementId: string): Promise<MollieSettlement | { error: string }> {
  try {
    const res = await mollieFetch(apiKey, `/settlements/${encodeURIComponent(settlementId)}`);
    if (!res.ok) return { error: `Mollie-afrekening nalezen mislukt (${res.status})` };
    const json = (await res.json()) as MollieSettlement;
    if (!json.id) return { error: "Mollie-antwoord zonder id" };
    return json;
  } catch (e) {
    return { error: `Mollie onbereikbaar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The payments a settlement paid out. */
export async function listMollieSettlementPayments(apiKey: string, settlementId: string): Promise<MollieSettlementPayment[] | { error: string }> {
  return molliePages<MollieSettlementPayment>(apiKey, `/settlements/${encodeURIComponent(settlementId)}/payments?limit=250`, "payments");
}

/** The payments made on one payment link — how a link (ours) maps to a payment (in a settlement). */
export async function listMolliePaymentLinkPayments(apiKey: string, linkId: string): Promise<MollieSettlementPayment[] | { error: string }> {
  return molliePages<MollieSettlementPayment>(apiKey, `/payment-links/${encodeURIComponent(linkId)}/payments?limit=250`, "payments", 2);
}
