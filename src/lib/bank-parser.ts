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

/**
 * [BANK-BALANCE] The statement's own opening + closing balance, when the format carries it
 * (MT940 :60F:/:62F:, CAMT.053 OPBD/CLBD). Signed euros: a debit (overdrawn) balance is
 * negative. Either side may be null when a format/file omits it (e.g. CSV, or a partial
 * statement) — reconciliation is then simply "not checkable", never a fabricated pass.
 */
export interface StatementBalance {
  opening: number | null;
  closing: number | null;
  currency: string;
}

/** Result of parsing a bank file */
export interface ParseResult {
  format: "MT940" | "CAMT053" | "CSV";
  accountIban: string | null;
  accountName: string | null;
  currency: string;
  transactions: BankTransaction[];
  parseErrors: string[];  // non-fatal warnings
  // [BANK-BALANCE] The statement's declared opening/closing balance for the completeness
  // check (opening + Σtx must equal closing). null when the format carries no balance.
  statementBalance?: StatementBalance | null;
}

/**
 * [BANK-BALANCE] Parse one MT940 balance field value (:60F:/:62F:/:60M:/:62M:).
 * Format: `C|D` + `YYMMDD` + `CCC`(currency) + amount (comma decimal, no thousands sep).
 * Returns signed euros (D = debit balance = negative) + currency, or null when unreadable.
 */
export function parseMT940Balance(value: string): { amount: number; currency: string } | null {
  const m = value.trim().match(/^([CD])\d{6}([A-Z]{3})([\d.,]+)$/);
  if (!m) return null;
  const [, sign, currency, rawAmount] = m;
  // MT940 uses comma as the decimal separator and no thousands separator.
  const magnitude = parseFloat(rawAmount.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(magnitude)) return null;
  return { amount: sign === "D" ? -magnitude : magnitude, currency };
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
//
// [GOCARDLESS] Exported since the API sync needs the SAME derivation: a bank-fed
// transaction arrives without a counterpart name just as often as a parsed one
// (the documented example has a debit line with only remittance text), and a
// second copy of this rule would drift — see the extractInvoiceReference header
// for what that costs.
export function deriveReadableName(raw: string | null): string | null {
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
  // MT940 kent geen veld met de tenaamstelling (:25: bevat alleen het rekeningnummer),
  // dus dit blijft bewust null in plaats van dat we een naam uit de tekst raden.
  const accountName: string | null = null;
  let currency = "EUR";

  // Normalize line endings
  // [MT940-TERMINATOR] SWIFT ends each message with a line holding a single '-' (some exports
  // '-}'). The tag-splitter's lookahead ends a block at the NEXT tag or end-of-input, so that
  // terminator glued onto the LAST tag's value — usually :62F:, whose "C260630EUR1200,00\n-"
  // then failed parseMT940Balance and silently nulled the closing balance: the completeness
  // check (opening + Σtx = closing) degraded to "not checkable" on every real bank export that
  // ends properly. Strip terminator LINES before splitting; a remittance line consisting of
  // exactly '-' does not occur in the wild (and would only lose a dash from free text).
  const text = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\s*-\}?\s*$/gm, "");

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
    // [MT940-25-CURRENCY] ING writes :25:NL91INGB0001234567EUR — the account plus its currency,
    // fused. The greedy class above swallows the suffix, and the polluted "IBAN" then flows to
    // statement-period continuity grouping, where NL91...EUR and NL91... read as two different
    // accounts. A Dutch IBAN is exactly 18 chars; strip a trailing ISO-4217 code only when what
    // remains is a plausible IBAN, so a genuinely long foreign IBAN is never truncated.
    if (accountIban && /(?:EUR|USD|GBP|CHF)$/.test(accountIban)) {
      const stripped = accountIban.slice(0, -3);
      if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(stripped)) accountIban = stripped;
    }
  }

  // Extract currency from :60F: opening balance — format: C/DYYMMDDCCCAMOUNT
  const tag60 = tags.find((t) => t.tag === "60F" || t.tag === "60M");
  if (tag60) {
    const currMatch = tag60.value.match(/^[CD]\d{6}([A-Z]{3})/);
    if (currMatch) currency = currMatch[1];
  }

  // [BANK-BALANCE] Opening = the FIRST 60F/60M (statement start); closing = the LAST 62F/62M
  // (statement end). A multi-page file's intermediate M-balances cancel out, so first-open →
  // last-close spans every :61: line — the reconciliation then proves no line is missing.
  const openingTag = tags.find((t) => t.tag === "60F" || t.tag === "60M");
  const closingTag = [...tags].reverse().find((t) => t.tag === "62F" || t.tag === "62M");
  const openingBal = openingTag ? parseMT940Balance(openingTag.value) : null;
  const closingBal = closingTag ? parseMT940Balance(closingTag.value) : null;
  const statementBalance: StatementBalance | null =
    openingBal || closingBal
      ? { opening: openingBal?.amount ?? null, closing: closingBal?.amount ?? null, currency }
      : null;

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
    statementBalance,
  };
}

