// src/app/opengraph-image.tsx
// [SEO] Site-wide default social-share image (og:image + twitter fallback).
// Generated at build time with next/og — self-contained, no external fonts or
// assets, so it renders reliably. Individual routes can override with their own
// opengraph-image file later.

import { ImageResponse } from 'next/og'

export const alt = 'BoekBrug — de brug tussen jou en je boekhouder'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: 'linear-gradient(135deg, #1a73e8 0%, #0056d6 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 600, opacity: 0.9, marginBottom: 24 }}>
          BoekBrug
        </div>
        <div style={{ fontSize: 82, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
          De brug tussen jou en je boekhouder
        </div>
        <div style={{ fontSize: 34, opacity: 0.92, marginTop: 36, maxWidth: 860 }}>
          Facturen maken en scannen · BTW bijhouden · samen met je accountant
        </div>
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            alignSelf: 'flex-start',
            background: '#ffffff',
            color: '#1a73e8',
            fontSize: 30,
            fontWeight: 700,
            padding: '14px 32px',
            borderRadius: 9999,
          }}
        >
          boekbrug.nl
        </div>
      </div>
    ),
    { ...size }
  )
}
