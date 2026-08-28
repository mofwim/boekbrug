'use client'

// [ACTING-FOR] Eén knop, en de zin eronder die zegt wat je aanneemt.

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FONT, M3, R } from '@/lib/design/tokens'
import { failureText } from '@/lib/server-message'

export default function AccepterenClient() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  async function accepteer() {
    setBezig(true); setFout('')
    try {
      const res = await fetch('/api/company/members/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 401 = niet ingelogd. Dan is doorsturen naar /login met een terugkeerpad het enige
        // zinnige — anders staat er "Unauthorized" op een scherm dat om een tik vroeg.
        //
        // [TERUGKEERPAD] De parameter heet `redirect`, want dat is de ENIGE die /login leest
        // (login/page.tsx: searchParams.get('redirect')). Hier stond `next`, en die wordt daar
        // genegeerd: de medewerker logde in, kwam op /dashboard terecht en moest de uitnodiging
        // opnieuw uit zijn mail opdiepen — precies één keer te vaak om nog te accepteren.
        // Een gate houdt dit vast: zie [TERUGKEERPAD] in lifecycle-gates.test.ts.
        if (res.status === 401) {
          router.push(`/login?redirect=${encodeURIComponent(`/team/accepteren?token=${token}`)}`)
          return
        }
        setFout(failureText(res.status, json, 'Accepteren mislukt'))
        setBezig(false)
        return
      }
      router.push('/dashboard/verkoop')
    } catch {
      setFout('Accepteren mislukt — probeer opnieuw')
      setBezig(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg, padding: 28, maxWidth: 460, width: '100%' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
          Facturen maken voor je werkgever
        </h1>

        {!token ? (
          <p style={{ fontSize: 14.5, color: M3.error, margin: 0, lineHeight: 1.6 }}>
            Deze link is niet compleet. Open de uitnodiging opnieuw vanuit je e-mail.
          </p>
        ) : (
          <>
            {/* Wat je aanneemt, in gewone woorden — vóór de knop, niet erna. */}
            <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 14px', lineHeight: 1.6 }}>
              Als je dit accepteert, kun je verkoopfacturen maken en versturen die uitgaan op naam
              en BTW-nummer van je werkgever.
            </p>
            <ul style={{ fontSize: 14, color: M3.neutral, lineHeight: 1.7, paddingInlineStart: 18, margin: '0 0 20px' }}>
              <li>Je ziet <strong>alleen wat je zelf aanmaakt</strong>.</li>
              <li>Niet de bankrekening, de omzet of de facturen van collega&apos;s.</li>
              <li>Je werkgever kan je toegang op elk moment intrekken.</li>
            </ul>

            {fout && (
              <p style={{ fontSize: 14, color: M3.error, background: M3.errorContainer, padding: '10px 12px', borderRadius: R.sm, margin: '0 0 14px', lineHeight: 1.5 }}>
                {fout}
              </p>
            )}

            <button
              onClick={accepteer}
              disabled={bezig}
              style={{
                width: '100%', background: bezig ? M3.outline : M3.primary, color: M3.onPrimary,
                border: 'none', padding: '13px 20px', borderRadius: R.md, fontSize: 15,
                fontWeight: 600, cursor: bezig ? 'default' : 'pointer', fontFamily: FONT,
              }}
            >
              {bezig ? 'Bezig…' : 'Accepteren'}
            </button>

            <p style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
              Verwacht je deze uitnodiging niet? Klik dan niet op accepteren en laat het je
              werkgever weten. Je hoeft verder niets te doen — een uitnodiging die blijft liggen,
              verloopt vanzelf.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