function parseMT940Transaction(
  line61: string,
  line86: string,
  currency: string,
  errors: string[]
): BankTransaction | null {
  // :61: format: YYMMDD[MMDD]CD[F]AMOUNT[Nxxx][OWNERREF][//BANKREF]\n[SUPPLEMENTARY]
  // C = credit, D = debit, RD = reversal debit, RC = reversal credit
  //
  // [BANK-PARSE-OWNERREF] The transaction type code is exactly four characters (N + three, e.g.
  // NTRF, NDDT) and what follows it, up to "//", is the ACCOUNT OWNER'S reference — for ING that
  // is where a betalingskenmerk lands: "NTRF1583366271601210//26115435747552". The old pattern
  // read the type code as `N.{0,4}`, so it swallowed "NTRF1" and left "583366271601210" to fail
  // the "//" that follows, which cost the kenmerk AND the bank reference behind it. On a real
  // quarter that lost the reference on four Belastingdienst payments where CAMT of the same
  // quarter kept it — the two doors then fingerprinted the same payment differently.
  const txMatch = line61.match(
    /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z]?)(\d+,\d{0,2})(N[A-Z0-9]{3})?([^/\n]{0,16})?(?:\/\/(.+))?/
  );

  if (!txMatch) {
    errors.push(`Kon transactieregel niet lezen: ${line61.slice(0, 40)}`);
    return null;
  }

  const [, dateStr, , creditDebit, , amountStr, , ownerRef, bankRef] = txMatch;

  // Parse date YYMMDD → ISO
  const year = 2000 + parseInt(dateStr.slice(0, 2));
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const date = `${year}-${month}-${day}`;

  // [M4] The date is assembled by string concatenation, so YYMMDD "999999" yields the
  // syntactically-shaped but impossible "2099-99-99". Postgres rejects it on a `date`
  // column, which fails the WHOLE batch INSERT — and bank-ingest swallows that error, so
  // every transaction in the file disappears while the report still says "verwerkt".
  // CAMT has guarded this since [M4]; the [H3] comment claimed MT940 did too. It did not.
  // Drop the single unreadable line with a named error instead of losing the batch.
  if (!isValidIsoDate(date)) {
    errors.push(`Ongeldige transactiedatum in MT940-regel: "${dateStr}"`);
    return null;
  }

  // Parse amount — MT940 uses comma as decimal separator
  const amount = parseFloat(amountStr.replace(",", "."));
  // [H3] A non-finite amount (Infinity from a 300-digit value, NaN from garbage) poisons every
  // downstream sum — reconciliation, kwartaaltotalen, BTW. Same guard CAMT already applies.
  if (!Number.isFinite(amount)) {
    errors.push(`Ongeldig transactiebedrag in MT940-regel: "${amountStr}"`);
    return null;
  }
  // [BANK-BALANCE] SWIFT sign convention, incl. reversals:
  //   C  = credit                → +   |   D  = debit                 → −
  //   RD = Reversal of a Debit   → +   |   RC = Reversal of a Credit  → −
  // A reversal UNDOES the original, so RC (undo a credit) nets to a DEBIT and RD (undo a
  // debit) nets to a CREDIT. The earlier code grouped RC with credits and RD with debits —
  // inverted — so every reversal booked with the WRONG sign (wrong omzet/kosten), and it
  // also made a complete statement fail the new begin/eindsaldo reconciliation. The :62F:
  // closing balance already reflects the true effect, so this is the sign that ties out.
  const signed =
    creditDebit === "C" || creditDebit === "RD" ? amount : -amount;

  // Parse :86: description field
  // ING/ABN AMRO use structured sub-fields: /BENM//NAME/...
  const { description, counterpartName, counterpartIban, reference } =
    parseMT940Description(line86, ownerRef ?? null);

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

