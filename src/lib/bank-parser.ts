// lib/bank-parser.ts
// Bank statement parsers: MT940 + CAMT.053 (BOEK-014 — read only) + CSV (BANK-CSV).
// Parsed transactions are returned as BankTransaction[] — not saved to DB yet.
// Saving + matching happens in BOEK-016 (Bank Matching Engine).

// [BANK-CSV] CSV parsing lives in its own module (bank-csv.ts) to keep this file
// focused on the SWIFT/XML formats. The import is type-safe and cycle-safe: both
// modules only reference each other's hoisted `export function`s at call time,
// never at module-init time.
import { parseBankCsv, looksLikeBankCsv } from "./bank-csv";

// ─── Canonical transaction type ───────────────────────────────────────────────

/**
 * Normalized bank transaction.
 * Both MT940 and CAMT.053 parse into this same shape.
 * BOEK-016 will save these to the bank_transactions table.
 */
export interface BankTransaction {
  date: string;           // ISO date: "2026-01-15"
  amount: number;         // positive = credit (ontvangen), negative = debit (betaald)
  currency: string;       // "EUR"
  description: string;   // omschrijving / remittance info
  counterpartName: string | null;    // naam tegenpartij
  counterpartIban: string | null;    // IBAN tegenpartij
  reference: string | null;          // betalingskenmerk
  transactionId: string | null;      // bank-eigen ID
  rawLine: string;        // original line(s) for debugging
}

/** Result of parsing a bank file */
export interface ParseResult {
  format: "MT940" | "CAMT053" | "CSV";
  accountIban: string | null;
  accountName: string | null;
  currency: string;
  transactions: BankTransaction[];
  parseErrors: string[];  // non-fatal warnings
}

// ─── MT940 Parser ─────────────────────────────────────────────────────────────
//
// MT940 is a SWIFT format used by ING, ABN AMRO, Rabobank, SNS.
// Structure: tag-based, each tag starts with :XX:
//
// Key tags:
//   :25:  account number / IBAN
//   :28C: statement number
//   :60F: opening balance
//   :61:  transaction (value date + amount + reference)
//   :86:  transaction details (description, counterpart)
//   :62F: closing balance

// [BANK-PARSE-READABLE] What the OWNER wants to see on a transaction card is the
// single most RECOGNISABLE thing — a name, an invoice number, or a meaningful
// description — and nothing else. Bank descriptions are full of noise the owner
// doesn't care about: terminal ids, sequence numbers (PASVOLGNR / TRANSACTIENR),
// processor prefixes (CCV* / BCK*), timestamps, BICs. When the structured parse
// found no counterpart name, derive a readable one from the free-text REMI by
// stripping that noise and keeping the leading human-meaningful part:
//   "CCV*ASM Supermarkt TILBURG NLD 29-05 ... TRANSACTIENR D00093" → "ASM Supermarkt"
//   "TX696074680XT Refund makro.nl O26-784..."                     → "Refund makro.nl"
//   "GCZ26327737 Termijnbedrag voor juni 2026"                     → "Termijnbedrag voor juni 2026"
//   "Unive Premie 02-06-2026"                                      → "Unive Premie"
// If the text is ONLY an opaque code (no real words), we still return it rather
// than nothing — a code the owner can match against is better than "Onbekend".
function deriveReadableName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  // Strip the "USTD//" / "USTD" unstructured-remittance marker and stray slashes
  // that prefix the free text in ING's :86: block.
  s = s.replace(/^\/*USTD\/*/i, "").replace(/^\/+/, "").trim();
  if (!s) return null;

  // 1. Drop card-processor prefixes ("CCV*", "BCK*", "BEA ", "GEA ").
  s = s.replace(/^(CCV|BCK|BEA|GEA)\*?\s*/i, "");

  // 2. Cut at the first piece of terminal/location noise, keeping what's before:
  //    a date, a time, or the terminal keywords. Then separately strip a trailing
  //    "<CITY> NLD" tail. Splitting on "<word> NLD" directly would wrongly cut a
  //    multi-word store like "TAMOIL TILBURG TILBURG NLD" down to "TILBURG", so
  //    we remove the country+city tail instead of splitting before it.
  s = s.split(
    /\s+TERMINALID|\s+PASVOLGNR|\s+TRANSACTIENR|\s+REFNR\.?|\s+\d{2}-\d{2}-\d{4}|\s+\d{2}:\d{2}\b/i
  )[0].trim();
  // Drop a trailing "  CITY NLD" (and anything after NLD): "TAMOIL TILBURG
  // TILBURG NLD" → "TAMOIL TILBURG"; "ASM Supermarkt TILBURG NLD" → "ASM Supermarkt".
  s = s.replace(/\s+[A-Z][A-Za-z]*\s+NLD\b.*$/i, "").trim();

  // 3. A leading transaction CODE followed by real words ("TX696074680XT Refund
  //    makro.nl", "GCZ26327737 Termijnbedrag...") — if dropping the code still
  //    leaves meaningful words, prefer those. The code must contain a DIGIT;
  //    an all-letter token like "TAMOIL" is a store name, not a code, and must
  //    be kept (otherwise "TAMOIL TILBURG" wrongly becomes "TILBURG").
  const codeThenWords = s.match(/^(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\s+(.+)/);
  if (codeThenWords && /[A-Za-z]{3,}/.test(codeThenWords[1])) {
    s = codeThenWords[1].trim();
  }

  s = s.replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s : null;
}

