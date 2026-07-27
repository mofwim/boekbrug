// src/lib/invoice-removal.ts
// [INVOICE-REMOVE] What happens when the owner taps "Verwijderen" on an invoice — decided ONCE,
// in one pure function, so the button, the confirmation dialog and the API route can never
// disagree about what is about to happen. NO I/O.
//
// The honest starting point: an invoice added by mistake must be removable. The owner is right
// about that — a wrong invoice in the books is worse than no invoice. But "removable" is not
// "gone":
//
//   · Bewaarplicht (art. 52 AWR) — a bookkeeping record is kept SEVEN YEARS. So removal is an
//     ARCHIVE (status 'archived'), never a physical delete. Every financial surface in this app
//     works from an allow-list ('paid'/'sent'/'overdue' out, 'paid'/'received' in), so an
//     archived invoice leaves omzet, kosten, BTW, debiteuren, aanmaningen, de bank-matcher, de
//     betaallink en de boekhouder in one move — while the row, its PDF and its number stay.
//   · A DRAFT is not a bookkeeping record at all. It never had a legal number and never left the
//     building, so it is deleted for real (that is today's behaviour and it stays).
//   · MONEY makes it irreversible. Once anything is paid — status 'paid' OR a deelbetaling on an
//     otherwise open invoice — archiving would hide euros that genuinely moved, from every ledger
//     that must show them. Refused, with the correct instrument named instead: a creditnota for a
//     sale, or undoing the payment first.
//   · The ACCOUNTANT's lock ('verwerkt') outranks the owner's tap, exactly as it does everywhere
//     else in this app.
//
// The one judgement call this function cannot make for the owner: was the invoice really SENT to
// the customer? A sent sales invoice belongs in a doorlopende nummering, and the legal correction
// is a creditnota — but an invoice created by mistake and never sent is precisely what this
// button is for. So that case archives, with the choice spelled out and the creditnota offered
// next to it. We say it; the owner decides.

export type RemovalMode =
  | "delete" // a concept / offerte — never a bookkeeping record, really deleted
  | "archive" // the normal case — out of every ledger, kept 7 years, reversible
  | "creditnota" // a paid sale — the legal correction, not a removal
  | "blocked" // money moved or the accountant locked it — name the way out
  | "restore"; // already archived — put it back

export interface RemovalInvoice {
  status?: string | null;
  invoice_type?: string | null;
  direction?: string | null;
  invoice_number?: string | null;
  amount_paid?: number | null;
  total_inc_btw?: number | null;
  accountant_status?: string | null;
  /** Set when a creditnota replaced this invoice (BOEK-031) — it can never come back. */
  replaced_by_number?: string | null;
}

/** What the dialog offers next to "Annuleren" when the answer is not a plain yes. */
export interface RemovalAlternative {
  kind: "creditnota" | "undo-payment" | "ask-accountant";
  label: string;
}

export interface RemovalDecision {
  mode: RemovalMode;
  /** May the confirm button actually perform something? False for 'blocked'. */
  allowed: boolean;
  title: string;
  /** What will happen, in plain Dutch. Always the truth, never a euphemism. */
  body: string;
  /** The consequence the owner must weigh before tapping. */
  warning?: string;
  confirmLabel: string;
  alternative?: RemovalAlternative;
}

const CENT = 0.005;

/** Has any money been settled against this invoice? Status OR a running deelbetaling. */
export function hasSettledMoney(inv: RemovalInvoice): boolean {
  if ((inv.status ?? "") === "paid") return true;
  return Math.max(0, Number(inv.amount_paid ?? 0)) > CENT;
}

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

/** "factuur 20260041" / "deze factuur" — the subject of every sentence below. */
function subject(inv: RemovalInvoice): string {
  const type =
    inv.invoice_type === "creditnota"
      ? "creditnota"
      : inv.invoice_type === "pro_forma" || inv.invoice_type === "offerte"
        ? "offerte"
        : (inv.direction ?? "") === "incoming"
          ? "inkoopfactuur"
          : "factuur";
  const nr = (inv.invoice_number ?? "").trim();
  return nr ? `${type} ${nr}` : `deze ${type}`;
}

/** The sentence that must be under every archive: it is kept, and it can come back. */
const KEPT = "Hij blijft bewaard (7 jaar bewaarplicht) en je kunt hem terugzetten.";

