# BoekBrug Legal Implementation Guide
## Wat te doen waar in het Platform

**Versie:** 1.0
**Datum:** 25 mei 2026

---

# 📋 Stap-voor-stap Implementatie

Dit document beschrijft **waar in BoekBrug** elke legal component moet komen, **hoe** je het implementeert, en **wanneer** users het zien.

---

## 🗂️ DEEL 1: Bestandsstructuur

### Nieuwe pagina's te maken

```
src/app/
├── privacy/
│   └── page.tsx              # Privacyverklaring
├── voorwaarden/
│   └── page.tsx              # Algemene Voorwaarden  
├── cookies/
│   └── page.tsx              # Cookiebeleid
└── verwerkersovereenkomst/
    └── page.tsx              # DPA (voor accountants)
```

### Markdown-bestanden in repo

```
src/content/legal/
├── privacyverklaring.md
├── algemene-voorwaarden.md
├── cookiebeleid.md
└── verwerkersovereenkomst-template.md
```

---

## 🍪 DEEL 2: Cookie Banner

### Waar: Globaal (verschijnt op elke pagina bij eerste bezoek)

### Bestand: `src/components/cookie-banner.tsx`

```typescript
'use client'

import { useState, useEffect } from 'react'

interface CookiePreferences {
  necessary: boolean
  functional: boolean
  analytics: boolean
}

const STORAGE_KEY = 'boekbrug-cookie-consent'

export function CookieBanner() {
  const [show, setShow] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [prefs, setPrefs] = useState<CookiePreferences>({
    necessary: true,  // altijd true, niet uit te schakelen
    functional: true,
    analytics: false, // default false (opt-in)
  })

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) setShow(true)
  }, [])

  function acceptAll() {
    const all: CookiePreferences = {
      necessary: true,
      functional: true,
      analytics: true,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    setShow(false)
    // Trigger Sentry init etc.
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: all }))
  }

  function acceptSelection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    setShow(false)
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: prefs }))
  }

  function rejectOptional() {
    const minimal: CookiePreferences = {
      necessary: true,
      functional: false,
      analytics: false,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal))
    setShow(false)
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: minimal }))
  }

  if (!show) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-white border-t border-gray-200 shadow-lg p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {!showDetails ? (
          // Simple view
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-2">
                🍪 Cookies op BoekBrug
              </h3>
              <p className="text-sm text-gray-600">
                Wij gebruiken alleen functionele cookies en optionele analytische cookies 
                (Sentry) voor het verbeteren van het Platform. Geen marketing of tracking.{' '}
                <a href="/cookies" className="text-blue-600 underline">
                  Meer informatie
                </a>
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowDetails(true)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Aanpassen
              </button>
              <button
                onClick={rejectOptional}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Alleen noodzakelijk
              </button>
              <button
                onClick={acceptAll}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Accepteren
              </button>
            </div>
          </div>
        ) : (
          // Detailed view
          <div>
            <h3 className="font-semibold text-gray-900 mb-4">
              Cookie-voorkeuren
            </h3>
            
            <div className="space-y-3 mb-4">
              {/* Necessary */}
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  checked={true}
                  disabled
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">Strikt noodzakelijk</span>
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">
                      Verplicht
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Voor authenticatie en sessiebeheer. Zonder deze werkt het Platform niet.
                  </p>
                </div>
              </div>

              {/* Functional */}
              <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.functional}
                  onChange={e => setPrefs(p => ({ ...p, functional: e.target.checked }))}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="font-medium text-gray-900">Functioneel</span>
                  <p className="text-sm text-gray-600 mt-1">
                    Onthouden van taalvoorkeur en thema-instellingen.
                  </p>
                </div>
              </div>

              {/* Analytics */}
              <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.analytics}
                  onChange={e => setPrefs(p => ({ ...p, analytics: e.target.checked }))}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="font-medium text-gray-900">Analytisch (Sentry)</span>
                  <p className="text-sm text-gray-600 mt-1">
                    Anonieme foutmonitoring om bugs op te sporen. Geen persoonsgegevens.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDetails(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Terug
              </button>
              <button
                onClick={acceptSelection}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Voorkeuren opslaan
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

### Integratie in layout

`src/app/layout.tsx`:
```typescript
import { CookieBanner } from '@/components/cookie-banner'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <CookieBanner />
      </body>
    </html>
  )
}
```

### Sentry conditional init

`src/lib/sentry-init.ts`:
```typescript
'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export function SentryConditionalInit() {
  useEffect(() => {
    // Check cookie consent
    const consent = localStorage.getItem('boekbrug-cookie-consent')
    if (consent) {
      const prefs = JSON.parse(consent)
      if (!prefs.analytics) {
        Sentry.close()
      }
    }

    // Listen for consent changes
    const handler = (e: CustomEvent) => {
      if (e.detail.analytics === false) {
        Sentry.close()
      }
    }
    window.addEventListener('cookie-consent', handler as EventListener)
    return () => window.removeEventListener('cookie-consent', handler as EventListener)
  }, [])

  return null
}
```

---

## 🦶 DEEL 3: Footer met legal links

### Bestand: `src/components/footer.tsx`

```typescript
import Link from 'next/link'

