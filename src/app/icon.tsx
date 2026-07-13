// src/app/icon.tsx
// [BRAND] Generated favicon — a crisp BoekBrug "B" monogram, so the browser
// tab shows the brand instead of a low-res .ico. Generated at build time.

import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          fontSize: 22,
          fontWeight: 800,
          borderRadius: 7,
          fontFamily: 'sans-serif',
        }}
      >
        B
      </div>
    ),
    { ...size }
  )
}
