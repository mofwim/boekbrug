// ─────────────────────────────────────────────────────────
// src/lib/ai.ts
// [BoekBrug v1.2] — BOEK-018 — AI Layer
// Central Claude API client. Import from here only.
// Do not call Claude API directly from any other file.
//
// Usage examples:
//
// BOEK-011 Email Integration:
//   import { classifyDocument, verifyInvoiceFromPdf } from '@/lib/ai';
//
// BOEK-015 Onboarding:
//   import { translateToNL } from '@/lib/ai';
//
// BOEK-028 Accountant Dashboard:
//   import { composeDraftEmail } from '@/lib/ai';
//
// BOEK-029 ZZP Dashboard:
//   import { classifyExpense, generateInvoiceFromPrompt } from '@/lib/ai';
//
// BOEK-016 Bank Matching (v2.0):
//   import { matchTransaction } from '@/lib/ai';
// ─────────────────────────────────────────────────────────
//
// Rule: AI prepares + presents. Human confirms. System executes.
// ─────────────────────────────────────────────────────────

// [BOEK-018] constants — May 2026
//const CLAUDE_MODEL = 'claude-sonnet-4-5-20251001';  // [BOEK-018] fix: correct model name
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Base system prompt — shared by all functions
const SYSTEM_BASE = `You are an AI assistant for BoekBrug, a financial workflow platform in the Netherlands.

Rules you never break:
- Output language for invoices and emails: always Dutch (nl-NL)
- Number format: Dutch — 1.234,56
- Date format: Dutch — 15-05-2026
- Tone: professional but simple and clear
- Many users are not native Dutch speakers — keep language simple
- Return only JSON, no markdown, no explanation`;

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
export interface ClassifyDocumentResult {
  type: 'invoice' | 'receipt' | 'quote' | 'reminder' | 'ad' | 'unknown';
  confidence: number;
  vendor?: string;
  amount?: number;
  date?: string;
  isDuplicate?: boolean;
}

// [BOEK-011] Result of reading an actual PDF — May 2026
export interface VerifyInvoiceResult {
  is_invoice: boolean;       // true only if this is a real commercial invoice
  confidence: number;        // 0–1
  vendor?: string;           // who sent the invoice
  amount?: number;           // total amount including BTW (numeric) — alias of total_inc_btw
  invoice_number?: string;   // invoice number if found
  invoice_date?: string;     // DD-MM-YYYY
  // [PAY-SAFE-EXTRACT] Vendor payment details — the IBAN to PAY and the
  // payment reference (betalingskenmerk). Used later to PREPARE a payment
  // (EPC/SEPA QR or pre-filled details) the owner executes in their OWN bank.
  // BoekBrug never processes money — these only prepare it. Null when absent.
  vendor_iban?: string;      // the vendor's IBAN (party to be paid), normalized
  payment_reference?: string; // betalingskenmerk / structured payment reference
  reason?: string;           // why it was rejected (if is_invoice = false)
  // [BOEK-011] detailed BTW breakdown — extracted in the same call, zero extra cost
  total_ex_btw?: number;     // amount excluding BTW
  btw_amount?: number;       // the BTW amount itself
  total_inc_btw?: number;    // total including BTW
  btw_rate?: number;         // detected rate: 0, 9 or 21
  // [BRIDGE-EXTRACT] Per-field confidence (0–1) — lets the UI ask the user to
  // confirm ONLY the fields the AI is unsure about, instead of guessing silently.
  field_confidence?: {
    vendor?: number;
    invoice_number?: number;
    invoice_date?: number;
  };
}

export interface TranslateResult {
  translation: string;
  original: string;
}

export interface ComposeDraftEmailResult {
  subject: string;
  body: string;
}

export interface MatchTransactionResult {
  matched: boolean;
  invoice_id?: string;
  confidence: number;
  reason: string;
}

export interface ClassifyExpenseResult {
  category: 'fuel' | 'equipment' | 'subscription' | 'travel' | 'office' | 'other';
  btw_eligible: boolean;
  confidence: number;
}

// [BOEK-015] Company details extracted from an invoice during onboarding
export interface ExtractCompanyDetailsResult {
  company_name: string | null;
  kvk_number: string | null;   // 8 digits, Dutch KVK
  btw_number: string | null;   // NL + 9 digits + B + 2 digits
  iban: string | null;
  address: string | null;
  found: boolean;              // true if at least company_name or kvk was found
}

