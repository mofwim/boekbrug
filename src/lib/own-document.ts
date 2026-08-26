// src/lib/own-document.ts
// [EIGEN-FACTUUR] Is this "purchase invoice" actually the owner's OWN invoice? Pure, no I/O.
// Run: npx tsx --test src/lib/own-document.test.ts
//
// ── WHAT HAPPENS WITHOUT THIS ──
//
// Kiwi Food Market invoices Stichting Contour de Twern for €394,99 and the copy lands back in the
// mailbox the app reads. It is a PDF with an invoice number, a date, a BTW breakdown and two
// parties — everything a purchase invoice has — so it was read as one and booked as a cost.
//
// That is not an untidy row. It is wrong twice over, in opposite directions:
//
//   · the €362,38 is turnover the owner EARNED, now also standing as a cost, so the profit is
//     understated by the full amount of a sale that already counts once;
//   · and the €32,61 is BTW the owner OWES, now claimed as VOORBELASTING. On the aangifte the
//     same tax is both payable and deductible — a €65 swing on one document, in the direction the
//     Belastingdienst charges interest on.
//
// Neither shows up as a contradiction anywhere. Both numbers are real, both are on a real
// document, and every total that uses them adds up.
//
// ── WHY THE EMAIL ADDRESS CANNOT ANSWER IT ──
//
// email-integration.ts already has an [OWN-SENT] guard: skip a message the owner SENT (from ==
// owner) unless the owner is also a RECIPIENT — because that second case is a supplier invoice
// forwarded to oneself, which must be kept.
//
// A self-copied outgoing invoice is that second case exactly. From the envelope the two are the
// same message, and no amount of header reading separates them.
//
// ── WHAT DOES ANSWER IT ──
//
// The document. A purchase invoice whose SUPPLIER is you cannot exist. The KVK number, the BTW
// number and the payee IBAN each identify one business, and the app already knows the owner's
// three from their profile — the reader is even told the owner's IBAN so the model does not
// mistake it for the vendor's.
//
// So this module compares what was read against who the owner is, and says so.

/** The owner, from their profile. Any field may be missing on a half-filled account. */
export interface OwnIdentity {
  companyName?: string | null;
  fullName?: string | null;
  kvkNumber?: string | null;
  btwNumber?: string | null;
  iban?: string | null;
}

/** The supplier side of what the reader extracted. */
export interface ReadSupplier {
  vendorName?: string | null;
  kvkNumber?: string | null;
  btwNumber?: string | null;
  vendorIban?: string | null;
}

export type OwnDocumentVerdict = {
  /** True when the document names the owner as the SUPPLIER. */
  isOwn: boolean;
  /**
   * `certain` — a registration number or bank account that belongs to exactly one business.
   * `likely`  — only the name matched, and names collide.
   * `no`      — nothing matched, or there was nothing to match against.
   */
  certainty: "certain" | "likely" | "no";
  /** Owner-facing Dutch, one clause per matching fact. Empty when isOwn is false. */
  reasons: string[];
};

/** Digits only — a KVK is written "12 34 56 78", "12345678", sometimes "KVK 1234.5678". */
const digits = (s: unknown): string => String(s ?? "").replace(/\D+/g, "");

/** Upper-cased, stripped of spaces and dots. NL 8199.35.762.B01 → NL819935762B01. */
const compact = (s: unknown): string => String(s ?? "").toUpperCase().replace(/[\s.\-]+/g, "");

/**
 * A company name, reduced to what is actually the name.
 *
 * Legal forms are dropped because they are noise for this comparison: an owner whose profile says
 * "Kiwi Food Market" and an invoice header that says "Kiwi Food Market B.V." are the same shop.
 * Punctuation and case go the same way. What is left has to match ENTIRELY — a substring rule
 * would make "Bakkerij Saada" match "Bakkerij Saada Groothandel", which is a different business.
 */
export function normalizeCompanyName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|eenmanszaak|holding|group|groep)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does this document name the owner as its supplier?
 *
 * Deliberately asymmetric about evidence. A registration number or an IBAN is issued to ONE
 * business, so a match there is a fact and the verdict is `certain`. A name is not: two florists
 * called "De Bloemenhoek" exist, so a name-only match is `likely` and the caller must ask rather
 * than decide. Refusing a real supplier invoice is its own kind of damage — the cost goes
 * unbooked and the voorbelasting unclaimed — so certainty has to be earned.
 *
 * Empty fields never match. An owner who has not filled in their KVK yet, and a document the
 * reader could not find one on, are not the same business because both are blank.
 */
export function looksLikeOwnDocument(doc: ReadSupplier, me: OwnIdentity): OwnDocumentVerdict {
  const reasons: string[] = [];
  let certain = false;

  const myKvk = digits(me.kvkNumber);
  const docKvk = digits(doc.kvkNumber);
  if (myKvk.length >= 8 && myKvk === docKvk) {
    certain = true;
    reasons.push(`het KVK-nummer op dit stuk (${docKvk}) is jouw eigen KVK-nummer`);
  }

  const myBtw = compact(me.btwNumber);
  const docBtw = compact(doc.btwNumber);
  if (myBtw.length >= 12 && myBtw === docBtw) {
    certain = true;
    reasons.push(`het BTW-nummer op dit stuk (${docBtw}) is jouw eigen BTW-nummer`);
  }

  // The payee account. On a purchase invoice this is where YOUR money goes; if it is your own
  // account, the document is asking you to pay yourself.
  const myIban = compact(me.iban);
  const docIban = compact(doc.vendorIban);
  if (myIban.length >= 15 && myIban === docIban) {
    certain = true;
    reasons.push("het rekeningnummer om naar over te maken is jouw eigen IBAN");
  }

  const myName = normalizeCompanyName(me.companyName) || normalizeCompanyName(me.fullName);
  const docName = normalizeCompanyName(doc.vendorName);
  const nameMatch = myName.length >= 3 && myName === docName;
  if (nameMatch) {
    reasons.push(`de afzender heet hetzelfde als jouw bedrijf (${String(doc.vendorName).trim()})`);
  }

  if (certain) return { isOwn: true, certainty: "certain", reasons };
  if (nameMatch) return { isOwn: true, certainty: "likely", reasons };
  return { isOwn: false, certainty: "no", reasons: [] };
}