/**
 * [BANK-PARSE-CARD] What marks a line as a card/terminal transaction rather than a transfer.
 *
 * Exported because three doors have to agree on it — MT940, CAMT and the PSD2 feed mapper. It
 * lived as three separate copies of the same literal until a real ING quarter showed the doors
 * disagreeing; a regex that decides whether a number is an invoice reference is exactly the kind
 * of rule [BANK-REF-ONE-SOURCE] says must have one home.
 */
export const CARD_TERMINAL_MARKERS =
  /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS|\bNLD\b/i;

/**
 * [BANK-REF-ONE-SOURCE] The end-to-end reference, or null when the bank only sent a placeholder.
 *
 * One rule for both doors. CAMT carries this as <EndToEndId>, MT940 as /EREF/ in :86: or as the
 * account owner's reference in :61:, and each format has its own way of saying "there isn't one":
 * SEPA writes NOTPROVIDED, MT940 writes NONREF, and ING writes the literal "EREF" in :61: to mean
 * "look in :86:". Booking any of those three as a payment reference matches it against invoices as
 * if it were a betalingskenmerk, and — because only one door used to do it — fingerprints the same
 * payment two different ways.
 */
function endToEndReference(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.replace(/[/]+/g, "").trim();
  if (!value) return null;
  return /^(NOTPROVIDED|NONREF|EREF)$/i.test(value) ? null : value;
}

