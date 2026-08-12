'use client'

// src/components/invoice/InvoiceReminders.tsx
// [REMINDERS] Per-invoice reminder panel on the invoice detail page.
//   * shows the history of automatic reminders sent for this invoice
//     (read via the owner's own client — invoice_reminders has an
//      owner-only SELECT RLS policy);
//   * lets the owner PAUSE automatic reminders for this one invoice
//     (a delicate client / a disputed invoice) — writes invoices.
//     reminders_paused, which the reminder cron respects.
// Renders nothing on incoming invoices or invoices that aren't in a
// remindable state (only outgoing sent/overdue invoices are ever reminded).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatDateNL } from '@/lib/format-nl'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

type Reminder = {
  id: string
  day_offset: number
  sent_at: string
  status: string
}

export function InvoiceReminders({
  invoiceId,
  direction,
  status,
  remindersPaused = false,
}: {
  invoiceId: string
  direction?: string | null
  status?: string | null
  remindersPaused?: boolean
}) {
  const t = translator(useLocale())
  const supabase = createClient()
  const [history, setHistory] = useState<Reminder[]>([])
  const [paused, setPaused] = useState(!!remindersPaused)
  const [saving, setSaving] = useState(false)

  // Only outgoing, still-open invoices are ever reminded — hide everywhere else.
  const applicable = direction !== 'incoming' && (status === 'sent' || status === 'overdue')

  useEffect(() => {
    if (!applicable) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('invoice_reminders')
        .select('id, day_offset, sent_at, status')
        .eq('invoice_id', invoiceId)
        .order('sent_at', { ascending: false })
      if (active && data) setHistory(data as Reminder[])
    })()
    return () => {
      active = false
    }
    // supabase client identity is stable per render; only the invoice matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, applicable])

  if (!applicable) return null

  async function togglePause() {
    const next = !paused
    setSaving(true)
    setPaused(next) // optimistic
    const { error } = await supabase
      .from('invoices')
      .update({ reminders_paused: next })
      .eq('id', invoiceId)
    if (error) setPaused(!next) // revert on failure — never lie about the state
    setSaving(false)
  }

  return (
    <div
      style={{
        border: '1px solid #E0E0E0',
        borderRadius: 16,
        padding: '16px 18px',
        margin: '16px 0',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#202124' }}>{t('herin.titel')}</div>
          <div style={{ fontSize: 13, color: '#5F6368', marginTop: 2 }}>
            {paused ? t('herin.gepauzeerd') : t('herin.actief')}
          </div>
        </div>
        <button
          type="button"
          onClick={togglePause}
          disabled={saving}
          style={{
            flexShrink: 0,
            padding: '8px 14px',
            borderRadius: 20,
            border: `1px solid ${paused ? '#1A73E8' : '#E0E0E0'}`,
            background: paused ? '#1A73E8' : '#fff',
            color: paused ? '#fff' : '#5F6368',
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {paused ? t('herin.hervatten') : t('herin.pauzeren')}
        </button>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid #F1F3F4', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#5F6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            {t('herin.verstuurd')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#202124' }}>
                <span>
                  {r.day_offset === 1 ? t('herin.naDag') : t('herin.naDagen', { days: r.day_offset })}
                  {r.status === 'failed' && <span style={{ color: '#B3261E' }}>{t('herin.mislukt')}</span>}
                </span>
                <span style={{ color: '#5F6368' }}>{formatDateNL(r.sent_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
