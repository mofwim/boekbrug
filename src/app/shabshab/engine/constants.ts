// [SHABSHAB] Core tuning constants for the slipper-fighting engine.
// All positions/velocities are in a fixed LOGICAL 1280x720 arena that the
// renderer scales to fit any screen. The simulation runs at a fixed 60Hz so
// physics is identical on host and (replayed) client; see engine/sim.ts.

export const FPS = 60
export const DT = 1 / FPS

// Arena (logical). The canvas is letter-boxed to keep this 16:9 ratio.
export const ARENA_W = 1280
export const ARENA_H = 720
export const GROUND_Y = 600 // y of the floor line (fighters stand on this)
export const WALL_PAD = 40 // fighters can't walk past this from either edge

// Fighter body
export const FIGHTER_W = 66
export const STAND_H = 150
export const CROUCH_H = 92
export const HEAD_R = 26

// Movement
export const MOVE_SPEED = 380 // px/s horizontal run speed
export const JUMP_VY = -960 // initial jump velocity (up is negative)
export const GRAVITY = 2400 // px/s^2

// Slippers (projectiles)
export const SLIPPER_W = 58
export const SLIPPER_H = 26
export const THROW_SPEED = 820 // horizontal launch speed (normal)
export const THROW_UP = -230 // slight upward launch so it arcs
export const SUPER_SPEED = 1120
export const SUPER_UP = -140
export const SLIPPER_GRAVITY = 1500 // arc gravity for a thrown slipper

// Combat pacing
export const THROW_COOLDOWN = 0.42 // seconds between normal throws
export const MAX_CHARGE = 1.0 // hold-to-charge time for a heavy throw
export const AMMO_MAX = 5
export const AMMO_REGEN = 0.85 // seconds to regenerate one slipper

// Damage & feedback
export const DMG_NORMAL = 7
export const DMG_HEAVY = 13 // fully charged (non-super) throw
export const DMG_SUPER = 24
export const HURT_STUN = 0.34 // seconds of hitstun
export const KNOCKBACK_X = 300
export const KNOCKBACK_Y = -220
export const SUPER_KNOCKBACK_X = 520
export const SUPER_KNOCKBACK_Y = -360

// Evolution / energy meter
export const ENERGY_MAX = 100
export const ENERGY_ON_HIT = 22 // gained by the attacker landing a hit
export const ENERGY_ON_TAKE = 12 // gained by the victim (comeback mechanic)
export const ENERGY_REGEN = 3.5 // passive per second

// Match structure
export const START_HP = 100
export const ROUND_TIME = 60 // seconds
export const ROUNDS_TO_WIN = 2 // best of 3
export const ROUNDOVER_HOLD = 2.6 // seconds to show FINISH before next round
export const START_X_P1 = 360
export const START_X_P2 = ARENA_W - 360
