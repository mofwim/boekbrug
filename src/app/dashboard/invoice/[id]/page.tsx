'use client'

// src/app/dashboard/invoice/[id]/page.tsx
// BOEK-005: skeleton loading
// [BOEK-031] add creditnota button for sent invoices — May 2026
// [BOEK-031] Design System v1.0 applied — Material You (ZZP page) — May 2026

import { useState, useEffect, useRef } from 'react'
import { M3, STICKY_BELOW_HEADER, columnInner, COLUMN } from '@/lib/design/tokens'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, notFound, useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { InvoicePDF } from '@/lib/invoice-pdf'
import { InvoiceActions } from '@/components/invoice/InvoiceActions'
import { InvoiceReminders } from '@/components/invoice/InvoiceReminders'
import { InvoiceDetailSkeleton } from '@/components/ui/Skeletons'
import { InvoiceTypeBadge, type InvoiceType } from '@/components/invoice/InvoiceTypeBadge'
import { crossQuarterPayment } from '@/lib/quarter'
import type { InvoiceRow, InvoiceLineRow, ProfileRow } from '@/types/rows'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
)

// [STATUS] Deze kaart was de "Design System"-kopie van de statuskleuren, en won daarmee terecht
// van vijf andere — maar het waren er acht in totaal. Woord én kleur komen nu uit
// src/lib/invoice-status.ts. Eén verschil is bewust NIET overgenomen: 'received' stond hier op
// hetzelfde blauw als 'sent', wat leest als "dit is afgehandeld", terwijl het een rekening is die
// je nog moet betalen. InvoiceRow had daar amber voor, mét reden. Zie de kop van die module.

// [DS] NL formatting — fixed, never changes
// [PRIJS-KOLOM] De prijskolom draait via unit-price-display.ts, zodat dit scherm en de PDF
// dezelfde prijs tonen — en een prijs die vermenigvuldigd het regeltotaal oplevert.
import { formatUnitPriceNL } from '@/lib/unit-price-display'
import { statusChip } from '@/lib/invoice-status'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED. This formats invoice_date / due_date / payment_date — all DATE-ONLY
// columns, so `new Date(...)` is midnight UTC and an unpinned format renders a day early west of
// UTC. It feeds the copy/share text of a legal invoice, which is the last place to be a day off.
const NL_DATE   = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam' })

const CREDITABLE_STATUSES = ['sent', 'paid', 'overdue', 'received', 'processing', 'processed']

