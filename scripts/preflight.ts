// scripts/preflight.ts
// [PREFLIGHT] The ONE go-live check. Answers a single question: "may I open the doors?"
// -----------------------------------------------------------------------------
// The code gates (tsc, unit tests, next build) already prove the CODE is sound. They
// cannot prove the ENVIRONMENT is. Every failure this script hunts has the same shape:
// the code is correct, ships, and the feature is silently DEAD (or leaking) on live
// because a migration was never applied, a secret was never set, or a bucket is named
// something else. That class of failure is invisible from the app — it degrades quietly.
// This script makes it loud.
//
// SIX GATES (the pre-launch list, in blocking order):
//   1. SECURITY   — can an anonymous visitor read the invitations table? (token leak)
//   2. SCHEMA     — is every migration the code depends on actually applied live?
//   3. AUTOMATION — is CRON_SECRET set on the server? (if not, the whole matching
//                   circle's hourly heartbeat is dead — 401, silently, forever)
//   4. LEGAL      — do the Terms/Privacy pages still render the "(volgt)" placeholders?
//   5. STORAGE    — does the 'documents' bucket exist? (invoice PDFs are stored there)
//   6. EMAIL      — is the Resend sending domain verified?
//
// DISCIPLINE — this script is READ-ONLY, by construction:
//   · No INSERT/UPDATE/DELETE anywhere.
//   · It never EXECUTES a database function. RPC presence is read from the PostgREST
//     OpenAPI spec (a GET), never by calling the function — calling next_invoice_seq()
//     would burn a legal invoice number, and calling a cron endpoint with a valid
//     secret would move real money. Neither ever happens here.
//   · The cron check deliberately calls WITHOUT credentials: an unauthenticated call
//     is the safe probe, and the two 401 bodies the routes return
//     ('cron_secret_not_configured' vs 'unauthorized') tell the secret's state apart
//     without ever triggering a run.
//
// EXIT CODE: 0 = clear for launch · 1 = at least one FAIL (safe to gate a deploy on).
// WARN never blocks — it marks a check that could not be completed (missing optional
// config, unreachable host), and says so instead of guessing a pass.
//
// RUN — locally against your live project:
//   npx tsx --env-file=.env.local scripts/preflight.ts
//
//   Fallback if your tsx build does not accept --env-file:
//   node --env-file=.env.local --import tsx scripts/preflight.ts
//
// Point the live-site gates (3, 4) at the deployed origin. It defaults to
// NEXT_PUBLIC_APP_URL; override for a preview deploy:
//   npx tsx --env-file=.env.local scripts/preflight.ts --url=https://boekbrug.nl
//
// Skip the live-site gates entirely (schema + security only):
//   npx tsx --env-file=.env.local scripts/preflight.ts --no-remote
// -----------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js'

// ─── What the code requires of the database ──────────────────────────────────
// Mirrors section A of docs/live-trust-check.sql, extended with the tables and
// functions added since that file was written. A FALSE here means the matching
// migration was never run: the feature exists in the code and does nothing live.

/** Tables whose absence kills a whole feature. */
const REQUIRED_TABLES: { table: string; feature: string; migration: string }[] = [
  { table: 'daily_turnover', feature: 'Dagomzet (kassa Z-rapport)', migration: 'daily_turnover.sql' },
  { table: 'eft_settlements', feature: 'Kaart-driehoek (EFT-afrekening)', migration: 'eft_settlements.sql' },
  { table: 'articles', feature: 'Artikelen-catalogus', migration: 'articles.sql' },
  { table: 'cash_entries', feature: 'Kasboek', migration: 'cash_ledger.sql' },
  { table: 'invoice_counters', feature: 'Atomaire factuurnummering', migration: 'factuur_b_numbering.sql (BACKUP FIRST)' },
  { table: 'bank_tx_invoices', feature: 'Omkeerbare bank-koppeling (reversal index)', migration: 'bank_tx_invoices.sql' },
  { table: 'btw_filings', feature: 'Bevroren aangifte-snapshot + suppletie-signaal', migration: 'btw_filings.sql' },
  { table: 'ledger_daily', feature: 'Grootboek-getuige (PIN/kas)', migration: 'ledger_daily.sql' },
  { table: 'pay_bundles', feature: 'Gebundeld betaalverzoek', migration: 'pay_bundles.sql' },
  { table: 'suppliers', feature: 'Leveranciers-registry', migration: 'supplier_registry.sql' },
  { table: 'invoice_reminders', feature: 'Automatische betalingsherinneringen', migration: 'invoice_reminders.sql' },
  { table: 'push_subscriptions', feature: 'Push-notificaties', migration: 'push_subscriptions.sql' },
  { table: 'rate_limits', feature: 'Rate limiting (AI-kostenbescherming)', migration: 'database.sql' },
  { table: 'audit_logs', feature: 'Audit trail', migration: 'database.sql' },
]