function parseMT940Description(
  rawLine86: string,
  /** [BANK-PARSE-OWNERREF] The account owner's reference from :61:, which is where ING puts a
   *  betalingskenmerk when :86: has no /EREF/. It is the MT940 twin of CAMT's <EndToEndId> and is
   *  used in exactly the same position, so both doors reach the same reference. */
  ownerRef: string | null = null,
): {
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
  // [MT940-WRAP-SPACE] Remove ONLY the newline itself. The old join swallowed the whitespace
  // AROUND the wrap too, which fused two space-separated tokens whenever the 65-char wrap point
  // fell after a space: a verzamelbetaling's "26702781 \n26703066" became the 16-digit
  // "2670278126703066" — one bogus reference, no batch resolution, both invoices left open, on
  // an unmodified bank file. Keeping the file's own spaces preserves both cases: a mid-word wrap
  // ("Metr\no Markets") still joins seamlessly (no space existed), and a wrap at a token
  // boundary keeps its separator. The \s{2,} collapse below still tidies any doubling.
  const line86 = rawLine86.replace(/\r?\n/g, "").replace(/\s{2,}/g, " ");

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
    // [MT940-ABN-KEYWORDS] ABN's slashed variant writes /NAAM/ where ING writes /NAME/.
    fields["NAME"] ?? fields["NAAM"] ?? fields["BENM"] ?? fields["ORDP"] ?? null;
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
  // [MT940-ABN-KEYWORDS] ABN AMRO's plain-text :86: has no /FIELD/ markers at all — it is
  // keyword text: "SEPA OVERBOEKING IBAN: NL46DEUT0136523093 BIC: DEUTNL2N NAAM: CAN
  // Vleesgroothandel BV OMSCHRIJVING: FACTUUR 2026-088", the incasso variant with
  // INCASSANT:/MACHTIGING:/KENMERK:, and the pin line "BEA NR:CCV12345 15.01.26/ALBERT HEIJN
  // 1522/AMSTERDAM". The generic fallbacks below mangled all three (the stored name literally
  // began "BIC: … NAAM: …", the merchant of a pin line vanished, a mandate kenmerk posed as the
  // reference). Read the keywords FIRST; everything downstream (reference extraction,
  // description, card handling) then flows through the normal REMI pipeline unchanged.
  if (!counterpartName && !fields["REMI"]) {
    const bea = line86.match(/^\s*(?:BEA|GEA)\b[^/]*\/([^/]+)/i);
    if (bea) {
      // Pin/geldautomaat: the merchant sits after the first slash. Terminal numbers are never
      // an invoice reference, and REMI stays unset so none is invented.
      const store = deriveReadableName(bea[1]);
      if (store) counterpartName = store;
    } else if (/\b(NAAM|OMSCHRIJVING)\s*:/.test(line86)) {
      const grab = (key: string) =>
        line86
          .match(new RegExp(`\\b${key}\\s*:\\s*([\\s\\S]*?)(?=\\s*\\b(?:IBAN|BIC|NAAM|OMSCHRIJVING|INCASSANT|MACHTIGING|KENMERK|EREF|MARF|CSID)\\s*:|$)`, "i"))?.[1]
          ?.trim() ?? null;
      const naam = grab("NAAM");
      const kwIban = line86.match(/\bIBAN\s*:\s*([A-Z]{2}\d{2}[A-Z0-9]{6,30})/i)?.[1] ?? null;
      const oms = grab("OMSCHRIJVING");
      const kenmerk = grab("KENMERK");
      if (naam) counterpartName = naam;
      if (kwIban && !counterpartIban) counterpartIban = kwIban;
      // OMSCHRIJVING is the human remittance (invoice numbers live there); KENMERK is the
      // fallback — an incasso kenmerk is usually a mandate id, and the shared extractor's
      // bare-year/POS rules decide what of it survives as a reference.
      if (oms) fields["REMI"] = oms;
      else if (kenmerk) fields["REMI"] = kenmerk;
    }
  }

  const remi = fields["REMI"] ?? null;
  const isPos = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(line86);
  let reference: string | null = extractInvoiceReference(remi, { isPos, isCard: false });

  // [BANK-REF-ONE-SOURCE] From here the fallback must be the SAME as parseCAMT053Entry's, because
  // the two doors carry the same statement and a different reference is a different contentKey —
  // the same payment imported twice.
  //
  // CAMT does exactly one thing when extractInvoiceReference finds nothing: it falls back to
  // <EndToEndId>, and to nothing else. MT940 used to first install the CLEANED REMI TEXT as the
  // reference, which is not a reference at all — on a real ING quarter that produced
  // "deel salaris april 2026" and "Salaris april 2026" on 13 rows where CAMT of the same quarter
  // correctly produced null, and on 10 direct debits it produced the whole
  // "Incasso Huur Periode: 01-04-2026 tot 01-05-2026" where CAMT produced the mandate's EREF.
  // Twenty-three of 576 lines that dedup as two different transactions.
  //
  // It also fed parseReferenceNumbers a sentence, which is the [BANK-REF-ONE-SOURCE] failure the
  // header warns about: a line that can never be auto-booked and never satisfies isFullyCovered.
  //
  // NOTE ON THE UPGRADE. This changes what an MT940-only owner's reference column holds, so a
  // period imported before the fix and re-uploaded after it can import twice on the affected
  // lines. That is a one-off at the boundary; the divergence it removes fires every time an owner
  // uses both of his bank's formats, which ING offers side by side on the same download page.
  if (!reference && !isPos) {
    reference = endToEndReference(fields["EREF"] ?? fields["KREF"] ?? ownerRef);
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
  const mt940TerminalText = !!remi && CARD_TERMINAL_MARKERS.test(remi);
  if ((!counterpartName || /^USTD$/i.test(counterpartName)) && mt940TerminalText) {
    const store = deriveReadableName(remi!);
    if (store) counterpartName = store;
  }
  // [BANK-PARSE-TERMINAL-REF] Clearing the reference is SEPARATE from rescuing the name, because a
  // terminal line can arrive with a party already named and then the rescue never runs. A Geldmaat
  // cash deposit does: the bank names "Gemeenschap Geldmaat" and leaves the terminal id, the
  // pasvolgnr and the transaction number in the text, so the structured pass offered
  // "811391, 001, 616716432971" as the invoice reference of a €10.150 deposit. Terminal numbers are
  // never an invoice reference no matter who is named beside them.
  if (mt940TerminalText) reference = null;

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
  // [BANK-PARSE-XMLENT-ORDER] `&amp;` is decoded LAST, never first. An escaped entity travels
  // through XML as "&amp;lt;" — the "&" of "&lt;" is itself escaped. Decoding "&amp;" first turns
  // it into "&lt;", which the next replace then turns into "<": a literal, harmless piece of a
  // vendor name silently becomes markup. Decoding every other form first and "&amp;" at the end
  // means each entity is decoded exactly once, which is what XML defines. A plain "ING DD&amp;C"
  // is unaffected either way — it is the escaped-escape that was wrong.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * [BANK-BALANCE] Extract the opening (OPBD) + closing (CLBD) booked balances from CAMT.053
 * <Bal> blocks. Signed euros (DBIT = negative). Takes the FIRST OPBD and the LAST CLBD so a
 * multi-statement file reconciles start-to-end. Ignores available-balance types (OPAV/CLAV/
 * FWAV) — only the BOOKED balance ties to the booked entries. Returns null when neither exists.
 */
export function parseCamtStatementBalance(content: string, currency: string): StatementBalance | null {
  const balPattern = /<Bal>([\s\S]*?)<\/Bal>/g;
  let opening: number | null = null;
  let closing: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = balPattern.exec(content)) !== null) {
    const block = m[1];
    const code = block.match(/<Cd>\s*(OPBD|CLBD)\s*<\/Cd>/)?.[1];
    if (!code) continue;
    const amtMatch = block.match(/<Amt[^>]*>([^<]+)<\/Amt>/);
    if (!amtMatch) continue;
    const mag = parseFloat(amtMatch[1]);
    if (!Number.isFinite(mag)) continue;
    const isDebit = (block.match(/<CdtDbtInd>\s*([^<]+?)\s*<\/CdtDbtInd>/)?.[1] ?? "CRDT") === "DBIT";
    const signed = isDebit ? -mag : mag;
    if (code === "OPBD" && opening === null) opening = signed; // first OPBD
    if (code === "CLBD") closing = signed;                     // last CLBD wins
  }
  return opening !== null || closing !== null ? { opening, closing, currency } : null;
}

