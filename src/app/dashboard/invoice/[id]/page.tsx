'use client'

// src/app/dashboard/invoice/[id]/page.tsx
// BOEK-005: skeleton loading
// [BOEK-031] add creditnota button for sent invoices — May 2026
// [BOEK-031] Design System v1.0 applied — Material You (ZZP page) — May 2026

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import { InvoicePDF } from '@/lib/invoice-pdf'
import { InvoiceActions } from '@/components/invoice/InvoiceActions'
import { InvoiceDetailSkeleton } from '@/components/ui/Skeletons'
import { InvoiceTypeBadge } from '@/components/invoice/InvoiceTypeBadge'

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
)

// [DS] Design System v1.0 — Status chip colors (ZZP = pill, same values)
const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:      { label: 'Concept',        bg: '#E7E0EC', color: '#49454F' },
  sent:       { label: 'Verzonden',      bg: '#D3E3FD', color: '#1967D2' },
  paid:       { label: 'Betaald',        bg: '#CEEAD6', color: '#137333' },
  overdue:    { label: 'Verlopen',       bg: '#F9DEDC', color: '#B3261E' },
  received:   { label: 'Ontvangen',      bg: '#D3E3FD', color: '#1967D2' },
  processing: { label: 'In behandeling', bg: '#FEF7E0', color: '#EA8600' },
  processed:  { label: 'Verwerkt',       bg: '#CEEAD6', color: '#137333' },
  unclear:    { label: 'Onduidelijk',    bg: '#F9DEDC', color: '#B3261E' },
  archived:   { label: 'Gearchiveerd',   bg: '#F1F3F4', color: '#5F6368' },
}

// [DS] NL formatting — fixed, never changes
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE   = new Intl.DateTimeFormat('nl-NL')