export function decideRemoval(inv: RemovalInvoice): RemovalDecision {
  const status = inv.status ?? "";
  const type = inv.invoice_type ?? "factuur";
  const incoming = (inv.direction ?? "") === "incoming";
  const isCredit = type === "creditnota";
  const isOfferte = type === "pro_forma" || type === "offerte";
  const what = subject(inv);

  // ── Already archived → the way back ────────────────────────────────────────────────────────
  if (status === "archived") {
    if (inv.replaced_by_number) {
      return {
        mode: "blocked",
        allowed: false,
        title: "Deze factuur is vervangen",
        body: `Er is een creditnota (${inv.replaced_by_number}) voor ${what} gemaakt. De correctie staat al in je boekhouding — terugzetten zou de omzet dubbel laten meetellen.`,
        confirmLabel: "Sluiten",
      };
    }
    return {
      mode: "restore",
      allowed: true,
      title: "Terugzetten?",
      body: `${what.charAt(0).toUpperCase() + what.slice(1)} komt terug in je lijst en telt weer mee in je cijfers vanaf de factuurdatum.`,
      warning: incoming
        ? "Een teruggezette inkoopfactuur gaat eerst terug naar de controlewachtrij."
        : undefined,
      confirmLabel: "Ja, terugzetten",
    };
  }

  // ── The accountant's lock outranks everything ──────────────────────────────────────────────
  if (inv.accountant_status === "verwerkt") {
    return {
      mode: "blocked",
      allowed: false,
      title: "Je boekhouder heeft deze factuur verwerkt",
      body: `${what.charAt(0).toUpperCase() + what.slice(1)} is al verwerkt in de administratie. Verwijderen zou een cijfer veranderen waar je boekhouder al mee heeft gerekend.`,
      warning: "Vraag je boekhouder om de verwerking eerst ongedaan te maken.",
      confirmLabel: "Sluiten",
      alternative: { kind: "ask-accountant", label: "Vraag je boekhouder" },
    };
  }

  // ── [ISSUED-STAYS] An OUTGOING invoice that has been issued is never removed ───────────────
  // The owner's rule, and the law's: a verkoopfactuur carries a number from a doorlopende reeks
  // (art. 35 Wet OB). Taking one out of the books leaves a hole in that sequence that nothing in
  // the administration explains — and a hole is exactly what an auditor looks for. So an issued
  // sales invoice is corrected, never removed: a creditnota books the reversal, keeps its own
  // number, and leaves both documents standing.
  //
  // This sits ABOVE the money check on purpose: the answer is the same whether the invoice was
  // paid or not, and naming the sequence is the honest reason. A concept and an offerte fall
  // through (they were never issued — see below), and an incoming invoice is untouched by this:
  // a supplier's invoice carries the SUPPLIER's number, never ours, so removing one breaks no
  // sequence of ours. That asymmetry is the whole point.
  if (!incoming && !isOfferte && status !== "draft") {
    const isFactuur = !isCredit;
    return {
      mode: isFactuur ? "creditnota" : "blocked",
      allowed: false,
      title: isFactuur ? "Een verstuurde factuur wordt gecrediteerd" : "Een creditnota blijft staan",
      body: isFactuur
        ? `${what.charAt(0).toUpperCase() + what.slice(1)} heeft een factuurnummer uit je doorlopende reeks. Die reeks mag geen gat hebben — dus een verstuurde factuur haal je niet weg, je corrigeert hem met een creditnota. Die boekt het bedrag terug en beide documenten blijven zichtbaar.`
        : `${what.charAt(0).toUpperCase() + what.slice(1)} is zelf al een correctie, met een eigen nummer uit je doorlopende reeks. Weghalen zou een gat achterlaten én de oorspronkelijke factuur weer als openstaand laten tellen.`,
      warning: isFactuur
        ? "Is deze factuur per ongeluk aangemaakt en nooit verstuurd? Neem dan contact op — dit lossen we per geval op, zodat je nummering klopt."
        : undefined,
      confirmLabel: isFactuur ? "Creditnota maken" : "Sluiten",
      ...(isFactuur ? { alternative: { kind: "creditnota" as const, label: "Creditnota maken" } } : {}),
    };
  }

  // ── Money moved → never hide it ────────────────────────────────────────────────────────────
  if (hasSettledMoney(inv)) {
    const paid = Math.max(0, Number(inv.amount_paid ?? 0));
    const total = Math.abs(Number(inv.total_inc_btw ?? 0));
    const partly = status !== "paid" && paid > CENT;
    const moneyLine = partly
      ? `Er is al ${eur.format(paid)} van ${eur.format(total)} betaald.`
      : "Deze factuur is betaald.";

    if (!incoming && !isCredit && !isOfferte) {
      return {
        mode: "creditnota",
        allowed: false,
        title: "Een betaalde factuur wordt gecrediteerd",
        body: `${moneyLine} Betaalde omzet mag niet uit je boekhouding verdwijnen — de wettelijke correctie is een creditnota, die het bedrag netjes terugboekt en zichtbaar blijft voor de Belastingdienst.`,
        warning: partly
          ? "Wil je deze factuur toch weghalen? Draai dan eerst de betaling terug."
          : undefined,
        confirmLabel: "Creditnota maken",
        alternative: { kind: "creditnota", label: "Creditnota maken" },
      };
    }
    return {
      mode: "blocked",
      allowed: false,
      title: "Er is al betaald",
      body: `${moneyLine} Zolang die betaling geboekt staat, kan ${what} niet weg — het geld zou uit je kas- en bankoverzicht verdwijnen terwijl het echt is verplaatst.`,
      warning: "Draai eerst de betaling terug (Ontkoppelen op de Bank-pagina of de Betaald-knop), daarna kun je hem verwijderen.",
      confirmLabel: "Sluiten",
      alternative: { kind: "undo-payment", label: "Betaling terugdraaien" },
    };
  }

  // ── Never a bookkeeping record → really delete ─────────────────────────────────────────────
  // A concept has no legal number and never left the building; an offerte is not a factuur at
  // all. Both may be deleted for real — that is the rule this app already had.
  if (!incoming && (status === "draft" || isOfferte)) {
    return {
      mode: "delete",
      allowed: true,
      title: isOfferte ? "Offerte verwijderen?" : "Concept verwijderen?",
      body: isOfferte
        ? `${what.charAt(0).toUpperCase() + what.slice(1)} wordt definitief verwijderd. Een offerte is geen factuur — er verandert niets aan je omzet of BTW.`
        : `Dit concept is nooit verstuurd en telt nergens in mee. Het wordt definitief verwijderd.`,
      warning: "Dit kan niet ongedaan worden gemaakt.",
      confirmLabel: "Definitief verwijderen",
    };
  }

  // ── The normal case: archive ───────────────────────────────────────────────────────────────
  if (incoming) {
    return {
      mode: "archive",
      allowed: true,
      title: "Inkoopfactuur verwijderen?",
      body: `${what.charAt(0).toUpperCase() + what.slice(1)} verdwijnt uit je lijst en telt niet meer mee in je kosten en voorbelasting. ${KEPT}`,
      warning:
        "Is deze factuur echt van jou en al betaald? Verwijder hem dan niet — dan mis je de voorbelasting.",
      confirmLabel: "Ja, verwijderen",
    };
  }

  if (isCredit) {
    return {
      mode: "archive",
      allowed: true,
      title: "Creditnota verwijderen?",
      body: `${what.charAt(0).toUpperCase() + what.slice(1)} verdwijnt uit je lijst en de terugboeking telt niet meer mee in je omzet en BTW. ${KEPT}`,
      warning:
        "De oorspronkelijke factuur telt daarna weer als openstaand en wordt weer aangemaand.",
      confirmLabel: "Ja, verwijderen",
    };
  }

  // sent / overdue / processing — an issued sales invoice.
  return {
    mode: "archive",
    allowed: true,
    title: "Factuur verwijderen?",
    body: `${what.charAt(0).toUpperCase() + what.slice(1)} verdwijnt uit je lijst, telt niet meer mee in je omzet en BTW, en wordt niet meer aangemaand. ${KEPT}`,
    warning:
      "Heb je deze factuur al naar je klant gestuurd? Dan hoort er een creditnota bij — je factuurnummers moeten doorlopen. Is hij per ongeluk aangemaakt en nooit verstuurd? Dan is verwijderen precies goed.",
    confirmLabel: "Ja, verwijderen",
    alternative: { kind: "creditnota", label: "Liever een creditnota" },
  };
}