/**
 * [BANK-CURRENCY] De valuta van het afschrift, gelezen uit het bestand zelf.
 *
 * Stond hier eerder hard op "EUR". Voor een rekening in een andere valuta labelde de
 * import dan stilzwijgend het verkeerde teken op de begin- en eindstand — een fout die
 * nergens opvalt omdat de bedragen zelf wél klopten. We lezen hem daarom uit het
 * <Bal>-blok (de gezaghebbende plek), met de eerste transactie als terugval en EUR als
 * laatste redmiddel; MT940 doet hetzelfde met :60F:.
 */
export function detectCamtCurrency(content: string): string {
  const balCcy = content.match(/<Bal>[\s\S]*?<Amt[^>]*\bCcy="([A-Z]{3})"/)?.[1];
  if (balCcy) return balCcy;
  const entryCcy = content.match(/<Ntry>[\s\S]*?<Amt[^>]*\bCcy="([A-Z]{3})"/)?.[1];
  if (entryCcy) return entryCcy;
  return "EUR";
}

export function parseCAMT053(content: string): ParseResult {
  const errors: string[] = [];
  const transactions: BankTransaction[] = [];

  let accountIban: string | null = null;
  let accountName: string | null = null;
  const currency = detectCamtCurrency(content);

  // Simple regex-based XML extraction — no DOM dependency needed server-side
  // For a full implementation, use fast-xml-parser (BOEK-016)

  // Account IBAN
  const ibanMatch = content.match(/<IBAN>([^<]+)<\/IBAN>/);
  if (ibanMatch) accountIban = ibanMatch[1].trim();

  // Account name
  const nameMatch = content.match(/<Nm>([^<]+)<\/Nm>/);
  if (nameMatch) accountName = nameMatch[1].trim();

  // Extract all <Ntry> blocks. [M5] Bound the entry count: a crafted file within the upload
  // size cap can pack a huge number of tiny entries, and per-entry regex work then burns the
  // request's CPU for seconds-to-minutes. A real quarterly statement is well under this cap;
  // once reached we stop and report rather than parse an abusive file to completion.
  const MAX_CAMT_ENTRIES = 50000;
  const ntryPattern = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let ntryMatch: RegExpExecArray | null;
  let scanned = 0; // count every <Ntry> scanned, not just the ones that parsed to a tx

  while ((ntryMatch = ntryPattern.exec(content)) !== null) {
    if (scanned >= MAX_CAMT_ENTRIES) {
      errors.push(`CAMT.053 bevat meer dan ${MAX_CAMT_ENTRIES} transacties — verwerking gestopt; splits het bestand.`);
      break;
    }
    scanned++;
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
    statementBalance: parseCamtStatementBalance(content, currency),
  };
}