/** Columns added by a later migration to a table that already existed. */
const REQUIRED_COLUMNS: { table: string; column: string; feature: string; migration: string }[] = [
  { table: 'invoices', column: 'client_id', feature: 'Klanten-registry koppeling', migration: 'crm_backbone.sql' },
  { table: 'invoices', column: 'pay_token', feature: 'Betaalverzoek (publieke betaallink)', migration: 'betaalverzoek.sql' },
  { table: 'invoices', column: 'amount_paid', feature: 'Deelbetalingen', migration: 'invoice_partial_payments.sql' },
  { table: 'clients', column: 'notes', feature: 'Klantnotities', migration: 'crm_backbone.sql' },
  { table: 'bank_transactions', column: 'category', feature: 'Bank-categorisering (P&L)', migration: 'bank_identity.sql' },
  { table: 'bank_transactions', column: 'counterpart_iban', feature: 'IBAN-matching (auto-confirm)', migration: 'bank_tx_counterpart_iban.sql' },
  { table: 'cash_entries', column: 'invoice_id', feature: 'Kas-settlement koppeling', migration: 'cash_settlement_invoice_link.sql' },
  { table: 'profiles', column: 'vat_scheme', feature: 'Kasstelsel vs factuurstelsel', migration: 'vat_scheme.sql' },
  { table: 'profiles', column: 'reminders_enabled', feature: 'Herinneringen aan/uit', migration: 'invoice_reminders.sql' },
]

/** Database functions the code calls. Presence is READ, never executed. */
const REQUIRED_FUNCTIONS: { fn: string; feature: string; migration: string }[] = [
  { fn: 'next_invoice_seq', feature: 'Atomaire nummering (geen dubbele nummers)', migration: 'factuur_b_numbering.sql' },
  { fn: 'book_bank_batch', feature: 'Atomair boeken van verzamelbetalingen', migration: 'book_bank_batch_atomic.sql' },
  { fn: 'check_rate_limit', feature: 'Rate limiting (faalt OPEN als deze mist!)', migration: 'database.sql' },
]

/** Cron endpoints whose guard state we probe (unauthenticated — never triggers a run). */
const CRON_PATHS = [
  '/api/cron/reconcile',
  '/api/cron/email-sync',
  '/api/cron/reminders',
  '/api/cron/quarter-close',
]

const SENDING_DOMAIN = 'boekbrug.nl' // matches the From address in src/lib/email.ts
const PDF_BUCKET = 'documents' // matches PDF_BUCKET in src/app/api/invoice/send/route.ts

// ─── Reporting ────────────────────────────────────────────────────────────────

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP'

interface Finding {
  gate: string
  name: string
  status: Status
  detail: string
  /** What to do about it. Printed only for FAIL/WARN. */
  fix?: string
}

const findings: Finding[] = []
const record = (f: Finding) => { findings.push(f); printLive(f) }

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const BADGE: Record<Status, string> = {
  PASS: paint('32', ' PASS '),
  FAIL: paint('1;31', ' FAIL '),
  WARN: paint('33', ' WARN '),
  SKIP: paint('90', ' SKIP '),
}

