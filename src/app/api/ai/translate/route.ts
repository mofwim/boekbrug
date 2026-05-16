// src/app/api/ai/translate/route.ts
// [BOEK-018] translate factuurregels to Dutch route — May 2026
// POST /api/ai/translate
// Body: { text: string, sourceLanguage: string }
// Returns: { translation: string, original: string }
// Note: output always Dutch, always professional

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { translateToNL } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, sourceLanguage } = body;

    // Input validation
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (!sourceLanguage || typeof sourceLanguage !== 'string') {
      return NextResponse.json({ error: 'sourceLanguage is required' }, { status: 400 });
    }

    const result = await translateToNL(text, sourceLanguage);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[BOEK-018] /api/ai/translate error:', error);
    // Safe fallback — return original text
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ translation: body.text ?? '', original: body.text ?? '' }, { status: 200 });
  }
}