export function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200 py-8 mt-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Brand */}
          <div>
            <h3 className="font-bold text-gray-900 mb-2">BoekBrug</h3>
            <p className="text-sm text-gray-600">
              Niet één document raakt verloren.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/features" className="text-gray-600 hover:text-gray-900">Functies</Link></li>
              <li><Link href="/pricing" className="text-gray-600 hover:text-gray-900">Tarieven</Link></li>
              <li><Link href="/voor-accountants" className="text-gray-600 hover:text-gray-900">Voor accountants</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">Juridisch</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-gray-600 hover:text-gray-900">Privacyverklaring</Link></li>
              <li><Link href="/voorwaarden" className="text-gray-600 hover:text-gray-900">Algemene Voorwaarden</Link></li>
              <li><Link href="/cookies" className="text-gray-600 hover:text-gray-900">Cookiebeleid</Link></li>
              <li><Link href="/verwerkersovereenkomst" className="text-gray-600 hover:text-gray-900">Verwerkersovereenkomst</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">Contact</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="mailto:support@boekbrug.nl" className="text-gray-600 hover:text-gray-900">
                  support@boekbrug.nl
                </a>
              </li>
              <li>
                <a href="mailto:privacy@boekbrug.nl" className="text-gray-600 hover:text-gray-900">
                  privacy@boekbrug.nl
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-200 mt-8 pt-6 flex flex-col md:flex-row justify-between items-center text-sm text-gray-500">
          <p>© 2026 BoekBrug. Alle rechten voorbehouden.</p>
          <p>KVK: [INVULLEN] · BTW: [INVULLEN]</p>
        </div>
      </div>
    </footer>
  )
}
```

---

## ✅ DEEL 4: Registratieflow met toestemming

### Waar: Op `/register` pagina

### Aanpassing in registratieformulier

```typescript
// src/app/register/page.tsx (snippet)

const [acceptTerms, setAcceptTerms] = useState(false)
const [acceptPrivacy, setAcceptPrivacy] = useState(false)

async function handleRegister() {
  if (!acceptTerms || !acceptPrivacy) {
    setError('Je moet akkoord gaan met de voorwaarden en privacyverklaring')
    return
  }
  
  // Existing registration logic...
  
  // Save consent to profile
  await supabase.from('profiles').update({
    accepted_terms_at: new Date().toISOString(),
    accepted_privacy_at: new Date().toISOString(),
    accepted_terms_version: '1.0',
    accepted_privacy_version: '1.0',
  }).eq('id', userId)
}

// In het formulier (vóór de submit button):
<div className="space-y-3 my-4">
  <label className="flex items-start gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={acceptPrivacy}
      onChange={e => setAcceptPrivacy(e.target.checked)}
      className="mt-1"
    />
    <span className="text-sm text-gray-700">
      Ik ga akkoord met de{' '}
      <Link href="/privacy" target="_blank" className="text-blue-600 underline">
        Privacyverklaring
      </Link>
      {' '}van BoekBrug.
    </span>
  </label>

  <label className="flex items-start gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={acceptTerms}
      onChange={e => setAcceptTerms(e.target.checked)}
      className="mt-1"
    />
    <span className="text-sm text-gray-700">
      Ik ga akkoord met de{' '}
      <Link href="/voorwaarden" target="_blank" className="text-blue-600 underline">
        Algemene Voorwaarden
      </Link>
      {' '}van BoekBrug.
    </span>
  </label>
