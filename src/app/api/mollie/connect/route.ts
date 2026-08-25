// src/app/api/mollie/connect/route.ts
// [MOLLIE] Koppelen met een eigen Mollie API-sleutel — augustus 2026
//
// GET    → { connected, status, connectedAt, lastError } — wat de instellingenkaart mag zien.
// POST   { apiKey } → controleert de sleutel LIVE bij Mollie (één onschuldige leescall),
//          bewaart hem in Vault en zet de koppeling op 'active'.
// DELETE → verbreekt de koppeling en wist het geheim uit Vault.
//
// De sleutel wordt NOOIT opgeslagen voordat hij bewezen werkt — een verkeerd geplakte sleutel
// zou anders als "gekoppeld" op het scherm staan en pas falen op het moment dat een KLANT wil
// betalen, de slechtst denkbare plek voor die ontdekking.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { validateMollieKey } from "@/lib/mollie";
import {
  getMollieConnectionMeta,
  saveMollieConnection,
  deleteMollieConnection,
} from "@/lib/mollie-connection";

export const dynamic = "force-dynamic";

function normalizeApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  // Mollie-sleutels zijn "live_…" of "test_…"; het precieze formaat is van Mollie, dus we
  // weigeren alleen wat zeker fout is voordat we er een netwerkverzoek aan wagen.
  if (key.length < 10 || key.length > 512) return null;
  return key;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const meta = await getMollieConnectionMeta(user.id);
  if (!meta) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    status: meta.status,
    connectedAt: meta.connectedAt,
    lastError: meta.lastError,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/mollie/connect",
    ...RATE_LIMITS.SNELSTART_CONNECT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: { apiKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
  const apiKey = normalizeApiKey(body.apiKey);
  if (!apiKey) {
    return NextResponse.json({ error: "Plak een geldige Mollie API-sleutel (live_… of test_…)." }, { status: 400 });
  }

  const works = await validateMollieKey(apiKey);
  if (!works) {
    return NextResponse.json(
      { error: "Mollie accepteerde deze sleutel niet. Controleer of je de API-sleutel (live_…) van je Mollie-dashboard hebt geplakt." },
      { status: 422 },
    );
  }

  const saved = await saveMollieConnection({ userId: user.id, apiKey });
  if (!saved.success) return NextResponse.json({ error: saved.error }, { status: 503 });
  return NextResponse.json({ connected: true, status: saved.meta.status, connectedAt: saved.meta.connectedAt });
}

export async function DELETE() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const ok = await deleteMollieConnection(user.id);
  if (!ok) return NextResponse.json({ error: "Ontkoppelen is niet gelukt. Probeer het zo opnieuw." }, { status: 503 });
  return NextResponse.json({ connected: false });
}
