// src/app/tr/prijzen/page.tsx
// [BILLING/TR] Turkish pricing page. A translated copy of /prijzen that REUSES
// the same price values from lib and the same SubscribeButton — no billing
// logic is duplicated or changed here.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLUS } from '@/lib/plan'
import { FAIR_USE_LIMITS, fairUseLimit } from '@/lib/fair-use'
import { BEWAARPLICHT_YEARS, KLUIS_GRACE_MONTHS, eur, KLUIS_PREPAY_YEAR_PRICE_EUR } from '@/lib/bewaarkluis'
import SubscribeButton from '@/app/prijzen/SubscribeButton'

export const metadata: Metadata = {
  title: 'Fiyatlar — sizin ve muhasebeciniz için ücretsiz | BoekBrug',
  description:
    `BoekBrug serbest çalışan için ücretsiz ve muhasebecisi için ücretsizdir. Adil kullanımın üzerinde Plus ayda ${PLUS.priceLabel} tutar (KDV dahil). Deneme süresi yok, otomatik tahsilat yok ve kendi idarenizde asla kilit yok.`,
  keywords: ['boekbrug fiyatları', 'ücretsiz muhasebe programı hollanda', 'zzp muhasebe maliyeti', 'saklama yükümlülüğü 7 yıl'],
  alternates: {
    canonical: '/tr/prijzen',
    languages: { 'nl-NL': '/prijzen', 'en-GB': '/en/prijzen', ar: '/ar/prijzen', 'tr-TR': '/tr/prijzen' },
  },
  openGraph: {
    title: 'BoekBrug — sizin ve muhasebeciniz için ücretsiz',
    description: `Plus ayda ${PLUS.priceLabel} tutar ve yalnızca adil kullanımın üzerinde gerekir.`,
    type: 'website',
    locale: 'tr_TR',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }

const INCLUDED = [
  'Fatura oluşturma, gönderme ve takip (ödeme talebiyle)',
  'Fişleri ve alış faturalarını yapay zekâ ile tarama',
  'Faturaları e-postanızdan otomatik alma',
  'Banka ekstresini içe aktarma ve otomatik eşleştirme',
  'Kasa defteri ve günlük ciro',
  'KDV beyannamesini hazırlama (KOR küçük işletme rejimi dahil)',
  'Muhasebecinize köprü — tek tuş, her şey eksiksiz',
  'Uyumluluk kasası: idareniz yıl bazında düzenli ve dışa aktarılabilir',
]

export default function TrPricingPage() {
  const ai = fairUseLimit('aiDocuments')
  const otherLimits = FAIR_USE_LIMITS.length - 1

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <p style={{ fontSize: 14, margin: '0 0 12px' }}>
          <Link href="/prijzen" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>🇳🇱 Hollandaca görüntüle →</Link>
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px', lineHeight: 1.25 }}>
          Muhasebe yapmak zorunda değilsiniz. <span style={{ color: '#1a73e8' }}>Yalnızca hiçbir şeyi kaybetmemeniz yeterli.</span>
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6, maxWidth: 640 }}>
          Fişlerinizi fotoğraflayın ya da e-postayla gelmesine izin verin; çeyreğin sonunda her şey muhasebeciniz için hazır olur.
        </p>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.6, maxWidth: 620 }}>
          Ve bu <strong>ücretsizdir</strong> — sizin ve muhasebeciniz için. Sessizce biten bir deneme yok, önceden kredi kartı yok ve kendi idarenizde kilit yok.
        </p>

        {/* Üç plan */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <section style={{ ...card, borderColor: '#137333', borderWidth: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#137333', letterSpacing: 0.4, textTransform: 'uppercase' }}>Serbest çalışan</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>tüm özellikler, adil kullanım içinde</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#137333', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>Ücretsiz başla</Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Bu giriş paketi değil — bu, ürünün kendisi için yapıldığı ve çoğu kullanıcının kalıcı olarak kalması gereken plandır.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4, textTransform: 'uppercase' }}>{PLUS.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{PLUS.priceLabel}</span>
              <span style={{ fontSize: 15, color: '#5f6368' }}>ayda</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>KDV dahil · aylık iptal edilebilir</div>
            <SubscribeButton />
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Yalnızca adil kullanımı sürekli aşarsanız gereklidir — örneğin yapay zekânın okuduğu ayda {ai.free} belgeden fazlası. Plus her sınırı {ai.plus}&apos;e yükseltir.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', letterSpacing: 0.4, textTransform: 'uppercase' }}>Muhasebeci</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>her zaman, müşteri sayısından bağımsız</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#fff', color: '#1A73E8', border: '1.5px solid #1A73E8', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>Portalı aç</Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Tam portal, çalışma panosu ve her müşteri için kapanmış bir çeyreği alma. Ücretli bir muhasebeci planı yok ve olmayacak.
            </p>
          </section>
        </div>

        {/* Her şeyde ne var */}
        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 14px' }}>Bu, her planda var — ücretsiz planda da</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.5 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
            Ücretsiz planın sınırları rakamına kadar <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>/eerlijk-gebruik</Link> sayfasında yayınlanır. Birini aşarsanız yalnızca bize maliyeti olan işlem duraklar. Kendi idarenizi görüntüleme, arama ve dışa aktarma her zaman çalışmaya devam eder — sınırın üstünde de, siz durduktan sonra da.
          </p>
        </section>

        {/* Saklama Kasası */}
        <section style={{ ...card, marginTop: 16, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4, textTransform: 'uppercase' }}>BoekBrug Saklama Kasası</div>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '8px 0 10px' }}>İşinizi bırakırsınız. Saklama yükümlülüğünüz bitmez.</h2>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            Hollanda vergi dairesi, idarenizi <strong>{BEWAARPLICHT_YEARS} yıl</strong> gösterebilmenizi ister (madde 52 AWR). Bu süre, işletmeniz durduktan ve yazılımınız durduktan sonra da devam eder. Bu, bir girişimcinin her şeyi bıraktıktan sonra hâlâ yapabilmesi gereken tek şeydir — ve tam da bunun için genellikle hiçbir şey hazır değildir.
          </p>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            Arşivinizi çevrimiçi tutarız: yıl ve çeyrek bazında düzenli, aranabilir ve tek tuşla yıl bazında dizinli bir ZIP olarak dışa aktarılabilir. Bu, <strong>kalan her saklama yılı için {eur(KLUIS_PREPAY_YEAR_PRICE_EUR)}</strong> tutar, tek seferde peşin. Bugün işinizi kapatırsanız bu, tüm süre için {eur(BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR)} olur.
          </p>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.65, maxWidth: 660 }}>
            <strong>Satmadığımız şey:</strong> saklama yükümlülüğünüzü devralmayız — o yasal olarak sizde kalır. Biz ikinci kopyanızız, asla tek kopyanız değil; kendi kopyanızı da indirin. Ayrıca iptalinizden sonraki ilk <strong>{KLUIS_GRACE_MONTHS} ay her şeyi ücretsiz saklarız</strong>, herhangi bir şey silinmeden çok önce e-postayla uyarı vererek. <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Koşullar §5.7</Link>.
          </p>
        </section>

        {/* SSS */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>Sık sorulan sorular</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q="Gerçekten ücretsiz mi, yoksa bu bir deneme mi?">
              Gerçekten ücretsiz. <strong>Deneme süresi yok</strong> ve işleyen bir saat yok. Ödeme bilgisi bırakmazsınız, dolayısıyla asla bir tahsilat olamaz. Olan şey adil bir kullanımdır: yapay zekânın okuduğu ayda {ai.free} belge ve <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>tek bir sayfada</Link> görünen {otherLimits} sınır daha.
            </Faq>
            <Faq q="Adil kullanımı aşarsam ne olur?">
              Bir sınırın %80&apos;inde, tam sayıyla bir bildirim alırsınız — yani bir şey olmadan önce. Aşarsanız <em>yalnızca</em> bize maliyeti olan işlem duraklar: yeni bir belgeyi otomatik okutma, yeni bir fatura gönderme. Zaten var olan her şey okunabilir ve dışa aktarılabilir kalır. Sonra siz seçersiniz: gelecek ayı beklemek ya da Plus almak.
            </Faq>
            <Faq q="Muhasebecim de öder mi?">
              Hayır ve bu değişmez. Muhasebeci portalı, yüz bağlı müşteriyle bile ücretsizdir. Ücretli bir muhasebeci planı yoktur.
            </Faq>
            <Faq q="Aylık iptal edebilir miyim?">
              Evet. Plus&apos;ı kendi ayarlarınızdan kendiniz iptal edersiniz — e-posta yok, telefon yok. Zaten ödediğiniz dönemin sonuna kadar Plus&apos;ta kalır, sonra ücretsiz plana dönersiniz. Hiçbir veri kaybetmezsiniz.
            </Faq>
            <Faq q="KDV&apos;li fatura alır mıyım?">
              Evet. Her ödeme, kendiniz indirebileceğiniz adınıza bir KDV faturası oluşturur. KDV numaranız varsa, ödeme sırasında onu eklersiniz.
            </Faq>
            <Faq q="Nasıl ödeyebilirim?">
              iDEAL veya kredi kartıyla. Ödeme Stripe üzerinden yapılır — kart bilgileriniz asla BoekBrug&apos;a ulaşmaz.
            </Faq>
            <Faq q="BoekBrug&apos;u tamamen bırakırsam ne olur?">
              Her şeyi dışa aktarırsınız (bu her zaman çalışır, ücretsiz planda da). Sonrasında idarenizi {KLUIS_GRACE_MONTHS} ay daha ücretsiz saklarız. Saklama yükümlülüğünüz devam ettiği için daha uzun kalmasını mı istiyorsunuz? Saklama Kasası bunun içindir. Hiçbir şeyi en az 30 gün önceden e-postayla haber vermeden asla silmeyiz.
            </Faq>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