</div>

<button
  disabled={!acceptTerms || !acceptPrivacy}
  onClick={handleRegister}
  className="... disabled:opacity-50"
>
  Account aanmaken
</button>
```

### Database migratie nodig

```sql
-- Add consent tracking columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS accepted_privacy_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS accepted_terms_version text,
  ADD COLUMN IF NOT EXISTS accepted_privacy_version text;
```

---

## 📧 DEEL 5: E-mail templates met legal info

### Welcome email (na registratie)

Toevoegen aan email footer:
```
---

Door dit e-mailadres te gebruiken bevestig je akkoord met onze 
Privacyverklaring (https://boekbrug.nl/privacy) en Algemene Voorwaarden 
(https://boekbrug.nl/voorwaarden).

Uitschrijven of voorkeuren beheren: https://boekbrug.nl/dashboard/settings

BoekBrug — Tilburg, Nederland
KVK: [INVULLEN]
```

### Factuur e-mail naar klant

Voeg toe aan email footer:
```
---

Deze factuur is verzonden via BoekBrug — een Nederlands platform voor 
ZZP'ers. BoekBrug verzendt deze e-mail namens [VERZENDER NAAM].

Privacybeleid: https://boekbrug.nl/privacy
```

---

## ⚙️ DEEL 6: Settings pagina

### Waar: `/dashboard/settings`

### Nieuwe secties toe te voegen

```typescript
// src/app/dashboard/settings/page.tsx (snippet)

// ─── Privacy & Data ──────────────────────────────────
<section className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
  <h2 className="text-lg font-semibold mb-4">Privacy & Data</h2>
  
  <div className="space-y-4">
    {/* Export all data */}
    <div className="flex justify-between items-start py-3 border-b">
      <div>
        <h3 className="font-medium">Mijn data exporteren</h3>
        <p className="text-sm text-gray-600 mt-1">
          Download al jouw gegevens in een ZIP-bestand (CSV + PDF + JSON).
        </p>
      </div>
      <button onClick={handleExportData} className="...">
        Exporteren
      </button>
    </div>

    {/* Manage cookie preferences */}
    <div className="flex justify-between items-start py-3 border-b">
      <div>
        <h3 className="font-medium">Cookie-voorkeuren</h3>
        <p className="text-sm text-gray-600 mt-1">
          Beheer welke cookies wij gebruiken.
        </p>
      </div>
      <button onClick={() => /* open cookie banner */} className="...">
        Beheren
      </button>
    </div>

    {/* Delete account */}
    <div className="flex justify-between items-start py-3">
      <div>
        <h3 className="font-medium text-red-600">Account verwijderen</h3>
        <p className="text-sm text-gray-600 mt-1">
          Verwijder je BoekBrug-account. Let op: financiële gegevens 
          blijven 7 jaar bewaard (wettelijke verplichting).
        </p>
      </div>
      <button onClick={handleDeleteAccount} className="text-red-600 ...">
        Verwijderen
      </button>
    </div>
  </div>
</section>

// ─── Legal Documents ──────────────────────────────────
<section className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
  <h2 className="text-lg font-semibold mb-4">Juridische documenten</h2>
  
  <div className="space-y-2">
    <Link href="/privacy" className="flex justify-between items-center py-2 hover:bg-gray-50 px-2 rounded">
      <span>Privacyverklaring</span>
      <span className="text-sm text-gray-500">→</span>
    </Link>
    <Link href="/voorwaarden" className="flex justify-between items-center py-2 hover:bg-gray-50 px-2 rounded">
      <span>Algemene Voorwaarden</span>
      <span className="text-sm text-gray-500">→</span>
    </Link>
    <Link href="/cookies" className="flex justify-between items-center py-2 hover:bg-gray-50 px-2 rounded">
      <span>Cookiebeleid</span>
      <span className="text-sm text-gray-500">→</span>
    </Link>
    {profile?.role === 'accountant' && (
      <Link href="/verwerkersovereenkomst" className="flex justify-between items-center py-2 hover:bg-gray-50 px-2 rounded">
        <span>Verwerkersovereenkomst (DPA)</span>
        <span className="text-sm text-gray-500">→</span>
      </Link>
    )}
  </div>
</section>
```

---

## 🔗 DEEL 7: Accountant Koppeling - Toestemmingsflow

### Waar: `/dashboard/clients/invite` en `/invite/accept`

### Aanpassing in invite-uitnodiging

Wanneer een accountant een ZZP'er uitnodigt:

```typescript
// In de uitnodiging e-mail:
`
Hallo,

[ACCOUNTANT NAAM] van [BEDRIJF] nodigt je uit om samen te werken via BoekBrug.

Wanneer je deze uitnodiging accepteert:
✅ De accountant kan je BETAALDE FACTUREN inzien
✅ De accountant kan documenten in je GEDEELDE MAP zien
❌ De accountant ziet GEEN concept-facturen
❌ De accountant ziet GEEN persoonlijke notities
❌ De accountant ziet GEEN niet-bevestigde inkomende facturen

Je kunt deze koppeling op elk moment verbreken via Instellingen.

Door op "Accepteren" te klikken ga je akkoord met:
- Onze Algemene Voorwaarden (https://boekbrug.nl/voorwaarden)
- Onze Privacyverklaring (https://boekbrug.nl/privacy)
- Het delen van bovengenoemde gegevens met deze accountant

[ACCEPTEREN] [WEIGEREN]
`
```

### Op /invite/accept pagina

```typescript
// Vóór de accept knop:
<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
  <h3 className="font-semibold text-blue-900 mb-2">Wat krijgt de accountant te zien?</h3>
  <ul className="text-sm text-blue-800 space-y-1">
    <li>✅ Betaalde facturen (status = paid)</li>
    <li>✅ Documenten in de gedeelde map</li>
    <li>❌ Geen concept-facturen</li>
    <li>❌ Geen persoonlijke notities</li>
    <li>❌ Geen niet-bevestigde inkomende facturen</li>
  </ul>
  <p className="text-sm text-blue-800 mt-2">
    Je kunt deze koppeling op elk moment verbreken in Instellingen.
  </p>
</div>

<label className="flex items-start gap-2 mb-4">
  <input type="checkbox" checked={consent} onChange={...} />
  <span className="text-sm">
    Ik geef toestemming voor het delen van bovenstaande gegevens met deze accountant. 
    Ik begrijp dat ik deze toestemming op elk moment kan intrekken.
  </span>
</label>
```

---

## 📊 DEEL 8: Data Export functionaliteit

### Endpoint: `/api/account/export`

```typescript
// src/app/api/account/export/route.ts

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'  // npm install jszip

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Collect all user data
  const [profile, invoices, lines, clients, documents, auditLogs] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('invoices').select('*').eq('sender_id', user.id),
    supabase.from('invoice_lines').select('*'),  // filter via invoices
    supabase.from('clients').select('*').eq('user_id', user.id),
    supabase.from('documents').select('*').eq('user_id', user.id),
    supabase.from('audit_logs').select('*').eq('user_id', user.id),
  ])

  // Build ZIP
  const zip = new JSZip()
  
  // README explaining what's in the export
  zip.file('README.txt', `
BoekBrug Data Export
====================
Exportdatum: ${new Date().toISOString()}
Gebruiker: ${profile.data?.email}

Inhoud:
- profile.json         — Jouw accountgegevens
- invoices.json        — Alle facturen
- invoice_lines.json   — Factuurregels
- clients.json         — Klantenlijst
- documents.json       — Documentmetadata
- audit_logs.json      — Activiteitslog (7 jaar bewaarplicht)

Bestanden:
- documents/           — Alle geüploade bestanden

Voor vragen: privacy@boekbrug.nl
  `)

  // Add data files
  zip.file('profile.json', JSON.stringify(profile.data, null, 2))
  zip.file('invoices.json', JSON.stringify(invoices.data, null, 2))
  zip.file('invoice_lines.json', JSON.stringify(lines.data, null, 2))
  zip.file('clients.json', JSON.stringify(clients.data, null, 2))
  zip.file('documents.json', JSON.stringify(documents.data, null, 2))
  zip.file('audit_logs.json', JSON.stringify(auditLogs.data, null, 2))

  // TODO: Add actual document files from storage
  
  const blob = await zip.generateAsync({ type: 'nodebuffer' })

  // Audit the export
  // ... await logAuditAction({ action: 'user.data_exported', ... })

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="boekbrug-export-${user.id.slice(0,8)}-${Date.now()}.zip"`,
    },
  })
}
```

