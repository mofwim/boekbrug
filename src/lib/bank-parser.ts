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
  let reference: string | null = null;
  const remi = fields["REMI"] ?? null;
  const isPos = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(line86);

  if (remi && !isPos) {
    // All runs of >=3 digits, plus alphanumeric refs (RE0801378, GCZ26381430),
    // de-duplicated, in order. Drop bare years (2024–2029) from "voor juli 2026".
    const tokens = remi.match(/\b[A-Z]{0,3}\d{3,}[A-Z0-9]*\b/g);
    if (tokens && tokens.length > 0) {
      const isBareYear = (t: string) => /^20(2[4-9]|3\d)$/.test(t);
      const meaningful = tokens.filter((t) => !isBareYear(t));
      const pool = meaningful.length > 0 ? meaningful : tokens;
      const seen = new Set<string>();
      reference = pool.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(", ");
    } else {
      // No usable number → keep a cleaned REMI (strip USTD noise + slashes).
      // "USTD" is an ING transaction-type marker, not a reference; if nothing
      // meaningful remains, leave reference null rather than show "UST"/"US".
      const cleaned = remi
        .replace(/\bUSTD?\b/g, "")
        .replace(/[/]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      reference = cleaned.length >= 3 ? cleaned : null;
    }
  }
  if (!reference && !isPos) {
    const fb = fields["EREF"] ?? fields["KREF"] ?? null;
    reference = fb ? fb.replace(/[/]+/g, "").trim() || null : null;
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

  const counterpartName = partyNameMatch ? decodeXmlEntities(partyNameMatch[1].trim()) : null;
  const counterpartIban = partyIbanMatch ? partyIbanMatch[1].trim() : null;

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
      const pool = meaningful.length > 0 ? meaningful : tokens;
      const seen = new Set<string>();
      reference = pool.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(", ");
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