// [BOEK-018] GenerateInvoiceFromPromptResult type — May 2026
export interface GenerateInvoiceLineResult {
  description: string;
  quantity: number;
  unit_price: number;
  btw_rate: 0 | 9 | 21;
}

// [BOEK-018] fix: add description, amount, btw_rate top-level fields — May 2026
export interface GenerateInvoiceFromPromptResult {
  client_name: string;
  client_email?: string | null;
  description?: string;        // top-level summary of the work (optional)
  amount?: number;             // total amount incl. BTW if mentioned in prompt
  btw_rate?: 0 | 9 | 21;      // top-level btw_rate if a single rate applies to all lines
  lines: GenerateInvoiceLineResult[];
  notes?: string | null;
}

interface TransactionInput {
  amount: number;
  date: string;
  description: string;
  counterpart: string;
}

interface InvoiceInput {
  id: string;
  invoice_number: string;
  total_inc_btw: number;
  client_name: string;
  invoice_date: string;
}

// ─────────────────────────────────────────────────────────
// Base caller — text only
// [BOEK-018] core fetch wrapper — May 2026
// ─────────────────────────────────────────────────────────
async function callClaude(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude API returned unexpected response shape');
  }
  return content.text;
}

// ─────────────────────────────────────────────────────────
// [BOEK-011] cleanBase64 — normalize base64 before sending to Claude
// Handles: data URL prefix, base64url chars, whitespace, padding — May 2026
// ─────────────────────────────────────────────────────────
function cleanBase64(raw: string): string {
  // Remove data URL prefix if present (e.g. "data:application/pdf;base64,...")
  const withoutPrefix = raw.includes(",") ? raw.split(",")[1] : raw;

  // Convert base64url → standard base64, strip whitespace
  const normalized = withoutPrefix
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s/g, "");

  // [BOEK-011] Fix padding — base64 length must be a multiple of 4.
  // Gmail's base64url often drops trailing '=' padding. Claude rejects it.
  const remainder = normalized.length % 4;
  if (remainder === 0) return normalized;
  return normalized + "=".repeat(4 - remainder);
}

// ─────────────────────────────────────────────────────────
// PDF caller — sends actual PDF bytes to Claude
// [BOEK-011] reads the real content, not just metadata — May 2026
// ─────────────────────────────────────────────────────────
async function callClaudeWithPdf(
  pdfBase64: string,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  // [BOEK-011] Fix: clean base64 before sending — removes prefix and normalizes encoding
  const cleanData = cleanBase64(pdfBase64)

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25', // required for PDF support
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: cleanData,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude PDF API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude PDF API returned unexpected response shape');
  }
  return content.text;
}

// ─────────────────────────────────────────────────────────
// Image caller — sends image to Claude (for scanned invoices)
// [BOEK-011] handles image/jpeg, image/png, image/webp — May 2026
// ─────────────────────────────────────────────────────────
async function callClaudeWithImage(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  prompt: string,
  systemPrompt: string
): Promise<string> {
  // [BOEK-011] Fix: clean base64 before sending — removes prefix and normalizes encoding
  const cleanData = cleanBase64(imageBase64)

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: cleanData,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude Image API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude Image API returned unexpected response shape');
  }
  return content.text;
}