---

## 🗑️ DEEL 9: Account Deletion Flow

### Endpoint: `/api/account/delete`

### Multi-stap flow

```typescript
// Stap 1: Verzoek tot verwijdering
POST /api/account/delete/request
  → Verzendt confirmatie e-mail
  → Returnt deletion_request_id

// Stap 2: Verplichte export
GET /api/account/export
  → Download ZIP

// Stap 3: Bevestiging via e-mail link
GET /account/delete/confirm?token=...
  → Toont confirmation page

// Stap 4: Wachtwoord-bevestiging
POST /api/account/delete/finalize
  Body: { password, deletion_request_id }
  → Verifies password
  → Marks account as deleted
  → Data blijft 7 jaar in DB
```

### Implementatie (basis)

```typescript
// src/app/api/account/delete/request/route.ts
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pipeline = createPipelineClient()

  // Create deletion request
  const { data: deletionReq, error } = await pipeline
    .from('deletion_requests')
    .insert({
      user_id: user.id,
      export_confirmed: false,
      email_confirmed: false,
      data_eligible_for_deletion_at: new Date(
        Date.now() + 7 * 365 * 24 * 60 * 60 * 1000
      ).toISOString(),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Verzoek mislukt' }, { status: 500 })
  }

  // Send confirmation email
  // ... await sendDeletionConfirmation(user.email, deletionReq.id)

  return NextResponse.json({
    success: true,
    deletion_request_id: deletionReq.id,
    message: 'Bevestigingsmail verzonden. Volg de stappen in de e-mail om je account te verwijderen.',
  })
}
```

