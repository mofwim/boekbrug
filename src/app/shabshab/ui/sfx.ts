// [SHABSHAB] Tiny WebAudio sound effects — synthesised on the fly so the game
// ships with zero audio assets. All calls are no-ops until the first user
// gesture unlocks the AudioContext (browsers block autoplay), and everything
// is guarded so it never throws on the server or in unsupported browsers.

let ctx: AudioContext | null = null
let muted = false

export function setMuted(m: boolean) {
  muted = m
}

export function unlockAudio() {
  if (typeof window === 'undefined') return
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) ctx = new AC()
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

function blip(freq: number, dur: number, type: OscillatorType, gain = 0.14, slideTo?: number) {
  if (muted || !ctx) return
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, gain = 0.2) {
  if (muted || !ctx) return
  const t0 = ctx.currentTime
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ctx.createBufferSource()
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
  src.buffer = buf
  src.connect(g).connect(ctx.destination)
  src.start(t0)
}

export const sfx = {
  throw: () => blip(520, 0.12, 'triangle', 0.1, 240),
  superThrow: () => {
    blip(300, 0.35, 'sawtooth', 0.14, 900)
    noise(0.18, 0.12)
  },
  hit: () => {
    blip(180, 0.09, 'square', 0.16, 90)
    noise(0.09, 0.18)
  },
  superHit: () => {
    blip(120, 0.28, 'square', 0.2, 60)
    noise(0.25, 0.28)
  },
  jump: () => blip(400, 0.1, 'sine', 0.08, 700),
  whiff: () => noise(0.05, 0.08),
  bell: () => {
    blip(880, 0.5, 'sine', 0.12)
    blip(1320, 0.5, 'sine', 0.06)
  },
  ko: () => blip(200, 0.6, 'sawtooth', 0.18, 40),
}
