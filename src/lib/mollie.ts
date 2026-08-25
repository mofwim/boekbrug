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