function printLive(f: Finding) {
  console.log(`  ${BADGE[f.status]} ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
}

function gate(title: string) {
  console.log(`\n${paint('1', title)}`)
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const argUrl = argv.find((a) => a.startsWith('--url='))?.slice('--url='.length)
const noRemote = argv.includes('--no-remote')

/** fetch with a hard timeout — an unreachable host must WARN, never hang the launch. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Service-role client. Reads only — this script never writes. Typed loosely on
 * purpose: it probes tables that may not exist yet, which is exactly the case the
 * generated Database types cannot express.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAdmin(env: { supabaseUrl: string; serviceKey: string }): ReturnType<typeof createClient<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(env.supabaseUrl, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
type AdminClient = ReturnType<typeof makeAdmin>

// ─── GATE 0 — environment ─────────────────────────────────────────────────────

interface Env {
  supabaseUrl: string
  anonKey: string
  serviceKey: string
  appUrl: string | null
  cronSecret: string | null
  resendKey: string | null
}

function checkEnv(): Env | null {
  gate('0 · OMGEVING — zijn de sleutels aanwezig?')

  const req = (k: string): string | null => {
    const v = process.env[k]?.trim()
    if (v) {
      record({ gate: 'env', name: k, status: 'PASS', detail: 'gezet' })
      return v
    }
    record({
      gate: 'env', name: k, status: 'FAIL', detail: 'ONTBREEKT',
      fix: `Zet ${k} in .env.local (lokaal) én in Vercel → Settings → Environment Variables.`,
    })
    return null
  }

  const opt = (k: string, why: string): string | null => {
    const v = process.env[k]?.trim()
    record(
      v
        ? { gate: 'env', name: k, status: 'PASS', detail: 'gezet' }
        : { gate: 'env', name: k, status: 'WARN', detail: `niet gezet — ${why}`, fix: `Zet ${k} vóór go-live.` },
    )
    return v ?? null
  }

  const supabaseUrl = req('NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = req('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const serviceKey = req('SUPABASE_SERVICE_ROLE_KEY')

  // CRON_SECRET is checked twice on purpose: here (is it in MY env?) and against the
  // live site in gate 3 (is it on the SERVER?). Only the second one actually matters
  // for automation — a local value proves nothing about production.
  const cronSecret = opt('CRON_SECRET', 'de automatische reconcile staat dan UIT op de server')
  const resendKey = opt('RESEND_API_KEY', 'er wordt geen e-mail verstuurd')
  opt('NEXT_PUBLIC_SENTRY_DSN', 'geen foutmonitoring na de lancering')
  opt('ANTHROPIC_API_KEY', 'factuur-scannen (AI) werkt niet')

  const appUrl = (argUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim() || null

  if (!supabaseUrl || !anonKey || !serviceKey) return null
  return { supabaseUrl, anonKey, serviceKey, appUrl, cronSecret, resendKey }
}

// ─── GATE 1 — security: the invitations leak ──────────────────────────────────
// The real attacker's-eye test. Not "is the migration file present in the repo"
// but "can an anonymous client actually read invitation tokens right now".
//
// The old policy — CREATE POLICY "public can read invitations" USING (true) — let ANY
// visitor enumerate every invitation token + e-mail address. invitations_rls_scoped_read.sql
// replaces it. We verify the OUTCOME, because only the outcome is the truth.

async function checkInvitationLeak(env: Env) {
  gate('1 · BEVEILIGING — kan een anonieme bezoeker uitnodigingen lezen?')

  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = makeAdmin(env)

  let anonRows: number | null = null
  let anonBlocked = false
  try {
    const { data, error } = await anon.from('invitations').select('*').limit(5)
    if (error) {
      anonBlocked = true
    } else {
      anonRows = data?.length ?? 0
    }
  } catch (e) {
    record({
      gate: 'security', name: 'anonieme leestest', status: 'WARN',
      detail: `kon niet uitgevoerd worden (${errMsg(e)})`,
      fix: 'Controleer handmatig of de policy "public can read invitations" nog bestaat.',
    })
    return
  }

  // How many rows exist at all? Needed to tell "RLS blocked me" apart from
  // "the table just happens to be empty" — an empty table proves nothing.
  let totalRows: number | null = null
  try {
    const { count, error } = await admin.from('invitations').select('*', { head: true, count: 'exact' })
    if (!error) totalRows = count ?? 0
  } catch { /* leave null — handled below */ }

  if (anonRows !== null && anonRows > 0) {
    record({
      gate: 'security', name: 'invitations RLS', status: 'FAIL',
      detail: `LEK: anoniem ${anonRows} rij(en) gelezen, inclusief tokens`,
      fix: 'Draai NU supabase/migrations/invitations_rls_scoped_read.sql in de Supabase SQL-editor. NIET lanceren tot dit PASS is.',
    })
    return
  }

  if (anonBlocked || (totalRows !== null && totalRows > 0 && anonRows === 0)) {
    record({
      gate: 'security', name: 'invitations RLS', status: 'PASS',
      detail: anonBlocked ? 'anonieme lezing geweigerd' : `anoniem 0 van ${totalRows} rijen zichtbaar`,
    })
    return
  }

  record({
    gate: 'security', name: 'invitations RLS', status: 'WARN',
    detail: 'tabel is leeg — een lege tabel bewijst niets',
    fix: 'Draai supabase/migrations/invitations_rls_scoped_read.sql voor de zekerheid; hij is idempotent.',
  })
}

// ─── GATE 2 — schema: are the migrations applied? ─────────────────────────────
// Source of truth is PostgREST's own OpenAPI document: one GET, and it lists every
// exposed table, column and RPC. Deterministic and side-effect free — crucially, it
// tells us a FUNCTION exists without ever calling it (calling next_invoice_seq would
// burn a legally-sequential invoice number).

interface Spec {
  tables: Set<string>
  columns: Map<string, Set<string>>
  functions: Set<string>
}

async function loadSpec(env: Env): Promise<Spec | null> {
  try {
    const res = await fetchWithTimeout(`${env.supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        Accept: 'application/openapi+json',
      },
    })
    if (!res.ok) return null
    const doc = (await res.json()) as {
      paths?: Record<string, unknown>
      definitions?: Record<string, { properties?: Record<string, unknown> }>
    }
    if (!doc.paths) return null

    const tables = new Set<string>()
    const functions = new Set<string>()
    for (const p of Object.keys(doc.paths)) {
      if (p.startsWith('/rpc/')) functions.add(p.slice('/rpc/'.length))
      else if (p.length > 1) tables.add(p.slice(1))
    }
    const columns = new Map<string, Set<string>>()
    for (const [t, def] of Object.entries(doc.definitions ?? {})) {
      columns.set(t, new Set(Object.keys(def.properties ?? {})))
    }
    return { tables, columns, functions }
  } catch {
    return null
  }
}

