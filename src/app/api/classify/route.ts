// src/app/api/ai/classify/route.ts
// [BOEK-018] classify document route — May 2026
// POST /api/ai/classify
// Body: { fileContent: string, fileName: string }
// Returns: ClassifyDocumentResult

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { classifyDocument } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fileContent, fileName } = body;

    // Input validation
    if (!fileContent || typeof fileContent !== 'string') {
      return NextResponse.json({ error: 'fileContent is required' }, { status: 400 });
    }
    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    const result = await classifyDocument(fileContent, fileName);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[BOEK-018] /api/ai/classify error:', error);
    // Safe fallback — never expose AI errors to client
    return NextResponse.json({ type: 'unknown', confidence: 0 }, { status: 200 });
  }
}