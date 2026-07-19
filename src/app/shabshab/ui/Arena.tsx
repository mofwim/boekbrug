'use client'

// [SHABSHAB] The playfield. Owns the game loop, input, camera, particles and
// the network wiring for every mode:
//   cpu     — local sim, p2 driven by engine/ai
//   local2  — local sim, two humans on one device
//   host    — local sim, p2 = remote guest's input; broadcasts snapshots
//   guest   — no sim; streams input up, renders host snapshots (light easing)
//
// The simulation itself lives in engine/sim.ts; this file is glue + rendering.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as C from '../engine/constants'
import { createGame, step } from '../engine/sim'
import { makeAI, type AiLevel } from '../engine/ai'
import { emptyInput, type GameEvent, type GameState, type Input, type PlayerId } from '../engine/types'
import { drawScene, type DrawOpts, type Hud, type Particle } from './draw'
import { sfx, setMuted, unlockAudio } from './sfx'
import TouchControls from './TouchControls'
import { joinRoom, type Room } from '../net/room'

export type Mode = 'cpu' | 'local2' | 'host' | 'guest'

const SNAP_EVERY = 2 // host broadcasts every 2 sim frames (~30Hz)
const GUEST_INPUT_HZ = 30

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export default function Arena({
  mode,
  code,
  aiLevel = 'normal',
  names,
  onQuit,
}: {
  mode: Mode
  code?: string
  aiLevel?: AiLevel
  names: { p1: string; p2: string }
  onQuit: () => void
}) {
  const [muted, setMutedState] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Inputs (device-local). inputA = this device's fighter; inputB = 2nd human.
  const inputA = useRef<Input>(emptyInput())
  const inputB = useRef<Input>(emptyInput())
  const remoteInput = useRef<Input>(emptyInput()) // host: guest's input → p2

  // Sim / snapshot state.
  const gsRef = useRef<GameState>(createGame())
  const latestSnap = useRef<GameState | null>(null)
  const displaySnap = useRef<GameState | null>(null)
  const aiRef = useRef(makeAI('p2', aiLevel))

  // Presentation.
  const particles = useRef<Particle[]>([])
  const hud = useRef<Hud>({ p1Shown: C.START_HP, p2Shown: C.START_HP })
  const shake = useRef({ t: 0, mag: 0 })
  const cam = useRef({ scale: 1, ox: 0, oy: 0, dpr: 1 })
  const namesRef = useRef(names)
  useEffect(() => {
    namesRef.current = names
  }, [names])

  // Net.
  const roomRef = useRef<Room | null>(null)
  const startedRef = useRef(mode === 'cpu' || mode === 'local2')
  const stepCount = useRef(0)
  const pendingEv = useRef<GameEvent[]>([])
  const guestSendAcc = useRef(0)

  const localSide: PlayerId | null = mode === 'guest' ? 'p2' : mode === 'local2' ? null : 'p1'

  // React overlay state (updated only when something changes).
  const [ui, setUi] = useState<{ phase: string; winner: PlayerId | null; conn: string | null }>({
    phase: 'intro',
    winner: null,
    conn: mode === 'host' ? `الكود: ${code} — بانتظار انضمام الخصم…` : mode === 'guest' ? 'جارٍ الاتصال بالمضيف…' : null,
  })
  const setConn = useCallback((conn: string | null) => {
    setUi((u) => (u.conn === conn ? u : { ...u, conn }))
  }, [])

  useEffect(() => setMuted(muted), [muted])

  // ---------------------------------------------------------------- FX -----
  const processEvent = useCallback((e: GameEvent) => {
    const spawn = (p: Partial<Particle> & { x: number; y: number }) => {
      particles.current.push({
        vx: 0,
        vy: 0,
        life: 0.5,
        maxLife: 0.5,
        size: 4,
        color: '#fff',
        kind: 'spark',
        ...p,
      })
    }
    switch (e.t) {
      case 'throw':
        if (e.super) sfx.superThrow()
        else sfx.throw()
        break
      case 'hit': {
        if (e.super) sfx.superHit()
        else sfx.hit()
        const n = e.super ? 22 : 12
        const col = e.super ? '#ffd93b' : '#ffffff'
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + Math.random()
          const sp = 120 + Math.random() * (e.super ? 340 : 200)
          spawn({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 60,
            life: 0.5,
            maxLife: 0.5,
            size: 2 + Math.random() * 3,
            color: i % 3 === 0 ? col : '#ff8a4d',
            kind: Math.random() < 0.4 ? 'star' : 'spark',
          })
        }
        spawn({ x: e.x, y: e.y, kind: 'ring', ring: e.super ? 90 : 55, life: 0.35, maxLife: 0.35, color: col })
        shake.current = { t: e.super ? 0.28 : 0.16, mag: e.super ? 18 : 9 }
        break
      }
      case 'jump':
        break
      case 'whiff':
        for (let i = 0; i < 6; i++)
          spawn({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, size: 2 + Math.random() * 2, color: '#cbb', life: 0.3, maxLife: 0.3, kind: 'dust' })
        break
      case 'ko':
        sfx.ko()
        break
      case 'roundStart':
        sfx.bell()
        break
      case 'matchEnd':
        sfx.bell()
        break
    }
  }, [])

  // ------------------------------------------------------- camera / resize -
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    canvas.width = Math.floor(cw * dpr)
    canvas.height = Math.floor(ch * dpr)
    canvas.style.width = cw + 'px'
    canvas.style.height = ch + 'px'
    const scale = Math.min(cw / C.ARENA_W, ch / C.ARENA_H)
    cam.current = {
      scale,
      ox: (cw - C.ARENA_W * scale) / 2,
      oy: (ch - C.ARENA_H * scale) / 2,
      dpr,
    }
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  // ----------------------------------------------------------- keyboard ----
  useEffect(() => {
    const setKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase()
      const code = e.code
      const a = inputA.current
      const b = inputB.current
      const isP1Letter = ['a', 'd', 'w', 's', 'f'].includes(k)
      const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(code)
      if (code === 'Space' || isArrow || k === 'j') e.preventDefault()

      if (mode === 'local2') {
        // P1 = WASD + F/Space ; P2 = Arrows + Enter/L
        if (code === 'KeyA') a.left = down
        if (code === 'KeyD') a.right = down
        if (code === 'KeyW') a.jump = down
        if (code === 'KeyS') a.crouch = down
        if (code === 'KeyF' || code === 'Space') a.attack = down
        if (code === 'ArrowLeft') b.left = down
        if (code === 'ArrowRight') b.right = down
        if (code === 'ArrowUp') b.jump = down
        if (code === 'ArrowDown') b.crouch = down
        if (code === 'Enter' || code === 'KeyL' || code === 'NumpadEnter') b.attack = down
        void isP1Letter
      } else {
        // Single human: accept both WASD and arrows.
        if (code === 'KeyA' || code === 'ArrowLeft') a.left = down
        if (code === 'KeyD' || code === 'ArrowRight') a.right = down
        if (code === 'KeyW' || code === 'ArrowUp') a.jump = down
        if (code === 'KeyS' || code === 'ArrowDown') a.crouch = down
        if (code === 'Space' || k === 'j' || k === 'k' || code === 'Enter') a.attack = down
      }
    }
    const down = (e: KeyboardEvent) => {
      unlockAudio()
      setKey(e, true)
    }
    const up = (e: KeyboardEvent) => setKey(e, false)
    const blur = () => {
      inputA.current = emptyInput()
      inputB.current = emptyInput()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [mode])

  // -------------------------------------------------------------- net ------
  useEffect(() => {
    if (mode !== 'host' && mode !== 'guest') return
    if (!code) return
    const room = joinRoom(code, mode === 'host' ? 'host' : 'guest', {
      onData: (event, payload) => {
        if (mode === 'host') {
          if (event === 'in') remoteInput.current = payload as Input
          else if (event === 'hi') {
            startedRef.current = true
            const nm = (payload as { name?: string })?.name
            if (nm) namesRef.current = { ...namesRef.current, p2: nm }
            room.send('welcome', { names: namesRef.current })
            setConn(null)
          }
        } else {
          if (event === 'snap') {
            const s = payload as GameState
            latestSnap.current = s
            if (!displaySnap.current) displaySnap.current = clone(s)
            for (const e of s.events) processEvent(e)
            setConn(null)
          } else if (event === 'welcome') {
            const nm = (payload as { names?: { p1: string; p2: string } })?.names
            if (nm) namesRef.current = nm
          }
        }
      },
      onPeerJoin: () => {
        if (mode === 'guest') room.send('hi', { name: namesRef.current.p2 })
        else setConn('اللاعب دخل، جارٍ البدء…')
      },
      onPeerLeave: () => {
        if (mode === 'host') {
          startedRef.current = false
          setConn('الخصم خرج من اللعبة')
        } else {
          setConn('انقطع الاتصال بالمضيف')
        }
      },
      onStatus: (status, detail) => {
        if (status === 'error') setConn(`تعذّر الاتصال (${detail ?? 'خطأ'})`)
      },
    })
    roomRef.current = room
    return () => {
      room.close()
      roomRef.current = null
    }
  }, [mode, code, setConn, processEvent])

  // ----------------------------------------------------------- game loop ---
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const updateParticles = (dt: number) => {
      const arr = particles.current
      for (const p of arr) {
        p.life -= dt
        if (p.kind !== 'ring') {
          p.vy += 900 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
        }
      }
      particles.current = arr.filter((p) => p.life > 0)
    }

    const doStep = () => {
      const gs = gsRef.current
      let inputs
      if (mode === 'cpu') inputs = { p1: inputA.current, p2: aiRef.current.think(gs) }
      else if (mode === 'local2') inputs = { p1: inputA.current, p2: inputB.current }
      else inputs = { p1: inputA.current, p2: remoteInput.current } // host
      step(gs, inputs)
      for (const e of gs.events) {
        processEvent(e)
        if (mode === 'host') pendingEv.current.push(e)
      }
      stepCount.current++
      if (mode === 'host' && roomRef.current && stepCount.current % SNAP_EVERY === 0) {
        const payload = { ...gs, events: pendingEv.current }
        roomRef.current.send('snap', payload)
        pendingEv.current = []
      }
    }

    const easeGuest = () => {
      const l = latestSnap.current
      const d = displaySnap.current
      if (!l || !d) return
      for (const id of ['p1', 'p2'] as PlayerId[]) {
        const df = d.fighters[id]
        const lf = l.fighters[id]
        const nx = df.x + (lf.x - df.x) * 0.4
        const ny = df.y + (lf.y - df.y) * 0.4
        d.fighters[id] = { ...lf, x: nx, y: ny }
      }
      const prev = new Map(d.slippers.map((s) => [s.id, s]))
      d.slippers = l.slippers.map((ls) => {
        const p = prev.get(ls.id)
        return p ? { ...ls, x: p.x + (ls.x - p.x) * 0.5, y: p.y + (ls.y - p.y) * 0.5 } : { ...ls }
      })
      d.frame = l.frame
      d.phase = l.phase
      d.phaseT = l.phaseT
      d.timeLeft = l.timeLeft
      d.round = l.round
      d.wins = l.wins
      d.winner = l.winner
      d.events = []
    }

    const render = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const state = mode === 'guest' ? displaySnap.current : gsRef.current
      const { scale, ox, oy, dpr } = cam.current

      // Letterbox background.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#0a0a12'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (!state) return

      // HUD chip decay toward real hp.
      const target = { p1: state.fighters.p1.hp, p2: state.fighters.p2.hp }
      const h = hud.current
      for (const id of ['p1', 'p2'] as PlayerId[]) {
        const key = id === 'p1' ? 'p1Shown' : 'p2Shown'
        if (h[key] > target[id]) h[key] = Math.max(target[id], h[key] - 45 * (1 / 60))
        else h[key] = target[id]
      }

      // Screen shake.
      let sx = 0
      let sy = 0
      if (shake.current.t > 0) {
        sx = (Math.random() - 0.5) * shake.current.mag
        sy = (Math.random() - 0.5) * shake.current.mag
      }

      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (ox + sx) * dpr, (oy + sy) * dpr)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, C.ARENA_W, C.ARENA_H)
      ctx.clip()
      const opts: DrawOpts = { localSide, names: namesRef.current }
      drawScene(ctx, state, particles.current, h, opts)
      ctx.restore()
    }

    const syncOverlay = () => {
      const state = mode === 'guest' ? latestSnap.current : gsRef.current
      if (!state) return
      const phase = state.phase
      const winner = state.winner
      setUi((u) => (u.phase === phase && u.winner === winner ? u : { ...u, phase, winner }))
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.2) dt = 0.2

      if (mode === 'cpu' || mode === 'local2' || (mode === 'host' && startedRef.current)) {
        let acc = dt
        // fixed timestep, capped to avoid spiral of death
        let iter = 0
        while (acc >= C.DT && iter < 6) {
          doStep()
          acc -= C.DT
          iter++
        }
      } else if (mode === 'guest') {
        easeGuest()
        guestSendAcc.current += dt
        if (guestSendAcc.current >= 1 / GUEST_INPUT_HZ && roomRef.current) {
          roomRef.current.send('in', inputA.current)
          guestSendAcc.current = 0
        }
      }

      if (shake.current.t > 0) shake.current.t -= dt
      updateParticles(dt)
      render()
      syncOverlay()
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mode, localSide, processEvent])

  // --------------------------------------------------------- restart -------
  const restart = () => {
    gsRef.current = createGame()
    aiRef.current = makeAI('p2', aiLevel)
    hud.current = { p1Shown: C.START_HP, p2Shown: C.START_HP }
    particles.current = []
    stepCount.current = 0
  }

  const showTouch = typeof window !== 'undefined' // render pads; harmless on desktop
  const matchOver = ui.phase === 'matchover'
  const canRematch = matchOver && mode !== 'guest'

  return (
    <div
      ref={wrapRef}
      onPointerDown={() => unlockAudio()}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0a12', touchAction: 'none' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, zIndex: 6, pointerEvents: 'none' }}>
        <button onClick={onQuit} style={topBtn}>‹ رجوع</button>
        <button onClick={() => setMutedState((m) => !m)} style={topBtn} aria-label="كتم الصوت">
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Connection / status overlay */}
      {ui.conn && (
        <div style={overlayBox}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{ui.conn}</div>
          {mode === 'host' && code && (
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 6, color: '#ffd93b' }}>{code}</div>
          )}
          {mode === 'host' && <div style={{ fontSize: 14, opacity: 0.8, marginTop: 8 }}>شارك هذا الكود مع صديقك ليكتبه في «انضمام بكود»</div>}
        </div>
      )}

      {/* Rematch */}
      {canRematch && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 130, display: 'flex', justifyContent: 'center', zIndex: 7 }}>
          <button onClick={restart} style={{ ...topBtn, fontSize: 20, padding: '12px 26px', background: '#ffd93b', color: '#1a1a2a' }}>
            لعبة جديدة ↻
          </button>
        </div>
      )}

      {/* Touch controls */}
      {showTouch && mode === 'local2' ? (
        <>
          <TouchControls inputRef={inputA} layout="left" onFirstTouch={unlockAudio} />
          <TouchControls inputRef={inputB} layout="right" onFirstTouch={unlockAudio} />
        </>
      ) : (
        showTouch && <TouchControls inputRef={inputA} layout="full" onFirstTouch={unlockAudio} />
      )}
    </div>
  )
}

const topBtn: React.CSSProperties = {
  pointerEvents: 'auto',
  border: 'none',
  borderRadius: 12,
  padding: '8px 16px',
  fontSize: 15,
  fontWeight: 700,
  color: '#fff',
  background: 'rgba(20,20,30,0.55)',
  backdropFilter: 'blur(4px)',
  cursor: 'pointer',
}

const overlayBox: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  color: '#fff',
  background: 'rgba(10,10,20,0.55)',
  backdropFilter: 'blur(3px)',
  zIndex: 8,
  padding: 20,
  fontFamily: 'system-ui, sans-serif',
}