// ── [EIGEN-NUMMER] The invoice number the app itself issued ──
//
// The identity guard above inspects the extracted VENDOR fields — and the measured miss is
// exactly the case where the reader assigned the roles wrong: on the owner's own invoice it named
// the CUSTOMER (Stichting Contour de Twern) as the vendor, so nothing the owner is matched
// anything the reader returned, and the guard never saw the owner at all.
//
// But the app WROTE this document. It knows the invoice number it issued, the client it billed
// and the total it printed — so intake can recognise its own work without trusting the reader's
// role assignment. The number ALONE is not proof: half the country numbers its invoices
// "20260001, 20260002, …", so a real supplier invoice can collide with an own number. The number
// plus ONE corroborating fact from the same stored row is:
//
//   · the same total, to the cent-ish — a stranger's invoice sharing both number AND amount is
//     not a coincidence that occurs;
//   · or the "vendor" the reader saw is the CLIENT on the own invoice — which is precisely the
//     role-confusion signature that defeats the identity guard.

/** The owner's own stored outgoing invoice, as the lookup found it by number. */
export interface OwnOutgoingInvoiceRef {
  invoiceNumber?: string | null;
  totalIncBtw?: number | null;
  clientName?: string | null;
}

/**
 * Is this "purchase invoice" the owner's own outgoing invoice, recognised by its NUMBER?
 *
 * `own` is the row the caller already looked up BY this document's extracted number, so the
 * numbers should match by construction — it is still re-verified here so the function stands on
 * its own and a sloppy lookup cannot manufacture a verdict.
 */
export function matchesOwnInvoiceNumber(
  read: { invoiceNumber?: string | null; totalIncBtw?: number | null; vendorName?: string | null },
  own: OwnOutgoingInvoiceRef,
): OwnDocumentVerdict {
  const readNr = compact(read.invoiceNumber);
  const ownNr = compact(own.invoiceNumber);
  // Under 3 characters is not an invoice number, it is a digit that happens to be on a page.
  if (readNr.length < 3 || readNr !== ownNr) return { isOwn: false, certainty: "no", reasons: [] };

  const readTotal = Number(read.totalIncBtw);
  const ownTotal = Number(own.totalIncBtw);
  // Absolute values: the reader reports a positive amount even when the stored creditnota is
  // negative — the money is the same money.
  const amountMatch =
    Number.isFinite(readTotal) && Number.isFinite(ownTotal) && ownTotal !== 0 &&
    Math.abs(Math.abs(readTotal) - Math.abs(ownTotal)) <= 0.02;

  const readVendor = normalizeCompanyName(read.vendorName);
  const ownClient = normalizeCompanyName(own.clientName);
  const roleConfusion = readVendor.length >= 3 && readVendor === ownClient;

  if (!amountMatch && !roleConfusion) return { isOwn: false, certainty: "no", reasons: [] };

  const reasons = [
    `factuurnummer ${String(own.invoiceNumber).trim()} is het nummer van je eigen verkoopfactuur` +
      (own.clientName ? ` aan ${String(own.clientName).trim()}` : ""),
  ];
  if (amountMatch) reasons.push("het totaalbedrag is hetzelfde als op die factuur");
  if (roleConfusion) {
    reasons.push(`de "leverancier" op dit stuk (${String(read.vendorName).trim()}) is de klant op die factuur`);
  }
  // Same asymmetry as the identity guard: number + the same money is a fact; number + a matching
  // NAME without the money agreeing is `likely` — a customer who also supplies you can collide on
  // a number, and the likely-notice offers the owner the way back in ("alsnog inlezen").
  return { isOwn: true, certainty: amountMatch ? "certain" : "likely", reasons };
}

/**
 * What the owner reads about it. Dutch, because it lands on their screen.
 *
 * Says what was NOT done as plainly as what was seen. "We booked nothing" is the part that has to
 * survive being skimmed: an owner who reads only the first line must not go looking for a cost
 * that is deliberately absent.
 */
export function ownDocumentNotice(v: OwnDocumentVerdict): string | null {
  if (!v.isOwn) return null;
  const why = v.reasons.join(" · ");
  if (v.certainty === "certain") {
    return (
      `Dit is je EIGEN verkoopfactuur — ${why}. We hebben hem NIET als inkoopfactuur geboekt: ` +
      "dan zou je omzet ook als kosten meetellen en zou je de BTW die je moet afdragen ook nog " +
      "terugvragen. Het bestand is wel bewaard."
    );
  }
  return (
    `Dit lijkt je eigen verkoopfactuur — ${why}. We hebben hem NIET als inkoopfactuur geboekt, ` +
    "omdat je omzet dan ook als kosten zou meetellen. Klopt dat niet en is dit echt een " +
    "inkoopfactuur van een ander bedrijf met dezelfde naam? Dan kun je hem alsnog inlezen."
  );
}