/** Fallback when the OpenAPI document is unavailable: probe with a 0-row SELECT. */
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

async function probeTable(admin: AdminClient, table: string): Promise<boolean | null> {
  const { error } = await admin.from(table).select('*', { head: true }).limit(0)
  if (!error) return true
  if (MISSING_TABLE.has(error.code ?? '')) return false
  if (/schema cache|does not exist/i.test(error.message)) return false
  return null
}

async function probeColumn(admin: AdminClient, table: string, column: string): Promise<boolean | null> {
  const { error } = await admin.from(table).select(column, { head: true }).limit(0)
  if (!error) return true
  if (MISSING_COLUMN.has(error.code ?? '') || MISSING_TABLE.has(error.code ?? '')) return false
  if (/does not exist|schema cache/i.test(error.message)) return false
  return null
}

async function checkSchema(env: Env) {
  gate('2 · SCHEMA — staat elke migratie ook écht op de live database?')

  const spec = await loadSpec(env)
  const admin = makeAdmin(env)

  if (!spec) {
    console.log(paint('90', '  (OpenAPI-spec niet leesbaar — terugval op directe probes)'))
  }

  for (const { table, feature, migration } of REQUIRED_TABLES) {
    const present = spec ? spec.tables.has(table) : await probeTable(admin, table)
    record(
      present === true
        ? { gate: 'schema', name: `tabel ${table}`, status: 'PASS', detail: feature }
        : present === false
          ? {
              gate: 'schema', name: `tabel ${table}`, status: 'FAIL',
              detail: `ONTBREEKT → "${feature}" is DOOD op live`,
              fix: `Draai supabase/migrations/${migration}`,
            }
          : {
              gate: 'schema', name: `tabel ${table}`, status: 'WARN',
              detail: 'kon niet vastgesteld worden',
              fix: `Controleer handmatig of ${table} bestaat.`,
            },
    )
  }

  for (const { table, column, feature, migration } of REQUIRED_COLUMNS) {
    const present = spec
      ? (spec.columns.get(table)?.has(column) ?? null)
      : await probeColumn(admin, table, column)
    record(
      present === true
        ? { gate: 'schema', name: `kolom ${table}.${column}`, status: 'PASS', detail: feature }
        : present === false
          ? {
              gate: 'schema', name: `kolom ${table}.${column}`, status: 'FAIL',
              detail: `ONTBREEKT → "${feature}" is DOOD op live`,
              fix: `Draai supabase/migrations/${migration}`,
            }
          : {
              gate: 'schema', name: `kolom ${table}.${column}`, status: 'WARN',
              detail: 'kon niet vastgesteld worden',
              fix: `Controleer handmatig of ${table}.${column} bestaat.`,
            },
    )
  }

  for (const { fn, feature, migration } of REQUIRED_FUNCTIONS) {
    if (!spec) {
      record({
        gate: 'schema', name: `functie ${fn}()`, status: 'WARN',
        detail: 'niet te controleren zonder OpenAPI-spec (nooit aangeroepen — dat zou schrijven)',
        fix: `Controleer in de SQL-editor: SELECT to_regprocedure('public.${fn}') IS NOT NULL;`,
      })
      continue
    }
    record(
      spec.functions.has(fn)
        ? { gate: 'schema', name: `functie ${fn}()`, status: 'PASS', detail: feature }
        : {
            gate: 'schema', name: `functie ${fn}()`, status: 'FAIL',
            detail: `ONTBREEKT → "${feature}"`,
            fix: `Draai supabase/migrations/${migration}`,
          },
    )
  }
}