// Safe JSON parse — returns null on failure instead of throwing
function safeParseJSON<T>(text: string): T | null {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// 1. Classify a document or invoice (metadata only — fast)
// [BOEK-018] classifyDocument — May 2026
// Used by: BOEK-010 (file system upload — no binary available)
// Note: for email attachments use verifyInvoiceFromPdf instead
// ─────────────────────────────────────────────────────────
export async function classifyDocument(
  fileContent: string,
  fileName: string
): Promise<ClassifyDocumentResult> {
  const FALLBACK: ClassifyDocumentResult = { type: 'unknown', confidence: 0 };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You classify financial documents. Return only a JSON object with these exact keys:
{
  "type": "invoice" | "receipt" | "quote" | "reminder" | "ad" | "unknown",
  "confidence": number between 0 and 1,
  "vendor": string or null,
  "amount": number or null,
  "date": "DD-MM-YYYY" or null,
  "isDuplicate": boolean
}`;

    const prompt = `Classify this document.
File name: ${fileName}
Content (first 2000 chars): ${fileContent.slice(0, 2000)}

Classify as:
- invoice: has invoice number, amount, sender, receiver
- receipt: proof of payment, no invoice number required
- quote: offerte, aanbieding, prijs opgave
- reminder: herinnering, aanmaning
- ad: reclame, marketing, nieuwsbrief
- unknown: cannot determine

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ClassifyDocumentResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] classifyDocument failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 2. Verify invoice by reading actual PDF or image content
// [BOEK-011] verifyInvoiceFromPdf — May 2026
//
// This is the real verification — Claude reads the actual file.
// Used by: BOEK-011 (email pipeline — after fetching attachment)
//
// Flow:
//   PDF  → callClaudeWithPdf  (reads text + scanned)
//   image → callClaudeWithImage (reads photo of invoice)
//
// Returns is_invoice: false → file is discarded, never saved to DB
// Returns is_invoice: true  → file is saved with extracted data
// ─────────────────────────────────────────────────────────
export async function verifyInvoiceFromPdf(
  fileBase64: string,
  mimeType: string,
  filename: string,
  // [BRIDGE-EXTRACT] Who WE are — the receiver of this incoming invoice. When
  // provided, the AI must never return this name as the vendor (it's the client,
  // not the sender). Fixes the W.Ketels/Kiwi confusion. Optional → callers that
  // don't pass it keep the old behaviour.
  receiverName?: string | null
): Promise<VerifyInvoiceResult> {
  const FALLBACK: VerifyInvoiceResult = {
    is_invoice: false,
    confidence: 0,
    reason: 'AI verificatie mislukt — bestand overgeslagen',
  };

  // [BRIDGE-EXTRACT] Inject the receiver identity into the prompt when known.
  const receiverHint = receiverName
    ? `\n\nIMPORTANT — who the RECEIVER is:
- The recipient of this invoice is "${receiverName}" (this is OUR company, the client).
- "${receiverName}" is the RECEIVER, never the vendor/sender. Even if this name appears
  prominently (e.g. under "Factuur aan", "T.a.v.", or at the top), do NOT return it as "vendor".
- The vendor is the OTHER party — the company that issued and sent the invoice to us.`
    : '';

  const systemPrompt = `${SYSTEM_BASE}

You verify whether a document is a real commercial invoice.
Return only a JSON object with these exact keys:
{
  "is_invoice": boolean,
  "confidence": number between 0 and 1,
  "vendor": string or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "vendor_iban": string or null,
  "payment_reference": string or null,
  "total_ex_btw": number or null,
  "btw_amount": number or null,
  "total_inc_btw": number or null,
  "btw_rate": 0 | 9 | 21 or null,
  "field_confidence": {
    "vendor": number between 0 and 1,
    "invoice_number": number between 0 and 1,
    "invoice_date": number between 0 and 1
  },
  "reason": string or null
}

Rules for is_invoice = true:
- Must have a sender (vendor/company name)
- Must have a monetary amount
- Must be a request for payment OR proof of payment
- Can be: factuur, rekening, nota, bon, receipt, invoice

Vendor (sender) extraction rules — read carefully:
- "vendor" = the party that ISSUED and SENT the invoice (the supplier/leverancier).
  Usually shown in the header, near the logo, or labelled "Afzender" / "Factuur van".
- The RECEIVER/client (labelled "Factuur aan", "T.a.v.", "Aan", "Klant") is NOT the vendor.
- Never merge two names into one (e.g. do NOT output "Ketels/Kiwi" or "Atapack Kiwi").
  Return ONLY the sender's name.
- If sender and receiver are ambiguous, the vendor is the one whose bank/IBAN, KVK and
  BTW number appear as the party to be PAID — not the party being billed.

Invoice number extraction rules:
- The factuurnummer is the invoice's OWN identifier — usually the longest
  standalone number on the document (often 6+ digits, e.g. 26302362), printed
  next to a label like "Factuurnummer", "Factuur nr", "Invoice no", "Nr",
  "Referentie". Prefer the value directly tied to such a label.
- Do NOT confuse it with other numbers on the page:
  · PAGE indicators ("Pagina", "Page", "Blad", "Pag.") — a value like "1-1",
    "1 van 2", or "Pagina 1/3" is a PAGE number, never the invoice number.
  · Debiteurnummer / Klantnummer (customer number).
  · Ordernummer / Bestelnummer (order number).
  · Dates, KVK, BTW, or IBAN numbers.
- In crowded tables (many numbers close together), the page indicator often
  sits near "Pagina"; the real factuurnummer is the longer number tied to the
  invoice-number label, NOT the small "1-1"-style page value next to "Pagina".
- If you genuinely cannot find a clear invoice number (only a page/customer/
  order number is present), set invoice_number to null — never substitute one
  of those other numbers.

Vendor IBAN + payment reference extraction rules:
- "vendor_iban" = the bank account number (IBAN) of the VENDOR — the party to
  be PAID. It belongs to the SENDER/supplier, NOT to us (the receiver). It is
  usually near labels like "IBAN", "Rekeningnummer", "Bankrekening", "t.n.v.",
  or in the payment/footer block. A Dutch IBAN looks like "NL00BANK0123456789"
  (2 letters + 2 digits + 4 letters + 10 digits); foreign IBANs vary in length.
- Return the IBAN WITHOUT spaces, in UPPERCASE (e.g. "NL37BNGH0123456789").
- If MULTIPLE IBANs appear, prefer the one tied to the vendor / "to be paid".
  If you cannot tell which IBAN belongs to the vendor, set vendor_iban to null
  — never guess an IBAN, and never return our own (receiver) IBAN.
- "payment_reference" = the betalingskenmerk / structured payment reference the
  invoice asks you to quote when paying (labels: "Betalingskenmerk",
  "Kenmerk", "Referentie", "Mededeling", "Payment reference"). This is often
  DIFFERENT from the invoice number. If only an invoice number is given as the
  reference, set payment_reference to null (the system falls back to the invoice
  number). If genuinely absent, set it to null — never invent one.

Rules for is_invoice = false:
- Marketing emails, newsletters, ads
- Order confirmations WITHOUT a payment amount
- Shipping notifications
- Anything that is not a financial document
- Set reason to a short Dutch explanation why it was rejected

Amount extraction rules:
- All amounts are numeric only — no currency symbols, no thousand separators — e.g. 121.00
- total_ex_btw: the subtotal before BTW (excl. BTW / netto)
- btw_amount: the BTW/VAT amount shown on the invoice
- total_inc_btw: the final total to pay (incl. BTW / bruto)
- btw_rate: the percentage — usually 21, sometimes 9 or 0
- If only the total is shown and BTW rate is known, calculate the breakdown
- If a value genuinely cannot be found, set it to null — never guess
- confidence: how certain you are (0 = no idea, 1 = absolutely certain)

Per-field confidence rules:
- field_confidence.vendor: how certain you are the vendor (sender) is correct.
  LOW (< 0.7) if sender/receiver were ambiguous, names were close, or the layout was unclear.
- field_confidence.invoice_number: LOW if you had to guess, or the only candidate looked
  like a page number, customer number, or date rather than a clear invoice number.
- field_confidence.invoice_date: LOW if multiple dates were present (invoice / due / delivery)
  and it was unclear which is the invoice date.
- Be honest. A low score is BETTER than a confident wrong answer — the user will be asked
  to confirm low-confidence fields. Do not inflate these scores.${receiverHint}`;

  const prompt = `Verify if this document is a real invoice or receipt.
Filename: ${filename}

Read the full content and answer:
1. Is this a real financial document that requires or confirms payment?
2. Extract the vendor, invoice number, date
3. Extract the full amount breakdown: amount excl. BTW, BTW amount, total incl. BTW, BTW rate

Return JSON only.`;

  try {
    let result: string;

    if (mimeType === 'application/pdf') {
      // [BOEK-011] Validate PDF before sending — catch corrupt files early
      // A valid PDF base64 starts with "JVBERi0" (= "%PDF-")
      const cleaned = cleanBase64(fileBase64);
      if (!cleaned.startsWith('JVBERi0')) {
        console.warn(
          `[BOEK-011] Skipping invalid PDF "${filename}" — base64 starts with: ${cleaned.slice(0, 12)}`
        );
        return {
          is_invoice: false,
          confidence: 0,
          reason: 'Ongeldig PDF-bestand — overgeslagen',
        };
      }
      // Claude reads the actual PDF — text + scanned
      result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
    } else if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp' ||
      mimeType === 'image/gif'
    ) {
      // Claude reads the image directly
      result = await callClaudeWithImage(
        fileBase64,
        mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        prompt,
        systemPrompt
      );
    } else {
      // Unsupported type — skip safely
      return {
        is_invoice: false,
        confidence: 0,
        reason: `Bestandstype niet ondersteund: ${mimeType}`,
      };
    }

    const parsed = safeParseJSON<VerifyInvoiceResult>(result);
    if (!parsed) return FALLBACK;

    // Clamp confidence
    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));

    // [BRIDGE-EXTRACT] Normalize per-field confidence (clamp 0–1; default to a
    // neutral 1 when the AI omitted a field's score so we don't false-flag).
    const clamp01 = (v: unknown): number =>
      typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    parsed.field_confidence = {
      vendor: clamp01(parsed.field_confidence?.vendor),
      invoice_number: clamp01(parsed.field_confidence?.invoice_number),
      invoice_date: clamp01(parsed.field_confidence?.invoice_date),
    };

    // [BRIDGE-EXTRACT] Defensive guard: if the AI returned OUR name as the vendor
    // despite the prompt, drop it — the receiver is never the vendor. Loose match
    // (case-insensitive, trimmed) so "kiwi food market" ~ "Kiwi Food Market B.V."
    if (receiverName && parsed.vendor) {
      const norm = (s: string) => s.toLowerCase().replace(/\b(b\.?v\.?|v\.?o\.?f\.?|n\.?v\.?)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
      const v = norm(parsed.vendor);
      const r = norm(receiverName);
      if (v && r && (v === r || v.includes(r) || r.includes(v))) {
        parsed.vendor = undefined;          // never surface the receiver as vendor
        parsed.field_confidence.vendor = 0; // force-flag: the user must supply it
      }
    }

    // [BRIDGE-EXTRACT] Defensive guard: strip page-number patterns mistaken for
    // an invoice number. "1-1", "1 van 2", "Pagina 1/3" are pages, not invoices.
    if (parsed.invoice_number) {
      const inv = parsed.invoice_number.trim();
      const looksLikePage =
        /^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(inv) ||                 // 1-1, 1/2
        /^(pagina|page|blad|pag\.?)\b/i.test(inv) ||              // Pagina 1...
        /\bvan\b/i.test(inv);                                     // 1 van 2
      if (looksLikePage) {
        parsed.invoice_number = undefined;
        parsed.field_confidence.invoice_number = 0; // force-flag for confirmation
      }
    }

    // [PAY-SAFE-EXTRACT] Normalize the vendor payment fields.
    // IBAN: strip ALL whitespace, uppercase (canonical form for storage +
    // future mod-97 validation at QR-prepare time). Empty → undefined.
    // We do NOT validate the IBAN here (prepare-time concern) — we only
    // canonicalize so storage is consistent. An obviously-too-short value is
    // dropped to avoid persisting junk (a real IBAN is ≥15 chars).
    if (typeof parsed.vendor_iban === 'string') {
      const iban = parsed.vendor_iban.replace(/\s+/g, '').toUpperCase();
      parsed.vendor_iban =
        iban.length >= 15 && /^[A-Z0-9]+$/.test(iban) ? iban : undefined;
    } else {
      parsed.vendor_iban = undefined;
    }
    // payment_reference: trim; empty → undefined (the system falls back to the
    // invoice number when preparing a payment, so a missing reference is fine).
    if (typeof parsed.payment_reference === 'string') {
      const ref = parsed.payment_reference.trim();
      parsed.payment_reference = ref.length ? ref : undefined;
    } else {
      parsed.payment_reference = undefined;
    }

    // Enforce minimum confidence threshold
    // Below 0.6 → treat as not an invoice to avoid false positives
    if (parsed.confidence < 0.6) {
      return {
        is_invoice: false,
        confidence: parsed.confidence,
        reason: parsed.reason || 'Te lage zekerheid — bestand overgeslagen',
      };
    }

    // [BOEK-011] Normalize and reconcile amounts — never let bad numbers reach DB
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;

    parsed.total_ex_btw = num(parsed.total_ex_btw);
    parsed.btw_amount = num(parsed.btw_amount);
    parsed.total_inc_btw = num(parsed.total_inc_btw);
    parsed.btw_rate = num(parsed.btw_rate);

    // Reconcile: if total is missing but ex + btw exist → compute it
    if (parsed.total_inc_btw === undefined &&
        parsed.total_ex_btw !== undefined &&
        parsed.btw_amount !== undefined) {
      parsed.total_inc_btw = parsed.total_ex_btw + parsed.btw_amount;
    }
    // Reconcile: if ex is missing but total + btw exist → compute it
    if (parsed.total_ex_btw === undefined &&
        parsed.total_inc_btw !== undefined &&
        parsed.btw_amount !== undefined) {
      parsed.total_ex_btw = parsed.total_inc_btw - parsed.btw_amount;
    }

    // amount = total incl. BTW (kept for backward compatibility)
    parsed.amount = parsed.total_inc_btw ?? parsed.amount;

    return parsed;
  } catch (error) {
    console.error('[BOEK-011] verifyInvoiceFromPdf failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 3. Translate factuurregels to professional Dutch
// [BOEK-018] translateToNL — May 2026
// ─────────────────────────────────────────────────────────
export async function translateToNL(
  text: string,
  sourceLanguage: string
): Promise<TranslateResult> {
  const FALLBACK: TranslateResult = { translation: text, original: text };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You translate invoice line descriptions to professional Dutch.
Return only a JSON object:
{
  "translation": "professional Dutch translation",
  "original": "original text as given"
}`;

    const prompt = `Translate this invoice description to professional Dutch.
Source language: ${sourceLanguage}
Text: ${text}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<TranslateResult>(result);
    if (!parsed) return FALLBACK;

    parsed.original = text;
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] translateToNL failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 4. Compose Draft Queue email in Dutch
// [BOEK-018] composeDraftEmail — May 2026
// ─────────────────────────────────────────────────────────
export async function composeDraftEmail(
  accountantName: string,
  clientName: string,
  items: string[]
): Promise<ComposeDraftEmailResult> {
  const FALLBACK: ComposeDraftEmailResult = {
    subject: `Ontbrekende stukken — ${clientName}`,
    body: `Beste ${clientName},\n\nKun je de volgende stukken aanleveren?\n\n${items.map((i) => `- ${i}`).join('\n')}\n\nMet vriendelijke groet,\n${accountantName}`,
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You compose professional Dutch emails from accountants to their clients.
Return only a JSON object:
{
  "subject": "email subject line",
  "body": "full email body with greeting and sign-off"
}`;

    const prompt = `Compose a professional Dutch email from an accountant to a client requesting missing documents.

Accountant name: ${accountantName}
Client name: ${clientName}
Missing items:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ComposeDraftEmailResult>(result);
    if (!parsed) return FALLBACK;

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] composeDraftEmail failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 5. Match bank transaction to invoice
// [BOEK-018] matchTransaction — May 2026
// ─────────────────────────────────────────────────────────
export async function matchTransaction(
  transaction: TransactionInput,
  invoices: InvoiceInput[]
): Promise<MatchTransactionResult> {
  const FALLBACK: MatchTransactionResult = {
    matched: false,
    confidence: 0,
    reason: 'AI unavailable',
  };

  if (!invoices.length) {
    return { matched: false, confidence: 0, reason: 'No invoices to match against' };
  }

  try {
    const systemPrompt = `${SYSTEM_BASE}

You match bank transactions to invoices. Return only a JSON object:
{
  "matched": boolean,
  "invoice_id": "uuid string or null",
  "confidence": number between 0 and 1,
  "reason": "brief Dutch explanation"
}

Rules:
- confidence < 0.7 → set matched: false and invoice_id: null`;

    const prompt = `Match this bank transaction to one of the invoices below.

Transaction:
- Amount: €${transaction.amount}
- Date: ${transaction.date}
- Description: ${transaction.description}
- Counterpart: ${transaction.counterpart}

Invoices:
${invoices
  .map(
    (inv) =>
      `ID: ${inv.id} | Number: ${inv.invoice_number} | Amount: €${inv.total_inc_btw} | Client: ${inv.client_name} | Date: ${inv.invoice_date}`
  )
  .join('\n')}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<MatchTransactionResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    if (parsed.confidence < 0.7) {
      parsed.matched = false;
      parsed.invoice_id = undefined;
    }

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] matchTransaction failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 6. Classify expense from image/PDF description
// [BOEK-018] classifyExpense — May 2026
// ─────────────────────────────────────────────────────────
export async function classifyExpense(
  description: string,
  amount?: number
): Promise<ClassifyExpenseResult> {
  const FALLBACK: ClassifyExpenseResult = {
    category: 'other',
    btw_eligible: false,
    confidence: 0,
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You classify business expenses for Dutch ZZP'ers.
Return only a JSON object:
{
  "category": "fuel" | "equipment" | "subscription" | "travel" | "office" | "other",
  "btw_eligible": boolean,
  "confidence": number between 0 and 1
}`;

    const prompt = `Classify this business expense.
Description: ${description}
${amount !== undefined ? `Amount: €${amount}` : ''}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ClassifyExpenseResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] classifyExpense failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 7. Generate invoice data from a natural language prompt
// [BOEK-018] generateInvoiceFromPrompt — May 2026
// Used by: BOEK-029 (ZZP dashboard — quick invoice creation)
//
// User types e.g.: "Factuur voor Ahmed, website gebouwd, €1200"
// AI returns structured invoice data ready to prefill the form
// Human reviews and confirms before anything is saved
// ─────────────────────────────────────────────────────────
export async function generateInvoiceFromPrompt(
  prompt: string
): Promise<GenerateInvoiceFromPromptResult> {
  const FALLBACK: GenerateInvoiceFromPromptResult = {
    client_name: '',
    lines: [],
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You generate structured invoice data from a natural language description.
Return only a JSON object with these exact keys:
{
  "client_name": "name of the client (string, required)",
  "client_email": "email address of the client or null",
  "description": "short professional Dutch summary of the work (optional, single sentence)",
  "amount": number or null (total amount incl. BTW if clearly stated in the prompt),
  "btw_rate": 0 | 9 | 21 or null (top-level rate if all lines share the same rate),
  "lines": [
    {
      "description": "professional Dutch description of the work or product",
      "quantity": number,
      "unit_price": number (excluding BTW),
      "btw_rate": 0 | 9 | 21
    }
  ],
  "notes": "optional invoice notes in Dutch or null"
}

Rules:
- client_name is required — extract from the prompt or use empty string if not found
- lines must have at least one item if any work is described
- description (top-level): short Dutch summary, e.g. "Ontwikkeling website" — optional
- amount (top-level): only if the user mentioned a total price — numeric, incl. BTW
- btw_rate (top-level): set if all lines share the same rate, else null
- line description must always be professional Dutch — translate if needed
- quantity defaults to 1 if not mentioned
- unit_price must be excluding BTW (excl. BTW)
- line btw_rate defaults to 21 if not mentioned
- btw_rate 9 applies to: food, books, medicine, public transport, some services
- btw_rate 0 applies to: exports outside EU, certain exempt services
- notes: add only if the user mentioned special payment terms or remarks
- Never invent information not present in the prompt`;

    const userPrompt = `Generate invoice data from this description:

"${prompt}"

Extract: who is the client, what was delivered, at what price, and any special notes.
If a price is given including BTW, calculate the excl. BTW price based on the btw_rate.
Return JSON only.`;

    const result = await callClaude(userPrompt, systemPrompt);
    const parsed = safeParseJSON<GenerateInvoiceFromPromptResult>(result);
    if (!parsed) return FALLBACK;

    // [BOEK-018] sanitize all fields — May 2026

    // client_name must be a string
    if (typeof parsed.client_name !== 'string') {
      parsed.client_name = '';
    }

    // description: optional string
    if (parsed.description !== undefined && typeof parsed.description !== 'string') {
      parsed.description = undefined;
    }

    // amount: optional positive number
    if (parsed.amount !== undefined) {
      if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
        parsed.amount = undefined;
      }
    }

    // btw_rate (top-level): enforce 0 | 9 | 21 or undefined
    if (parsed.btw_rate !== undefined) {
      const validRates = [0, 9, 21] as const;
      if (!validRates.includes(parsed.btw_rate as 0 | 9 | 21)) {
        parsed.btw_rate = undefined;
      }
    }

    // lines: must be an array
    if (!Array.isArray(parsed.lines)) {
      parsed.lines = [];
    }

    parsed.lines = parsed.lines.map((line) => ({
      description: typeof line.description === 'string' ? line.description : '',
      quantity: typeof line.quantity === 'number' && line.quantity > 0 ? line.quantity : 1,
      unit_price: typeof line.unit_price === 'number' ? line.unit_price : 0,
      // Enforce btw_rate per line — default to 21
      btw_rate: ([0, 9, 21] as const).includes(line.btw_rate as 0 | 9 | 21)
        ? (line.btw_rate as 0 | 9 | 21)
        : 21,
    }));

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] generateInvoiceFromPrompt failed:', error);
    return FALLBACK;
  }
}
// ─────────────────────────────────────────────────────────
// 8. Extract company registration details from invoice
// [BOEK-015] extractCompanyDetails — May 2026
//
// Used by: BOEK-015 Onboarding — Step 3A (AI upload flow)
// Reads actual PDF or image content and extracts the SENDER's
// business registration data: bedrijfsnaam, KVK, BTW, IBAN
//
// Safe fallback: { found: false, all fields null }
// Never throws — onboarding continues even if AI fails
// ─────────────────────────────────────────────────────────
export async function extractCompanyDetails(
  fileBase64: string,
  mimeType: string,
  filename: string
): Promise<ExtractCompanyDetailsResult> {
  const FALLBACK: ExtractCompanyDetailsResult = {
    company_name: null,
    kvk_number: null,
    btw_number: null,
    iban: null,
    address: null,
    found: false,
  };

  // [BOEK-015] improved prompt — more examples, looser matching, explicit label variants
  const systemPrompt = `${SYSTEM_BASE}

You are extracting Dutch business registration data from an invoice or receipt.
Extract ONLY the SENDER's data — the company or person who issued/sent this document.
Do NOT extract the receiver/client data.

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{
  "company_name": string or null,
  "kvk_number": string or null,
  "btw_number": string or null,
  "iban": string or null,
  "address": string or null,
  "found": boolean
}

Extraction rules:
- company_name: the trading name or legal name of the sender. Look for it at the top of the document, in the header, or next to the logo.
- kvk_number: labeled as "KVK", "K.v.K.", "KvK-nummer", "Kvk", "Chamber of Commerce", "CoC". Extract digits only, ignore spaces and dots. Example: "KVK: 12 34 56 78" → "12345678"
- btw_number: labeled as "BTW", "BTW-nr", "BTW-nummer", "VAT", "VAT number", "Btw-id". Format: NL + digits + B + digits. Example: "BTW: NL 123456789 B01" → "NL123456789B01". Remove all spaces.
- iban: labeled as "IBAN", "Bankrekeningnummer", "Rekeningnummer". Keep full IBAN with country code, remove spaces.
- address: street name + house number of the sender only. Exclude city and postal code.
- found: set to true if at least company_name OR kvk_number was successfully extracted.
- If a field truly does not appear in the document, set it to null.`;

  const prompt = `Extract the SENDER's business registration details from this invoice document.
Filename: ${filename}

The sender is the company/person who created and sent this invoice (usually shown in the header or top section).

Search carefully for:
1. Company name / Bedrijfsnaam (top of document, near logo)
2. KVK number — may appear as: KVK, K.v.K., KvK-nummer, CoC (8 digits)
3. BTW number — may appear as: BTW, BTW-nr, BTW-nummer, VAT (format: NL123456789B01)
4. IBAN — may appear as: IBAN, Bankrekeningnummer, Rekeningnummer
5. Street address of the sender (not the client)

Return JSON only. If unsure between sender and receiver, choose the one at the TOP of the document.`;

  try {
    let raw: string;

    if (mimeType === 'application/pdf') {
      raw = await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
    } else if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp' ||
      mimeType === 'image/gif'
    ) {
      raw = await callClaudeWithImage(
        fileBase64,
        mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        prompt,
        systemPrompt
      );
    } else {
      // Unsupported type — treat as text extraction best-effort
      raw = await callClaude(
        `Filename: ${filename}\n${prompt}`,
        systemPrompt
      );
    }

    const parsed = safeParseJSON<ExtractCompanyDetailsResult>(raw);
    if (!parsed) return FALLBACK;

    // [BOEK-015] Sanitize KVK — digits only, 7-8 digits accepted
    if (parsed.kvk_number) {
      const kvkClean = parsed.kvk_number.replace(/\D/g, '');
      // Accept 7 or 8 digits — some older KVK numbers are 7 digits
      parsed.kvk_number = (kvkClean.length >= 7 && kvkClean.length <= 8) ? kvkClean : null;
    }

    // [BOEK-015] Sanitize BTW — remove spaces/dots, normalize to NLxxxxxxxxxBxx
    if (parsed.btw_number) {
      const btwClean = parsed.btw_number.replace(/[\s.\-]/g, '').toUpperCase();
      // Accept standard Dutch BTW format
      parsed.btw_number = /^NL\d{9}B\d{2}$/.test(btwClean) ? btwClean : null;
    }

    // [BOEK-015] Sanitize IBAN — remove spaces, uppercase
    if (parsed.iban) {
      const ibanClean = parsed.iban.replace(/\s/g, '').toUpperCase();
      // Basic IBAN validation: 2 letters + digits, 10-34 chars
      parsed.iban = /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(ibanClean) ? ibanClean : null;
    }

    // Recompute found after sanitization
    parsed.found = !!(parsed.company_name || parsed.kvk_number);

    return parsed;
  } catch (error) {
    console.error('[BOEK-015] extractCompanyDetails failed:', error);
    return FALLBACK;
  }
}