// [BANK-PARSE-REF] Single source of truth for extracting invoice number(s) from a
// REMI/Ustrd remittance string. BOTH the live parse (parseTransaction) and the
// re-derive path (rederiveFromDescription) call this, so a rule added here can
// never be forgotten in one place — the ONS IT Incasso bug was exactly that:
// two copies of this logic, only one fixed.
//
// Returns the cleaned invoice number(s), comma-joined when a single transfer pays
// several invoices ("26702781, 26703066"), or null when there is no usable number.
// Callers decide their own fallback for the null case (EREF/KREF, cleaned REMI, …).
//
// Rules, in priority order:
//   1. POS settlement (BETAALAUTOMAAT / Verzamelbetaling) → null (date + batch
//      counter only, never an invoice number).
//   2. Card terminal (TERMINALID / PASVOLGNR / CCV* / …) → null (terminal sequence
//      numbers are not invoice references).
//   3. SEPA Incasso (IncassobatchId / OpdrachtId present) → ONLY the number after
//      "fact."/"factuur"; if absent → null (a batch/order id is NOT an invoice, and
//      we never guess — honest: no explicit invoice number means no reference).
//   4. Otherwise → every run of >=3 digits / alphanumeric ref, de-duplicated, in
//      order, with bare years (2024–2029) dropped.
export function extractInvoiceReference(
  remi: string | null,
  opts: { isPos: boolean; isCard: boolean }
): string | null {
  if (!remi) return null;
  if (opts.isPos || opts.isCard) return null;

  const isBareYear = (t: string) => /^20(2[4-9]|3\d)$/.test(t);

  // SEPA Incasso: take only the invoice number after a "fact."/"factuur" marker.
  const isIncasso = /\b(Incassobatch|Opdracht)Id\b/i.test(remi);
  if (isIncasso) {
    const m = remi.match(/\bfact(?:uur)?\.?\s*(?:nr\.?\s*)?[:#]?\s*([A-Z]{0,3}\d{3,}[A-Z0-9]*)/i);
    const num = m?.[1] ?? null;
    return num && !isBareYear(num) ? num : null;
  }

  // General case: all meaningful invoice-number-like tokens, de-duplicated.
  const tokens = remi.match(/\b[A-Z]{0,3}\d{3,}[A-Z0-9]*\b/g);
  if (!tokens || tokens.length === 0) return null;
  const meaningful = tokens.filter((t) => !isBareYear(t));
  if (meaningful.length === 0) return null;
  const seen = new Set<string>();
  return meaningful.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(", ");
}

export function parseMT940(content: string): ParseResult {
  const errors: string[] = [];
  const transactions: BankTransaction[] = [];

  let accountIban: string | null = null;
  let accountName: string | null = null;
  let currency = "EUR";

  // Normalize line endings
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into tag blocks — each tag starts with :XX: at line start
  // [BANK-PARSE-MULTILINE] The lookahead must end a tag block at the NEXT tag or
  // at the true end of input — NOT at every end-of-line. With the /m flag, a bare
  // `$` matches each line end, which truncated multi-line :86: blocks (a wrapped
  // counterpart name like "Metr\no Markets GmbH" lost everything after the break).
  // `(?![\s\S])` matches only the real end of the string.
  const tagPattern = /^:(\d{2}[A-Z]?):([\s\S]*?)(?=^:\d{2}[A-Z]?:|(?![\s\S]))/gm;
  const tags: { tag: string; value: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text)) !== null) {
    tags.push({ tag: match[1], value: match[2].trim() });
  }

  // Extract account IBAN from :25:
  const tag25 = tags.find((t) => t.tag === "25");
  if (tag25) {
    // Format: "NL91ABNA0417164300" or "ABNABNL2A/123456789"
    const ibanMatch = tag25.value.match(/([A-Z]{2}\d{2}[A-Z0-9]{4,})/);
    accountIban = ibanMatch ? ibanMatch[1] : tag25.value.split("/")[1] ?? null;
  }

  // Extract currency from :60F: opening balance — format: C/DYYMMDDCCCAMOUNT
  const tag60 = tags.find((t) => t.tag === "60F" || t.tag === "60M");
  if (tag60) {
    const currMatch = tag60.value.match(/^[CD]\d{6}([A-Z]{3})/);
    if (currMatch) currency = currMatch[1];
  }

  // Process :61: + :86: pairs
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].tag !== "61") continue;

    const line61 = tags[i].value;
    const line86 = tags[i + 1]?.tag === "86" ? tags[i + 1].value : "";

    const tx = parseMT940Transaction(line61, line86, currency, errors);
    if (tx) transactions.push(tx);
  }

  return {
    format: "MT940",
    accountIban,
    accountName,
    currency,
    transactions,
    parseErrors: errors,
  };
}

