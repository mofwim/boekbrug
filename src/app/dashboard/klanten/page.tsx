'use client'

// src/app/dashboard/klanten/page.tsx
// [BOEK-029] Mijn klanten — client list + inline expand + add form — May 2026

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface Client {
  id: string
  name: string
  email: string | null
  kvk_number: string | null
  btw_number: string | null
  iban: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  created_at: string
}

const EMPTY_FORM = { name: '', email: '', kvk_number: '', btw_number: '', iban: '', address: '', postal_code: '', city: '' }

export default function KlantenPage({ profile }: { profile: any }) {
  const router   = useRouter()
  const supabase = createClient()

  const [clients, setClients]     = useState<Client[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [toast, setToast]         = useState<string | null>(null)

  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    setLoading(true)
    const { data } = await supabase
      .from('clients').select('*')
      .eq('user_id', profile.id)
      .order('name', { ascending: true })
    setClients(data ?? [])
    setLoading(false)
  }

  // [BOEK-029] filtered by search
  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleSave() {
    if (!form.name.trim()) { setError('Naam is verplicht'); return }
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('clients').insert({
      user_id: profile.id,
      name: form.name.trim(),
      email: form.email || null,
      kvk_number: form.kvk_number || null,
      btw_number: form.btw_number || null,
      iban: form.iban || null,
      address: form.address || null,
      postal_code: form.postal_code || null,
      city: form.city || null,
    })
    if (err) { setError('Opslaan mislukt'); setSaving(false); return }
    setForm(EMPTY_FORM); setShowForm(false)
    showToast('Klant toegevoegd')
    await loadClients()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Klant verwijderen?')) return
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(c => c.id !== id))
    showToast('Klant verwijderd')
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--color-bg, #f2f2f7)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* ── Header ── */}
      <div style={{
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(0,0,0,0.1)',
        padding: '12px 16px 10px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#007aff', fontWeight: 600, padding: 0 }}>← Terug</button>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', flex: 1, textAlign: 'center' }}>Mijn klanten</h1>
          <button onClick={() => { setShowForm(p => !p); setError(null) }}
            style={{ background: '#007aff', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 700 }}>
            + Nieuw
          </button>
        </div>
        {/* Search */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Zoek op naam of e-mail..."
          style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e5ea', padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
      </div>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 80px' }}>

        {/* ── Add form ── */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '18px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', marginBottom: 14 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 14 }}>Nieuwe klant</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { key: 'name',       label: 'Naam *',      placeholder: 'Bedrijfsnaam of naam' },
                { key: 'email',      label: 'E-mail',       placeholder: 'info@bedrijf.nl' },
                { key: 'kvk_number', label: 'KVK nummer',  placeholder: '12345678' },
                { key: 'btw_number', label: 'BTW nummer',  placeholder: 'NL123456789B01' },
                { key: 'iban',       label: 'IBAN',         placeholder: 'NL91ABNA0417164300' },
                { key: 'address',    label: 'Adres',        placeholder: 'Straatnaam 1' },
                { key: 'postal_code',label: 'Postcode',     placeholder: '1234 AB' },
                { key: 'city',       label: 'Stad',         placeholder: 'Amsterdam' },
              ].map(f => (
                <div key={f.key}>
                  <p style={{ fontSize: 11, color: '#8e8e93', marginBottom: 3, fontWeight: 500 }}>{f.label}</p>
                  <input
                    value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e5ea', padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                </div>
              ))}
            </div>
            {error && <p style={{ fontSize: 12, color: '#ff3b30', marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#f2f2f7', color: '#1c1c1e', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Annuleren
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: saving ? '#e5e5ea' : '#007aff', color: saving ? '#8e8e93' : '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Opslaan...' : 'Opslaan'}
              </button>
            </div>
          </div>
        )}

        {/* ── Client list ── */}
        {loading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 40, marginBottom: 10 }}>👥</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e', marginBottom: 4 }}>
              {search ? 'Geen resultaten' : 'Nog geen klanten'}
            </p>
            <p style={{ fontSize: 13, color: '#8e8e93' }}>
              {search ? `Geen klant gevonden voor "${search}"` : 'Voeg je eerste klant toe'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(client => {
              const expanded = expandedId === client.id
              return (
                <div key={client.id} style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                  {/* Main row */}
                  <div
                    onClick={() => setExpandedId(expanded ? null : client.id)}
                    style={{ background: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: '#e8f1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#007aff', flexShrink: 0 }}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{client.name}</p>
                      <p style={{ fontSize: 12, color: '#8e8e93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.email ?? 'Geen e-mail'}</p>
                    </div>
                    <span style={{ fontSize: 16, color: '#c7c7cc', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
                  </div>

                  {/* Inline expand */}
                  {expanded && (
                    <div style={{ background: '#f9f9fb', borderTop: '0.5px solid #e5e5ea', padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 12 }}>
                        {client.kvk_number  && <InfoLine label="KVK"      value={client.kvk_number} />}
                        {client.btw_number  && <InfoLine label="BTW"      value={client.btw_number} />}
                        {client.iban        && <InfoLine label="IBAN"     value={client.iban} />}
                        {client.address     && <InfoLine label="Adres"    value={`${client.address}, ${client.postal_code ?? ''} ${client.city ?? ''}`} />}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(client.id) }}
                          style={{ fontSize: 12, color: '#ff3b30', background: '#fff0ef', border: 'none', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>
                          Verwijderen
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/new?client_id=${client.id}&client_name=${encodeURIComponent(client.name)}`) }}
                          style={{ fontSize: 13, color: '#fff', background: '#007aff', border: 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>
                          + Factuur
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

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)', background: 'rgba(28,28,30,0.88)', color: '#fff', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 20, zIndex: 300, backdropFilter: 'blur(10px)', whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}
      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes shimmer { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 10, color: '#8e8e93', marginBottom: 1 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>{value}</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1,2,3].map(i => <div key={i} style={{ height: 66, borderRadius: 14, background: 'linear-gradient(90deg,#f2f2f7 25%,#e5e5ea 50%,#f2f2f7 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />)}
    </div>
  )
}