// [M4] YYYY-MM-DD that is also a real calendar date (rejects 9999-99-99, 2026-13-40, a
// datetime, or trailing junk). [GOCARDLESS] Exported so the API sync guards its dates
// with the SAME check — a malformed date reaching a Postgres `date` column fails the
// whole batch INSERT, and the ingest swallows that, silently dropping every transaction.
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
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
  // [H3] A non-finite amount (NaN from "abc", Infinity from "1e309") must NEVER reach the
  // database — it poisons every downstream sum (reconciliation, quarter totals). Drop the
  // single entry with a clear error rather than write a corrupt figure. MT940/CSV/EFT guard
  // the same way.
  if (!Number.isFinite(rawAmount)) {
    errors.push(`Ongeldig transactiebedrag in CAMT.053 entry: "${amtMatch[2]}"`);
    return null;
  }

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
  // [M4] Validate the date SHAPE before it flows to a Postgres `date` column. A single
  // malformed value ("9999-99-99", a datetime, garbage) would fail the whole batch INSERT,
  // which the ingest swallows → every transaction silently dropped while the file still
  // reads "verwerkt". Drop just this entry and warn instead of losing the batch.
  if (!isValidIsoDate(date)) {
    errors.push(`Ongeldige transactiedatum in CAMT.053 entry: "${date}"`);
    return null;
  }

  // [BANK-PARSE-CAMT-ALLDTLS] EVERY <TxDtls> of the entry, not just the first.
  //
  // Two separate losses lived in the old single-match version, and both are the CAMT twin of the
  // MT940 bug [BANK-PARSE-MULTILINE] already fixes on the other side of this file:
  //
  //   1. <Ustrd> repeats. ISO 20022 caps one element at 140 characters, so banks SPLIT a long
  //      remittance across several of them. Reading only the first truncated the text at 140
  //      chars — and an invoice number past that point simply did not exist as far as the app was
  //      concerned: no reference extracted, no batch resolved, the payment landed in "Geen
  //      factuur" for a statement that named its invoice perfectly well.
  //   2. <TxDtls> repeats too, on a collection/batch entry (a direct-debit run, a POS
  //      settlement). Only the first sub-transaction's remittance was read; every other one was
  //      dropped with no warning.
  //
  // The entry's <Amt> is the booked total and stays the money-truth — this only recovers the
  // TEXT, so no figure moves. Joining every part is also the conservative direction downstream:
  // more reference tokens make parseReferenceNumbers report a multi-invoice line, which BLOCKS
  // unattended auto-booking (autoConfirmTier bails above one number) and makes planBatchAutoConfirm
  // stricter (an unresolved token aborts the whole batch). It can only surface an invoice number
  // that was already printed in the statement; it can never invent one.
  const txDtlsBlocks = [...block.matchAll(/<TxDtls>([\s\S]*?)<\/TxDtls>/g)].map((m) => m[1]);
  // The party / EndToEndId still come from the FIRST sub-transaction, exactly as before: on a
  // batch they are per-sub-transaction and there is no single right answer, so nothing is guessed.
  const txDtls = txDtlsBlocks[0] ?? "";

  // Unstructured remittance info — every <Ustrd> of every <TxDtls>, in document order,
  // de-duplicated so a bank that repeats the same line does not double it.
  const ustrdParts: string[] = [];
  for (const dtls of txDtlsBlocks) {
    for (const m of dtls.matchAll(/<Ustrd>([^<]+)<\/Ustrd>/g)) {
      const part = decodeXmlEntities(m[1].trim());
      if (part && !ustrdParts.includes(part)) ustrdParts.push(part);
    }
    // [CAMT-STRD-REF] STRUCTURED remittance. A betaalverzoek/incasso often carries its
    // betalingskenmerk ONLY as <Strd><CdtrRefInf><Ref> — no <Ustrd> at all — and that reference
    // was never read: the transaction imported with an empty description and a null reference,
    // unmatchable while the payment literally carried its invoice number in a machine-readable
    // field. Append it to the remittance parts so extractInvoiceReference sees it through the
    // exact same pipeline (POS guard, bare-year drop, multi-number join) as free text.
    for (const m of dtls.matchAll(/<CdtrRefInf>[\s\S]*?<Ref>([^<]+)<\/Ref>/g)) {
      const part = decodeXmlEntities(m[1].trim());
      if (part && !ustrdParts.includes(part)) ustrdParts.push(part);
    }
  }
  const description = ustrdParts.join(" ");

  // Counterpart — check both Dbtr (debtor = payer) and Cdtr (creditor = receiver)
  const counterpartBlock =
    txDtls.match(/<RltdPties>([\s\S]*?)<\/RltdPties>/)?.[1] ?? "";

  // For credit transactions, counterpart is the Debtor
  // For debit transactions, counterpart is the Creditor
  const partyTag = isCredit ? "Dbtr" : "Cdtr";
  const partyNameMatch = counterpartBlock.match(
    // [CAMT-V8-PTY] camt.053.001.08 — the current "new format" Rabobank/ABN offer — wraps the
    // party as <Dbtr><Pty><Nm>; v2 has <Dbtr><Nm> directly. Without the optional wrapper the
    // name silently missed and the [BANK-PARSE-READABLE] fallback installed the REMITTANCE TEXT
    // as the counterpart ("factuur 26302050" as a payer name) on every line of every v8 file,
    // while the IBAN still parsed — a fully-parsed-looking row with a wrong party.
    new RegExp(`<${partyTag}>\\s*(?:<Pty>\\s*)?<Nm>([^<]+)<\\/Nm>`)
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
  // [BANK-REF-ONE-SOURCE] Call extractInvoiceReference instead of re-implementing its general
  // case here. The inline copy that stood here lacked the SEPA-incasso rule, so a REMI like
  // "/IncassobatchId/26-06-0001/OpdrachtId/994872215/Betaling fact. 1260405" produced
  // "0001, 994872215, 1260405" in CAMT where MT940 produced only the invoice number. Three
  // failures followed from that one divergence:
  //   1. contentKey() includes the reference, so the SAME transaction imported from MT940 and
  //      from CAMT got DIFFERENT dedup keys → a double insert → doubled kosten/omzet.
  //   2. parseReferenceNumbers() counted 3 numbers → autoConfirmTier() returned null → the
  //      line silently stopped auto-booking.
  //   3. isFullyCovered() could never be satisfied, so the tx stayed actionable forever.
  // This is exactly the ONS IT Incasso bug the extractInvoiceReference header warns about:
  // two copies of one rule, only one of them fixed.
  let reference = extractInvoiceReference(description || null, {
    isPos: isPosEntry,
    isCard: false,
  });
  if (!reference && !isPosEntry) {
    reference = endToEndReference(txDtls.match(/<EndToEndId>([^<]+)<\/EndToEndId>/)?.[1]);
  }

  // Transaction ID
  const txIdMatch = block.match(/<NtryRef>([^<]+)<\/NtryRef>/);
  const transactionId = txIdMatch ? txIdMatch[1].trim() : null;

  // [BANK-PARSE-CARD] Same as MT940: a card purchase has no related party, so
  // derive the store name from the description and drop the terminal-noise ref.
  const camtTerminalText = CARD_TERMINAL_MARKERS.test(description);
  if (!counterpartName && camtTerminalText) {
    const store = deriveReadableName(description);
    if (store) counterpartName = store;
  }
  // [BANK-PARSE-TERMINAL-REF] Same split as MT940, and for the same real line: the Geldmaat deposit
  // arrives with a named party, so the rescue above never fires and the terminal numbers survived
  // as the reference of the largest single amount in the quarter.
  if (camtTerminalText) reference = null;
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
  const result = parseMT940(content);
  // [BANK-FORMAT-HONEST] A text file that is NOT MT940 at all — an ABN .TAB portal download, a
  // copy-pasted overview, any delimited export the CSV sniffer didn't recognise — used to fall
  // through here and "parse" to ZERO transactions with ZERO warnings: the import then looked
  // successful while nothing was imported (the exact false-green trap [DETECT] closes for
  // spreadsheets). If the parse produced nothing AND the content carries none of the MT940 tag
  // anatomy, say so explicitly; a genuinely empty-but-real MT940 (has :20:/:25:/:60F:) stays
  // warning-free.
  if (result.transactions.length === 0 && !/^:\d{2}[A-Z]?:/m.test(content)) {
    result.parseErrors.push(
      "Dit bestand is niet herkend als bankafschrift (MT940/CAMT.053/CSV) — er zijn geen transacties geïmporteerd. Download het afschrift bij je bank als MT940 (.940/.sta) of CAMT.053 (.xml).",
    );
  }
  return result;
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