function parseMT940Transaction(
  line61: string,
  line86: string,
  currency: string,
  errors: string[]
): BankTransaction | null {
  // :61: format: YYMMDD[MMDD]CD,AMOUNT[NREF][//BANKREF]\n[SUPPLEMENTARY]
  // C = credit, D = debit, RD = reversal debit, RC = reversal credit
  const txMatch = line61.match(
    /^(\d{6})(\d{4})?(C|D|RC|RD)([A-Z]?)(\d+,\d{0,2})(N.{0,4})?(?:\/\/(.+))?/
  );

  if (!txMatch) {
    errors.push(`Kon transactieregel niet lezen: ${line61.slice(0, 40)}`);
    return null;
  }

  const [, dateStr, , creditDebit, , amountStr, , bankRef] = txMatch;

  // Parse date YYMMDD → ISO
  const year = 2000 + parseInt(dateStr.slice(0, 2));
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const date = `${year}-${month}-${day}`;

  // Parse amount — MT940 uses comma as decimal separator
  const amount = parseFloat(amountStr.replace(",", "."));
  const signed =
    creditDebit === "C" || creditDebit === "RC" ? amount : -amount;

  // Parse :86: description field
  // ING/ABN AMRO use structured sub-fields: /BENM//NAME/...
  const { description, counterpartName, counterpartIban, reference } =
    parseMT940Description(line86);

  return {
    date,
    amount: signed,
    currency,
    description,
    counterpartName,
    counterpartIban,
    reference,
    transactionId: bankRef ?? null,
    rawLine: line61 + (line86 ? "\n" + line86 : ""),
  };
}

