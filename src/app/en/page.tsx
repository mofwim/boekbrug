// src/app/en/page.tsx
// [LANDING-EN] The English homepage — a translation of `/`, not a second product page.
//
// WHY IT EXISTS
// The Dutch homepage is the foundation and stays that way. But a large share of the people who
// must file a Dutch BTW return do not read Dutch comfortably: shop owners and freelancers who
// came from elsewhere. They are the least served by the Dutch market, because every competitor
// is Dutch-only — and they are the ones for whom losing a receipt costs the most, since they are
// least able to argue with the Belastingdienst afterwards.
//
// So this page is not "the same thing in another language for completeness". It is the door for
// the person who would otherwise never get through it.
//
// WHAT IT MUST NEVER BECOME
// A second opinion. Every sentence comes from belofte-en.ts, which is a TRANSLATION of
// belofte.ts — see the rule at the top of that file. If this page ever promises something the
// Dutch homepage does not, this page is wrong, however well it reads.
//
// ONLY TOOLS THAT EXIST IN ENGLISH ARE LINKED. Three of the eight free tools have no /en
// version (factuur-maken, factuur-scannen, bankafschrift-naar-excel). Sending an English reader
// to a Dutch calculator is exactly the small dishonesty this product avoids elsewhere; when
// those three get an English version, they belong in the list below.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  PROMISE_HEAD,
  PROMISE_HEAD_2,
  PROMISE_EXPLAIN,
  PROMISE_REASSURE,
  PROMISE_STEPS,
  PROMISE_BOOKKEEPER,
  PROMISE_OTHER_LANGUAGES,
} from '@/lib/belofte-en'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'

