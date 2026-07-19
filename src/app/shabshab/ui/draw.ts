// [SHABSHAB] All canvas rendering. Pure drawing from a GameState snapshot +
// a client-side particle list — no game logic here, so it works identically
// whether the state came from the local sim or a network snapshot.

import * as C from '../engine/constants'
import type { Fighter, GameState, PlayerId, Slipper } from '../engine/types'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  kind: 'spark' | 'star' | 'dust' | 'ring'
  ring?: number
}

export interface DrawOpts {
  localSide: PlayerId | null
  names: { p1: string; p2: string }
}

interface Palette {
  body: string
  bodyDark: string
  slipper: string
}

const PAL: Record<PlayerId, Palette> = {
  p1: { body: '#ff6b6b', bodyDark: '#d63a4f', slipper: '#c0392b' },
  p2: { body: '#4dabff', bodyDark: '#2b6cb0', slipper: '#2c6fbb' },
}

const ARABIC_FONT =
  '"Segoe UI", "Noto Sans Arabic", "Tahoma", system-ui, sans-serif'

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

// ---------------------------------------------------------------------------
// Background: a warm rooftop-at-dusk scene (the classic where slipper duels go
// down). Cheap gradients + silhouettes so it stays smooth on phones.
// ---------------------------------------------------------------------------
export function drawBackground(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, C.GROUND_Y)
  sky.addColorStop(0, '#2a1a4a')
  sky.addColorStop(0.45, '#7b3f7d')
  sky.addColorStop(0.8, '#e07a5f')
  sky.addColorStop(1, '#f2cc8f')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, C.ARENA_W, C.ARENA_H)

  // Sun/moon glow.
  const cx = C.ARENA_W * 0.5
  const cy = C.GROUND_Y - 120
  const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, 260)
  glow.addColorStop(0, 'rgba(255,240,200,0.9)')
  glow.addColorStop(1, 'rgba(255,240,200,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, C.ARENA_W, C.GROUND_Y)
  ctx.fillStyle = 'rgba(255,247,224,0.95)'
  ctx.beginPath()
  ctx.arc(cx, cy, 64, 0, Math.PI * 2)
  ctx.fill()

  // Distant building silhouettes (two parallax rows).
  ctx.fillStyle = 'rgba(40,25,60,0.55)'
  for (let i = 0; i < 9; i++) {
    const w = 120 + ((i * 53) % 80)
    const x = i * 150 - 40
    const h = 150 + ((i * 71) % 130)
    ctx.fillRect(x, C.GROUND_Y - h, w, h)
  }
  ctx.fillStyle = 'rgba(25,15,40,0.75)'
  for (let i = 0; i < 7; i++) {
    const w = 150 + ((i * 61) % 90)
    const x = i * 200 - 60
    const h = 90 + ((i * 47) % 90)
    ctx.fillRect(x, C.GROUND_Y - h, w, h)
    // lit windows
    ctx.fillStyle = 'rgba(255,214,120,0.5)'
    for (let wy = C.GROUND_Y - h + 14; wy < C.GROUND_Y - 12; wy += 26) {
      for (let wx = x + 12; wx < x + w - 12; wx += 26) {
        if ((wx * 7 + wy * 13 + i) % 3 === 0) ctx.fillRect(wx, wy, 8, 12)
      }
    }
    ctx.fillStyle = 'rgba(25,15,40,0.75)'
  }

  // Rooftop floor.
  const floor = ctx.createLinearGradient(0, C.GROUND_Y, 0, C.ARENA_H)
  floor.addColorStop(0, '#6b5b73')
  floor.addColorStop(1, '#3a3140')
  ctx.fillStyle = floor
  ctx.fillRect(0, C.GROUND_Y, C.ARENA_W, C.ARENA_H - C.GROUND_Y)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, C.GROUND_Y + 2)
  ctx.lineTo(C.ARENA_W, C.GROUND_Y + 2)
  ctx.stroke()
  // floor tile lines
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 2
  for (let x = 0; x < C.ARENA_W; x += 80) {
    ctx.beginPath()
    ctx.moveTo(x, C.GROUND_Y)
    ctx.lineTo(x - 40, C.ARENA_H)
    ctx.stroke()
  }
}