function parseMT940Description(rawLine86: string): {
  description: string;
  counterpartName: string | null;
  counterpartIban: string | null;
  reference: string | null;
} {
  if (!rawLine86) {
    return {
      description: "",
      counterpartName: null,
      counterpartIban: null,
      reference: null,
    };
  }

  // [BANK-PARSE-MULTILINE] MT940 wraps long :86: content across multiple lines
  // (e.g. a counterpart name split as "Metr\no Markets GmbH"). These are
  // logically ONE string — join the wrapped lines before parsing, otherwise the
  // name/IBAN/REMI extraction stops at the line break ("Metr" instead of
  // "Metro Markets GmbH"). Collapse newlines + surrounding spaces to a single space.
  const line86 = rawLine86.replace(/\s*\r?\n\s*/g, "").replace(/\s{2,}/g, " ");

  // Structured format: /BENM//NAME/John Doe/IBAN/NL91.../REMI/invoice 123
  const fields: Record<string, string> = {};
  const structuredMatch = line86.match(/\/([A-Z]{2,4})\//g);

  if (structuredMatch && structuredMatch.length > 0) {
    // Split on /FIELD/ markers
    const parts = line86.split(/\/([A-Z]{2,4})\//);
    for (let i = 1; i < parts.length - 1; i += 2) {
      fields[parts[i]] = parts[i + 1]?.trim() ?? "";
    }
  }

  // Extract known fields — varies per bank but common ones:
  let counterpartName: string | null =
    fields["NAME"] ?? fields["BENM"] ?? fields["ORDP"] ?? null;
  let counterpartIban: string | null =
    fields["IBAN"] ?? fields["BNAM"] ?? null;

  // [BANK-PARSE-CNTP] ING uses a composite /CNTP/ field (NOT /NAME/):
  //   /CNTP/NL11INGB0398443327/INGBNL2A/Trimex//
  // → IBAN / BIC / counterpart name. Parse it explicitly so ING statements get
  // clean names + IBANs without relying on the looser fallback below.
  if (fields["CNTP"]) {
    const cntp = fields["CNTP"];
    const m = cntp.match(/^([A-Z]{2}\d{2}[A-Z0-9]{4,})\/([A-Z0-9]+)\/(.+?)\/*$/);
    if (m) {
      if (!counterpartIban) counterpartIban = m[1].trim();
      if (!counterpartName) counterpartName = m[3].trim();
    } else if (!counterpartName) {
      // No IBAN/BIC structure — take the CNTP content as the name.
      const cleaned = cntp.replace(/\/+$/, "").trim();
      counterpartName = cleaned || null;
    }
  }

  // [BANK-PARSE-REF] Invoice number extraction. ING puts the supplier invoice
  // number inside REMI as:  USTD//29528/  (the bank's own UI shows just "29528").
  // One transaction can pay SEVERAL invoices at once — the supplier groups them
  // and the owner pays with a single transfer, e.g.
  //   USTD//26702781 , 26703066/      (two invoices)
  //   USTD//262430, 262469, 262494/   (four invoices)
  // We extract ALL invoice numbers (comma-joined) so the owner sees every one
  // and referenceMatches() can test each against an invoice.
  //
  // POS settlements (AFREK. BETAALAUTOMAAT / Verzamelbetaling) have NO supplier
  // invoice — their REMI is "...DAT. 20260626/6177 AANT. 25..." where the only
  // digit runs are a date and a batch counter, NOT an invoice number. Matching
  // one of those (e.g. "6177") to an invoice would be wrong, so POS → null.
  // [BANK-PARSE-REF] Invoice number(s) via the shared extractor (single source of
  // truth — same rules for the live parse and the re-derive path). Handles the
  // Incasso, multi-invoice, bare-year and POS cases. isCard is checked separately
  // below for the name; here we only need the POS flag (card terminals have no
  // /CNTP/ and their reference is cleared in the card branch further down).
  const remi = fields["REMI"] ?? null;
  const isPos = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(line86);
  let reference: string | null = extractInvoiceReference(remi, { isPos, isCard: false });

  if (reference === null && remi && !isPos) {
    // No invoice number found. Two ordered fallbacks for the live parse:
    //   (a) a cleaned REMI (strip USTD noise + slashes) as a human reference, then
    //   (b) the structured EREF/KREF field if even that is empty.
    const cleaned = remi
      .replace(/\bUSTD?\b/g, "")
      .replace(/[/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    reference = cleaned.length >= 3 ? cleaned : null;
  }
  if (!reference && !isPos) {
    const fb = fields["EREF"] ?? fields["KREF"] ?? null;
    reference = fb ? fb.replace(/[/]+/g, "").trim() || null : null;
  }

  // [BANK-PARSE-FEE] Bank's own charges have no counterpart party (no /CNTP/, no
  // IBAN/BIC). Their REMI starts with the charge name and then runs into free
  // text, e.g. "Kosten Zakelijk Betalingsverkeer   Factuurnr. 10003226631 ...
  // Periode: 01-05-2026". Without this, the loose IBAN fallback below grabs a
  // fragment like "Periode: 01-05-2026" as the name. Detect the charge and take
  // the clean label that precedes the first free-text marker.
  if (!counterpartName && remi && /Kosten|Betalingsverkeer/i.test(remi)) {
    const label = remi
      .split(/\s{2,}|Factuurnr\.|Betreft|Periode/i)[0]
      .replace(/\bUSTD?\b/g, "")
      .replace(/[/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (label.length >= 3) counterpartName = label;
  }

  // [BANK-PARSE-CARD] Card purchases (pinbetaling) at a shop have NO /CNTP/
  // party — the bank records only the store name inside the free-text REMI, and
  // the "reference" the structured pass grabbed is terminal noise (PASVOLGNR /
  // TRANSACTIENR), never an invoice. Detect the card-terminal shape, derive the
  // readable store name via the shared helper, and drop the noisy reference so
  // the card shows e.g. "ASM Supermarkt" with no confusing pseudo-invoice chip.
  if ((!counterpartName || /^USTD$/i.test(counterpartName)) && remi && /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS|\bNLD\b/i.test(remi)) {
    const store = deriveReadableName(remi);
    if (store) {
      counterpartName = store;
      reference = null; // terminal sequence numbers are not invoice references
    }
  }

  // [BANK-PARSE-ING] Fallback for the common ING/Rabo/ABN :86: layout that is
  // NOT wrapped in /NAME/ markers but reads as:  IBAN/BIC/Counterpart name
  //   e.g. "NL89RABO0131703501/RABONL2U/W ketels & zn eierhandel"
  //        "NL54ABNA0100529224/ABNANL2A/CAN Vleesgroothandel B.V."
  // The structured parser above misses these because there's no /FIELD/ key.
  // Only fill what the structured pass didn't already find.
  if (!counterpartName || !counterpartIban) {
    const ibanBicName = line86.match(
      /([A-Z]{2}\d{2}[A-Z]{4}\d{7,10})\/([A-Z]{6}[A-Z0-9]{2,5})\/(.+?)(?:\s{2,}|$)/
    );
    if (ibanBicName) {
      if (!counterpartIban) counterpartIban = ibanBicName[1].trim();
      if (!counterpartName) counterpartName = ibanBicName[3].trim();
    } else {
      // Looser fallback: an IBAN followed by a name (no BIC in between).
      //   "NL12INGB0001234567 Jansen BV"  or  "NL12INGB0001234567/Jansen BV"
      const ibanName = line86.match(
        /([A-Z]{2}\d{2}[A-Z]{4}\d{7,10})[\s/]+([A-Za-z][^/]{2,})/
      );
      if (ibanName) {
        if (!counterpartIban) counterpartIban = ibanName[1].trim();
        if (!counterpartName) counterpartName = ibanName[2].trim();
      } else {
        // [BANK-PARSE-CLEAN] No IBAN at all, but the line often starts with the
        // counterpart name BEFORE the field markers:
        //   "Oz + Er Food B.V.///REMI/UST" → name = "Oz + Er Food B.V."
        //   "Mohammad Ibrahim///REMI/UST"  → name = "Mohammad Ibrahim"
        // Take everything up to the first slash, if it looks like a name.
        const leading = line86.split("/")[0]?.trim() ?? "";
        if (!counterpartName && leading.length >= 2 && /[A-Za-z]/.test(leading)) {
          counterpartName = leading;
        }
      }
    }
  }

  // [BANK-PARSE-CLEAN] Final cleanup: strip any trailing field-marker debris that
  // leaked into the name (e.g. "Oz + Er Food B.V.//", "Jansen/REMI"). Cut at the
  // first "/" and collapse whitespace, so the owner sees a clean vendor name.
  counterpartName = counterpartName
    ? (counterpartName.split("/")[0].replace(/\s+/g, " ").trim() || null)
    : null;
  // A bare "USTD" (the remittance marker) is noise, not a name — treat as empty
  // so the readable-name fallback below derives the real store/description.
  if (counterpartName && /^USTD$/i.test(counterpartName)) counterpartName = null;

  // Description: use REMI or fall back to full line86 cleaned up
  const description =
    fields["REMI"] ??
    fields["OWNR"] ??
    line86.replace(/\/[A-Z]{2,4}\//g, " ").replace(/\s+/g, " ").trim();

  // [BANK-PARSE-READABLE] Still no name? Derive the most recognisable thing from
  // the description so the owner never sees a blank/"Onbekend" when the bank
  // actually told us what the payment was (a shop, a refund, an instalment).
  if (!counterpartName) {
    counterpartName = deriveReadableName(fields["REMI"] ?? description);
  }

  return { description, counterpartName, counterpartIban, reference };
}

// ─── CAMT.053 Parser ──────────────────────────────────────────────────────────
//
// CAMT.053 (ISO 20022) is the modern XML bank statement format.
// Used by ING, ABN AMRO, Rabobank — gradually replacing MT940.
// Exact Online and most NL accounting software read it natively.
//
// Key XML elements:
//   Acct/Id/IBAN          account IBAN
//   Acct/Nm               account name
//   Ntry                  entry (transaction)
//   Ntry/Amt              amount with Ccy attribute
//   Ntry/CdtDbtInd        CRDT or DBIT
//   Ntry/ValDt/Dt         value date
//   Ntry/NtryDtls/TxDtls  transaction details
//   TxDtls/RmtInf/Ustrd   unstructured remittance info
//   TxDtls/RltdPties      related parties (counterpart)

// [BANK-PARSE-XMLENT] Decode the XML entities that appear in CAMT text nodes so
// names/descriptions read correctly. Without this, "ING DD&amp;C" shows literally
// as "ING DD&amp;C" instead of "ING DD&C" (and the POS filter could miss it).
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

export function parseCAMT053(content: string): ParseResult {
  const errors: string[] = [];
  const transactions: BankTransaction[] = [];

  let accountIban: string | null = null;
  let accountName: string | null = null;
  let currency = "EUR";

  // Simple regex-based XML extraction — no DOM dependency needed server-side
  // For a full implementation, use fast-xml-parser (BOEK-016)

  // Account IBAN
  const ibanMatch = content.match(/<IBAN>([^<]+)<\/IBAN>/);
  if (ibanMatch) accountIban = ibanMatch[1].trim();

  // Account name
  const nameMatch = content.match(/<Nm>([^<]+)<\/Nm>/);
  if (nameMatch) accountName = nameMatch[1].trim();

  // Extract all <Ntry> blocks
  const ntryPattern = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let ntryMatch: RegExpExecArray | null;

  while ((ntryMatch = ntryPattern.exec(content)) !== null) {
    const block = ntryMatch[1];
    const tx = parseCAMT053Entry(block, currency, errors);
    if (tx) transactions.push(tx);
  }

  return {
    format: "CAMT053",
    accountIban,
    accountName,
    currency,
    transactions,
    parseErrors: errors,
  };
}

function parseCAMT053Entry(
  block: string,
  defaultCurrency: string,
  errors: string[]
): BankTransaction | null {
  // Amount + currency
  const amtMatch = block.match(/<Amt Ccy="([^"]+)">([^<]+)<\/Amt>/);
  if (!amtMatch) {
    errors.push("Transactiebedrag ontbreekt in CAMT.053 entry");
    return null;
  }
  const currency = amtMatch[1] ?? defaultCurrency;
  const rawAmount = parseFloat(amtMatch[2]);

  // Credit or debit
  const cdMatch = block.match(/<CdtDbtInd>([^<]+)<\/CdtDbtInd>/);
  const isCredit = (cdMatch?.[1]?.trim() ?? "CRDT") === "CRDT";
  const amount = isCredit ? rawAmount : -rawAmount;

  // Value date — prefer <ValDt><Dt>, fall back to <BookgDt><Dt>
  const valDtMatch =
    block.match(/<ValDt>\s*<Dt>([^<]+)<\/Dt>/) ??
    block.match(/<BookgDt>\s*<Dt>([^<]+)<\/Dt>/);
  const date = valDtMatch ? valDtMatch[1].trim() : "";

  if (!date) {
    errors.push("Transactiedatum ontbreekt in CAMT.053 entry");
    return null;
  }

  // Transaction details block
  const txDtls = block.match(/<TxDtls>([\s\S]*?)<\/TxDtls>/)?.[1] ?? "";

  // Unstructured remittance info
  const ustrdMatch = txDtls.match(/<Ustrd>([^<]+)<\/Ustrd>/);
  const description = ustrdMatch ? decodeXmlEntities(ustrdMatch[1].trim()) : "";

  // Counterpart — check both Dbtr (debtor = payer) and Cdtr (creditor = receiver)
  const counterpartBlock =
    txDtls.match(/<RltdPties>([\s\S]*?)<\/RltdPties>/)?.[1] ?? "";

  // For credit transactions, counterpart is the Debtor
  // For debit transactions, counterpart is the Creditor
  const partyTag = isCredit ? "Dbtr" : "Cdtr";
  const partyNameMatch = counterpartBlock.match(
    new RegExp(`<${partyTag}>\\s*<Nm>([^<]+)<\\/Nm>`)
  );
  const partyIbanMatch = counterpartBlock.match(
    new RegExp(
      `<${partyTag}Acct>[\\s\\S]*?<IBAN>([^<]+)<\\/IBAN>[\\s\\S]*?<\\/${partyTag}Acct>`
    )
  );

  let counterpartName = partyNameMatch ? decodeXmlEntities(partyNameMatch[1].trim()) : null;
  const counterpartIban = partyIbanMatch ? partyIbanMatch[1].trim() : null;

  // [BANK-PARSE-FEE] Bank charges have no related party in CAMT (no <Dbtr>/<Cdtr>),
  // so counterpartName is null. Mirror the MT940 fix: pull the clean charge label
  // from the start of the description ("Kosten Zakelijk Betalingsverkeer ...").
  if (!counterpartName && /Kosten|Betalingsverkeer/i.test(description)) {
    const label = description
      .split(/\s{2,}|Factuurnr\.|Betreft|Periode/i)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (label.length >= 3) counterpartName = label;
  }

  // [BANK-PARSE-REF] Reference — unified with MT940. EndToEndId is the bank's own
  // id and for ING POS rows holds the batch id (not an invoice). The supplier
  // invoice number(s) live in <Ustrd> (= MT940's REMI), so derive the reference
  // from `description` with the SAME rules (multi-invoice, POS→null) and fall
  // back to EndToEndId only for a real, non-POS transfer.
  const isPosEntry = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(description);
  let reference: string | null = null;
  if (description && !isPosEntry) {
    const tokens = description.match(/\b[A-Z]{0,3}\d{3,}[A-Z0-9]*\b/g);
    if (tokens && tokens.length > 0) {
      const isBareYear = (t: string) => /^20(2[4-9]|3\d)$/.test(t);
      const meaningful = tokens.filter((t) => !isBareYear(t));
      if (meaningful.length === 0) {
        reference = null;
      } else {
        const seen = new Set<string>();
        reference = meaningful.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(", ");
      }
    }
  }
  if (!reference && !isPosEntry) {
    const e2eMatch = txDtls.match(/<EndToEndId>([^<]+)<\/EndToEndId>/);
    const e2e = e2eMatch ? e2eMatch[1].trim() : "";
    reference = e2e && !/^NOTPROVIDED$/i.test(e2e) ? e2e : null;
  }

  // Transaction ID
  const txIdMatch = block.match(/<NtryRef>([^<]+)<\/NtryRef>/);
  const transactionId = txIdMatch ? txIdMatch[1].trim() : null;

  // [BANK-PARSE-CARD] Same as MT940: a card purchase has no related party, so
  // derive the store name from the description and drop the terminal-noise ref.
  if (!counterpartName && /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS|\bNLD\b/i.test(description)) {
    const store = deriveReadableName(description);
    if (store) {
      counterpartName = store;
      reference = null;
    }
  }
  // [BANK-PARSE-READABLE] Still nothing? Derive the most recognisable text from
  // the description so the owner never sees a blank counterpart.
  if (!counterpartName) {
    counterpartName = deriveReadableName(description);
  }

  return {
    date,
    amount,
    currency,
    description,
    counterpartName,
    counterpartIban,
    reference,
    transactionId,
    rawLine: block.trim(),
  };
}

// ─── Auto-detect + parse ──────────────────────────────────────────────────────

/**
 * Detect file format and parse automatically.
 * Accepts MT940 (.mt940, .sta, .txt) or CAMT.053 (.xml).
 *
 * @example
 * const result = parseBankFile(fileContent, "afschrift.xml");
 * if (result.parseErrors.length) console.warn(result.parseErrors);
 * // result.transactions → ready for BOEK-016 matching
 */
export function parseBankFile(content: string, filename: string): ParseResult {
  const lower = filename.toLowerCase();

  // CAMT.053: XML file or contains ISO 20022 namespace
  if (
    lower.endsWith(".xml") ||
    content.includes("urn:iso:std:iso:20022") ||
    content.includes("<BkToCstmrStmt")
  ) {
    return parseCAMT053(content);
  }

  // [BANK-CSV] CSV bank export (ING, Rabobank, bunq, SNS, ASN, Triodos, Knab, …).
  // Route .csv by extension, or any file whose content looks like a delimited
  // statement with date+amount headers. Kept out of the MT940 fallback below so a
  // CSV upload no longer silently parses to zero transactions. Imported lazily to
  // keep this module's dependency graph unchanged for the MT940/CAMT paths.
  if (lower.endsWith(".csv") || looksLikeBankCsv(content)) {
    return parseBankCsv(content);
  }

  // MT940: .mt940, .sta, .txt, or starts with :20:
  return parseMT940(content);
}

// ─── Summary helper ───────────────────────────────────────────────────────────

/**
 * Quick stats from a ParseResult — used in the UI preview before BOEK-016.
 */
export function summarizeParseResult(result: ParseResult): {
  totalCredits: number;
  totalDebits: number;
  creditCount: number;
  debitCount: number;
  dateFrom: string | null;
  dateTo: string | null;
} {
  let totalCredits = 0;
  let totalDebits = 0;
  let creditCount = 0;
  let debitCount = 0;
  const dates = result.transactions
    .map((t) => t.date)
    .filter(Boolean)
    .sort();

  for (const tx of result.transactions) {
    if (tx.amount >= 0) {
      totalCredits += tx.amount;
      creditCount++;
    } else {
      totalDebits += Math.abs(tx.amount);
      debitCount++;
    }
  }

  return {
    totalCredits,
    totalDebits,
    creditCount,
    debitCount,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
  };
}

// [BANK-REDERIVE] Re-derive a transaction's display name + reference from its
// STORED `description` (the REMI text), using the same rules as the live parser.
// This lets us upgrade older rows that were imported before the parser learned
// to read card-purchase store names — WITHOUT a re-upload or any deletion.
//
// Important scope: the stored description is the REMI only (e.g. "USTD//Lidl 213
// Tilburg ... TRANSACTIENR: C00095" or "USTD//26023790 , 26026707"). It does NOT
// contain the /CNTP/ party, so a vendor whose name lived in CNTP (Oz+Er, ATAPACK)
// cannot be recovered here — but those already parsed correctly. This only helps
// the rows whose name IS in the description (card purchases, salary, refunds),
// which are exactly the ones that showed "Onbekende". Callers must therefore
// only apply the new name when the existing one is weak/empty, never overwrite a
// good CNTP name.
export function rederiveFromDescription(description: string | null): {
  name: string | null;
  reference: string | null;
} {
  if (!description) return { name: null, reference: null };

  const remi = description;
  const isPos = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(remi);

  // Name — reuse the shared readable-name derivation.
  let name = deriveReadableName(remi);
  // The stored description is the REMI only. For a row whose real name lived in
  // /CNTP/, the REMI is often just invoice numbers ("26023790 , 26026707") — a
  // derived "name" made only of digits/punctuation is NOT a usable name and
  // must be rejected, so we never overwrite a real vendor with a number string.
  if (name) {
    name = name.replace(/[\/\s]+$/, "").trim();
    const hasRealWords = /[A-Za-z]{2,}/.test(name);
    if (!hasRealWords) name = null;
  }

  // Reference — via the shared extractor (single source of truth). This is how
  // the re-derive path automatically inherits the Incasso fix and any future rule.
  const isCard = /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS/i.test(remi);
  const reference = extractInvoiceReference(remi, { isPos, isCard });

  return { name, reference };
}