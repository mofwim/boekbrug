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
// [BOEK-011 double-check m.1] Output token budget for Claude responses.
// The invoice JSON has 18 fields + nested field_confidence + a Dutch `reason`.
// At 1000 a complex invoice (long vendor name, full breakdown, detailed reason)
// could TRUNCATE mid-JSON → safeParseJSON fails → FALLBACK → the invoice is
// silently classified "not an invoice" and lost. 2000 gives ample headroom;
// the extra output tokens are a few cents and only billed when actually used.
const MAX_TOKENS = 2000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// [STATEMENT-GUARD] An unmistakable statement-of-account filename — an OVERVIEW of MULTIPLE
// invoices (with a summed total), never a single bookable invoice. Booking such a document
// as one invoice double-counts the invoices it summarises. Narrow on purpose: it excludes
// "aanmaning"/"herinnering", which can be a single-invoice reminder that IS bookable.
export function isStatementFilename(filename: string): boolean {
  return /(rekening|saldo)[-_ ]?overzicht|openstaande?[-_ ]?posten|overzicht[-_ ]?openstaande[-_ ]?facturen/i.test(filename || "");
}

// [CREDIT-BACKSTOP] A document whose printed TOTAL is negative is a credit / correction, even
// when the model did not tag it (e.g. an "expondo Factuurcorrectie — Full return" that never
// writes the word "Creditnota"). Returns true when the row must be treated as a creditnota so
// the negative amount is KEPT instead of being dropped to undefined (which turns a real
// -1.123,14 credit into an empty €0 record). A normal invoice's totals are positive, so this
// never mis-fires on a genuine purchase invoice.
export function shouldTreatAsCreditNote(
  taggedCredit: boolean | undefined,
  rawIncl: unknown,
  rawEx: unknown,
): boolean {
  if (taggedCredit === true) return true;
  const neg = (v: unknown) => typeof v === "number" && isFinite(v) && v < 0;
  const pos = (v: unknown) => typeof v === "number" && isFinite(v) && v > 0;
  // [HUNT-F2] A POSITIVE printed total is never a creditnota. A negative ex under a positive
  // total is an extraction error (e.g. a discount/korting line mis-read into the base), not a
  // credit — leave it for SAFECORE to flag rather than mis-classify it as a creditnota.
  if (pos(rawIncl)) return false;
  return neg(rawIncl) || neg(rawEx);
}

// [EX-INCL-FIX] Some suppliers mislabel the GROSS total as "Subtotaal", so extraction ends up
// with total_ex_btw == total_inc_btw while a real BTW is printed — an impossible combination
// (equal ex and incl implies zero BTW). The incl / paid total and the BTW are the reliable
// anchors (they match what left the bank), so recover the true base: ex = incl − btw. It fires
// ONLY on that exact contradiction (ex ≈ incl with |btw| > 0), so it can never mask a genuine
// mismatch. Sign-safe: on a creditnota (all negative) it yields the correct negative base.
export function fixExInclConfusion(
  ex: number | undefined,
  btw: number | undefined,
  incl: number | undefined,
): number | undefined {
  if (ex === undefined || btw === undefined || incl === undefined) return ex;
  if (Math.abs(btw) > 0.02 && Math.abs(ex - incl) < 0.02) {
    const newEx = incl - btw;
    // [HUNT-F1] Only accept the recomputation when the recovered base implies a PLAUSIBLE NL
    // BTW rate. A reverse-charge / "BTW verlegd" memo captured into btw_amount (ex=1000,
    // btw=210, incl=1000) would otherwise be silently "reconciled" into a fabricated €210
    // deductible BTW + a wrong ex, AND make SAFECORE's sum check pass. Rejecting an out-of-band
    // implied rate leaves ex untouched so SAFECORE holds the invoice for human review.
    const impliedRate = Math.abs(newEx) > 0.005 ? Math.round(Math.abs(btw / newEx) * 100) : 0;
    if (impliedRate >= 0 && impliedRate <= 21) return newEx;
  }
  return ex;
}

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

// [TRUST-UNCERTAIN] Decide what to do with a read given its overall confidence and
// whether it carries any invoice signal (a vendor or an amount). The old code hard-
// dropped everything below 0.6 as "not an invoice" — silently losing real but hard-
// to-read invoices. This never drops a signal-bearing read in the uncertain band;
// it routes it to human review instead. Pure + exported so it is unit-tested.
//   >= 0.60                         → 'accept'  (normal flow)
//   [0.35, 0.60) with signal        → 'review'  (flow to verify queue, FLAGGED)
//   < 0.35, or no invoice signal    → 'skip'    (spam / newsletter / unreadable)
export type ConfidenceBand = 'accept' | 'review' | 'skip';
export function decideConfidenceBand(confidence: number, hasInvoiceSignal: boolean): ConfidenceBand {
  if (!(confidence >= 0)) return 'skip'; // NaN/negative → skip
  if (confidence >= 0.6) return 'accept';
  if (confidence >= 0.35 && hasInvoiceSignal) return 'review';
  return 'skip';
}