// ─── GATE 5 — storage bucket ──────────────────────────────────────────────────
// TODO(M) in src/app/api/invoice/send/route.ts: "verify this bucket name before deploy".
// Delivery of an invoice never blocks on the upload, so a wrong name fails SILENTLY:
// the client receives the invoice, and pdf_url stays empty forever.

async function checkStorage(env: Env) {
  gate('5 · OPSLAG — bestaat de bucket waar factuur-PDFs in gaan?')

  const admin = makeAdmin(env)
  try {
    const { data, error } = await admin.storage.listBuckets()
    if (error) {
      record({
        gate: 'storage', name: `bucket '${PDF_BUCKET}'`, status: 'WARN',
        detail: `bucketlijst niet leesbaar (${error.message})`,
        fix: 'Controleer handmatig in Supabase → Storage.',
      })
      return
    }
    const names = (data ?? []).map((b) => b.name)
    record(
      names.includes(PDF_BUCKET)
        ? { gate: 'storage', name: `bucket '${PDF_BUCKET}'`, status: 'PASS', detail: 'aanwezig' }
        : {
            gate: 'storage', name: `bucket '${PDF_BUCKET}'`, status: 'FAIL',
            detail: `ONTBREEKT — gevonden: ${names.join(', ') || '(geen)'}`,
            fix: `Maak de bucket '${PDF_BUCKET}' aan in Supabase → Storage, of pas PDF_BUCKET aan in src/app/api/invoice/send/route.ts.`,
          },
    )
  } catch (e) {
    record({
      gate: 'storage', name: `bucket '${PDF_BUCKET}'`, status: 'WARN',
      detail: errMsg(e), fix: 'Controleer handmatig in Supabase → Storage.',
    })
  }
}

// ─── GATE 3 — automation: is CRON_SECRET set ON THE SERVER? ───────────────────
// Every cron route answers 401 twice over, with DIFFERENT bodies:
//   { error: 'cron_secret_not_configured' } → the secret is MISSING on the server
//   { error: 'unauthorized' }               → the secret IS set, guard working
// So an UNAUTHENTICATED call tells us the secret's state without running anything.
// A 200 here would mean the endpoint is world-callable — the worst possible outcome.

async function checkCronGuards(liveUrl: string) {
  gate('3 · AUTOMATISERING — staat CRON_SECRET op de server? (het uur-hartslag)')

  for (const path of CRON_PATHS) {
    const url = `${liveUrl.replace(/\/$/, '')}${path}`
    try {
      const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'manual' })
      const body = await res.text()
      let parsed: { error?: string } = {}
      try { parsed = JSON.parse(body) as { error?: string } } catch { /* non-JSON */ }

      if (res.status === 200) {
        record({
          gate: 'cron', name: path, status: 'FAIL',
          detail: 'PUBLIEK AANROEPBAAR — geen enkele bescherming',
          fix: 'Zet CRON_SECRET in Vercel en verifieer dat de route de Bearer-check doet. NIET lanceren.',
        })
        continue
      }
      if (parsed.error === 'cron_secret_not_configured') {
        record({
          gate: 'cron', name: path, status: 'FAIL',
          detail: 'CRON_SECRET ONTBREEKT op de server → deze automatisering staat UIT',
          fix: 'Vercel → Settings → Environment Variables → CRON_SECRET, daarna opnieuw deployen.',
        })
        continue
      }
      if (parsed.error === 'unauthorized' || res.status === 401) {
        record({ gate: 'cron', name: path, status: 'PASS', detail: 'secret gezet, guard werkt (401 unauthorized)' })
        continue
      }
      record({
        gate: 'cron', name: path, status: 'WARN',
        detail: `onverwacht antwoord ${res.status}: ${body.slice(0, 80)}`,
        fix: 'Controleer de route handmatig.',
      })
    } catch (e) {
      record({
        gate: 'cron', name: path, status: 'WARN',
        detail: `niet bereikbaar (${errMsg(e)})`,
        fix: 'Draai dit opnieuw tegen de live URL na de deploy.',
      })
    }
  }
}

