'use client'

// [SHABSHAB] Top-level client screen: the menu + mode picker that mounts the
// <Arena/> for the chosen mode. Kept intentionally standalone (its own chrome,
// RTL, full-bleed) so the game feels like its own app even though it lives in
// the BoekBrug Next.js project and ships to Android via the same PWA/TWA path.

import React, { useMemo, useState } from 'react'
import Arena, { type Mode } from './ui/Arena'
import type { AiLevel } from './engine/ai'
import { makeRoomCode, onlineAvailable } from './net/room'

interface Config {
  mode: Mode
  code?: string
  aiLevel: AiLevel
  names: { p1: string; p2: string }
}

const NAMES: Record<Mode, { p1: string; p2: string }> = {
  host: { p1: 'المضيف', p2: 'الضيف' },
  guest: { p1: 'المضيف', p2: 'أنت' },
  cpu: { p1: 'أنت', p2: 'الكمبيوتر' },
  local2: { p1: 'لاعب 1', p2: 'لاعب 2' },
}

export default function Game() {
  const [config, setConfig] = useState<Config | null>(null)
  const [screen, setScreen] = useState<'menu' | 'cpu' | 'join'>('menu')
  const [aiLevel, setAiLevel] = useState<AiLevel>('normal')
  const [joinCode, setJoinCode] = useState('')
  const online = useMemo(() => onlineAvailable(), [])

  if (config) {
    return (
      <Arena
        mode={config.mode}
        code={config.code}
        aiLevel={config.aiLevel}
        names={config.names}
        onQuit={() => {
          setConfig(null)
          setScreen('menu')
        }}
      />
    )
  }

  const start = (mode: Mode, extra?: Partial<Config>) =>
    setConfig({ mode, aiLevel, names: NAMES[mode], ...extra })

  return (
    <div dir="rtl" style={page}>
      <div style={{ position: 'absolute', inset: 0, background: bgGradient, zIndex: 0 }} />
      <div style={card}>
        <div style={{ fontSize: 64, lineHeight: 1 }}>🩴</div>
        <h1 style={title}>شبشب فايت</h1>
        <p style={subtitle}>قتال الشباشب — اضرب خصمك بأقوى الضربات واقلبه!</p>

        {screen === 'menu' && (
          <div style={col}>
            <button
              style={{ ...btn, ...(online ? btnPrimary : btnDisabled) }}
              disabled={!online}
              onClick={() => start('host', { code: makeRoomCode() })}
            >
              🌐 أونلاين — استضف غرفة
            </button>
            <button
              style={{ ...btn, ...(online ? btnBlue : btnDisabled) }}
              disabled={!online}
              onClick={() => setScreen('join')}
            >
              🔑 أونلاين — انضمام بكود
            </button>
            {!online && (
              <div style={note}>الأونلاين يتطلب إعداد Supabase (متغيّرات البيئة). الأوضاع المحلية تعمل دائماً.</div>
            )}
            <button style={{ ...btn, ...btnDark }} onClick={() => setScreen('cpu')}>
              🤖 ضد الكمبيوتر
            </button>
            <button style={{ ...btn, ...btnDark }} onClick={() => start('local2')}>
              👬 لاعبان على نفس الجهاز
            </button>
          </div>
        )}

        {screen === 'cpu' && (
          <div style={col}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>اختر الصعوبة</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {(['easy', 'normal', 'hard'] as AiLevel[]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => setAiLevel(lv)}
                  style={{ ...pill, ...(aiLevel === lv ? pillOn : {}) }}
                >
                  {lv === 'easy' ? 'سهل' : lv === 'normal' ? 'عادي' : 'صعب'}
                </button>
              ))}
            </div>
            <button style={{ ...btn, ...btnPrimary }} onClick={() => start('cpu')}>
              ابدأ القتال ⚔️
            </button>
            <button style={{ ...btn, ...btnGhost }} onClick={() => setScreen('menu')}>
              رجوع
            </button>
          </div>
        )}

        {screen === 'join' && (
          <div style={col}>
            <div style={{ fontWeight: 700 }}>اكتب كود الغرفة</div>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
              placeholder="مثال: K7QP"
              inputMode="text"
              autoCapitalize="characters"
              style={input}
            />
            <button
              style={{ ...btn, ...(joinCode.length === 4 ? btnBlue : btnDisabled) }}
              disabled={joinCode.length !== 4}
              onClick={() => start('guest', { code: joinCode })}
            >
              انضمام ⚡
            </button>
            <button style={{ ...btn, ...btnGhost }} onClick={() => setScreen('menu')}>
              رجوع
            </button>
          </div>
        )}

        <details style={{ marginTop: 18, fontSize: 13, opacity: 0.85 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>كيف ألعب؟</summary>
          <ul style={{ textAlign: 'right', lineHeight: 1.9, marginTop: 8, paddingInlineStart: 18 }}>
            <li>الجوال: أزرار الحركة يسار، وزر 🩴 يمين — امسكه ليشحن ضربة أقوى.</li>
            <li>الكيبورد: A/D للحركة، W قفز، S انحناء، مسافة/J للرمي.</li>
            <li>انحنِ لتتفادى الشبشب العالي، واقفز فوق المنخفض.</li>
            <li>عبّئ شريط الطاقة لتُطلق «الشبشب الذهبي» الخارق ✨.</li>
            <li>أفضل من 3 جولات يفوز بالمباراة.</li>
          </ul>
        </details>
      </div>
    </div>
  )
}

// ---- styles ---------------------------------------------------------------
const bgGradient = 'radial-gradient(1200px 600px at 50% -10%, #7b3f7d 0%, #2a1a4a 55%, #140d24 100%)'
const page: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  color: '#fff',
  fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
  padding: 16,
  overflow: 'auto',
}
const card: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: '100%',
  maxWidth: 420,
  textAlign: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 24,
  padding: '28px 22px 22px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(8px)',
}
const title: React.CSSProperties = { fontSize: 40, fontWeight: 900, margin: '6px 0 2px', letterSpacing: -0.5 }
const subtitle: React.CSSProperties = { fontSize: 15, opacity: 0.85, margin: '0 0 20px' }
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const btn: React.CSSProperties = {
  border: 'none',
  borderRadius: 14,
  padding: '14px 18px',
  fontSize: 18,
  fontWeight: 800,
  cursor: 'pointer',
  color: '#fff',
  transition: 'transform 0.05s',
}
const btnPrimary: React.CSSProperties = { background: 'linear-gradient(135deg,#ff6b6b,#d63a4f)' }
const btnBlue: React.CSSProperties = { background: 'linear-gradient(135deg,#4dabff,#2b6cb0)' }
const btnDark: React.CSSProperties = { background: 'rgba(255,255,255,0.1)' }
const btnGhost: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(255,255,255,0.25)' }
const btnDisabled: React.CSSProperties = { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)', cursor: 'not-allowed' }
const pill: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'transparent',
  color: '#fff',
  borderRadius: 999,
  padding: '8px 16px',
  fontWeight: 700,
  cursor: 'pointer',
}
const pillOn: React.CSSProperties = { background: '#ffd93b', color: '#1a1a2a', borderColor: '#ffd93b' }
const input: React.CSSProperties = {
  textAlign: 'center',
  letterSpacing: 8,
  fontSize: 28,
  fontWeight: 900,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(0,0,0,0.25)',
  color: '#fff',
  textTransform: 'uppercase',
}
const note: React.CSSProperties = { fontSize: 12.5, opacity: 0.75, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 10px' }