---

## 📋 DEEL 10: Database Migrations

### Migratie: Consent tracking

```sql
-- migrations/20260525_consent_tracking.sql

BEGIN;

-- Add consent columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS accepted_privacy_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS accepted_terms_version text,
  ADD COLUMN IF NOT EXISTS accepted_privacy_version text;

-- For existing users (pre-launch), mark as consented to v1.0
UPDATE public.profiles
SET 
  accepted_terms_at = created_at,
  accepted_privacy_at = created_at,
  accepted_terms_version = '1.0',
  accepted_privacy_version = '1.0'
WHERE accepted_terms_at IS NULL;

COMMIT;
```

### Migratie: Document audit voor accountant koppeling

```sql
-- migrations/20260525_accountant_consent.sql

BEGIN;

ALTER TABLE public.accountant_clients
  ADD COLUMN IF NOT EXISTS zzper_consent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS zzper_consent_version text,
  ADD COLUMN IF NOT EXISTS unlinked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS unlink_reason text;

COMMIT;
```

---

## 📅 DEEL 11: Implementatie Volgorde

### Week 1 — Critical (vóór launch)

**Dag 1 (4 uur):**
1. ✅ Maak `/privacy` pagina + content
2. ✅ Maak `/voorwaarden` pagina + content
3. ✅ Maak `/cookies` pagina + content
4. ✅ Update footer met legal links

**Dag 2 (3 uur):**
5. ✅ Implementeer Cookie Banner component
6. ✅ Integreer in layout.tsx
7. ✅ Sentry conditional init

**Dag 3 (3 uur):**
8. ✅ Update register page met consent checkboxes
9. ✅ Database migratie voor consent tracking
10. ✅ Update invite/accept page met consent

