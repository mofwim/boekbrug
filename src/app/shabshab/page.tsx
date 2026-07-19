// [SHABSHAB] Route entry. Server component: SEO metadata + a mobile-locked
// viewport (no pinch-zoom, full-bleed with viewport-fit=cover so it fills the
// notch area on Android). The interactive game is the client <Game/> below.

import type { Metadata, Viewport } from 'next'
import Game from './Game'

export const metadata: Metadata = {
  title: 'شبشب فايت — لعبة قتال الشباشب أونلاين',
  description:
    'لعبة قتال ثنائية بالشباشب على طريقة مورتال كومبات: حركة، قفز، مراوغة، ضربات خارقة (الشبشب الذهبي)، وأونلاين بين لاعبين بكود غرفة. مجاناً على المتصفح والأندرويد.',
  keywords: ['لعبة شباشب', 'شبشب فايت', 'لعبة قتال', 'رمي شباشب', 'slipper fight', 'لعبة اونلاين'],
  alternates: { canonical: '/shabshab' },
  openGraph: {
    title: 'شبشب فايت 🩴',
    description: 'قاتل بالشباشب أونلاين — اشحن أقوى ضربة واقلب خصمك!',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#2a1a4a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function Page() {
  return <Game />
}