export const metadata: Metadata = {
  title: 'BoekBrug — invoices, BTW and bookkeeping for freelancers in the Netherlands',
  description:
    'Make invoices, scan receipts, keep your BTW in order and work with your bookkeeper. ' +
    'Free, no trial that expires, and never charged automatically.',
  alternates: {
    canonical: '/en',
    languages: { 'nl-NL': '/', 'en-GB': '/en' },
  },
  openGraph: {
    title: 'BoekBrug — the bridge between you and your bookkeeper',
    description: 'Make and scan invoices, keep your BTW in order, and hand a complete quarter to your bookkeeper.',
    type: 'website',
    locale: 'en_GB',
  },
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }
const btnGhost: React.CSSProperties = { backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none', display: 'inline-block' }

// Mirrors the Dutch `features` array one for one.
const features = [
  { emoji: '🧾', title: 'Invoices that are correct', body: 'Make an invoice that follows the Dutch rules. Download it as a PDF.' },
  { emoji: '📄', title: 'Scan and done', body: 'Upload a photo or a PDF. The AI reads the supplier, the amount and the BTW for you.' },
  { emoji: '📊', title: 'BTW always up to date', body: 'Your turnover and BTW are added up per quarter. Your return is almost ready.' },
  { emoji: '🤝', title: 'One line with your bookkeeper', body: 'Share your invoices with your bookkeeper. No more mailing folders full of PDFs.' },
]

// Only the tools that have an English page of their own — see the header.
const tools = [
  { slug: '/en/btw-berekenen', emoji: '🧮', title: 'BTW calculator', tagline: 'From amount to BTW, and back.' },
  { slug: '/en/btw-aangifte-berekenen', emoji: '📋', title: 'BTW return estimate', tagline: 'See roughly what you owe this quarter.' },
  { slug: '/en/netto-inkomen-zzp', emoji: '💶', title: 'Net income', tagline: 'What is left after tax as a freelancer.' },
  { slug: '/en/uurtarief-berekenen', emoji: '⏱️', title: 'Hourly rate', tagline: 'What you need to charge to make a living.' },
  { slug: '/en/kilometervergoeding', emoji: '🚗', title: 'Mileage allowance', tagline: 'What you may charge per kilometre.' },
]

export default function EnglishHome() {
  // No session check here, unlike the Dutch homepage. That page redirects a logged-in owner to
  // the dashboard because it is the front door people land on by habit; this one is a page you
  // SHARE, and a shared link that bounces the sender to their own dashboard is confusing when
  // they are trying to show it to someone else.
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      {/* Hero */}
      <section style={{ ...wrap, textAlign: 'center', paddingTop: 72, paddingBottom: 48 }}>
        <div style={{ display: 'inline-block', background: '#eaf3ff', color: '#1a73e8', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, marginBottom: 20 }}>
          For small businesses in the Netherlands and their bookkeeper
        </div>
        <h1 style={{ fontSize: 46, fontWeight: 800, color: '#202124', letterSpacing: -1, lineHeight: 1.1, margin: '0 auto 18px', maxWidth: 720 }}>
          {PROMISE_HEAD}
          <br />
          <span style={{ color: '#1a73e8' }}>{PROMISE_HEAD_2}</span>
        </h1>
        <p style={{ fontSize: 19, color: '#5f6368', lineHeight: 1.6, margin: '0 auto 32px', maxWidth: 600 }}>
          {PROMISE_EXPLAIN}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/register" style={btnPrimary}>Create a free account</Link>
          <Link href="/en/prijzen" style={btnGhost}>See what it costs</Link>
        </div>
        <div style={{ fontSize: 13, color: '#bdc1c6', marginTop: 16 }}>{PROMISE_REASSURE}</div>
      </section>

      {/* The problem, in the words of the person who has it. The Dutch page can leave this
          implicit — its reader knows the shoebox. Someone reading this in their second or third
          language deserves it spelled out once. */}
      <section style={{ ...wrap, paddingBottom: 44 }}>
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: '28px 26px', maxWidth: 720, margin: '0 auto' }}>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>The problem</h2>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }}>
            Receipts in a pocket, invoices in an inbox, a bank statement somewhere on a laptop.
            Every three months you have to turn that into a BTW return — and the Belastingdienst
            expects you to keep all of it for seven years.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: '#3c4043', margin: 0 }}>
            <strong>The solution is not that you learn bookkeeping.</strong> It is that nothing
            gets lost between the moment you receive a paper and the moment your bookkeeper needs
            it. That is the only job this app has.
          </p>
        </div>
      </section>

      {/* How it works — three steps */}
      <section style={{ ...wrap, paddingBottom: 40 }}>
        <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '0 0 18px', textAlign: 'center' }}>How it works</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {PROMISE_STEPS.map((step, i) => (
            <div key={step.head} style={{ padding: '4px 2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 999, background: '#1a73e8', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16.5, fontWeight: 700, color: '#202124' }}>{step.head}</span>
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: '#5f6368' }}>{step.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ ...wrap, paddingBottom: 44 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {features.map((f) => (
            <div key={f.title} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: 24 }}>
              <div style={{ fontSize: 30, marginBottom: 12 }} aria-hidden>{f.emoji}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#202124', marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: '#5f6368' }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* For the bookkeeper */}
      <section style={{ ...wrap, paddingBottom: 44 }}>
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: '24px 26px', maxWidth: 720, margin: '0 auto' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>Do you have a bookkeeper?</h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: '#5f6368', margin: 0 }}>{PROMISE_BOOKKEEPER}</p>
        </div>
      </section>

      {/* Free tools */}
      <section style={{ ...wrap, paddingBottom: 56 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#202124', letterSpacing: -0.5, margin: '0 0 8px' }}>Start free — no account</h2>
          <p style={{ fontSize: 16, color: '#5f6368', margin: 0 }}>Useful tools for anyone working for themselves.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {tools.map((t) => (
            <Link key={t.slug} href={t.slug} style={{ display: 'block', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 20, textDecoration: 'none' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }} aria-hidden>{t.emoji}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: '#5f6368' }}>{t.tagline}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ ...wrap, paddingBottom: 32 }}>
        <div style={{ background: 'linear-gradient(135deg, #1a73e8, #0056d6)', borderRadius: 24, padding: '48px 32px', textAlign: 'center', color: '#fff' }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, margin: '0 0 10px' }}>Spend less time on your admin</h2>
          <p style={{ fontSize: 17, opacity: 0.92, margin: '0 auto 24px', maxWidth: 480 }}>
            Take the first step today. A free account takes a minute.
          </p>
          <Link href="/register" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 16, fontWeight: 700, padding: '14px 30px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
            Create a free account
          </Link>
        </div>
      </section>

      {/* Language: to Dutch, and an honest answer for every other language. */}
      <section style={{ ...wrap, paddingBottom: 64, textAlign: 'center' }}>
        <p style={{ fontSize: 14.5, color: '#5f6368', margin: '0 0 6px' }}>
          <Link href="/" style={{ color: '#1a73e8' }}>Lees deze pagina in het Nederlands →</Link>
        </p>
        <p style={{ fontSize: 13.5, color: '#80868b', margin: 0 }}>{PROMISE_OTHER_LANGUAGES}</p>
      </section>

      <PublicFooter />
    </div>
  )
}