**Dag 4 (2 uur):**
11. ✅ Maak `/verwerkersovereenkomst` pagina (alleen voor accountants)
12. ✅ Test alle flows

### Week 2 — Important (voor 10+ users)

**Dag 5-6 (6 uur):**
13. ✅ Implementeer data export functionaliteit
14. ✅ Implementeer account deletion flow
15. ✅ Update Settings pagina

**Dag 7 (2 uur):**
16. ✅ Final review
17. ✅ Testen met test-account

### Week 3 — Maintenance

**Doorlopend:**
- Monitor Sentry voor compliance-issues
- Document elke nieuwe verwerking in het register
- Update versie-nummers bij wijzigingen

---

## ⚠️ DEEL 12: Wat te invullen voordat live

### Voor jezelf:
- [ ] KVK-nummer invullen in alle documenten
- [ ] BTW-nummer invullen (zodra toegekend)
- [ ] Volledige naam en adres
- [ ] privacy@boekbrug.nl mailbox instellen
- [ ] support@boekbrug.nl mailbox instellen
- [ ] legal@boekbrug.nl mailbox instellen

### Supabase setup:
- [ ] Sign Supabase DPA (Dashboard → Settings → Legal)
- [ ] Configure EU data location (waar mogelijk)

### Vercel setup:
- [ ] Sign Vercel DPA (Dashboard → Settings → Legal)

### Anthropic setup:
- [ ] Confirm no-training on API data
- [ ] Sign Anthropic DPA (via api.anthropic.com)

### Optioneel maar aanbevolen:
- [ ] Register als verwerker bij AP (voor accountants is dit aanbevolen)
- [ ] Privacy mailbox forwarding instellen
- [ ] Backup van legal documenten

---

## 🎯 Samenvatting: Wat krijgen users te zien?

### Bij eerste bezoek:
- 🍪 Cookie banner onderaan scherm

### Bij registratie:
- ☑️ Checkbox: "Ik ga akkoord met Privacyverklaring"
- ☑️ Checkbox: "Ik ga akkoord met Algemene Voorwaarden"

### Bij accountant uitnodiging accepteren:
- 📋 Duidelijk overzicht van wat de accountant kan zien
- ☑️ Expliciete toestemming voor data-delen

### Onderaan elke pagina:
- 🦶 Footer met links naar alle legal docs

### In Settings:
- 📊 "Mijn data exporteren"
- 🍪 "Cookie-voorkeuren beheren"
- 🗑️ "Account verwijderen"
- 📋 Links naar alle juridische docs

### In e-mails:
- 📧 Privacy disclaimer onderaan elke transactionele e-mail
- 🔗 Links naar privacyverklaring

---

## ✅ Checklist vóór Launch

**Documenten:**
- [ ] Privacyverklaring online op /privacy
- [ ] Algemene Voorwaarden online op /voorwaarden
- [ ] Cookiebeleid online op /cookies
- [ ] DPA template beschikbaar op /verwerkersovereenkomst
- [ ] Verwerkingsregister opgeslagen intern

**Technisch:**
- [ ] Cookie banner werkt op alle pagina's
- [ ] Sentry conditional opt-in werkt
- [ ] Footer met legal links op alle pagina's
- [ ] Register page met consent checkboxes
- [ ] Data export werkt
- [ ] Account deletion flow werkt

**Persoonlijk:**
- [ ] Bedrijfsgegevens ingevuld in alle docs
- [ ] E-mail addressen aangemaakt
- [ ] Supabase + Vercel + Anthropic DPAs getekend
- [ ] Backup van legal docs

**Compliance:**
- [ ] Geen Google Analytics actief
- [ ] Geen tracking pixels
- [ ] Verwerkingsregister bijgewerkt
- [ ] Datalek-procedure gedocumenteerd

---

*Bij twijfel: contact privacy@boekbrug.nl*

*Dit document is een implementatiegids, geen vervanger voor juridisch advies bij complexe situaties. Voor maatwerk: ICTRecht of vergelijkbaar.*