export default function InvoiceDetailPage() {
  const router = useRouter()
  const taal = useLocale()
  const t = translator(taal)
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // [ACC-INVOICE-VIEW] viewer's own profile — reliable "self" side for the
  // Van/Aan cards. On an incoming invoice the sender_id points at an external
  // party with no profiles row, so we cannot derive the ZZP'er from it.
  const [viewerProfile, setViewerProfile] = useState<ProfileRow | null>(null)
  // [ACC-INVOICE-VIEW] original-PDF fetch state — documents bucket is private,
  // so we fetch a fresh signed URL from the existing Wave 3 file route rather
  // than linking the raw (relative, expiring) pdf_url.
  const [loadingOriginal, setLoadingOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)
  // [ACTING-FOR] De medewerker die deze factuur maakte — leeg als de eigenaar hem zelf maakte.
  const [makerNaam, setMakerNaam] = useState<string | null>(null)

  // [BOEK-031] linked creditnota — toon als er al een bestaat
  // Alleen de kolommen die de lookup ophaalt — geen volledige factuurrij beloven.
  // [CREDITNOTA-REF] The invoice THIS creditnota corrects (null unless this is a creditnota).
  const [correctedInvoice, setCorrectedInvoice] =
    useState<{ invoice_number: string | null; invoice_date: string | null } | null>(null)
  const [linkedCreditnota, setLinkedCreditnota] =
    useState<Pick<InvoiceRow, 'id' | 'invoice_number' | 'status' | 'created_at'> | null>(null)

  // [COHERENCE-CREDITNOTA] The dedicated creditnota action. It POSTs to
  // /api/invoice/creditnota — the ONE route that copies the original's lines
  // negatively, stores original_invoice_id (so "Gecrediteerd via …" shows and no
  // second creditnota can be made), mints a CR- number, and delivers the PDF.
  // The old banner navigated to a BLANK /invoice/new form where handleCredit was
  // never invoked: the owner retyped everything and handleSubmit wrote a
  // creditnota with original_invoice_id=null — an orphan that severed the link and
  // allowed unlimited duplicate legal credits. This dialog calls the route directly.
  const [showCreditDialog, setShowCreditDialog] = useState(false)
  useCloseOnBack(!!showCreditDialog, () => { if (!creatingCredit) setShowCreditDialog(false) })
  // …and it obeys the same refusal the backdrop does: while the creditnota is being minted
  // there is a number in flight, and dismissing would leave the owner not knowing whether it
  // exists. `!creatingCredit` is the SAME condition the backdrop click checks.
  const [creditReason, setCreditReason] = useState('')
  const [creatingCredit, setCreatingCredit] = useState(false)
  // [CORRIGEER] De samengestelde actie: creditnota + nieuw concept met dezelfde regels. Zie de
  // kop van /api/invoice/[id]/correct — dit scherm orkestreert niets zelf, het vraagt en toont.
  const [showCorrectDialog, setShowCorrectDialog] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [correctError, setCorrectError] = useState<string | null>(null)
  const [creditError, setCreditError] = useState<string | null>(null)

  // [BOEK-031] Send flow state — May 2026
  const [showSendModal, setShowSendModal] = useState(false)
  useCloseOnBack(!!showSendModal, () => setShowSendModal(false))
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // [FACTUUR-A] Delivery recovery banner — read ?delivery= once on mount — June 2026
  const searchParams = useSearchParams()
  const pathname = usePathname()
  // [REACT] Afgeleid van de URL — geen effect nodig. Een effect zou een tweede renderronde
  // kosten en de waarschuwing één frame later tonen dan de pagina eronder.
  const deliveryParam = searchParams.get('delivery')
  const deliveryFromUrl: 'pdf_failed' | 'email_failed' | null =
    deliveryParam === 'pdf_failed' || deliveryParam === 'email_failed' ? deliveryParam : null
  const [dismissedDelivery, setDismissedDelivery] = useState(false)
  const deliveryWarning = dismissedDelivery ? null : deliveryFromUrl
  const [resending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)



  // [COHERENCE-CREDITNOTA] ?action=credit (from the Facturen list's "credit a paid
  // invoice" flow) auto-opens the creditnota dialog once the invoice has loaded. Fires at
  // most ONCE (creditAutoOpenedRef) so it can't reopen after the user dismisses it or when
  // the invoice re-renders, and strips the query param afterwards. Guarded synchronously on
  // the invoice's own type/status so it never opens on a creditnota or a non-creditable
  // status; the server route remains the authority for the actual write.
  const creditAutoOpenedRef = useRef(false)
  useEffect(() => {
    if (
      invoice &&
      !creditAutoOpenedRef.current &&
      searchParams.get('action') === 'credit' &&
      invoice.invoice_type !== 'creditnota' &&
      invoice.direction !== 'incoming' &&
      !!invoice.status && CREDITABLE_STATUSES.includes(invoice.status)
    ) {
      creditAutoOpenedRef.current = true
      setCreditReason('')
      setCreditError(null)
      setShowCreditDialog(true)
      // Drop the param so a later re-render / setInvoice can't reopen the dialog.
      window.history.replaceState(null, '', pathname)
    }
  }, [invoice, searchParams, pathname])

  // [NAVIGATION] Back is now provided by the shared sub-page header, which
  // resolves the canonical parent via getParentPath with the page's search params
  // — so the "opened from a client's kwartaal" context (?from=client&clientId=…)
  // is preserved there, not here.

  // [FACTUUR-A] Resend handler — calls /api/invoice/send with resend:true — June 2026
  // Re-delivers PDF+email; does NOT touch invoice_number or status.
  // [ACC-INVOICE-VIEW] Open the original supplier PDF via the existing Wave 3
  // signed-URL route (same mechanism BRIDGE-POLISH used for the incoming
  // management surface). The documents bucket is private and pdf_url is stored
  // inconsistently (raw path or an expired signed URL), so we never link it
  // directly — we ask the route for a fresh signed URL keyed by invoice id.
  async function openOriginal() {
    setLoadingOriginal(true)
    try {
      const res = await fetch(`/api/email/file/${invoiceId}`)
      if (!res.ok) throw new Error('not ok')
      const data = await res.json().catch(() => ({}))
      const url = data.url || data.signedUrl || data.signed_url
      if (!url) throw new Error('no url')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setSendError('Origineel PDF kon niet worden geopend')
    } finally {
      setLoadingOriginal(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setSendError(null)

    const res = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId, resend: true }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSendError(data.error || 'Opnieuw versturen mislukt')
      setResending(false)
      return
    }

    // Success — hide banner + clean ?delivery= from URL
    setDismissedDelivery(true)
    setResendSuccess(true)
    setResending(false)
    router.replace(pathname) // strips query params
  }

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

      // [INVOICE-DETAIL-NULL-GUARD] On an incoming invoice the sender_id points
      // at an external party with NO profiles row (often null) — querying
      // profiles.eq('id', null) throws a Postgres 22P02 "invalid input syntax for
      // uuid: null" and floods the console. Guard it: only fetch the sender
      // profile when sender_id is a real value; otherwise resolve to null.
      const senderProfilePromise = invoiceData.sender_id
        ? supabase.from('profiles').select('*').eq('id', invoiceData.sender_id).single()
        : Promise.resolve({ data: null })

      const [{ data: senderProfile }, { data: linesData }, { data: ownProfile }] = await Promise.all([
        senderProfilePromise,
        supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId),
        supabase.from('profiles').select('*').eq('id', user.id).single(),
      ])

      if (senderProfile) setProfile(senderProfile)
      if (linesData) setLines(linesData)
      if (ownProfile) setViewerProfile(ownProfile) // [ACC-INVOICE-VIEW]

      // [ACTING-FOR] Wie maakte deze factuur? Alleen relevant als dat NIET de kijker zelf was —
      // dan is het de medewerker die hem namens de eigenaar heeft uitgegeven. created_by werd
      // geschreven en nergens gelezen; dit is de leesbare kant ervan.
      //
      // De naam komt uit /api/company/members, die alleen (oud-)teamleden van de AANROEPER
      // teruggeeft. Er wordt dus nooit een losse uuid naar een naam vertaald, en de aanroep
      // gebeurt alleen in het geval dat hij iets kan opleveren.
      const maker = (invoiceData as { created_by?: string | null }).created_by
      if (maker && maker !== user.id) {
        try {
          const res = await fetch('/api/company/members')
          if (res.ok) {
            const json = await res.json()
            const lid = (json?.leden ?? []).find((l: { member_id?: string }) => l.member_id === maker)
            if (lid?.naam) setMakerNaam(lid.naam)
          }
        } catch { /* een naam is een extraatje — nooit een reden om het scherm te breken */ }
      }

      // [BOEK-031] Is deze factuur al gecrediteerd? The creditnota stores its link to the
      // original in `original_invoice_id` (the real FK the creditnota route writes + guards
      // on). The old lookup used `receiver_id` — a USER-id FK, not the invoice link — so it
      // was ALWAYS null: the "Gecrediteerd via …" banner never appeared and the "Creditnota"
      // button stayed on an already-credited invoice, dead-ending on the server's 409.
      if (CREDITABLE_STATUSES.includes(invoiceData.status) && invoiceData.invoice_type === 'factuur') {
        const { data: creditnota } = await supabase
          .from('invoices')
          .select('id, invoice_number, status, created_at')
          .eq('original_invoice_id', invoiceId)
          .eq('invoice_type', 'creditnota')
          .maybeSingle()

        if (creditnota) setLinkedCreditnota(creditnota)
      }

      // [CREDITNOTA-REF] The other direction: when THIS invoice is a creditnota, resolve the
      // invoice it corrects, so the downloadable PDF can name it. Art. 219 Richtlijn 2006/112/EG
      // only equates a corrective document with an invoice when it refers specifically and
      // unambiguously to the initial one — without this the page-rendered PDF named only itself,
      // while the mailed one (rendered server-side) now does carry the reference.
      if (invoiceData.invoice_type === 'creditnota' && invoiceData.original_invoice_id) {
        const { data: corrected } = await supabase
          .from('invoices')
          .select('invoice_number, invoice_date')
          .eq('id', invoiceData.original_invoice_id)
          .maybeSingle()
        if (corrected) setCorrectedInvoice(corrected)
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
    setInvoice((prev) => (prev === null ? prev : {
      ...prev,
      status: 'sent',
      invoice_number: responseData.invoice_number ?? prev.invoice_number,
      invoice_type: responseData.invoice_type ?? prev.invoice_type,
    }))

    // [SEND-PDF-HONEST] pdf_failed = the number was issued but the PDF/email did NOT go out. Don't
    // silently close as if delivered — keep the modal open with an honest resend prompt.
    if (responseData.warning === 'pdf_failed' || responseData.delivered === false) {
      setSendError('De factuur kreeg een nummer, maar de PDF kon niet worden gemaakt — de klant heeft niets ontvangen. Verstuur opnieuw.')
      setSending(false)
      return
    }

    setShowSendModal(false)
    setSending(false)
  }

  // [COHERENCE-CREDITNOTA] Create the creditnota via the dedicated route. No blank
  // form, no re-entry: the server copies the original invoice's lines negatively and
  // preserves the original_invoice_id link. On success we land on the new creditnota;
  // the original's detail then shows "Gecrediteerd via …" and the create-banner is
  // gone (canCreateCreditnota turns off), so a second credit is impossible.
  async function createCreditnota() {
    setCreatingCredit(true)
    setCreditError(null)
    try {
      const res = await fetch('/api/invoice/creditnota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_invoice_id: invoiceId, reason: creditReason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreditError(data.error || 'Creditnota aanmaken mislukt — probeer opnieuw')
        setCreatingCredit(false)
        return
      }
      // Navigate to the freshly-created, correctly-linked creditnota.
      router.replace(
        data.creditnota_id ? `/dashboard/invoice/${data.creditnota_id}` : '/dashboard/facturen'
      )
    } catch {
      setCreditError(t('detail.onbekendeFout'))
      setCreatingCredit(false)
    }
  }

  // [STATUS] Woord én kleur in één keer, uit de gedeelde module.
  const statusCfg = invoice
    ? statusChip(invoice.status, taal)
    : null

  // [ACC-INVOICE-DETAIL] Owner = the logged-in viewer whose id equals the
  // invoice's sender_id (the party who issued it). An accountant opening a
  // client's outgoing invoice has a different id, so isOwner is false for them.
  // Identity-based, not query-param based: cannot be spoofed or absent.
  const isOwner = !!invoice && viewerProfile?.id === invoice.sender_id

  const canCreateCreditnota =
    invoice &&
    isOwner && // [ACC-INVOICE-DETAIL] creditnota is an owner-only action, never the accountant
    invoice.invoice_type !== 'creditnota' &&
    invoice.direction !== 'incoming' && // [ACC-INVOICE-VIEW] creditnota only on own outgoing invoices
    !!invoice.status && CREDITABLE_STATUSES.includes(invoice.status) &&
    !linkedCreditnota

  // [ACC-INVOICE-VIEW] Direction is the single source of truth. Only an explicit
  // 'incoming' flips the view; NULL/legacy/anything else renders as outgoing
  // (the safe, unchanged default that covers every normal invoice).
  const isIncoming = invoice?.direction === 'incoming'

  // [ACC-INVOICE-VIEW] Party blocks derived from direction.
  //   outgoing:  Van = ZZP'er (own profile)        | Aan = customer (client_*)
  //   incoming:  Van = supplier (client_* fields)  | Aan = ZZP'er (own profile)
  // On incoming, the supplier lives in client_* (there are no supplier_* columns),
  // and the ZZP'er is the logged-in viewer (sender_id points at an external party).
  const selfBlock = {
    name: viewerProfile?.company_name || viewerProfile?.full_name,
    lines: [
      viewerProfile?.company_name || viewerProfile?.full_name,
      viewerProfile?.address,
      [viewerProfile?.postal_code, viewerProfile?.city].filter(Boolean).join(' '),
      viewerProfile?.kvk_number ? `KVK: ${viewerProfile.kvk_number}` : null,
      viewerProfile?.btw_number ? `BTW: ${viewerProfile.btw_number.toUpperCase()}` : null,
    ],
  }
  const counterpartyBlock = {
    name: invoice?.client_name || '—',
    lines: [
      invoice?.client_name || '—',
      invoice?.client_address,
      [invoice?.client_postal_code, invoice?.client_city].filter(Boolean).join(' '),
      invoice?.client_btw_number ? `BTW: ${invoice.client_btw_number.toUpperCase()}` : null,
      invoice?.client_email,
    ],
  }
  const vanBlock = isIncoming ? counterpartyBlock : selfBlock
  const aanBlock = isIncoming ? selfBlock : counterpartyBlock

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA' }}>

      {/* [DS] Context toolbar — [SUBNAV] back + generic "Factuur" title come from
          the shared sub-page header; this bar keeps the invoice-specific context
          (number + type badge + status chip + actions + PDF) and sticks directly
          below the shared bar. */}
      <div style={{
        position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 10,
        backgroundColor: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px',
      }}>
        {/* [BAR-ALIGN] This bar already centred its content — but at the column's
            OUTER width, while the body below spends 16px of that on its gutters.
            The factuurnummer therefore started one gutter left of the card under
            it and the PDF button ended one gutter right of it. columnInner is the
            width the reader actually sees. */}
        {/* [DETAIL-BAR] Layout staat in globals.css (.inv-detail-bar*), niet inline —
            anders wint de inline style van de wrap-regel onder 520px en scrolt de
            hele pagina weer zijwaarts. */}
        <div className="inv-detail-bar" style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto' }}>
          <div className="inv-detail-bar-left">
            {loading ? (
              <div style={{ height: 16, width: 144, backgroundColor: '#f1f3f4', borderRadius: 9999 }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ fontSize: 16, fontWeight: 700, color: '#202124', margin: 0 }}>
                  {invoice?.invoice_number || 'Concept'}
                </h1>
                {invoice?.invoice_type && invoice?.invoice_type !== 'factuur' && (
                  <InvoiceTypeBadge type={invoice.invoice_type as InvoiceType} size="xs" />
                )}
                {/* [ACTING-FOR] Gemaakt door een MEDEWERKER, niet door de eigenaar zelf.
                    De eigenaar deelt het recht uit om facturen op zijn naam en BTW-nummer uit
                    te geven; bij een controle is zo'n factuur niet van de zijne te onderscheiden.
                    Dan hoort hier te staan wie hem maakte. Verschijnt alleen als het iemand
                    anders was — anders is het ruis op elke eigen factuur. */}
                {makerNaam && (
                  <span
                    title={`Aangemaakt door ${makerNaam}`}
                    style={{ fontSize: 11, fontWeight: 500, borderRadius: 9999, padding: '3px 10px', background: '#F3E5F5', color: '#6A1B9A', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>person</span>
                    {makerNaam}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="inv-detail-bar-right">
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
                  invoiceNumber={invoice?.invoice_number ?? ''}
                  status={invoice?.status ?? ''}
                  direction={invoice?.direction ?? undefined} /*[BOEK-020]*/
                  invoiceType={invoice?.invoice_type} /*[BETAALVERZOEK]*/
                />
                {/* [ACC-INVOICE-VIEW] Outgoing: generate the invoice PDF.
                    Incoming: InvoicePDF assumes outgoing (Van=profile/Aan=client)
                    and would emit a wrong document — show the original supplier
                    PDF from pdf_url instead. */}
                {!isIncoming && invoice && profile && (
                  <PDFDownloadLink
                    document={
                      <InvoicePDF
                        invoice={{
                          ...invoice,
                          // [CREDITNOTA-REF] undefined on a normal factuur — the PDF prints the
                          // reference line only for a creditnota that has one.
                          original_invoice_number: correctedInvoice?.invoice_number,
                          original_invoice_date: correctedInvoice?.invoice_date,
                        }}
                        lines={lines}
                        profile={profile}
                      />
                    }
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
                {isIncoming && invoice?.pdf_url && (
                  <button
                    onClick={openOriginal}
                    disabled={loadingOriginal}
                    style={{
                      backgroundColor: '#1A73E8',
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '8px 16px',
                      borderRadius: 9999,
                      border: 'none',
                      cursor: loadingOriginal ? 'wait' : 'pointer',
                      opacity: loadingOriginal ? 0.6 : 1,
                      transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  >
                    {loadingOriginal ? 'Laden...' : '↓ Origineel PDF'}
                  </button>
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
        <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 80 }}>

          {/* [FACTUUR-A] Delivery recovery banner — shows when ?delivery=pdf_failed|email_failed — June 2026 */}
          {deliveryWarning && (
            <div style={{ backgroundColor: '#FEF7E0', borderInlineStart: '4px solid #F9AB00', borderRadius: '0 16px 16px 0', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1 }}>
                <span style={{ color: M3.warning, flexShrink: 0, fontSize: 16 }}>⚠</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#7C4D00', margin: 0 }}>
                    {t('detail.bezorgingMislukt')}
                  </p>
                  <p style={{ fontSize: 12, color: '#7C4D00', margin: '2px 0 0', opacity: 0.85 }}>
                    {deliveryWarning === 'pdf_failed'
                      ? 'De PDF kon niet worden gegenereerd. Het factuurnummer is wel definitief.'
                      : 'De e-mail kon niet worden afgeleverd. Het factuurnummer is wel definitief.'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleResend}
                disabled={resending}
                style={{ flexShrink: 0, backgroundColor: '#F9AB00', color: '#202124', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: resending ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: resending ? 0.6 : 1 }}
              >
                {resending ? 'Verzenden...' : '↻ Opnieuw versturen'}
              </button>
            </div>
          )}

          {/* [FACTUUR-A] Resend success — toast-like — June 2026 */}
          {resendSuccess && (
            <div style={{ backgroundColor: '#E6F4EA', borderRadius: 16, padding: '10px 16px' }}>
              <p style={{ fontSize: 13, color: '#137333', margin: 0 }}>
                ✓ De factuur is opnieuw verzonden.
              </p>
            </div>
          )}

          {/* [REMINDERS] Per-invoice reminder history + pause (outgoing sent/overdue only) */}
          <InvoiceReminders
            invoiceId={invoiceId}
            direction={invoice?.direction}
            status={invoice?.status}
            remindersPaused={invoice?.reminders_paused}
          />

          {/* [BOEK-031] Send banner — only for draft invoices — May 2026 */}
          {invoice?.status === 'draft' && (
            <div style={{ backgroundColor: '#D3E3FD', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#1967D2' }}>↗</span>
                <p style={{ fontSize: 12, color: '#1967D2', margin: 0 }}>
                  <strong>{t('detail.klaar')}</strong> {t('detail.definitief')}
                </p>
              </div>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={sending}
                style={{ flexShrink: 0, marginInlineStart: 12, backgroundColor: '#1A73E8', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: sending ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: sending ? 0.6 : 1 }}
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
                  <p style={{ fontSize: 11, color: '#B3261E', margin: '2px 0 0', opacity: 0.8 }}>{t('detail.geannuleerd')}</p>
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
                  <strong>{t('detail.foutIn')}</strong> {t('detail.nooitVerwijderen')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginInlineStart: 12 }}>
                {/* [CORRIGEER] Verkeerde gegevens, regels goed: de wettelijke vorm van "bewerken". */}
                <button
                  onClick={() => { setCorrectError(null); setShowCorrectDialog(true) }}
                  style={{ backgroundColor: 'white', color: '#EA8600', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: '1px solid #F9AB00', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >✎ {t('detail.corrigeer')}</button>
                <button
                  onClick={() => { setCreditReason(''); setCreditError(null); setShowCreditDialog(true) }}
                  style={{ backgroundColor: '#EA4335', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)' }}
                >↩ Creditnota</button>
              </div>
            </div>
          )}

          {/* [DS] Van / Aan / Details — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
              {[
                {
                  title: 'Van',
                  lines: vanBlock.lines,
                },
                {
                  title: 'Aan',
                  lines: aanBlock.lines,
                },
                {
                  title: 'Details',
                  lines: [
                    `Nummer: ${invoice?.invoice_number || '—'}`,
                    `Datum: ${invoice?.invoice_date ? NL_DATE.format(new Date(invoice?.invoice_date)) : '—'}`,
                    `Vervaldatum: ${invoice?.due_date ? NL_DATE.format(new Date(invoice?.due_date)) : '—'}`,
                    // [CROSS-QUARTER] Show the real settlement date when we recorded one, so
                    // "when did this get paid" is answered on the invoice itself.
                    invoice?.payment_date ? `Betaald op: ${NL_DATE.format(new Date(invoice?.payment_date))}` : '',
                  ]
                },
              ].map(section => (
                <div key={section.title}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{section.title}</p>
                  {section.lines.filter(Boolean).map((line, i) => (
                    <p key={i} style={{ fontSize: 13, color: i === 0 ? '#202124' : '#5F6368', fontWeight: i === 0 ? 600 : 400, margin: '2px 0' }}>{line}</p>
                  ))}
                </div>
              ))}
            </div>
            {/* [CROSS-QUARTER] When the money moved in a different quarter than the invoice
                date, say so plainly — and make explicit that the btw quarter did NOT move,
                so the owner is never confused into thinking their aangifte shifted. */}
            {invoice?.status === 'paid' && (() => {
              const xq = crossQuarterPayment(invoice?.invoice_date, invoice?.payment_date)
              if (!xq) return null
              return (
                <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: '#FFF3E0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B26A00', marginTop: 1 }}>event_available</span>
                  <div style={{ fontSize: 12.5, color: '#7A4B00', lineHeight: 1.5 }}>
                    <strong>Betaald in {xq.paidQuarterLabel}.</strong> Voor de btw telt deze factuur mee in {xq.bookedQuarterLabel} — de kwartaal­aangifte volgt de factuurdatum, niet de betaaldatum. Dit verandert daar niets aan; het laat alleen zien wanneer het geld binnenkwam.
                  </div>
                </div>
              )
            })()}
          </div>

          {/* [DS] Factuurregels — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F3F4' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('nieuw.regels.factuur')}</h2>
            </div>
            {/* Header row — [LINES-LAYOUT] raster + uitlijning staan in globals.css
                (.inv-lines-*), niet inline: anders wint de inline style van de
                media query en houdt de telefoon het brede raster. */}
            <div className="inv-lines-head" style={{ padding: '8px 20px', backgroundColor: '#F8F9FA' }}>
              {['Omschrijving','Aantal','Prijs','BTW','Totaal'].map((h, i) => (
                <p key={h} className={i === 0 ? 'inv-lines-desc' : 'inv-lines-total'} style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{h}</p>
              ))}
            </div>
            {lines.map((line, index) => (
              <div key={index} className="inv-lines-row" style={{ padding: '12px 20px', borderTop: '1px solid #F1F3F4' }}>
                <p className="inv-lines-desc" style={{ fontSize: 14, color: '#202124', margin: 0 }}>{line.description}</p>
                <p className="inv-lines-qty" style={{ fontSize: 14, color: '#5F6368', margin: 0 }}>{line.quantity}</p>
                <p className="inv-lines-price" style={{ fontSize: 14, color: '#5F6368', margin: 0, fontFamily: 'Roboto Mono, monospace' }}>{formatUnitPriceNL(line.unit_price, line.quantity, line.line_total)}</p>
                <p className="inv-lines-btw" style={{ fontSize: 14, color: '#5F6368', margin: 0 }}>{line.btw_rate}%</p>
                <p className="inv-lines-total" style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0, fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(line.line_total ?? 0)}</p>
              </div>
            ))}
          </div>

          {/* [DS] Totalen */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ maxWidth: 280, marginInlineStart: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>{t('nieuw.totaal.subtotaal')}</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.total_ex_btw ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>BTW</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.btw_amount ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: invoice?.invoice_type === 'creditnota' ? '#B3261E' : '#202124', paddingTop: 8, borderTop: '1px solid #F1F3F4' }}>
                <span>{t('nieuw.totaal.incl')}</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.total_inc_btw ?? 0)}</span>
              </div>
            </div>
          </div>

          {/* [DS] Betalingsinformatie — [ACC-INVOICE-VIEW] outgoing only;
              on incoming the IBAN belongs to the supplier (in the original PDF),
              not the ZZP'er's own profile. */}
          {!isIncoming && profile?.iban && invoice?.invoice_type !== 'creditnota' && (
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{t('nieuw.betaalinfo')}</p>
              <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
                Gelieve te betalen op{' '}
                <strong style={{ color: '#202124', fontFamily: 'Roboto Mono, monospace' }}>{profile.iban}</strong>{' '}
                o.v.v. <strong style={{ color: '#202124' }}>{invoice?.invoice_number}</strong>
              </p>
            </div>
          )}

          {/* [FACTUUR-A] Terugbetaling block removed — PDF carries authoritative legal text — June 2026 */}

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
              {t('detail.bevestig')}
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
                {t('nieuw.actie.annuleren')}
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

      {/* [COHERENCE-CREDITNOTA] Creditnota confirmation — replaces the dead blank-form
          navigation. Confirming calls /api/invoice/creditnota, which copies this
          invoice's lines negatively and preserves the link. No re-entry, no orphans. */}
      {showCreditDialog && invoice && (
        <div onClick={() => !creatingCredit && setShowCreditDialog(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              Creditnota maken voor {invoice.invoice_number || 'deze factuur'}?
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              We maken automatisch een creditnota met dezelfde regels als negatieve bedragen.
              De originele factuur blijft staan en wordt gemarkeerd als gecrediteerd. Je hoeft
              niets over te typen.
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>Klant:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{invoice.client_name}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('detail.teCrediteren')}</dt>
              <dd style={{ color: '#B3261E', fontWeight: 600, margin: 0 }}>
                −{NL_NUMBER.format(Math.abs(invoice.total_inc_btw ?? 0))}
              </dd>
            </dl>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#5F6368', marginBottom: 6 }}>
              Reden (optioneel)
            </label>
            <input
              type="text"
              value={creditReason}
              onChange={e => setCreditReason(e.target.value)}
              placeholder={t('detail.creditReden')}
              disabled={creatingCredit}
              style={{ width: '100%', minHeight: 44, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 12px', fontSize: 16, color: '#202124', boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit' }}
            />
            {creditError && (
              <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
                {creditError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreditDialog(false)}
                disabled={creatingCredit}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: creatingCredit ? 'default' : 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
              <button onClick={createCreditnota}
                disabled={creatingCredit}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#EA4335', color: 'white', fontSize: 14, fontWeight: 600, cursor: creatingCredit ? 'default' : 'pointer', opacity: creatingCredit ? 0.6 : 1 }}>
                {creatingCredit ? 'Bezig…' : '↩ Creditnota maken'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [CORRIGEER] Eén tik maakt TWEE documenten — dus de dialoog zegt precies wat er straks
          bestaat, vóór de tik. Bij succes gaat het scherm naar het nieuwe concept, waar de
          gegevens gewoon bewerkbaar zijn en de regels al ingevuld staan. */}
      {showCorrectDialog && invoice && (
        <div onClick={() => !correcting && setShowCorrectDialog(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 10px' }}>{t('detail.corrigeer.titel')}</h2>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: '0 0 16px' }}>
              {t('detail.corrigeer.uitleg', { number: invoice.invoice_number ?? '' })}
            </p>
            {correctError && (
              <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
                {correctError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setShowCorrectDialog(false)}
                disabled={correcting}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: correcting ? 'default' : 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
              <button
                onClick={async () => {
                  setCorrecting(true); setCorrectError(null)
                  try {
                    const res = await fetch(`/api/invoice/${invoiceId}/correct`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok || !data?.draft_id) {
                      setCorrectError(data?.error || t('detail.onbekendeFout'))
                      setCorrecting(false)
                      return
                    }
                    router.push(`/dashboard/invoice/${data.draft_id}/edit`)
                  } catch {
                    setCorrectError(t('detail.onbekendeFout'))
                    setCorrecting(false)
                  }
                }}
                disabled={correcting}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#EA8600', color: 'white', fontSize: 14, fontWeight: 600, cursor: correcting ? 'default' : 'pointer', opacity: correcting ? 0.6 : 1 }}>
                {correcting ? t('detail.corrigeer.bezig') : `✎ ${t('detail.corrigeer.ja')}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}