// src/components/blog/ToolCTA.tsx
// [BLOG] The funnel. A visually distinct box at the end of every article that
// links to the article's related free tool (primary) and to signup (secondary).
// Reads relatedTool + relatedToolLabel from the article frontmatter. Matches the
// blue-accent CTA styling used on the landing page and tools hub (#1a73e8).

import Link from 'next/link'
import type { Locale } from '@/lib/blog'

// Tools that have a published English version at /en/<slug>. For EN articles we
// route the CTA to the English tool so the reader stays in English; tools not
// listed here (factuur-maken, factuur-scannen, tools hub) have no EN page yet
// and keep their Dutch path.
const EN_TOOLS = new Set([
  '/btw-berekenen',
  '/netto-inkomen-zzp',
  '/uurtarief-berekenen',
  '/kilometervergoeding',
  '/btw-aangifte-berekenen',
])

// [WAT-HET-DOET] The body used to say the invoices, receipts and VAT are kept "in one place" and
// added up per quarter. True, and it describes a filing cabinet — so a reader of the free surface
// reasonably concluded the product has no automation at all. It says what actually happens now:
// the documents are read (ai.ts) and late customers are chased (/api/cron/reminders). The bank
// connection is deliberately left out until its credentials are live — see ToolPage.tsx.
const COPY: Record<Locale, { heading: string; body: string; register: string; reassure: string }> = {
  nl: {
    heading: 'Doe het meteen goed — gratis',
    body: 'Of laat BoekBrug het werk doen: je bonnetjes en inkoopfacturen worden vanzelf uitgelezen, je klanten krijgen vanzelf een herinnering als ze te laat zijn, en je btw wordt per kwartaal opgeteld — klaar voor je aangifte en je boekhouder.',
    register: 'Gratis account maken',
    reassure: 'Gratis account, in een minuut geregeld. Je data blijft van jou.',
  },
  en: {
    heading: 'Get it right from the start — free',
    body: 'Or let BoekBrug do the work: your receipts and purchase invoices are read for you, your customers are reminded automatically when they are late, and your VAT is added up per quarter — ready for your tax return and your accountant.',
    register: 'Create a free account',
    reassure: 'Free account, set up in a minute. Your data stays yours.',
  },
  ar: {
    heading: 'ابدأ بشكل صحيح — مجاناً',
    body: 'أو دع BoekBrug يقوم بالعمل: يقرأ إيصالاتك وفواتير مشترياتك تلقائياً، ويذكّر عملاءك من تلقاء نفسه عندما يتأخرون في الدفع، ويجمع ضريبتك كل ربع سنة — جاهزة لإقرارك ولمحاسبك.',
    register: 'أنشئ حساباً مجانياً',
    reassure: 'حساب مجاني، يُجهَّز في دقيقة. بياناتك تبقى لك.',
  },
  tr: {
    heading: 'Baştan doğru yapın — ücretsiz',
    body: 'Ya da işi BoekBrug yapsın: fişleriniz ve alış faturalarınız otomatik okunur, geciken müşterilerinize kendiliğinden hatırlatma gider ve KDV’niz üç ayda bir toplanır — beyannameniz ve muhasebeciniz için hazır.',
    register: 'Ücretsiz hesap oluştur',
    reassure: 'Ücretsiz hesap, bir dakikada kurulur. Verileriniz sizin kalır.',
  },
}

export default function ToolCTA({
  locale,
  relatedTool,
  relatedToolLabel,
}: {
  locale: Locale
  relatedTool: string
  relatedToolLabel: string
}) {
  const t = COPY[locale]
  const toolHref = locale === 'en' && EN_TOOLS.has(relatedTool) ? `/en${relatedTool}` : relatedTool
  return (
    <aside
      style={{
        background: '#e8f0fe',
        border: '1px solid #d3e3fd',
        borderRadius: 18,
        padding: '26px 24px',
        margin: '36px 0 8px',
      }}
    >
      <div style={{ fontSize: 19, fontWeight: 700, color: '#202124', marginBottom: 14 }}>
        {t.heading}
      </div>

      <p style={{ fontSize: 15, lineHeight: 1.6, color: '#3c4043', margin: '0 0 18px' }}>
        {t.body}
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {relatedTool && relatedToolLabel && (
          <Link
            href={toolHref}
            style={{
              backgroundColor: '#1a73e8',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              padding: '13px 24px',
              borderRadius: 9999,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            {relatedToolLabel} →
          </Link>
        )}

        <Link
          href="/register"
          style={{
            backgroundColor: '#fff',
            color: '#1a73e8',
            fontSize: 15,
            fontWeight: 600,
            padding: '13px 24px',
            borderRadius: 9999,
            border: '1.5px solid #1a73e8',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {t.register} →
        </Link>
      </div>

      <p style={{ fontSize: 13, color: '#5f6368', margin: '14px 0 0' }}>{t.reassure}</p>
    </aside>
  )
}
