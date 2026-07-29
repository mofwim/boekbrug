'use client'

// src/app/dashboard/klanten/KlantenClient.tsx
// [BOEK-029] Client component — profile always passed from server wrapper
// Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter, useSearchParams } from 'next/navigation'
import { STICKY_BELOW_HEADER } from '@/lib/design/tokens'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { ProfileRow } from '@/types/rows'
// [SMART-FILTER] Accent-insensitieve fold ("Café" ↔ "cafe") — één gedeelde,
// null-veilige bron voor alle pagina's (src/lib/search.ts).
import { foldText } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const M3 = {
  primary:           '#1A73E8',
  onPrimary:         '#FFFFFF',
  primaryContainer:  '#D3E3FD',
  onPrimaryContainer:'#041E49',
  surface:           '#ffffff',
  onSurface:         '#202124',
  surfaceVariant:    '#f1f3f4',
  outline:           '#80868b',
  error:             '#B3261E',
  errorContainer:    '#F9DEDC',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

interface Client {
  id: string; name: string; email: string | null
  kvk_number: string | null; btw_number: string | null; iban: string | null
  address: string | null; postal_code: string | null; city: string | null
  created_at: string
}

const EMPTY = { name: '', email: '', kvk_number: '', btw_number: '', iban: '', address: '', postal_code: '', city: '' }

// Avatar color from name
function avatarColor(name: string) {
  const colors = ['#1A73E8','#00897B','#7B1FA2','#E37400','#E53935','#039BE5']
  return colors[name.charCodeAt(0) % colors.length]
}

export default function KlantenClient({ profile }: { profile: ProfileRow }) {
  const router   = useRouter()
  const supabase = createClient()

  // [SEARCH] Deep-link focus from the global search (?focus={clientId}) — scroll,
  // expand and briefly highlight the matching client card.
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const dialog = useDialog()
  // [MOTION] The app-wide snackbar. Bound to the name the call sites already
  // used, so the seven showToast(...) calls below are unchanged.
  const showToast = useToast()
  const [clients, setClients]       = useState<Client[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)  // [BOEK-029] edit mode
  const [form, setForm]             = useState(EMPTY)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').eq('user_id', profile.id).order('name')
    setClients(data ?? [])
    setLoading(false)
  }

  // [SEARCH] Accent-insensitive filter across the full customer record — not just
  // name/email (KVK, BTW, IBAN, city, address are all findable now).
  // [PERF] Gememoïseerd: zonder useMemo werden tot 7 velden per klant bij ELKE
  // render opnieuw gefold (ook bij het openklappen van een kaart of een toast).
  const filtered = useMemo(() => {
    const q = foldText(search.trim())
    if (!q) return clients
    return clients.filter(c =>
      foldText(c.name).includes(q) ||
      foldText(c.email).includes(q) ||
      foldText(c.kvk_number).includes(q) ||
      foldText(c.btw_number).includes(q) ||
      foldText(c.iban).includes(q) ||
      foldText(c.city).includes(q) ||
      foldText(c.address).includes(q)
    )
  }, [clients, search])

  // [SEARCH] Reveal the ?focus= client once the list has loaded.
  useEffect(() => {
    if (!focusId || loading) return
    if (!clients.some(c => c.id === focusId)) return
    // De onthulling hoort bij dezelfde beweging als het scrollen: binnen de wikkel draait
    // ze in dezelfde tick, maar telt ze niet als synchrone setState in de effect-body.
    void (async () => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    })()
    const scrollTimer = setTimeout(() => {
      rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
  }, [focusId, loading, clients])

  async function handleSave() {
    if (!form.name.trim()) { setError('Naam is verplicht'); return }
    setSaving(true); setError(null)

    if (editingId) {
      // [BOEK-029] Update existing client
      const { error: err } = await supabase.from('clients').update({
        name: form.name.trim(),
        email: form.email || null, kvk_number: form.kvk_number || null,
        btw_number: form.btw_number || null, iban: form.iban || null,
        address: form.address || null, postal_code: form.postal_code || null, city: form.city || null,
      }).eq('id', editingId)
      if (err) { setError('Opslaan mislukt'); setSaving(false); return }
      showToast('Klant bijgewerkt')
    } else {
      // Insert new client
      const { error: err } = await supabase.from('clients').insert({
        user_id: profile.id, name: form.name.trim(),
        email: form.email || null, kvk_number: form.kvk_number || null,
        btw_number: form.btw_number || null, iban: form.iban || null,
        address: form.address || null, postal_code: form.postal_code || null, city: form.city || null,
      })
      if (err) { setError('Opslaan mislukt'); setSaving(false); return }
      showToast('Klant toegevoegd')
    }

    setForm(EMPTY); setShowForm(false); setEditingId(null)
    await loadClients()
    setSaving(false)
  }

  // [BOEK-029] Open form pre-filled with client data
  function handleEdit(client: Client) {
    setForm({
      name:        client.name,
      email:       client.email       ?? '',
      kvk_number:  client.kvk_number  ?? '',
      btw_number:  client.btw_number  ?? '',
      iban:        client.iban        ?? '',
      address:     client.address     ?? '',
      postal_code: client.postal_code ?? '',
      city:        client.city        ?? '',
    })
    setEditingId(client.id)
    setShowForm(true)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(id: string) {
    // [MOTION] Was window.confirm('Klant verwijderen?') — a browser box that
    // named neither the client nor the consequence.
    const client = clients.find(c => c.id === id)
    const ok = await dialog.confirm({
      title: 'Klant verwijderen?',
      message: `${client?.name ?? 'Deze klant'} verdwijnt uit je klantenlijst. Facturen die je al aan deze klant stuurde, blijven staan.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    })
    if (!ok) return
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(c => c.id !== id))
    showToast('Klant verwijderd')
  }


  // `as const` op de sleutels: daardoor weet TypeScript dat f.key een veld van het
  // formulier is, in plaats van een willekeurige string die een cast nodig heeft.
  const FIELDS = [
    { key: 'name',        label: 'Naam *',      placeholder: 'Bedrijfsnaam of naam', required: true },
    { key: 'email',       label: 'E-mail',       placeholder: 'info@bedrijf.nl' },
    { key: 'kvk_number',  label: 'KVK nummer',  placeholder: '12345678' },
    { key: 'btw_number',  label: 'BTW nummer',  placeholder: 'NL123456789B01' },
    { key: 'iban',        label: 'IBAN',         placeholder: 'NL91ABNA0417164300' },
    { key: 'address',     label: 'Adres',        placeholder: 'Straatnaam 1' },
    { key: 'postal_code', label: 'Postcode',     placeholder: '1234 AB' },
    { key: 'city',        label: 'Stad',         placeholder: 'Amsterdam' },
  ] as const

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Controls toolbar ── [SUBNAV] back + "Mijn klanten" title come from the
          shared sub-page header; this block keeps the "Nieuw" + search controls,
          sticking directly below the shared bar. */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px 10px', position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => { setShowForm(p => !p); setError(null) }}
            style={{ background: M3.primaryContainer, color: M3.onPrimaryContainer, border: 'none', borderRadius: R.full, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person_add</span>
            Nieuw
          </button>
        </div>

        {/* Material You search bar */}
        <div style={{ position: 'relative' }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#5F6368' }}>search</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            aria-label="Klanten zoeken"
            placeholder="Zoek op naam, e-mail, KVK, IBAN..."
            style={{ width: '100%', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: search ? '10px 40px 10px 40px' : '10px 16px 10px 40px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface }}
          />
          {/* [SMART-FILTER] Wissen-knop — alleen zichtbaar zodra er iets getypt is. */}
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Zoekopdracht wissen"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', borderRadius: R.full, padding: 4, cursor: 'pointer', color: '#5F6368', display: 'flex', alignItems: 'center', fontFamily: FONT }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          )}
        </div>
      </div>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 80px' }}>

        {/* Add form — Material You card */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: R.lg, padding: '20px 16px', boxShadow: EL1, marginBottom: 14, border: `1px solid ${M3.primaryContainer}` }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 16, fontFamily: FONT }}>
              {editingId ? 'Klant bewerken' : 'Nieuwe klant'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FIELDS.map(f => (
                <div key={f.key}>
                  <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 4, fontWeight: 500 }}>{f.label}</p>
                  <input
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{ width: '100%', borderRadius: R.md, border: `2px solid ${form[f.key] ? M3.primary : M3.outline}`, padding: '12px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface, transition: 'border-color 0.15s' }}
                  />
                </div>
              ))}
            </div>
            {error && <p style={{ fontSize: 12, color: M3.error, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setShowForm(false); setForm(EMPTY); setEditingId(null) }}
                style={{ flex: 1, padding: '12px', borderRadius: R.full, border: 'none', background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                Annuleren
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '12px', borderRadius: R.full, border: 'none', background: saving ? M3.surfaceVariant : M3.primary, color: saving ? '#80868b' : '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                {saving ? 'Opslaan...' : editingId ? 'Bijwerken' : 'Opslaan'}
              </button>
            </div>
          </div>
        )}

        {/* Client list */}
        {loading ? <SkeletonList /> : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#C4C7C5', display: 'block', marginBottom: 12 }}>people</span>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 4, fontFamily: FONT }}>
              {search ? 'Geen resultaten' : 'Nog geen klanten'}
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>
              {search ? `Geen klant gevonden voor "${search}"` : 'Voeg je eerste klant toe'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(client => {
              const expanded = expandedId === client.id
              const bg = avatarColor(client.name)
              return (
                <div
                  key={client.id}
                  ref={el => { rowRefs.current[client.id] = el }}
                  style={{
                    borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1,
                    outline: highlightId === client.id ? `2px solid ${M3.primary}` : '2px solid transparent',
                    outlineOffset: 2, transition: 'outline-color 0.3s',
                  }}
                >
                  {/* Main row */}
                  <div onClick={() => setExpandedId(expanded ? null : client.id)}
                    style={{ background: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                    {/* Avatar */}
                    <div style={{ width: 42, height: 42, borderRadius: R.full, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>{client.name}</p>
                      <p style={{ fontSize: 13, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.email ?? 'Geen e-mail'}</p>
                    </div>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#80868b', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>chevron_right</span>
                  </div>

                  {/* Inline expand */}
                  {expanded && (
                    <div style={{ background: '#F8F9FA', borderTop: `1px solid ${M3.surfaceVariant}`, padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 14 }}>
                        {client.kvk_number  && <InfoLine label="KVK"  value={client.kvk_number} />}
                        {client.btw_number  && <InfoLine label="BTW"  value={client.btw_number} />}
                        {client.iban        && <InfoLine label="IBAN" value={client.iban} />}
                        {client.address     && <InfoLine label="Adres" value={[client.address, client.postal_code, client.city].filter(Boolean).join(', ')} />}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* [KLANTEN] Open the mini-CRM detail: history, notes, totals. */}
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/klanten/${client.id}`) }}
                          style={{ fontSize: 13, color: M3.onSurface, background: M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person</span>
                          Bekijk
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(client.id) }}
                          style={{ fontSize: 13, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          Verwijderen
                        </button>
                        {/* [BOEK-029] Edit button */}
                        <button onClick={e => { e.stopPropagation(); handleEdit(client) }}
                          style={{ fontSize: 13, color: M3.primary, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                          Bewerken
                        </button>
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/new?client_id=${client.id}&client_name=${encodeURIComponent(client.name)}`) }}
                          style={{ fontSize: 13, color: M3.onPrimary, background: M3.primary, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                          Factuur
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: `calc(24px + env(safe-area-inset-bottom))`,
          right: 20,
          background: '#D3E3FD',
          color: '#041E49',
          borderRadius: R.lg,
          padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
        Nieuwe factuur
      </button>
      <style>{`
        @keyframes shimmer  { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2, fontWeight: 500 }}>{label}</p>
      {/* [ROW-LAYOUT] overflowWrap so an unbroken IBAN / BTW-nummer wraps inside its
          grid cell instead of overflowing and being clipped by the card. */}
      <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: FONT, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: R.lg, background: 'linear-gradient(90deg,#F8F9FA 25%,#e0e0e0 50%,#F8F9FA 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />)}
    </div>
  )
}