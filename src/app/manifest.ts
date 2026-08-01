// src/app/manifest.ts
// [PWA] Web app manifest so BoekBrug can be installed to the home screen and
// gets a consistent name, colours and icon. theme_color matches the accent
// blue used in viewport; background_color is the app's light system grey.
//
// [ANDROID/TWA] The 192/512 "any" icons + the maskable variants below are what
// Android (and PWABuilder/Bubblewrap when generating the Play Store TWA) read
// to build the launcher icon and splash screen. "maskable" icons are full-bleed
// so Android can crop them to any device shape without white corners. The source
// artwork is the white "BB" wordmark over a suspension bridge (BoekBrug = "book
// bridge") on the brand-blue gradient — regenerate via scripts/generate-icons.mjs.

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // [PWA] id pins a stable app identity so the browser/Play treat updates as
    // the same installed app even if start_url ever changes.
    id: '/',
    name: 'BoekBrug',
    short_name: 'BoekBrug',
    description: "Eén plek voor al je facturen, documenten en klanten. Voor ZZP'ers en boekhouders.",
    start_url: '/',
    // [PWA] scope "/" keeps the whole site inside the installed app window, so
    // navigating anywhere in BoekBrug stays in-app instead of bouncing to Chrome.
    scope: '/',
    display: 'standalone',
    // [PWA] Dutch UI, left-to-right — helps the store + a11y label the app.
    lang: 'nl',
    dir: 'ltr',
    // [PWA] Lock the installed app to portrait — a phone-first admin app that
    // shouldn't flip to landscape when the device rotates. The TWA bakes this
    // into the Android activity's screenOrientation when regenerated in
    // PWABuilder; Chrome also applies it at runtime for the installed PWA.
    orientation: 'portrait',
    categories: ['finance', 'business', 'productivity'],
    background_color: '#f8f9fa',
    theme_color: '#1a73e8',
    // [PWA] Long-press launcher shortcuts → deep links into the core flows.
    shortcuts: [
      {
        name: 'Factuur scannen',
        short_name: 'Scannen',
        description: 'Snel een factuur of bon inschieten',
        url: '/dashboard/upload',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Mijn facturen',
        short_name: 'Facturen',
        description: 'Bekijk en beheer je facturen',
        url: '/dashboard/facturen',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Bank',
        short_name: 'Bank',
        description: 'Bankafschriften en matching',
        url: '/dashboard/bank',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    // NOTE: no favicon.ico here on purpose — app stores (and PWABuilder) reject
    // .ico as a manifest icon type. The favicon lives in the HTML <head> via
    // layout metadata; the manifest ships PNG-only (incl. maskable).
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
