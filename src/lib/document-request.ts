// src/lib/document-request.ts
// [OPVRAGEN] The accountant asks their client for what is still missing. Pure, no I/O.
// Run: npx tsx --test src/lib/document-request.test.ts
//
// WHY THIS IS A MODULE AND NOT A TEMPLATE STRING IN A ROUTE
//
// Chasing paperwork is the single biggest drain on a bookkeeper's month, and it is almost always
// done badly: a WhatsApp saying "kun je de rest nog sturen?" that the client cannot act on because
// they do not know what "the rest" is. The whole value here is that BoekBrug already knows the
// gaps — the readiness report lists them — so the request can be specific. Specific is the feature.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM
//
// It never says "then your quarter is complete". The app cannot know that, and readiness.ts says
// so in its own notes: a receipt the client never uploaded is invisible to us. A request that
// implies completeness turns an honest checklist into a promise we cannot keep, and the client
// would rightly hold us to it at the moment the Belastingdienst disagrees.
//
// IT IS ALSO NOT A CLAIM ABOUT WHO IS AT FAULT. The text asks, it does not accuse. The client is
// not late for us; they are busy, and the reason this product exists is that bookkeeping is not
// their job.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). The produced TEXT is Dutch —
// it is read by a Dutch entrepreneur, and it is the whole output of this file.

/** One thing being asked for. `title` comes from ReadinessItem; `detail` is its subtitle. */
export interface RequestItem {
  title: string;
  detail?: string | null;
}

export interface RequestInput {
  items: readonly RequestItem[];
  /** "Q2 2026" — as readiness.ts formats it. */
  quarterLabel: string;
  /** How the accountant is called. Appears as the sender, so it must be a real name. */
  accountantName: string;
  /** A sentence the accountant typed themselves. Optional, and it goes FIRST — it is the human part. */
  extra?: string | null;
}

export type RequestResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * How many items may be listed.
 *
 * Twelve, and this is a real limit rather than a technical one. A request with twenty bullet
 * points is not a request, it is a shrug — the client reads the first three and closes it. If a
 * quarter genuinely has more gaps than this, the honest move is a phone call, and the message
 * says so instead of scrolling.
 */
export const MAX_ITEMS = 12;

/** The ceiling on the whole message. messages.content is text, so this is about readability. */
export const MAX_LENGTH = 2000;

/** The accountant's own sentence cannot be a whole letter. */
export const MAX_EXTRA = 600;

/**
 * Build the request, or refuse with a reason the accountant can act on.
 *
 * Refuses rather than sending something empty: a message that says only "je boekhouder vraagt om
 * stukken" without naming any is exactly the useless WhatsApp this feature replaces.
 */
export function buildDocumentRequest(input: RequestInput): RequestResult {
  const naam = (input.accountantName || "").trim();
  const kwartaal = (input.quarterLabel || "").trim();
  const extra = (input.extra || "").trim();

  if (!naam) return { ok: false, reason: "De naam van de boekhouder ontbreekt." };
  if (!kwartaal) return { ok: false, reason: "Het kwartaal ontbreekt." };
  if (extra.length > MAX_EXTRA) {
    return { ok: false, reason: `Je eigen bericht mag hoogstens ${MAX_EXTRA} tekens zijn.` };
  }

  // Dedupe on the visible title. Two readiness dimensions can name the same gap (a missing receipt
  // shows up under both invoices and bank), and asking twice for one thing makes the whole list
  // look automated — which is the moment a client stops reading it.
  const gezien = new Set<string>();
  const schoon: RequestItem[] = [];
  for (const item of input.items) {
    const titel = (item.title || "").trim();
    if (!titel) continue;
    const sleutel = titel.toLowerCase();
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    schoon.push({ title: titel, detail: (item.detail || "").trim() || null });
  }

  if (schoon.length === 0 && !extra) {
    return { ok: false, reason: "Kies minstens één punt, of schrijf zelf een zin." };
  }
  if (schoon.length > MAX_ITEMS) {
    return {
      ok: false,
      reason: `Dit zijn er ${schoon.length}. Meer dan ${MAX_ITEMS} punten leest niemand — kies de belangrijkste, of bel even.`,
    };
  }

  const regels: string[] = [];
  regels.push(`Hoi,`);
  regels.push("");
  regels.push(
    schoon.length > 0
      ? `Voor ${kwartaal} mis ik nog een paar dingen. Zodra ik ze heb, kan ik verder.`
      : `Een vraag over ${kwartaal}.`,
  );

  // De eigen zin van de boekhouder staat vóór de lijst. Hij is het menselijke deel van het
  // bericht, en een lijst die daarboven staat leest als een automatische herinnering.
  if (extra) {
    regels.push("");
    regels.push(extra);
  }

  if (schoon.length > 0) {
    regels.push("");
    for (const item of schoon) {
      regels.push(item.detail ? `• ${item.title} — ${item.detail}` : `• ${item.title}`);
    }
    regels.push("");
    // [OPVRAGEN-EERLIJK] De zin die niet weg mag. Zie de kop: dit is een lijst van wat de app KAN
    // zien, en de app ziet geen bon die nooit is geüpload. "Dan zijn we klaar" zou een belofte zijn
    // die precies op het verkeerde moment breekt.
    regels.push(
      "Dit is wat ik in BoekBrug zie ontbreken. Heb je nog iets anders van dit kwartaal liggen, stuur het gerust mee — wat er niet in staat, kan ik ook niet zien.",
    );
  }

  regels.push("");
  regels.push(`Groet,`);
  regels.push(naam);

  const tekst = regels.join("\n").trim();
  if (tekst.length > MAX_LENGTH) {
    return { ok: false, reason: "Het bericht is te lang geworden. Kort je eigen zin wat in." };
  }
  return { ok: true, text: tekst };
}

/**
 * The one-line preview for a notification and an e-mail subject.
 *
 * Says the NUMBER, because that is the fact that decides whether the client opens it now or
 * tonight. "Je boekhouder heeft een bericht" decides nothing.
 */
export function requestSummary(itemCount: number, quarterLabel: string): string {
  if (itemCount <= 0) return `Vraag over ${quarterLabel}`;
  if (itemCount === 1) return `Je boekhouder mist nog 1 ding voor ${quarterLabel}`;
  return `Je boekhouder mist nog ${itemCount} dingen voor ${quarterLabel}`;
}
