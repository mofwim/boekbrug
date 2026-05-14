// lib/bank-parser.ts
// Bank statement parsers: MT940 + CAMT.053 (BOEK-014 — read only)
// Parsed transactions are returned as BankTransaction[] — not saved to DB yet.
// Saving + matching happens in BOEK-016 (Bank Matching Engine).

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
  format: "MT940" | "CAMT053";
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

export function parseMT940(content: string): ParseResult {
  const errors: string[] = [];
  const transactions: BankTransaction[] = [];

  let accountIban: string | null = null;
  let accountName: string | null = null;
  let currency = "EUR";

  // Normalize line endings
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into tag blocks — each tag starts with :XX: at line start
  const tagPattern = /^:(\d{2}[A-Z]?):([\s\S]*?)(?=^:\d{2}[A-Z]?:|$)/gm;
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

function parseMT940Description(line86: string): {
  description: string;
  counterpartName: string | null;
  counterpartIban: string | null;
  reference: string | null;
} {
  if (!line86) {
    return {
      description: "",
      counterpartName: null,
      counterpartIban: null,
      reference: null,
    };
  }

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
  const counterpartName =
    fields["NAME"] ?? fields["BENM"] ?? fields["ORDP"] ?? null;
  const counterpartIban =
    fields["IBAN"] ?? fields["BNAM"] ?? null;
  const reference =
    fields["REMI"] ?? fields["EREF"] ?? fields["KREF"] ?? null;

  // Description: use REMI or fall back to full line86 cleaned up
  const description =
    fields["REMI"] ??
    fields["OWNR"] ??
    line86.replace(/\/[A-Z]{2,4}\//g, " ").replace(/\s+/g, " ").trim();

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
  const description = ustrdMatch ? ustrdMatch[1].trim() : "";

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

  const counterpartName = partyNameMatch ? partyNameMatch[1].trim() : null;
  const counterpartIban = partyIbanMatch ? partyIbanMatch[1].trim() : null;

  // End-to-end reference
  const e2eMatch = txDtls.match(/<EndToEndId>([^<]+)<\/EndToEndId>/);
  const reference = e2eMatch ? e2eMatch[1].trim() : null;

  // Transaction ID
  const txIdMatch = block.match(/<NtryRef>([^<]+)<\/NtryRef>/);
  const transactionId = txIdMatch ? txIdMatch[1].trim() : null;

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