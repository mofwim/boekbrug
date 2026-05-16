// src/app/api/ai/match/route.ts
// [BOEK-018] match bank transaction to invoice route — May 2026
// POST /api/ai/match
// Body: { transaction: Transaction, invoices: Invoice[] }
// Returns: { matched: boolean, invoice_id?: string, confidence: number, reason: string }
// Auth: required
// Note: confidence < 0.7 → matched: false (enforced in ai.ts)

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { matchTransaction } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { transaction, invoices } = body;

    // Input validation — transaction
    if (!transaction || typeof transaction !== 'object') {
      return NextResponse.json({ error: 'transaction is required' }, { status: 400 });
    }
    if (typeof transaction.amount !== 'number') {
      return NextResponse.json({ error: 'transaction.amount must be a number' }, { status: 400 });
    }
    if (!transaction.date || !transaction.description || !transaction.counterpart) {
      return NextResponse.json(
        { error: 'transaction must have date, description, and counterpart' },
        { status: 400 }
      );
    }

    // Input validation — invoices
    if (!Array.isArray(invoices)) {
      return NextResponse.json({ error: 'invoices must be an array' }, { status: 400 });
    }

    const result = await matchTransaction(transaction, invoices);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[BOEK-018] /api/ai/match error:', error);
    return NextResponse.json(
      { matched: false, confidence: 0, reason: 'Matching niet beschikbaar' },
      { status: 200 }
    );
  }
}