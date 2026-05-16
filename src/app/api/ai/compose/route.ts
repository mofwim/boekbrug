// src/app/api/ai/compose/route.ts
// [BOEK-018] compose draft queue email route — May 2026
// POST /api/ai/compose
// Body: { clientName: string, items: string[] }
// Returns: { subject: string, body: string }
// Auth: required — accountant only
// Note: email always in Dutch, clear and simple

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { composeDraftEmail } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check — accountant only
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'accountant') {
      return NextResponse.json({ error: 'Forbidden — accountant only' }, { status: 403 });
    }

    const body = await req.json();
    const { clientName, items } = body;

    // Input validation
    if (!clientName || typeof clientName !== 'string') {
      return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }
    if (!items.every((i) => typeof i === 'string')) {
      return NextResponse.json({ error: 'all items must be strings' }, { status: 400 });
    }

    const accountantName = profile.full_name ?? 'Uw boekhouder';
    const result = await composeDraftEmail(accountantName, clientName, items);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[BOEK-018] /api/ai/compose error:', error);
    // Safe fallback — return plain list
    return NextResponse.json(
      {
        subject: 'Ontbrekende stukken',
        body: 'Kun je de ontbrekende stukken aanleveren?',
      },
      { status: 200 }
    );
  }
}