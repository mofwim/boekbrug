// src/app/apple-icon.tsx
// [BRAND] Apple touch icon (home-screen icon on iOS). Same BoekBrug monogram,
// sized for the Apple touch icon slot.

import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a84ff, #0056d6)',
          color: '#fff',
          fontSize: 112,
          fontWeight: 800,
          fontFamily: 'sans-serif',
        }}
      >
        B
      </div>
    ),
    { ...size }
  )
}
