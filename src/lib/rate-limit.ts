// src/lib/rate-limit.ts
// [BOEK-SECURITY-2] Rate limiting helper — May 2026
// =====================================================
// يستخدم atomic DB function (check_rate_limit) — لا race conditions
// كل calls تمر عبر service_role (Pipeline client)
// =====================================================

import { createPipelineClient } from '@/lib/supabase-pipeline'

// ── Types ─────────────────────────────────────────────

export interface RateLimitCheck {
  /** Profile ID المستخدم */
  userId: string
  /** اسم الـ endpoint (للتمييز بين الحدود) — مثل '/api/email/sync' */
  endpoint: string
  /** الحد الأقصى للطلبات في الـ window */
  maxRequests: number
  /** طول الـ window بالدقائق */
  windowMinutes: number
}

export interface RateLimitResult {
  /** هل الطلب مسموح؟ */
  allowed: boolean
  /** الطلبات المتبقّية في الـ window الحالي */
  remaining: number
  /** متى يُعاد تعيين الـ window */
  resetAt: Date
}

// ── الحدود المعيارية (Configurable per-endpoint) ──────

export const RATE_LIMITS = {
  EMAIL_SYNC:          { maxRequests: 10, windowMinutes: 5 },     // 10 / 5min
  DOCUMENT_CLASSIFY:   { maxRequests: 50, windowMinutes: 60 },    // 50 / hour
  ACCOUNTANT_INVITE:   { maxRequests: 20, windowMinutes: 1440 },  // 20 / day
  INVOICE_SEND:        { maxRequests: 100, windowMinutes: 60 },   // 100 / hour
  // [COST] AI/OCR calls to Claude — a per-user ceiling so one account can't drive
  // unbounded ANTHROPIC spend on the main intake/onboarding/email pipelines.
  AI_OCR:              { maxRequests: 240, windowMinutes: 60 },   // 240 AI reads / hour — a shop's month of receipts in one sitting (non-AI files no longer count)
  AI_TRANSLATE:        { maxRequests: 120, windowMinutes: 60 },   // 120 short text calls / hour
  // [BETAALVERZOEK] Public /pay/[token] read — anonymous surface. Bucketed per
  // TOKEN (a uuid), so a single leaked/shared link can't be hammered, while a real
  // customer refreshing the page a few times is never blocked.
  PUBLIC_PAY:          { maxRequests: 120, windowMinutes: 60 },   // 120 reads / hour per link
  // [SEC-COST] Public, login-free invoice scanner → paid Claude call. Durable per-IP ceiling so a
  // rotating-instance attacker can't drive unbounded ANTHROPIC spend (the in-route in-memory gate
  // is per-instance only). Sits just above the honest client's 3/day.
  PUBLIC_SCAN:         { maxRequests: 10, windowMinutes: 1440 },  // 10 scans / day per IP
} as const

// ── Main function ─────────────────────────────────────

/**
 * Checks and increments rate limit atomically via DB function.
 * NO race conditions — single SQL statement using INSERT ON CONFLICT.
 *
 * Usage:
 *   const limit = await checkRateLimit({
 *     userId,
 *     endpoint: '/api/email/sync',
 *     ...RATE_LIMITS.EMAIL_SYNC,
 *   })
 *   if (!limit.allowed) return rateLimitResponse(limit)
 */
export async function checkRateLimit({
  userId,
  endpoint,
  maxRequests,
  windowMinutes,
}: RateLimitCheck): Promise<RateLimitResult> {
  const supabase = createPipelineClient()

  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_user_id:        userId,
    p_endpoint:       endpoint,
    p_max_requests:   maxRequests,
    p_window_minutes: windowMinutes,
  })

  // لو فشل الـ RPC → نسمح (fail-open للوظيفة، fail-closed للأمان: قرار)
  // قرار: fail-open هنا — لو DB قاع، لا نوقف الـ users
  // الـ error يُسجَّل في logs للمراجعة
  if (error || !data || data.length === 0) {
    console.warn('[BOEK-SECURITY-2] Rate limit check failed — allowing request', {
      userId,
      endpoint,
      error: error?.message,
    })
    return {
      allowed:   true,
      remaining: maxRequests,
      resetAt:   new Date(Date.now() + windowMinutes * 60 * 1000),
    }
  }

  const row = data[0]
  return {
    allowed:   row.allowed,
    remaining: row.remaining,
    resetAt:   new Date(row.reset_at),
  }
}

// ── Helper: Next.js response للـ 429 ──────────────────

/**
 * Builds a 429 Too Many Requests response in Dutch.
 * Includes Retry-After header per HTTP spec.
 */
export function rateLimitResponse(limit: RateLimitResult): Response {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
  )

  return new Response(
    JSON.stringify({
      error: `Te veel verzoeken. Probeer over ${retryAfterSec} seconden opnieuw.`,
      retryAfter: limit.resetAt.toISOString(),
    }),
    {
      status: 429,
      headers: {
        'Content-Type':           'application/json',
        'Retry-After':            String(retryAfterSec),
        'X-RateLimit-Remaining':  String(limit.remaining),
        'X-RateLimit-Reset':      limit.resetAt.toISOString(),
      },
    }
  )
}