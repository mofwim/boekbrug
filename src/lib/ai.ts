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
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
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
  amount?: number;           // total amount including BTW (numeric)
  invoice_number?: string;   // invoice number if found
  invoice_date?: string;     // DD-MM-YYYY
  reason?: string;           // why it was rejected (if is_invoice = false)
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

// [BOEK-018] GenerateInvoiceFromPromptResult type — May 2026
export interface GenerateInvoiceLineResult {
  description: string;
  quantity: number;
  unit_price: number;
  btw_rate: 0 | 9 | 21;
}

export interface GenerateInvoiceFromPromptResult {
  client_name: string;
  client_email?: string;
  lines: GenerateInvoiceLineResult[];
  notes?: string;
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
// PDF caller — sends actual PDF bytes to Claude
// [BOEK-011] reads the real content, not just metadata — May 2026
// ─────────────────────────────────────────────────────────
async function callClaudeWithPdf(
  pdfBase64: string,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
                data: pdfBase64,
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
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
                data: imageBase64,
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
  filename: string
): Promise<VerifyInvoiceResult> {
  const FALLBACK: VerifyInvoiceResult = {
    is_invoice: false,
    confidence: 0,
    reason: 'AI verificatie mislukt — bestand overgeslagen',
  };

  const systemPrompt = `${SYSTEM_BASE}

You verify whether a document is a real commercial invoice.
Return only a JSON object with these exact keys:
{
  "is_invoice": boolean,
  "confidence": number between 0 and 1,
  "vendor": string or null,
  "amount": number or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "reason": string or null
}

Rules for is_invoice = true:
- Must have a sender (vendor/company name)
- Must have a monetary amount
- Must be a request for payment OR proof of payment
- Can be: factuur, rekening, nota, bon, receipt, invoice

Rules for is_invoice = false:
- Marketing emails, newsletters, ads
- Order confirmations WITHOUT a payment amount
- Shipping notifications
- Anything that is not a financial document
- Set reason to a short Dutch explanation why it was rejected

confidence: how certain you are (0 = no idea, 1 = absolutely certain)
amount: numeric only — no currency symbols, no dots/commas — e.g. 121.00`;

  const prompt = `Verify if this document is a real invoice or receipt.
Filename: ${filename}

Read the full content and answer: is this a real financial document that requires or confirms payment?

Return JSON only.`;

  try {
    let result: string;

    if (mimeType === 'application/pdf') {
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

    // Enforce minimum confidence threshold
    // Below 0.6 → treat as not an invoice to avoid false positives
    if (parsed.confidence < 0.6) {
      return {
        is_invoice: false,
        confidence: parsed.confidence,
        reason: parsed.reason || 'Te lage zekerheid — bestand overgeslagen',
      };
    }

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
- description must always be professional Dutch — translate if needed
- quantity defaults to 1 if not mentioned
- unit_price must be excluding BTW (excl. BTW)
- btw_rate defaults to 21 if not mentioned
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

    // Sanitize lines
    if (!Array.isArray(parsed.lines)) {
      parsed.lines = [];
    }

    parsed.lines = parsed.lines.map((line) => ({
      description: typeof line.description === 'string' ? line.description : '',
      quantity: typeof line.quantity === 'number' && line.quantity > 0 ? line.quantity : 1,
      unit_price: typeof line.unit_price === 'number' ? line.unit_price : 0,
      // Enforce btw_rate is only 0, 9, or 21 — default to 21
      btw_rate: ([0, 9, 21] as const).includes(line.btw_rate as 0 | 9 | 21)
        ? (line.btw_rate as 0 | 9 | 21)
        : 21,
    }));

    // client_name must be a string
    if (typeof parsed.client_name !== 'string') {
      parsed.client_name = '';
    }

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] generateInvoiceFromPrompt failed:', error);
    return FALLBACK;
  }
}