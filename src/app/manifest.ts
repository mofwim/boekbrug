// src/app/manifest.ts
// [PWA] Web app manifest so BoekBrug can be installed to the home screen and
// gets a consistent name, colours and icon. theme_color matches the accent
// blue used in viewport; background_color is the app's light system grey.
//
// [ANDROID/TWA] The 192/512 "any" icons + the maskable variants below are what
// Android (and PWABuilder/Bubblewrap when generating the Play Store TWA) read
// to build the launcher icon and splash screen. "maskable" icons are full-bleed
// so Android can crop them to any device shape without white corners. The source
// artwork is the white "BB" monogram on the brand-blue gradient in public/icons.

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BoekBrug',
    short_name: 'BoekBrug',
    description: "Eén plek voor al je facturen, documenten en klanten. Voor ZZP'ers en boekhouders.",
    start_url: '/',
    display: 'standalone',
    background_color: '#f8f9fa',
    theme_color: '#1a73e8',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
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