const CREDITABLE_STATUSES = ['sent', 'paid', 'overdue', 'received', 'processing', 'processed']

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)

  // [BOEK-031] linked creditnota — toon als er al een bestaat
  const [linkedCreditnota, setLinkedCreditnota] = useState<any>(null)

  // [BOEK-031] Send flow state — May 2026
  const [showSendModal, setShowSendModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single()

      if (!invoiceData) {
        setNotFoundState(true)
        setLoading(false)
        return
      }

      setInvoice(invoiceData)

      const [{ data: senderProfile }, { data: linesData }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', invoiceData.sender_id).single(),
        supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId)
      ])

      if (senderProfile) setProfile(senderProfile)
      if (linesData) setLines(linesData)

      // [BOEK-031] Controleer of er al een creditnota bestaat voor deze factuur
      // receiver_id wordt gebruikt als link naar de originele factuur
      if (CREDITABLE_STATUSES.includes(invoiceData.status) && invoiceData.invoice_type === 'factuur') {
        const { data: creditnota } = await supabase
          .from('invoices')
          .select('id, invoice_number, status, created_at')
          .eq('receiver_id', invoiceId)
          .eq('invoice_type', 'creditnota')
          .maybeSingle()

        if (creditnota) setLinkedCreditnota(creditnota)
      }

      setLoading(false)
    }
    load()
  }, [invoiceId])

  if (notFoundState) notFound()

  // [BOEK-031] Send draft — calls /api/invoice/send (number + status + email) — May 2026
  async function handleSendInvoice() {
    setSending(true)
    setSendError(null)

    const res = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSendError(data.error || 'Verzenden mislukt')
      setSending(false)
      return
    }

    // Use API response data directly — avoids Supabase read-after-write lag
    // The API already committed the new number + status + type to DB
    const responseData = await res.json().catch(() => ({}))
    setInvoice((prev: any) => ({
      ...prev,
      status: 'sent',
      invoice_number: responseData.invoice_number ?? prev.invoice_number,
      invoice_type: responseData.invoice_type ?? prev.invoice_type,
    }))

    setShowSendModal(false)
    setSending(false)
  }

  // [DS] STATUS_CONFIG — Material You chip tokens
  const statusCfg = invoice
    ? STATUS_CONFIG[invoice.status] || { label: invoice.status, bg: '#F1F3F4', color: '#5F6368' }
    : null

  const canCreateCreditnota =
    invoice &&
    invoice.invoice_type !== 'creditnota' &&
    CREDITABLE_STATUSES.includes(invoice.status) &&
    !linkedCreditnota

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA' }}>

      {/* [DS] Header — Material You sticky, frosted glass */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        backgroundColor: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* [DS] Back button — Material You circular tonal */}
            <button
              onClick={() => router.back()}
              style={{
                width: 36, height: 36,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 9999,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#5F6368',
                cursor: 'pointer',
                fontSize: 18,
                transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#E7E0EC')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >←</button>
            {loading ? (
              <div style={{ height: 16, width: 144, backgroundColor: '#E7E0EC', borderRadius: 9999 }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ fontSize: 16, fontWeight: 700, color: '#202124', margin: 0 }}>
                  {invoice.invoice_number || 'Concept'}
                </h1>
                {invoice.invoice_type && invoice.invoice_type !== 'factuur' && (
                  <InvoiceTypeBadge type={invoice.invoice_type} size="xs" />
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!loading && statusCfg && (
              <>
                {/* [DS] Status chip — Material You pill */}
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  padding: '4px 12px',
                  borderRadius: 9999,
                  backgroundColor: statusCfg.bg,
                  color: statusCfg.color,
                  whiteSpace: 'nowrap',
                }}>
                  {statusCfg.label}
                </span>
                <InvoiceActions
                  invoiceId={invoiceId}
                  invoiceNumber={invoice.invoice_number}
                  status={invoice.status}
                />
                {invoice && profile && (
                  <PDFDownloadLink
                    document={<InvoicePDF invoice={invoice} lines={lines} profile={profile} />}
                    fileName={`${invoice.invoice_number || 'concept'}.pdf`}
                  >
                    {({ loading: pdfLoading }: { loading: boolean }) => (
                      <button style={{
                        backgroundColor: '#1A73E8',
                        color: 'white',
                        fontSize: 13,
                        fontWeight: 500,
                        padding: '8px 16px',
                        borderRadius: 9999, // [DS] Material You pill
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)',
                      }}>
                        {pdfLoading ? 'Laden...' : '↓ PDF'}
                      </button>
                    )}
                  </PDFDownloadLink>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <InvoiceDetailSkeleton />
      ) : (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 80 }}>

          {/* [BOEK-031] Send banner — only for draft invoices — May 2026 */}
          {invoice.status === 'draft' && (
            <div style={{ backgroundColor: '#D3E3FD', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#1967D2' }}>↗</span>
                <p style={{ fontSize: 12, color: '#1967D2', margin: 0 }}>
                  <strong>Klaar om te verzenden?</strong> De factuur krijgt een definitief nummer.
                </p>
              </div>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={sending}
                style={{ flexShrink: 0, marginLeft: 12, backgroundColor: '#1A73E8', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: sending ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: sending ? 0.6 : 1 }}
              >
                {sending ? 'Verzenden...' : '✉ Verstuur factuur'}
              </button>
            </div>
          )}

          {/* [BOEK-031] Send error message */}
          {sendError && (
            <div style={{ backgroundColor: '#FCE8E6', borderRadius: 16, padding: '12px 16px' }}>
              <p style={{ fontSize: 13, color: '#B3261E', margin: 0 }}>{sendError}</p>
            </div>
          )}

          {/* [DS] Creditnota banner — al een creditnota gekoppeld */}
          {linkedCreditnota && (
            <div style={{ backgroundColor: '#F9DEDC', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#B3261E' }}>↩</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#B3261E', margin: 0 }}>Gecrediteerd via {linkedCreditnota.invoice_number}</p>
                  <p style={{ fontSize: 11, color: '#B3261E', margin: '2px 0 0', opacity: 0.8 }}>Deze factuur is geannuleerd door een creditnota</p>
                </div>
              </div>
              <button onClick={() => router.push(`/dashboard/invoice/${linkedCreditnota.id}`)}
                style={{ fontSize: 12, fontWeight: 500, color: '#B3261E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                Bekijken →
              </button>
            </div>
          )}

          {/* [DS] Creditnota aanmaken banner — warning tonal */}
          {canCreateCreditnota && (
            <div style={{ backgroundColor: '#FEF7E0', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚠️</span>
                <p style={{ fontSize: 12, color: '#EA8600', margin: 0 }}>
                  <strong>Fout in deze factuur?</strong> Verzonden facturen mogen nooit worden verwijderd.
                </p>
              </div>
              <button
                onClick={() => router.push(`/dashboard/invoice/new?type=creditnota&original=${invoiceId}`)}
                style={{ flexShrink: 0, marginLeft: 12, backgroundColor: '#EA4335', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)' }}
              >↩ Creditnota</button>
            </div>
          )}

          {/* [DS] Van / Aan / Details — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
              {[
                {
                  title: 'Van',
                  lines: [
                    profile?.company_name || profile?.full_name,
                    profile?.address,
                    [profile?.postal_code, profile?.city].filter(Boolean).join(' '),
                    profile?.kvk_number ? `KVK: ${profile.kvk_number}` : null,
                    profile?.btw_number ? `BTW: ${profile.btw_number}` : null,
                  ]
                },
                {
                  title: 'Aan',
                  lines: [
                    invoice?.client_name || '—',
                    invoice?.client_address,
                    [invoice?.client_postal_code, invoice?.client_city].filter(Boolean).join(' '),
                    invoice?.client_btw_number ? `BTW: ${invoice.client_btw_number}` : null,
                    invoice?.client_email,
                  ]
                },
                {
                  title: 'Details',
                  lines: [
                    `Nummer: ${invoice.invoice_number || '—'}`,
                    `Datum: ${invoice.invoice_date ? NL_DATE.format(new Date(invoice.invoice_date)) : '—'}`,
                    `Vervaldatum: ${invoice.due_date ? NL_DATE.format(new Date(invoice.due_date)) : '—'}`,
                  ]
                },
              ].map(section => (
                <div key={section.title}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#9AA0A6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{section.title}</p>
                  {section.lines.filter(Boolean).map((line, i) => (
                    <p key={i} style={{ fontSize: 13, color: i === 0 ? '#202124' : '#5F6368', fontWeight: i === 0 ? 600 : 400, margin: '2px 0' }}>{line}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* [DS] Factuurregels — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F3F4' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Factuurregels</h2>
            </div>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '5fr 1fr 1fr 1fr 1fr', gap: 8, padding: '8px 20px', backgroundColor: '#F8F9FA' }}>
              {['Omschrijving','Aantal','Prijs','BTW','Totaal'].map((h, i) => (
                <p key={h} style={{ fontSize: 11, fontWeight: 600, color: '#9AA0A6', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, textAlign: i > 0 ? 'right' : 'left' }}>{h}</p>
              ))}
            </div>
            {lines.map((line, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '5fr 1fr 1fr 1fr 1fr', gap: 8, padding: '12px 20px', borderTop: '1px solid #F1F3F4' }}>
                <p style={{ fontSize: 14, color: '#202124', margin: 0 }}>{line.description}</p>
                <p style={{ fontSize: 14, color: '#5F6368', margin: 0, textAlign: 'right' }}>{line.quantity}</p>
                <p style={{ fontSize: 14, color: '#5F6368', margin: 0, textAlign: 'right', fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(line.unit_price)}</p>
                <p style={{ fontSize: 14, color: '#5F6368', margin: 0, textAlign: 'right' }}>{line.btw_rate}%</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0, textAlign: 'right', fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(line.line_total)}</p>
              </div>
            ))}
          </div>

          {/* [DS] Totalen */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ maxWidth: 280, marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>Subtotaal excl. BTW</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice.total_ex_btw)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>BTW</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice.btw_amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: invoice.invoice_type === 'creditnota' ? '#B3261E' : '#202124', paddingTop: 8, borderTop: '1px solid #F1F3F4' }}>
                <span>Totaal incl. BTW</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice.total_inc_btw)}</span>
              </div>
            </div>
          </div>

          {/* [DS] Betalingsinformatie */}
          {profile?.iban && invoice.invoice_type !== 'creditnota' && (
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#9AA0A6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Betalingsinformatie</p>
              <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
                Gelieve te betalen op{' '}
                <strong style={{ color: '#202124', fontFamily: 'Roboto Mono, monospace' }}>{profile.iban}</strong>{' '}
                o.v.v. <strong style={{ color: '#202124' }}>{invoice.invoice_number}</strong>
              </p>
            </div>
          )}

          {/* [DS] Creditnota terugbetaling */}
          {invoice.invoice_type === 'creditnota' && profile?.iban && (
            <div style={{ backgroundColor: '#F9DEDC', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#B3261E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Terugbetaling</p>
              <p style={{ fontSize: 14, color: '#B3261E', lineHeight: 1.6, margin: 0 }}>
                Het gecrediteerde bedrag wordt teruggestort op het rekeningnummer van de klant.
                O.v.v. creditnota <strong>{invoice.invoice_number}</strong>.
              </p>
            </div>
          )}

        </div>
      )}

      {/* [BOEK-031] Send confirmation modal — TODO: extract to shared CenteredModal — May 2026 */}
      {showSendModal && invoice && (
        <div onClick={() => setShowSendModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              Versturen naar {invoice.client_name}?
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              Bevestig de gegevens voordat je de factuur verstuurt.
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>Factuurnummer:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>
                {invoice.invoice_number || 'Wordt toegekend bij verzending'}
              </dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>E-mail:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{invoice.client_email}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>Bedrag:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>€{(invoice.total_inc_btw ?? 0).toFixed(2)}</dd>
            </dl>
            <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
              ⚠ Na verzending kun je deze factuur niet meer wijzigen. Voor correcties maak je een creditnota.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSendModal(false)}
                disabled={sending}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: sending ? 'default' : 'pointer' }}>
                Annuleren
              </button>
              <button onClick={handleSendInvoice}
                disabled={sending}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1A73E8', color: 'white', fontSize: 14, fontWeight: 600, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>
                {sending ? 'Verzenden...' : 'Versturen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}