// ─── GATE 4 — legal identity on the live pages ────────────────────────────────
// company.ts renders "(volgt)" when the KVK/BTW env vars are unset — deliberately,
// so an unset value can never read as a real-but-false registration number. Good for
// safety, unacceptable on a commercial launch: KVK + BTW are legally required.
// We check the RENDERED page, because that is what a customer (and the Belastingdienst)
// actually sees — it also catches "set in .env.local but never set in Vercel".

const PLACEHOLDERS = ['(volgt)', '(adres volgt)']

async function checkLegalPages(liveUrl: string) {
  gate('4 · JURIDISCH — staan KVK/BTW echt op de gepubliceerde pagina\'s?')

  for (const page of ['/voorwaarden', '/privacy']) {
    const url = `${liveUrl.replace(/\/$/, '')}${page}`
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        record({
          gate: 'legal', name: page, status: 'WARN',
          detail: `HTTP ${res.status}`, fix: 'Controleer of de pagina live staat.',
        })
        continue
      }
      const html = await res.text()
      const hit = PLACEHOLDERS.filter((p) => html.includes(p))
      record(
        hit.length === 0
          ? { gate: 'legal', name: page, status: 'PASS', detail: 'geen placeholders' }
          : {
              gate: 'legal', name: page, status: 'FAIL',
              detail: `toont nog ${hit.join(' + ')}`,
              fix: 'Zet NEXT_PUBLIC_COMPANY_LEGAL_NAME / _KVK / _BTW / _ADDRESS / _CITY in Vercel en deploy opnieuw (NEXT_PUBLIC_* worden bij de BUILD ingebakken).',
            },
      )
    } catch (e) {
      record({
        gate: 'legal', name: page, status: 'WARN',
        detail: `niet bereikbaar (${errMsg(e)})`, fix: 'Draai dit opnieuw tegen de live URL.',
      })
    }
  }
}

// ─── GATE 6 — Resend sending domain ───────────────────────────────────────────
// src/lib/email.ts sends from noreply@boekbrug.nl. An unverified domain means every
// invoice e-mail is rejected — and the app degrades gracefully, so nothing looks broken.