// ---------------------------------------------------------------------------
// A single cute fighter.
// ---------------------------------------------------------------------------
function drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, energyFull: boolean, frame: number) {
  const pal = PAL[f.id]
  const h = f.crouching && f.onGround ? C.CROUCH_H : C.STAND_H
  const flash = f.hurtT > 0 && Math.floor(frame / 3) % 2 === 0

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath()
  const shW = C.FIGHTER_W * (f.onGround ? 0.9 : 0.6)
  ctx.ellipse(f.x, C.GROUND_Y + 6, shW, 10, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.scale(f.facing, 1) // face right in local space, mirror by facing

  if (f.action === 'ko') {
    ctx.rotate(-Math.PI / 2.1) // topple over
    ctx.translate(-h * 0.4, -20)
  }

  const bodyW = C.FIGHTER_W
  const bodyTop = -h
  const legH = 26
  const torsoTop = bodyTop + C.HEAD_R * 1.7
  const torsoH = -legH - torsoTop // from torsoTop down to -legH

  // Legs.
  ctx.fillStyle = pal.bodyDark
  rr(ctx, -bodyW * 0.32, -legH, bodyW * 0.26, legH, 6)
  ctx.fill()
  rr(ctx, bodyW * 0.06, -legH, bodyW * 0.26, legH, 6)
  ctx.fill()

  // Torso.
  ctx.fillStyle = flash ? '#ffffff' : pal.body
  rr(ctx, -bodyW / 2, torsoTop, bodyW, torsoH, 16)
  ctx.fill()
  // belt / energy hint
  ctx.fillStyle = energyFull ? '#ffd93b' : pal.bodyDark
  rr(ctx, -bodyW / 2, -legH - 8, bodyW, 8, 4)
  ctx.fill()

  // Head.
  const headCy = bodyTop + C.HEAD_R
  ctx.fillStyle = flash ? '#ffffff' : '#ffe0bd'
  ctx.beginPath()
  ctx.arc(0, headCy, C.HEAD_R, 0, Math.PI * 2)
  ctx.fill()
  // headband
  ctx.fillStyle = pal.bodyDark
  rr(ctx, -C.HEAD_R, headCy - C.HEAD_R * 0.5, C.HEAD_R * 2, 9, 3)
  ctx.fill()
  // headband tails
  ctx.beginPath()
  ctx.moveTo(-C.HEAD_R, headCy - C.HEAD_R * 0.4)
  ctx.lineTo(-C.HEAD_R - 16, headCy - C.HEAD_R * 0.4 + (f.action === 'run' ? Math.sin(frame * 0.4) * 6 : 4))
  ctx.lineTo(-C.HEAD_R, headCy - C.HEAD_R * 0.1)
  ctx.fill()

  // Face (eyes look forward = toward opponent = +x local).
  ctx.fillStyle = '#2a2a2a'
  const eyeY = headCy + 2
  ctx.beginPath()
  ctx.arc(6, eyeY, 3.4, 0, Math.PI * 2)
  ctx.arc(16, eyeY, 3.4, 0, Math.PI * 2)
  ctx.fill()
  // blush
  ctx.fillStyle = 'rgba(255,120,120,0.5)'
  ctx.beginPath()
  ctx.arc(12, eyeY + 10, 4, 0, Math.PI * 2)
  ctx.fill()
  // mouth
  ctx.strokeStyle = '#2a2a2a'
  ctx.lineWidth = 2
  ctx.beginPath()
  if (f.action === 'hurt') ctx.arc(10, eyeY + 12, 4, Math.PI, 0)
  else ctx.arc(10, eyeY + 9, 4, 0, Math.PI)
  ctx.stroke()

  // Arm + held slipper. Raised when charging/throwing.
  const charging = f.charging
  const rC = Math.min(1, f.charge / C.MAX_CHARGE)
  const armAngle = f.action === 'throw' ? -1.4 : charging ? -0.6 - rC * 0.7 : f.action === 'win' ? -2.2 : -0.2
  ctx.save()
  ctx.translate(bodyW * 0.28, torsoTop + 14)
  ctx.rotate(armAngle)
  ctx.strokeStyle = flash ? '#ffffff' : pal.body
  ctx.lineWidth = 11
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(30, 0)
  ctx.stroke()
  // held slipper
  drawSlipperShape(ctx, 34, 0, 0, false, pal.slipper)
  // charge glow
  if (charging) {
    const g = ctx.createRadialGradient(34, 0, 2, 34, 0, 26 + rC * 20)
    const gold = f.energy >= C.ENERGY_MAX
    g.addColorStop(0, gold ? 'rgba(255,215,60,0.9)' : 'rgba(255,255,255,0.7)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(34, 0, 26 + rC * 22, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  ctx.restore()
}

// A flip-flop shape centred at (x,y), rotated by `spin`.
function drawSlipperShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  spin: number,
  isSuper: boolean,
  color: string
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(spin)
  if (isSuper) {
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, C.SLIPPER_W)
    g.addColorStop(0, 'rgba(255,240,150,0.95)')
    g.addColorStop(1, 'rgba(255,180,20,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, C.SLIPPER_W * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  // sole
  ctx.fillStyle = isSuper ? '#ffd93b' : color
  ctx.beginPath()
  ctx.ellipse(0, 0, C.SLIPPER_W / 2, C.SLIPPER_H / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  // inner sole highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.ellipse(-3, -3, C.SLIPPER_W / 3, C.SLIPPER_H / 3.4, 0, 0, Math.PI * 2)
  ctx.fill()
  // thong strap (the V)
  ctx.strokeStyle = isSuper ? '#b8860b' : 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-C.SLIPPER_W / 4, 0)
  ctx.lineTo(0, -2)
  ctx.lineTo(C.SLIPPER_W / 4, 0)
  ctx.stroke()
  ctx.restore()
}

function drawSlipper(ctx: CanvasRenderingContext2D, s: Slipper) {
  const pal = PAL[s.owner]
  // motion trail
  ctx.save()
  ctx.globalAlpha = 0.25
  drawSlipperShape(ctx, s.x - s.vx * 0.015, s.y - s.vy * 0.015, s.spin, s.super, pal.slipper)
  ctx.restore()
  drawSlipperShape(ctx, s.x, s.y, s.spin, s.super, pal.slipper)
}

// ---------------------------------------------------------------------------
// HUD: health, energy, round pips, timer, names, banners.
// ---------------------------------------------------------------------------
function healthColor(pct: number): string {
  if (pct > 0.5) return '#4ade80'
  if (pct > 0.25) return '#facc15'
  return '#ef4444'
}

// Smoothly displayed health (chip-away bar) is tracked by the caller.
export interface Hud {
  p1Shown: number
  p2Shown: number
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  hp: number,
  shown: number,
  energy: number,
  rightAligned: boolean
) {
  const H = 26
  // frame
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  rr(ctx, x - 3, y - 3, w + 6, H + 6, 6)
  ctx.fill()
  ctx.fillStyle = '#2b2b2b'
  rr(ctx, x, y, w, H, 4)
  ctx.fill()
  const pct = Math.max(0, hp / C.START_HP)
  const shownPct = Math.max(pct, shown / C.START_HP)
  // chip (recent damage) in white/orange
  ctx.fillStyle = '#f5c451'
  const cw = w * shownPct
  rr(ctx, rightAligned ? x + w - cw : x, y, cw, H, 4)
  ctx.fill()
  // current health
  ctx.fillStyle = healthColor(pct)
  const hw = w * pct
  rr(ctx, rightAligned ? x + w - hw : x, y, hw, H, 4)
  ctx.fill()
  // energy strip
  const eY = y + H + 4
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  rr(ctx, x, eY, w, 8, 3)
  ctx.fill()
  const ePct = Math.max(0, Math.min(1, energy / C.ENERGY_MAX))
  ctx.fillStyle = ePct >= 1 ? '#ffd93b' : '#8b5cf6'
  const ew = w * ePct
  rr(ctx, rightAligned ? x + w - ew : x, eY, ew, 8, 3)
  ctx.fill()
}

function drawPips(ctx: CanvasRenderingContext2D, x: number, y: number, wins: number, rightAligned: boolean) {
  for (let i = 0; i < C.ROUNDS_TO_WIN; i++) {
    const px = rightAligned ? x - i * 22 : x + i * 22
    ctx.beginPath()
    ctx.arc(px, y, 7, 0, Math.PI * 2)
    ctx.fillStyle = i < wins ? '#ffd93b' : 'rgba(255,255,255,0.25)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

function drawHud(ctx: CanvasRenderingContext2D, s: GameState, hud: Hud, opts: DrawOpts) {
  const margin = 28
  const barW = 440
  drawBar(ctx, margin, 30, barW, s.fighters.p1.hp, hud.p1Shown, s.fighters.p1.energy, false)
  drawBar(ctx, C.ARENA_W - margin - barW, 30, barW, s.fighters.p2.hp, hud.p2Shown, s.fighters.p2.energy, true)
  drawPips(ctx, margin + 6, 78, s.wins.p1, false)
  drawPips(ctx, C.ARENA_W - margin - 6, 78, s.wins.p2, true)

  // names
  ctx.font = `600 20px ${ARABIC_FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.fillText(opts.names.p1, margin, 22)
  ctx.textAlign = 'right'
  ctx.fillText(opts.names.p2, C.ARENA_W - margin, 22)

  // timer — sits in the free centre gap, below the top-bar buttons, on a badge
  const cx = C.ARENA_W / 2
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  rr(ctx, cx - 44, 66, 88, 54, 12)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.font = `800 44px ${ARABIC_FONT}`
  ctx.fillStyle = s.timeLeft <= 10 && s.phase === 'fight' ? '#ff6b6b' : '#fff'
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 4
  const tt = String(Math.ceil(s.timeLeft)).padStart(2, '0')
  ctx.strokeText(tt, cx, 104)
  ctx.fillText(tt, cx, 104)
}

function centerBanner(ctx: CanvasRenderingContext2D, text: string, sub: string, color: string, scale: number) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.translate(C.ARENA_W / 2, C.ARENA_H * 0.42)
  ctx.scale(scale, scale)
  ctx.font = `900 84px ${ARABIC_FONT}`
  ctx.lineWidth = 10
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  ctx.fillStyle = color
  ctx.strokeText(text, 0, 0)
  ctx.fillText(text, 0, 0)
  if (sub) {
    ctx.font = `700 30px ${ARABIC_FONT}`
    ctx.fillStyle = '#fff'
    ctx.strokeText(sub, 0, 44)
    ctx.fillText(sub, 0, 44)
  }
  ctx.restore()
}

function drawBanners(ctx: CanvasRenderingContext2D, s: GameState, opts: DrawOpts) {
  if (s.phase === 'intro') {
    const pop = 0.8 + Math.min(0.2, s.phaseT)
    centerBanner(ctx, `الجولة ${s.round}`, 'استعد…', '#ffd93b', pop)
  } else if (s.phase === 'fight' && s.phaseT < 0.9) {
    const a = 1 - s.phaseT / 0.9
    ctx.globalAlpha = a
    centerBanner(ctx, 'ابدأ!', '', '#4ade80', 1 + (1 - a) * 0.6)
    ctx.globalAlpha = 1
  } else if (s.phase === 'roundover') {
    const dead = s.fighters.p1.hp <= 0 || s.fighters.p2.hp <= 0
    centerBanner(ctx, dead ? 'قاضية!' : 'انتهى الوقت', '', dead ? '#ff6b6b' : '#ffd93b', 1)
  } else if (s.phase === 'matchover' && s.winner) {
    const name = opts.names[s.winner]
    const youWon = opts.localSide ? s.winner === opts.localSide : s.winner === 'p1'
    centerBanner(
      ctx,
      opts.localSide ? (youWon ? 'فزت! 🎉' : 'خسرت') : `فاز ${name}`,
      opts.localSide ? '' : '🎉',
      youWon ? '#ffd93b' : '#ff6b6b',
      1 + Math.min(0.15, s.phaseT * 0.3)
    )
    ctx.font = `600 22px ${ARABIC_FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText('اضغط "لعبة جديدة" للإعادة', C.ARENA_W / 2, C.ARENA_H * 0.42 + 90)
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, ps: Particle[]) {
  for (const p of ps) {
    const a = Math.max(0, p.life / p.maxLife)
    ctx.globalAlpha = a
    if (p.kind === 'ring') {
      ctx.strokeStyle = p.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(p.x, p.y, (p.ring ?? 0) * (1 - a) + 6, 0, Math.PI * 2)
      ctx.stroke()
    } else if (p.kind === 'star') {
      ctx.fillStyle = p.color
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.life * 6)
      ctx.fillRect(-p.size, -1.5, p.size * 2, 3)
      ctx.fillRect(-1.5, -p.size, 3, p.size * 2)
      ctx.restore()
    } else {
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  particles: Particle[],
  hud: Hud,
  opts: DrawOpts
) {
  drawBackground(ctx)
  // Fighters (draw the far one first is irrelevant on a flat stage).
  drawFighter(ctx, s.fighters.p1, s.fighters.p1.energy >= C.ENERGY_MAX, s.frame)
  drawFighter(ctx, s.fighters.p2, s.fighters.p2.energy >= C.ENERGY_MAX, s.frame)
  for (const slip of s.slippers) drawSlipper(ctx, slip)
  drawParticles(ctx, particles)
  drawHud(ctx, s, hud, opts)
  drawBanners(ctx, s, opts)
}