/**
 * The server's own answer to the same question — it never trusts the client's mode. Returns null
 * when the archive may proceed, or the machine-readable reason to refuse.
 */
export type ArchiveRefusal =
  | "verwerkt"
  | "money_settled"
  | "already_archived"
  | "issued_sales_invoice"
  | "not_archivable";

export function refuseArchive(inv: RemovalInvoice): ArchiveRefusal | null {
  if ((inv.status ?? "") === "archived") return "already_archived";
  if (inv.accountant_status === "verwerkt") return "verwerkt";
  // [ISSUED-STAYS] The route is a public API; the rule above must hold here too, not only in the
  // dialog. An issued sales invoice is corrected with a creditnota — never taken out of the
  // doorlopende nummering.
  if ((inv.direction ?? "") !== "incoming") return "issued_sales_invoice";
  if (hasSettledMoney(inv)) return "money_settled";
  // Everything that is a real, unpaid PURCHASE record may be archived. A draft goes through the
  // delete path instead (it is not archived — it never existed as a record).
  const ok = new Set(["processing", "received"]);
  return ok.has(inv.status ?? "") ? null : "not_archivable";
}

/**
 * Where an archived invoice goes when it is restored. There is no stored "previous status" and
 * inventing one would be a guess, so it is DERIVED from what the row itself proves:
 *   · incoming → the verification queue ('processing'), never straight to 'received': restoring
 *     must not push an unverified purchase invoice to the accountant (shared = true). Same rule
 *     the ignore/restore flow has always used.
 *   · outgoing WITH an invoice number → it was issued: back to 'sent'.
 *   · outgoing WITHOUT a number → it never got one, so it can only have been a concept.
 */
export function restoreStatus(inv: RemovalInvoice): "processing" | "sent" | "draft" {
  if ((inv.direction ?? "") === "incoming") return "processing";
  return (inv.invoice_number ?? "").trim() ? "sent" : "draft";
}