async function checkResend(env: Env) {
  gate('6 · E-MAIL — is het verzenddomein geverifieerd bij Resend?')

  if (!env.resendKey) {
    record({
      gate: 'email', name: 'Resend', status: 'SKIP',
      detail: 'geen RESEND_API_KEY — overgeslagen',
    })
    return
  }
  try {
    const res = await fetchWithTimeout('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.resendKey}` },
    })
    if (!res.ok) {
      record({
        gate: 'email', name: 'Resend', status: 'WARN',
        detail: `API gaf HTTP ${res.status}`, fix: 'Controleer de API-sleutel in het Resend-dashboard.',
      })
      return
    }
    const json = (await res.json()) as { data?: { name?: string; status?: string }[] }
    const domains = json.data ?? []
    const match = domains.find((d) => d.name === SENDING_DOMAIN)
    if (!match) {
      record({
        gate: 'email', name: `domein ${SENDING_DOMAIN}`, status: 'FAIL',
        detail: `niet gevonden — bekend: ${domains.map((d) => d.name).join(', ') || '(geen)'}`,
        fix: `Voeg ${SENDING_DOMAIN} toe in Resend en zet de DNS-records; anders komt er geen enkele factuurmail aan.`,
      })
      return
    }
    record(
      match.status === 'verified'
        ? { gate: 'email', name: `domein ${SENDING_DOMAIN}`, status: 'PASS', detail: 'geverifieerd' }
        : {
            gate: 'email', name: `domein ${SENDING_DOMAIN}`, status: 'FAIL',
            detail: `status is '${match.status}', niet 'verified'`,
            fix: 'Rond de DNS-verificatie af in het Resend-dashboard.',
          },
    )
  } catch (e) {
    record({
      gate: 'email', name: 'Resend', status: 'WARN',
      detail: errMsg(e), fix: 'Controleer handmatig in het Resend-dashboard.',
    })
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(paint('1', '\n╔══════════════════════════════════════════════════════════╗'))
  console.log(paint('1', '║  BoekBrug — PREFLIGHT  ·  mag de deur open?              ║'))
  console.log(paint('1', '╚══════════════════════════════════════════════════════════╝'))
  console.log(paint('90', '  Read-only. Schrijft niets, roept geen enkele DB-functie aan.'))

  const env = checkEnv()
  if (!env) {
    console.log(`\n${paint('1;31', 'AFGEBROKEN')} — zonder Supabase-sleutels kan er niets gecontroleerd worden.`)
    console.log('  npx tsx --env-file=.env.local scripts/preflight.ts')
    process.exit(1)
  }

  await checkInvitationLeak(env)
  await checkSchema(env)
  await checkStorage(env)

  if (noRemote) {
    gate('3+4 · LIVE-SITE — overgeslagen (--no-remote)')
    record({ gate: 'live', name: 'cron + juridisch', status: 'SKIP', detail: '--no-remote' })
  } else if (!env.appUrl) {
    gate('3+4 · LIVE-SITE — geen URL bekend')
    record({
      gate: 'live', name: 'cron + juridisch', status: 'WARN',
      detail: 'geen NEXT_PUBLIC_APP_URL en geen --url=',
      fix: 'Draai opnieuw met --url=https://boekbrug.nl — dit zijn de twee gates die alleen live te meten zijn.',
    })
  } else {
    console.log(paint('90', `\n  (live-site gates tegen ${env.appUrl})`))
    await checkCronGuards(env.appUrl)
    await checkLegalPages(env.appUrl)
  }

  await checkResend(env)

  // ── Verdict ────────────────────────────────────────────────────────────────
  const fails = findings.filter((f) => f.status === 'FAIL')
  const warns = findings.filter((f) => f.status === 'WARN')
  const passes = findings.filter((f) => f.status === 'PASS')

  console.log(`\n${paint('1', '─'.repeat(62))}`)
  console.log(
    `  ${paint('32', `${passes.length} PASS`)}   ` +
    `${paint('1;31', `${fails.length} FAIL`)}   ` +
    `${paint('33', `${warns.length} WARN`)}   ` +
    `${paint('90', `${findings.filter((f) => f.status === 'SKIP').length} SKIP`)}`,
  )
  console.log(paint('1', '─'.repeat(62)))

  if (fails.length > 0) {
    console.log(`\n${paint('1;31', 'BLOKKEERT DE LANCERING:')}`)
    for (const f of fails) {
      console.log(`\n  ✗ ${paint('1', f.name)} — ${f.detail}`)
      if (f.fix) console.log(`    → ${f.fix}`)
    }
  }
  if (warns.length > 0) {
    console.log(`\n${paint('33', 'NIET VASTGESTELD (blokkeert niet, maar is geen groen licht):')}`)
    for (const f of warns) {
      console.log(`\n  ! ${paint('1', f.name)} — ${f.detail}`)
      if (f.fix) console.log(`    → ${f.fix}`)
    }
  }

  if (fails.length === 0 && warns.length === 0) {
    console.log(`\n${paint('1;32', '✓ VRIJ VOOR LANCERING')} — alle gates groen.\n`)
  } else if (fails.length === 0) {
    console.log(`\n${paint('33', '~ GEEN BLOKKADES')} — maar ${warns.length} check(s) konden niet worden bevestigd. Los die eerst op.\n`)
  } else {
    console.log(`\n${paint('1;31', '✗ NIET LANCEREN')} — ${fails.length} blokkade(s) hierboven.\n`)
  }

  process.exit(fails.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(`\n${paint('1;31', 'PREFLIGHT CRASHED')} — ${errMsg(e)}`)
  console.error('Dit is GEEN groen licht: de controle is niet afgerond.')
  process.exit(1)
})
