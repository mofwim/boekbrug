// src/app/manifest.ts
// [PWA] Web app manifest so BoekBrug can be installed to the home screen and
// gets a consistent name, colours and icon. theme_color matches the accent
// blue used in viewport; background_color is the app's light system grey.
//
// NOTE: only favicon.ico exists today. A proper set of 192x192 and 512x512
// PNG icons (incl. a maskable one) should be added later for a good
// install/splash experience on Android.

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BoekBrug',
    short_name: 'BoekBrug',
    description: "Eén plek voor al je facturen, documenten en klanten. Voor ZZP'ers en boekhouders.",
    start_url: '/',
    display: 'standalone',
    background_color: '#f2f2f7',
    theme_color: '#007aff',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
