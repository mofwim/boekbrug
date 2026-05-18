// src/app/api/onboarding/extract/route.ts
// [BOEK-015] Extract company data from uploaded invoice using AI
// POST /api/onboarding/extract
// Body: { base64: string, mimeType: string, filename: string }
// Returns: { found: boolean, company_name?, kvk_number?, btw_number?, iban?, address? }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { verifyInvoiceFromPdf } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json();
  const { base64, mimeType, filename } = body;

  if (!base64 || !mimeType || !filename) {
    return NextResponse.json({ error: "Ontbrekende velden" }, { status: 400 });
  }

  try {
    // [BOEK-015] Use verifyInvoiceFromPdf — reads actual content, not metadata
    // verifyInvoiceFromPdf returns: is_invoice, confidence, vendor, amount, invoice_number, invoice_date
    // For KVK/BTW/IBAN we send a dedicated extraction prompt to Claude directly
    const verified = await verifyInvoiceFromPdf(base64, mimeType, filename);

    if (!verified.is_invoice || verified.confidence < 0.5) {
      return NextResponse.json({ found: false });
    }

    // [BOEK-015] Second call: extract company registration data from the same file
    // We call Claude directly here because ai.ts doesn't have a dedicated company-extract function
    // This is the one allowed exception: onboarding extract is a thin wrapper, not business logic
    const extractionResult = await extractCompanyData(base64, mimeType, filename);

    return NextResponse.json({
      found: true,
      company_name: extractionResult.company_name ?? verified.vendor ?? null,
      kvk_number: extractionResult.kvk_number ?? null,
      btw_number: extractionResult.btw_number ?? null,
      iban: extractionResult.iban ?? null,
      address: extractionResult.address ?? null,
    });
  } catch (error) {
    console.error("[BOEK-015] extract failed:", error);
    return NextResponse.json({ found: false });
  }
}

// ── Company data extraction ───────────────────────────────
// Calls Claude with a focused prompt to extract Dutch business registration data

interface ExtractedCompany {
  company_name?: string;
  kvk_number?: string;
  btw_number?: string;
  iban?: string;
  address?: string;
}

async function extractCompanyData(
  base64: string,
  mimeType: string,
  filename: string
): Promise<ExtractedCompany> {
  const FALLBACK: ExtractedCompany = {};

  const systemPrompt = `You extract Dutch business registration data from invoices and receipts.
Return only a JSON object with these keys (null if not found):
{
  "company_name": string or null,
  "kvk_number": string or null,
  "btw_number": string or null,
  "iban": string or null,
  "address": string or null
}

Rules:
- kvk_number: 8 digits only, no spaces or dashes
- btw_number: Dutch format NL + 9 digits + B + 2 digits (e.g. NL123456789B01)
- iban: keep full IBAN as written including country code
- address: street + house number only, no city or postal code
- Extract the SENDER's data (the company that issued the invoice), not the receiver
- Return only JSON, no markdown, no explanation`;

  const prompt = `Extract the sender's business registration data from this document.
Filename: ${filename}
Look for: company name, KVK number, BTW/VAT number, IBAN, address.
Return JSON only.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(mimeType === "application/pdf" ? { "anthropic-beta": "pdfs-2024-09-25" } : {}),
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: mimeType === "application/pdf"
              ? [
                  { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                  { type: "text", text: prompt },
                ]
              : [
                  { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
                  { type: "text", text: prompt },
                ],
          },
        ],
      }),
    });

    if (!response.ok) return FALLBACK;

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as ExtractedCompany;
  } catch {
    return FALLBACK;
  }
}