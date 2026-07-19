// [SHABSHAB] Shared game types. The whole GameState is plain JSON so it can be
// broadcast verbatim over Supabase Realtime in the host-authoritative netcode.

export type PlayerId = 'p1' | 'p2'
export type Facing = 1 | -1

export type FighterAction =
  | 'idle'
  | 'run'
  | 'jump'
  | 'crouch'
  | 'throw'
  | 'hurt'
  | 'ko'
  | 'win'

export interface Fighter {
  id: PlayerId
  x: number // center x of the body
  y: number // feet y (bottom of the body, sits on GROUND_Y)
  vx: number
  vy: number
  facing: Facing
  hp: number
  energy: number // 0..ENERGY_MAX, unlocks the golden super
  onGround: boolean
  crouching: boolean
  action: FighterAction
  actionT: number // seconds spent in current action (for animation)
  throwCd: number // remaining throw cooldown (s)
  charge: number // current hold time on the throw button (s); 0 when not charging
  charging: boolean
  ammo: number
  ammoT: number // regen timer accumulator (s)
  hurtT: number // remaining hitstun (s)
  invuln: number // remaining invulnerability (s)
  ready: boolean // false during round intro / roundover
}

export interface Slipper {
  id: number
  owner: PlayerId
  x: number
  y: number
  vx: number
  vy: number
  spin: number // visual rotation (radians)
  super: boolean
  dmg: number
  alive: boolean
}

// Transient, one-frame events the renderer turns into sparks / shakes / sounds.
export type GameEvent =
  | { t: 'throw'; who: PlayerId; super: boolean }
  | { t: 'hit'; who: PlayerId; x: number; y: number; super: boolean; dmg: number }
  | { t: 'block' | 'whiff'; x: number; y: number }
  | { t: 'jump'; who: PlayerId }
  | { t: 'ko'; loser: PlayerId }
  | { t: 'roundStart'; round: number }
  | { t: 'roundEnd'; winner: PlayerId | null }
  | { t: 'matchEnd'; winner: PlayerId }

export type GamePhase = 'intro' | 'fight' | 'roundover' | 'matchover'

export interface GameState {
  frame: number
  phase: GamePhase
  phaseT: number // seconds spent in the current phase
  timeLeft: number // round clock (s)
  round: number // 1-based
  wins: { p1: number; p2: number }
  fighters: { p1: Fighter; p2: Fighter }
  slippers: Slipper[]
  events: GameEvent[] // cleared and refilled every step
  nextSlipperId: number
  winner: PlayerId | null // match winner once phase === 'matchover'
}

// One player's raw controls for a single frame. `throw` is the raw button;
// the sim edge-detects press/release from the previous frame's held state.
export interface Input {
  left: boolean
  right: boolean
  jump: boolean
  crouch: boolean
  attack: boolean // throw button held
}

export interface Inputs {
  p1: Input
  p2: Input
}

export function emptyInput(): Input {
  return { left: false, right: false, jump: false, crouch: false, attack: false }
}