// [BOEK-011] Result of reading an actual PDF — May 2026
export interface VerifyInvoiceResult {
  is_invoice: boolean;       // true only if this is a real commercial invoice
  confidence: number;        // 0–1
  // [TRUST-UNCERTAIN] The reader saw likely-invoice content but was NOT confident
  // it read it correctly (blurry photo, odd/foreign layout). Such an item is routed
  // to the human verify queue FLAGGED — never silently dropped. Distinct from
  // is_invoice:false (confidently NOT an invoice → quietly skipped).
  uncertain?: boolean;
  vendor?: string;           // who sent the invoice
  amount?: number;           // total amount including BTW (numeric) — alias of total_inc_btw
  invoice_number?: string;   // invoice number if found
  invoice_date?: string;     // DD-MM-YYYY
  // [EXTRACT-DUE-DATE] Two SEPARATE raw signals — the AI never computes the due
  // date itself (arithmetic stays in our code via safecore.deriveDueDate). It
  // only reports what the invoice literally states:
  //   due_date          → an EXPLICIT "Vervaldatum: 27-05-2026" if printed
  //   payment_term_days → a payment TERM ("Betaling binnen 14 dagen") as a number
  // Both null when absent; deriveDueDate() then applies the priority + math.
  due_date?: string;         // explicit due date if stated, "YYYY-MM-DD"
  payment_term_days?: number; // "binnen X dagen" term, in days
  // [PAY-SAFE-EXTRACT] Vendor payment details — the IBAN to PAY and the
  // payment reference (betalingskenmerk). Used later to PREPARE a payment
  // (EPC/SEPA QR or pre-filled details) the owner executes in their OWN bank.
  // BoekBrug never processes money — these only prepare it. Null when absent.
  vendor_iban?: string;      // the vendor's IBAN (party to be paid), normalized
  payment_reference?: string; // betalingskenmerk / structured payment reference
  // [SMART-INTAKE] What KIND of document this is, so the intake router can send
  // it to the right destination. A "receipt"/kassabon is a PAID proof; an
  // "invoice" is a payment request (usually unpaid). "other" → not a financial
  // document for the invoice pipeline (route to bestanden instead).
  document_kind?: "invoice" | "receipt" | "other";
  // [SMART-INTAKE] Did this document indicate it is ALREADY PAID? True for a
  // kassabon / pin-receipt (paid at the counter). The router uses this to
  // pre-suggest "paid" in the verify queue — the human still confirms (Pillar ⑤).
  is_paid?: boolean;
  // [BRIDGE-CREDITNOTA-SIGN] Is this a CREDITNOTA (credit note)? True only on
  // explicit evidence: a "Creditnota"/"Credit note" title, a CR-prefixed
  // number, or amounts printed negative. Routing is unaffected (a creditnota
  // still goes to the verify queue like any invoice — document_kind stays
  // 'invoice'); this flag drives invoice_type='creditnota' at storage and the
  // sign-inverted SAFECORE gate. Amounts on a creditnota are kept NEGATIVE as
  // printed — matching the outgoing creditnota route [BOEK-031].
  is_credit_note?: boolean;
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
    // [TRUST-AMOUNTS] The reader's own certainty about the AMOUNTS it read — the
    // money-truth. Only set when the model actually reports it; absent means "no
    // signal", NOT "certain" (import-health only flags a low score that is present).
    amount?: number;
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

// [BOEK-011 double-check m.3] Retry transient Claude failures once.
// A single 429 (rate limit) or 5xx during a big backfill would otherwise cost a
// whole sync round per invoice (the invoice isn't lost — email-integration
// retries next sync — but it's wasteful). One short backoff retry absorbs the
// common transient blips. We do NOT retry 4xx other than 429 (a 400 bad-PDF or
// 401 bad-key won't fix itself), and we cap at 2 attempts total to stay well
// inside the function time budget.
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  const isRetryable = (status: number) => status === 429 || status >= 500;

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok) return res
      if (attempt < 2 && isRetryable(res.status)) {
        // Respect Retry-After when present (seconds), else a short fixed backoff.
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5000)
          : 1200
        console.warn(`[BOEK-011] ${label} ${res.status} — retrying in ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      return res // non-retryable, or out of attempts → let caller read the error
    } catch (err) {
      // Network-level throw (DNS, socket) — retry once, then rethrow.
      lastErr = err
      if (attempt < 2) {
        console.warn(`[BOEK-011] ${label} network error — retrying`, err)
        await new Promise((r) => setTimeout(r, 1200))
        continue
      }
    }
  }
  throw lastErr ?? new Error(`${label}: request failed`)
}

// [BOEK-COST] Prompt caching. The system prompt (the long extraction rules,
// ~1.5k tokens) is identical on every invoice call, so we mark it cacheable:
// the first call in a 5-minute window pays a small write premium (1.25×), every
// subsequent call reads it at 0.1× — a 90% discount on that portion. During a
// backfill (dozens of calls per minute) almost all calls are cache hits.
// After image downscaling the system prompt is the LARGEST remaining input, so
// this is where the second-biggest saving now lives. Structured as a
// single-element array so a plain string can't accidentally lose the marker;
// prompt caching is GA (no beta header needed).
function cacheableSystem(systemPrompt: string): Array<{
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}> {
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
}

async function callClaude(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: cacheableSystem(systemPrompt),
      messages: [{ role: 'user', content: prompt }],
    }),
  }, 'Claude API')

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
// [PDF-OPTIMIZE] Text-layer extraction — the cost lever for text PDFs
// ─────────────────────────────────────────────────────────
//
// WHY: a text PDF (exported from an accounting program — the majority of our
// supplier invoices: BALKIP, FAMZFOOD, Dutch Sweets, Ketels) sent RAW through
// Claude's document API costs ~2425 input tokens, because Claude both reads the
// text layer AND renders the page as an image internally. If we extract the
// text ourselves and send TEXT ONLY, the same invoice costs ~840 tokens — a
// measured ~65% saving, with SAFECORE verified: on real Kiwi data Claude
// returned byte-identical amounts on both paths, and the "Nieuwe schuld"
// running-balance trap did NOT hijack the total.
//
// SCOPE (deliberately narrow — we do NOT touch what works):
//   · This ONLY affects TEXT PDFs. A scanned PDF (image inside a PDF) yields
//     little/no extractable text → we return null → caller keeps the EXISTING
//     raw-PDF path unchanged. Scanned invoices behave EXACTLY as before.
//   · CONSERVATIVE gate: we take the text path ONLY on strong evidence the PDF
//     is genuinely text (plenty of characters AND digits). Any doubt → null →
//     raw path. The asymmetry is intentional: a wrong "text" verdict could send
//     a partial extraction to Claude (bad); a wrong "scanned" verdict just sends
//     the raw PDF (safe, only costlier). We always err toward the safe/raw side.
//
// SAFETY:
//   · FAIL-SAFE: any error (pdfjs missing, decode failure, client context)
//     returns null → caller uses the raw PDF. Cost optimisation must never drop
//     or corrupt an invoice.
//   · typeof window guard — pdfjs is server-only; on the client we skip.
//   · Downstream SAFECORE (ex+btw=total) still validates, a second net.
//
// Returns the extracted text when the PDF is confidently text-based, else null.
async function extractPdfTextIfTextLayer(pdfBase64: string): Promise<string | null> {
  // Conservative thresholds — a real text invoice has abundant text + numbers.
  // Below these we do NOT trust extraction and fall back to the raw PDF.
  const MIN_CHARS = 100;
  const MIN_DIGITS = 20;

  try {
    // pdfjs is a server-only ESM module. On the client, skip (fail-safe → raw).
    if (typeof window !== 'undefined') return null;

    const clean = cleanBase64(pdfBase64);
    const bytes = Buffer.from(clean, 'base64');

    // [PDF-OPTIMIZE] Use `unpdf` for text extraction. It bundles a serverless
    // build of pdf.js that MOCKS the canvas dependency, so it works on Vercel
    // without @napi-rs/canvas — unlike importing pdfjs-dist/legacy directly,
    // which tries to load @napi-rs/canvas at import time and FAILS on serverless
    // (observed in prod: "Cannot find module '@napi-rs/canvas'" → import returns
    // null → we silently fell back to raw for EVERY PDF, i.e. zero saving).
    // Verified: unpdf extracts byte-identical text to pdfjs v6 on real Kiwi data
    // (same char/digit counts, all critical amounts + the "Nieuwe schuld" trap
    // separation preserved), so SAFECORE parity holds.
    const unpdf = await import('unpdf').catch(() => null);
    if (!unpdf) {
      console.warn('[PDF-OPTIMIZE] unpdf unavailable — using raw PDF path');
      return null;
    }

    const doc = await unpdf.getDocumentProxy(new Uint8Array(bytes));
    const { text: extracted } = await unpdf.extractText(doc, { mergePages: true });
    const text = (extracted ?? '').trim();

    // Confidence gate — strong evidence this is a genuine text PDF, not a scan
    // with a few stray characters. Both conditions must hold.
    const chars = text.replace(/\s/g, '').length;
    const digits = (text.match(/\d/g) || []).length;
    if (chars < MIN_CHARS || digits < MIN_DIGITS) {
      console.log('[PDF-OPTIMIZE] Weak text layer — raw PDF path', { chars, digits });
      return null;
    }

    console.log('[PDF-OPTIMIZE] Text PDF → text path', { chars, digits });
    return text;
  } catch (err) {
    // FAIL-SAFE: never let extraction trouble drop or corrupt an invoice.
    console.warn('[PDF-OPTIMIZE] Text extraction failed — using raw PDF', err);
    return null;
  }
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

  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
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
      system: cacheableSystem(systemPrompt),
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
  }, 'Claude PDF API');

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
// [BOEK-COST] Image downscaling before Claude
// ─────────────────────────────────────────────────────────
//
// WHY: real usage data (2026-07) showed ~21,000 tokens per attachment —
// ~4× our estimate — because camera photos of invoices are sent at full
// resolution. Claude charges (width × height) / 750 tokens for an image, so a
// 12-megapixel phone photo is ~16,000 image tokens. Capping the long edge at
// 1568px (Anthropic's recommended max) brings that to ~1,600 tokens: a ~90%
// cut on image cost with NO provider change and NO accuracy loss — 1568px on
// an A4 page is ~185 DPI, well above the ~150 DPI needed to read invoice
// figures reliably.
//
// SAFETY (this decides whether Claude reads the amounts correctly):
//   · Only DOWNSCALE, never upscale — a small image is left untouched.
//   · 1568px long edge, JPEG quality 88 — deliberately conservative so digits
//     stay crisp. We are NOT chasing the smallest file; we're removing waste.
//   · FAIL-SAFE: any error (sharp missing, decode failure) returns the ORIGINAL
//     base64 unchanged. Cost optimisation must never drop or corrupt an invoice.
//   · SAFECORE downstream still validates ex+btw=total, so even in the unlikely
//     event a resize hurt a digit, the arithmetic check is a second net.
//
// Returns { data, mimeType }. When resized, mimeType becomes image/jpeg.
async function downscaleImageIfNeeded(
  base64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<{ data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  const MAX_EDGE = 1568
  const JPEG_QUALITY = 88

  try {
    // [BOEK-COST] sharp is a native, server-only module. ai.ts is (currently)
    // imported by some client components too, so we must ensure sharp is never
    // pulled into the browser bundle. Two defences:
    //   1. next.config: serverExternalPackages: ['sharp'] (the official fix)
    //   2. this runtime guard — if we're somehow on the client, skip resizing.
    // Either alone prevents the "module not found" build error; together they're
    // safe. On the client we just send the original (fail-safe path).
    if (typeof window !== 'undefined') {
      return { data: base64, mimeType }
    }

    // Dynamic import so a missing `sharp` can't break the module at load time —
    // if it's unavailable we simply skip resizing (fail-safe below).
    const sharpModule = await import('sharp').catch(() => null)
    if (!sharpModule) {
      console.warn('[BOEK-COST] sharp unavailable — sending image at original size')
      return { data: base64, mimeType }
    }
    const sharp = sharpModule.default ?? sharpModule

    const clean = base64.includes(',') ? base64.split(',')[1] : base64
    const inputBuffer = Buffer.from(clean, 'base64')

    const img = sharp(inputBuffer, { failOn: 'none' })
    const meta = await img.metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0

    // Already within budget → don't touch it (no upscaling, no re-encode).
    if (w > 0 && h > 0 && w <= MAX_EDGE && h <= MAX_EDGE) {
      return { data: base64, mimeType }
    }

    const outBuffer = await img
      .rotate() // respect EXIF orientation so text isn't sideways
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const beforeKB = Math.round(inputBuffer.length / 1024)
    const afterKB = Math.round(outBuffer.length / 1024)
    // Rough token proxy: image tokens ≈ (w×h)/750. Log both for verification.
    const beforeTok = w && h ? Math.round((w * h) / 750) : null
    console.log('[BOEK-COST] Image downscaled', {
      from: `${w}x${h}`,
      to: `≤${MAX_EDGE}`,
      beforeKB,
      afterKB,
      approxTokensBefore: beforeTok,
    })

    return { data: outBuffer.toString('base64'), mimeType: 'image/jpeg' }
  } catch (err) {
    // FAIL-SAFE: never let a resize error drop or corrupt an invoice image.
    console.warn('[BOEK-COST] Image downscale failed — sending original', err)
    return { data: base64, mimeType }
  }
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

  // [BOEK-COST] Downscale oversized photos before Claude sees them — the single
  // biggest cost lever (real data: ~21k → ~1.6k image tokens). Fail-safe:
  // returns the original untouched on any error, so an invoice is never lost.
  const { data: sendData, mimeType: sendMime } = await downscaleImageIfNeeded(
    cleanData,
    mimeType
  )

  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: cacheableSystem(systemPrompt),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: sendMime,
                data: sendData,
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
  }, 'Claude Image API');

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
  // [BOEK-011 double-check m.2] Robust extraction. Claude is told to return
  // JSON only, but occasionally wraps it in prose ("Here is the analysis: {…}
  // Note: …") or adds a trailing comma. A naive JSON.parse then fails →
  // FALLBACK → a real invoice is silently dropped. So:
  //   1. strip code fences
  //   2. if that doesn't parse, extract the widest {…} span and try that
  //   3. as a last resort, remove trailing commas before } or ]
  const stripped = text.replace(/```json|```/g, '').trim();

  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  // 1. Direct parse of the fence-stripped text.
  let out = tryParse(stripped);
  if (out) return out;

  // 2. Widest {…} span — handles leading/trailing prose around the JSON.
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const span = stripped.slice(first, last + 1);
    out = tryParse(span);
    if (out) return out;

    // 3. Last resort: drop trailing commas (",}" / ",]") then retry.
    const noTrailingCommas = span.replace(/,(\s*[}\]])/g, '$1');
    out = tryParse(noTrailingCommas);
    if (out) return out;
  }

  return null;
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
  "due_date": "YYYY-MM-DD" or null,
  "payment_term_days": number or null,
  "vendor_iban": string or null,
  "payment_reference": string or null,
  "document_kind": "invoice" | "receipt" | "other",
  "is_paid": boolean,
  "is_credit_note": boolean,
  "total_ex_btw": number or null,
  "btw_amount": number or null,
  "total_inc_btw": number or null,
  "btw_rate": 0 | 9 | 21 or null,
  "field_confidence": {
    "vendor": number between 0 and 1,
    "invoice_number": number between 0 and 1,
    "invoice_date": number between 0 and 1,
    "amount": number between 0 and 1
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

CRITICAL — a STATEMENT OF ACCOUNT is NOT a bookable invoice (set is_invoice=false):
- A "Rekeningoverzicht", "Openstaande posten", "Saldo-overzicht", "Overzicht openstaande
  facturen", "Aanmaning" or "Betalingsherinnering" that LISTS MULTIPLE invoices is an
  OVERVIEW, not a single invoice. Tell-tale signs, any of which is decisive:
  · a title containing "overzicht", "openstaand", "aanmaning" or "herinnering";
  · a TABLE whose columns are things like "Factuurnummer / Factuurbedrag / Reeds betaald /
    Nog openstaand / Vervallen / Factuurdatum";
  · TWO OR MORE different invoice numbers, each with its OWN amount and date;
  · a "Totaal openstaand bedrag" (or similar) that is the SUM of the listed lines.
- Booking such a document as one invoice is a SERIOUS error: its total DOUBLE-COUNTS the
  individual invoices it summarises (which arrive separately), and it has no single valid
  BTW breakdown (excl + BTW will never equal the total). So: is_invoice=false,
  document_kind="other", and reason e.g. "Rekeningoverzicht — overzicht van meerdere
  facturen, geen boekbare factuur".
- Exception: a reminder that repeats ONE single invoice (one number, one amount, one date)
  IS that invoice — treat it normally; the system de-duplicates it against the original.
  The rule above is ONLY for an overview of TWO OR MORE invoices.

Document kind + paid status (ALWAYS set these):
- "document_kind" tells what this is:
  - "invoice": a payment REQUEST — has an invoice number, a vendor, a due date
    or payment terms ("te betalen", "betaal binnen 14 dagen", an IBAN to pay to).
    Usually NOT yet paid.
  - "receipt": a PROOF OF PAYMENT already made — a kassabon, pin-receipt, or
    cash receipt. Signs: "PIN", "Contant", "Betaald", "Voldaan", a store till
    receipt layout, no invoice number / no payment request, paid on the spot.
  - "other": not an invoice and not a receipt (newsletter, quote, reminder,
    shipping note, contract). For "other", set is_invoice=false too.
- "is_paid": true ONLY when the document shows the payment is ALREADY DONE
  (a receipt/kassabon: "PIN", "Contant betaald", "Voldaan", "Betaald"). For a
  normal unpaid invoice (a request to pay), set is_paid=false. When unsure,
  set is_paid=false — it is safer to ask the human to confirm payment than to
  mark something paid that is not.
- A receipt is still a real financial document: keep is_invoice=true for both
  "invoice" and "receipt" (both enter the pipeline); only "other" is false.

Creditnota detection (ALWAYS set is_credit_note):
- "is_credit_note" = true ONLY on explicit evidence this is a CREDIT NOTE:
  a title like "Creditnota", "Credit note", "Creditfactuur", "Credit invoice";
  an INVOICE CORRECTION — "Factuurcorrectie", "Factuurcorrectienummer",
  "Gecorrigeerd factuurdocument", "Correctiereden", "Credit memo", a "CM-…"
  number prefix, a return/refund ("Full return", "Retour", "Terugbetaling");
  an invoice number with a credit prefix (e.g. "CR-…"); or the amounts printed
  as NEGATIVE / explicitly marked as credit ("te ontvangen", "credit").
  A document that CORRECTS or REVERSES an earlier invoice (it names the original
  invoice it corrects) with negative amounts IS a creditnota — set it true.
- A creditnota is still a real financial document: is_invoice=true and
  document_kind="invoice" (it enters the same verify queue).
- On a creditnota, return the amounts EXACTLY as printed — NEGATIVE when the
  document shows them negative (e.g. total_inc_btw: -4.84). NEVER flip a sign
  yourself: report what the document states. If a document is titled creditnota
  but prints positive amounts, return them positive (the system will hold it
  for human review — that is correct).
- A normal invoice → is_credit_note = false. When unsure → false.

Statement / reminder detection (NOT an invoice — prevents double counting):
- A "Rekeningoverzicht", "Aanmaning", "Betalingsherinnering", "Herinnering",
  "Saldo-overzicht", "Openstaande posten" or any account statement / dunning
  letter is NOT an invoice. It SUMMARIZES invoices that already exist as
  separate documents — importing it as an invoice would count those amounts
  TWICE and could make the owner pay twice. → is_invoice=false,
  document_kind="other", and set reason to a short Dutch explanation, e.g.
  "rekeningoverzicht — samenvatting van bestaande facturen, geen factuur".
- Strong signals (require at least TWO before classifying as a statement):
  · a table listing MULTIPLE different factuurnummers in one document
  · columns like "Reeds betaald" / "Nog openstaand" / "Vervallen"
  · a total labelled "openstaand" ("Totaal openstaand bedrag") instead of
    "Totaal incl. BTW"
  · no BTW breakdown anywhere on the document
- EXCEPTION: a reminder that contains exactly ONE invoice WITH a full BTW
  breakdown (excl + BTW + incl) is that invoice re-sent → treat it as a normal
  invoice (the duplicate check catches the copy of the original).
- When genuinely unsure whether it is a statement or an invoice →
  is_invoice=true (the human verify queue is the safety gate; a silently
  skipped real invoice costs money, a held statement only costs a review).

Amount extraction rules:
- All amounts are numeric only — no currency symbols, no thousand separators — e.g. 121.00
- total_ex_btw: the FULL amount before BTW — the sum of ALL line bases across every rate,
  INCLUDING any 0%-BTW lines. It must be chosen so that total_ex_btw + btw_amount =
  total_inc_btw (the identity always holds). See STATIEGELD below.
- btw_amount: the total BTW/VAT amount shown on the invoice (the sum across all rates).
- total_inc_btw: the final total the invoice asks you to pay — the "Totaal", "Te voldoen",
  "Totaalbedrag" or "Totaal te betalen" line. Return THIS printed final total even when it
  does not equal a simple product subtotal (statiegeld, emballage and shipping are added on
  top) and even when it is NEGATIVE (a return/creditnota where credited items exceed goods).
- btw_rate: the percentage — usually 21, sometimes 9 or 0. On a MIXED invoice (e.g. 9% goods
  plus 0% statiegeld) the effective blended rate is lower; that is normal, not an error.
- If only the total is shown and BTW rate is known, calculate the breakdown
- If a value genuinely cannot be found, set it to null — never guess
- confidence: how certain you are (0 = no idea, 1 = absolutely certain)

STATIEGELD / EMBALLAGE / STORTGELD (crucial — a shop that sells drinks sees this daily):
- Many wholesale invoices add STATIEGELD (a returnable-packaging deposit), EMBALLAGE, or a
  container/"Bijgel. container"/"Retour container" charge, usually at 0% BTW, ON TOP of the
  goods. There may be a whole "Statiegeld" column, or a summary line, or a "Geen BTW" grondslag.
- These deposit amounts ARE part of what is paid. Fold them into total_ex_btw as 0%-BTW base
  so that total_ex_btw + btw_amount = total_inc_btw stays exact. Do NOT drop them, and do NOT
  let them make excl + BTW disagree with the printed total.
- Returned deposits are NEGATIVE (e.g. "Retour container -408,00"): include them with their
  sign. If the net printed total ("Te voldoen") is therefore negative, return it negative.

- EX/INCL identity: total_ex_btw + btw_amount MUST equal total_inc_btw. Some suppliers
  mislabel the GROSS total as "Subtotaal", so you may see the same number on both the
  "Subtotaal" and "Totaal incl. btw" lines while a real BTW is printed — that is impossible
  (equal excl and incl means zero BTW). Trust the "Totaal incl."/"Reeds betaald"/paid total
  and the printed BTW, and set total_ex_btw = total_inc_btw − btw_amount. Never return
  total_ex_btw equal to total_inc_btw when btw_amount is non-zero.

Per-field confidence rules:
- field_confidence.vendor: how certain you are the vendor (sender) is correct.
  LOW (< 0.7) if sender/receiver were ambiguous, names were close, or the layout was unclear.
- field_confidence.invoice_number: LOW if you had to guess, or the only candidate looked
  like a page number, customer number, or date rather than a clear invoice number.
- field_confidence.invoice_date: LOW if multiple dates were present (invoice / due / delivery)
  and it was unclear which is the invoice date.
- field_confidence.amount: how certain you are the AMOUNTS (total_ex_btw / btw_amount /
  total_inc_btw) are correct. This is the most important score — it is the money. LOW
  (< 0.7) if any digit was blurry/cut off, the currency or decimal separator was unclear,
  totals were handwritten, or you had to infer a total from partial figures. A confidently
  WRONG amount is the worst outcome — when unsure, score LOW so the user is asked to check.
- due_date: the EXPLICIT due/expiry date if the invoice prints one ("Vervaldatum",
  "Te betalen voor", "Uiterste betaaldatum", "Betalen voor"). Return it as
  "YYYY-MM-DD". If no explicit due date is printed, set due_date to null — do NOT
  compute it yourself.
- payment_term_days: if the invoice states a payment TERM instead of (or besides) an
  explicit date — "Betaling binnen 14 dagen", "Te voldoen binnen 30 dagen", "14 dagen
  netto" — return the number of days as an integer (e.g. 14, 30). If no term is stated,
  set payment_term_days to null. Never invent a default term.
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
      // [PDF-OPTIMIZE] Try the cheap text path first. For a TEXT PDF (the
      // majority of supplier invoices) we extract the text ourselves and send
      // TEXT ONLY (~840 vs ~2425 tokens, ~65% saved). SAFECORE-verified on real
      // Kiwi data: identical amounts, no "Nieuwe schuld" trap. Returns null for
      // scanned/weak PDFs or on ANY error → we fall through to the UNCHANGED raw
      // path below, so scanned invoices behave exactly as before (zero loss).
      const extractedText = await extractPdfTextIfTextLayer(fileBase64);
      if (extractedText) {
        result = await callClaude(
          `${prompt}\n\n--- FACTUUR TEKST (uit PDF) ---\n${extractedText}`,
          systemPrompt
        );

        // [PDF-OPTIMIZE] SAFECORE secondary fail-safe. On real Kiwi data, a
        // FEW complex layouts (multi-column tables, credit notes) survive text
        // extraction as CHARACTERS but lose the visual column order. Reading the
        // flat text, Claude then either (a) returns an invoice with an unusable
        // total, or (b) fails to recognise it as an invoice at all — while the
        // RAW PDF path, where Claude SEES the page layout, reads it correctly.
        //
        // Rule: the text path is TRUSTED only when it yields a real invoice with
        // a usable total. ANY weaker outcome — parse failure, "not an invoice",
        // or a missing/underivable total — means we CANNOT trust the flat text,
        // so we RE-READ once via the raw PDF and use THAT result. The raw path is
        // exactly the pre-PDF-OPTIMIZE behaviour, so a re-read can never do worse
        // than production already did: zero degradation, zero invoice loss.
        //
        // Why not just check is_invoice=true+total: because a garbled layout can
        // ALSO make Claude reject a genuine invoice (case b, seen on Ketels). We
        // must catch that too, and the raw path is the trustworthy arbiter.
        //
        // Cost: the extra raw call fires only when the cheap text path did not
        // produce a solid invoice. Real PDF attachments are overwhelmingly
        // invoices, and a rejected non-invoice text call is tiny, so the rare
        // double-read is dwarfed by the saving on the clean majority.
        const probe = safeParseJSON<VerifyInvoiceResult>(result);
        const hasNum = (v: unknown): boolean =>
          typeof v === 'number' && isFinite(v);
        const textPathTrusted =
          probe != null &&
          probe.is_invoice === true &&
          (hasNum(probe.total_inc_btw) ||
            (hasNum(probe.total_ex_btw) && hasNum(probe.btw_amount)));

        if (!textPathTrusted) {
          console.log(
            '[PDF-OPTIMIZE] Text path not conclusive — re-reading via raw PDF (SAFECORE fallback)'
          );
          result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
        }
      } else {
        // Raw PDF path — Claude reads the actual PDF (text + scanned). UNCHANGED.
        result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
      }
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

    // [STATEMENT-GUARD] Deterministic backstop against booking a STATEMENT OF ACCOUNT as an
    // invoice. A "Rekeningoverzicht" / "Openstaande posten" / "Saldo-overzicht" lists MANY
    // invoices and a summed total — booking it as one invoice double-counts the invoices it
    // summarises and carries no valid single BTW split. The prompt already teaches this, but
    // an unmistakable filename forces the correct verdict even if the model wavers. Narrow on
    // purpose: NOT "aanmaning/herinnering", which can be a single-invoice reminder.
    if (parsed.is_invoice && isStatementFilename(filename)) {
      return {
        is_invoice: false,
        confidence: 0.9, // confident it is NOT a bookable invoice → registered with the reason
        reason: 'Rekeningoverzicht — overzicht van meerdere facturen, geen boekbare factuur',
      };
    }

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
      // [TRUST-AMOUNTS] Only carry the amount score when the model actually gave one.
      // Unlike the fields above, we do NOT default a missing amount score to 1 —
      // "no signal" must not read as "certain" on the money-truth. import-health
      // flags it only when it is present and low, so absence fabricates no doubt.
      ...(typeof parsed.field_confidence?.amount === 'number'
        ? { amount: Math.min(1, Math.max(0, parsed.field_confidence.amount)) }
        : {}),
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

    // [EXTRACT-DUE-DATE] Normalize the two raw due-date signals. We do NOT
    // compute the due date here — safecore.deriveDueDate() does that at the
    // write paths. Here we only sanitize: keep due_date as a trimmed string
    // (deriveDueDate tolerates ISO or DD-MM-YYYY), and keep payment_term_days
    // only when it is a sane positive integer-ish day count. Junk → undefined.
    if (typeof parsed.due_date === 'string') {
      const dd = parsed.due_date.trim();
      parsed.due_date = dd.length ? dd : undefined;
    } else {
      parsed.due_date = undefined;
    }
    if (
      typeof parsed.payment_term_days === 'number' &&
      isFinite(parsed.payment_term_days) &&
      parsed.payment_term_days > 0 &&
      parsed.payment_term_days <= 365
    ) {
      parsed.payment_term_days = Math.round(parsed.payment_term_days);
    } else {
      parsed.payment_term_days = undefined;
    }

    // [SMART-INTAKE] Normalize the classification fields. Default to the safe
    // side: unknown kind → 'invoice' (enters the verify queue, human reviews);
    // unknown paid → false (human confirms payment, never auto-mark paid).
    parsed.document_kind =
      parsed.document_kind === "receipt" || parsed.document_kind === "other"
        ? parsed.document_kind
        : "invoice";
    parsed.is_paid = parsed.is_paid === true;
    // [BRIDGE-CREDITNOTA-SIGN] Strict boolean; unknown → false (safe side:
    // a normal invoice with a stray negative stays blocked by num() below +
    // the SAFECORE gate — never silently treated as a creditnota).
    parsed.is_credit_note = parsed.is_credit_note === true;

    // [TRUST-UNCERTAIN] Confidence banding — never silently drop a real-but-hard
    // invoice. Below the hard floor (or with no invoice signal at all) it's spam /
    // a newsletter → skip. In the uncertain band [0.35, 0.6) WITH a vendor or an
    // amount, we route it to the human verify queue FLAGGED instead of discarding
    // it: is_invoice becomes true, `uncertain` is set, and we cap the amount
    // confidence so the health surface shows "onzeker gelezen — controleer". The
    // human then confirms or dismisses; the invoice is never lost without a trace.
    const hasInvoiceSignal =
      !!parsed.vendor ||
      parsed.total_inc_btw != null ||
      parsed.total_ex_btw != null ||
      parsed.amount != null;
    const band = decideConfidenceBand(parsed.confidence, hasInvoiceSignal);
    if (band === 'skip') {
      return {
        is_invoice: false,
        confidence: parsed.confidence,
        reason: parsed.reason || 'Te lage zekerheid — bestand overgeslagen',
      };
    }
    if (band === 'review') {
      parsed.is_invoice = true;
      parsed.uncertain = true;
      parsed.field_confidence = {
        ...(parsed.field_confidence ?? {}),
        amount: Math.min(parsed.field_confidence?.amount ?? 0.4, 0.4),
      };
    }

    // [BOEK-011] Normalize and reconcile amounts — never let bad numbers reach DB
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;
    // [BRIDGE-CREDITNOTA-SIGN] On a creditnota the amounts are legitimately
    // NEGATIVE (matching the paper + the outgoing creditnota route [BOEK-031],
    // which stores -(original.x)). numSigned accepts any finite number; it is
    // used ONLY when is_credit_note=true. Normal invoices keep num() exactly
    // as before — a stray negative there is an extraction error and stays
    // filtered (conditional, never permissive).
    const numSigned = (v: unknown): number | undefined =>
      typeof v === 'number' && isFinite(v) ? v : undefined;
    // [CREDIT-BACKSTOP] Without this, num() below rejects a negative amount as a "stray
    // negative" and drops it to undefined — turning a real -1.123,14 credit into an empty €0
    // record flagged "totaalbedrag ontbreekt". A negative printed total means credit, so flip
    // it before choosing the number normaliser (see shouldTreatAsCreditNote).
    parsed.is_credit_note = shouldTreatAsCreditNote(
      parsed.is_credit_note,
      parsed.total_inc_btw,
      parsed.total_ex_btw,
    );
    const pickNum = parsed.is_credit_note === true ? numSigned : num;

    parsed.total_ex_btw = pickNum(parsed.total_ex_btw);
    parsed.btw_amount = pickNum(parsed.btw_amount);
    parsed.total_inc_btw = pickNum(parsed.total_inc_btw);
    // [BOEK-011 double-check m.5] btw_rate must be a real Dutch VAT rate.
    // num() alone would accept e.g. 6 (old rate) or 121 (amount mistaken for a
    // rate). Constrain to the three valid values; anything else → undefined so
    // it's treated as "unknown" rather than persisting a bogus rate.
    {
      const r = num(parsed.btw_rate);
      parsed.btw_rate = r !== undefined && [0, 9, 21].includes(r) ? r : undefined;
    }

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
    // [EX-INCL-FIX] Recover a base that a mislabelled "Subtotaal" set equal to the incl total
    // while a real BTW is printed (impossible). Trusts incl + btw → ex = incl − btw.
    parsed.total_ex_btw = fixExInclConfusion(
      parsed.total_ex_btw, parsed.btw_amount, parsed.total_inc_btw,
    );

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
// [TRIANGLE] Transcribe a payment-terminal settlement receipt (Equens CTAP "TOTALEN
// RAPPORT") to VERBATIM plain text, so the proven pure parser (eft-parser.ts) — not the
// model — does the structured extraction and applies its reconciliation cross-checks. The
// model only reads the pixels; the arithmetic is deterministic and testable downstream.
export async function transcribeEftReceipt(
  fileBase64: string,
  mimeType: string,
  filename: string,
): Promise<string> {
  const systemPrompt =
    'Je transcribeert kassabon-achtige betaalterminal-afrekeningen exact zoals gedrukt. ' +
    'Verzin niets, corrigeer geen getallen, laat niets weg.';
  const prompt =
    'Dit is een afrekening/dagafsluiting van een betaalterminal (bijv. Equens CTAP, "TOTALEN RAPPORT"). ' +
    'Transcribeer ELKE regel exact zoals gedrukt — alle labels (TMS TERM-ID, PERIODE NR, PERIODE START/EINDE, ' +
    'DATUM EERSTE/LAATSTE TRX, EFT TOTALEN, BETALING, TOTAAL, en de kaartsoorten zoals V Pay, Maestro, ' +
    'Debit Mastercard, Visa Debit, MasterCard) met hun #TRX-aantallen en EUR-bedragen. ' +
    'Geef ALLEEN de tekst terug, geen uitleg.';

  const isPdf = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  if (isPdf) return callClaudeWithPdf(fileBase64, prompt, systemPrompt);

  const mt: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
    mimeType === 'image/png' ? 'image/png'
    : mimeType === 'image/webp' ? 'image/webp'
    : mimeType === 'image/gif' ? 'image/gif'
    : 'image/jpeg';
  return callClaudeWithImage(fileBase64, mt, prompt, systemPrompt);
}
