// [SHABSHAB] The pure, fixed-timestep fight simulation.
//
// `step(state, inputs)` advances the whole match by one 60Hz frame and mutates
// `state` in place (the caller owns the object). It is deterministic given the
// same inputs, which is what lets the netcode be host-authoritative: the host
// steps the sim and broadcasts the resulting GameState; the client just renders
// what it receives. Nothing here touches the DOM, canvas, or randomness during
// combat — AI (engine/ai.ts) is the only place Math.random is used, and it only
// runs on the host.

import * as C from './constants'
import type {
  Fighter,
  GameState,
  Input,
  Inputs,
  PlayerId,
  Slipper,
} from './types'

function makeFighter(id: PlayerId, x: number, facing: 1 | -1): Fighter {
  return {
    id,
    x,
    y: C.GROUND_Y,
    vx: 0,
    vy: 0,
    facing,
    hp: C.START_HP,
    energy: 0,
    onGround: true,
    crouching: false,
    action: 'idle',
    actionT: 0,
    throwCd: 0,
    charge: 0,
    charging: false,
    ammo: C.AMMO_MAX,
    ammoT: 0,
    hurtT: 0,
    invuln: 0,
    ready: false,
  }
}

export function createGame(): GameState {
  return {
    frame: 0,
    phase: 'intro',
    phaseT: 0,
    timeLeft: C.ROUND_TIME,
    round: 1,
    wins: { p1: 0, p2: 0 },
    fighters: {
      p1: makeFighter('p1', C.START_X_P1, 1),
      p2: makeFighter('p2', C.START_X_P2, -1),
    },
    slippers: [],
    events: [],
    nextSlipperId: 1,
    winner: null,
  }
}

// Reset both fighters for a fresh round while keeping match score.
function resetRound(s: GameState) {
  s.fighters.p1 = makeFighter('p1', C.START_X_P1, 1)
  s.fighters.p2 = makeFighter('p2', C.START_X_P2, -1)
  s.slippers = []
  s.timeLeft = C.ROUND_TIME
  s.phase = 'intro'
  s.phaseT = 0
}

function setAction(f: Fighter, a: Fighter['action']) {
  if (f.action !== a) {
    f.action = a
    f.actionT = 0
  }
}

// Current body height depends on stance — a shorter crouch box lets high
// slippers sail overhead (the "duck" dodge).
function bodyHeight(f: Fighter): number {
  return f.crouching && f.onGround ? C.CROUCH_H : C.STAND_H
}

function clampX(x: number): number {
  const min = C.WALL_PAD + C.FIGHTER_W / 2
  const max = C.ARENA_W - C.WALL_PAD - C.FIGHTER_W / 2
  return Math.max(min, Math.min(max, x))
}

function spawnThrow(s: GameState, f: Fighter) {
  const r = Math.max(0, Math.min(1, f.charge / C.MAX_CHARGE))
  const isSuper = f.energy >= C.ENERGY_MAX && r >= 0.85
  if (isSuper) f.energy = 0
  const speed = isSuper ? C.SUPER_SPEED : C.THROW_SPEED * (0.8 + 0.4 * r)
  const up = isSuper ? C.SUPER_UP : C.THROW_UP
  const dmg = isSuper ? C.DMG_SUPER : C.DMG_NORMAL + (C.DMG_HEAVY - C.DMG_NORMAL) * r
  const h = bodyHeight(f)
  const slip: Slipper = {
    id: s.nextSlipperId++,
    owner: f.id,
    x: f.x + f.facing * (C.FIGHTER_W / 2 + 10),
    y: f.y - h * 0.62,
    vx: f.facing * speed,
    vy: up,
    spin: 0,
    super: isSuper,
    dmg,
    alive: true,
  }
  s.slippers.push(slip)
  f.ammo -= 1
  f.throwCd = C.THROW_COOLDOWN
  f.charge = 0
  f.charging = false
  setAction(f, 'throw')
  s.events.push({ t: 'throw', who: f.id, super: isSuper })
}

// Advance a single fighter's control + physics for this frame.
function stepFighter(s: GameState, f: Fighter, opp: Fighter, input: Input, active: boolean) {
  f.actionT += C.DT
  if (f.throwCd > 0) f.throwCd -= C.DT
  if (f.invuln > 0) f.invuln -= C.DT
  if (f.energy < C.ENERGY_MAX) f.energy = Math.min(C.ENERGY_MAX, f.energy + C.ENERGY_REGEN * C.DT)
  // Ammo slowly regenerates up to the cap.
  if (f.ammo < C.AMMO_MAX) {
    f.ammoT += C.DT
    if (f.ammoT >= C.AMMO_REGEN) {
      f.ammo += 1
      f.ammoT = 0
    }
  }

  const stunned = f.hurtT > 0
  if (stunned) f.hurtT -= C.DT

  // Always face the opponent (classic fighter side-flip) while alive.
  if (f.x < opp.x) f.facing = 1
  else if (f.x > opp.x) f.facing = -1

  const canControl = active && !stunned && f.hp > 0

  if (canControl) {
    f.crouching = input.crouch && f.onGround
    // Charge / release the throw.
    if (input.attack) {
      if (!f.charging && f.throwCd <= 0 && f.ammo > 0) {
        f.charging = true
        f.charge = 0
      }
      if (f.charging) f.charge = Math.min(C.MAX_CHARGE * 1.15, f.charge + C.DT)
    } else if (f.charging) {
      spawnThrow(s, f)
    }

    // Horizontal movement — locked while crouching; slowed while charging.
    let move = 0
    if (!f.crouching) move = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    const speedMul = f.charging ? 0.45 : 1
    f.vx = move * C.MOVE_SPEED * speedMul

    // Jump.
    if (input.jump && f.onGround && !f.crouching) {
      f.vy = C.JUMP_VY
      f.onGround = false
      s.events.push({ t: 'jump', who: f.id })
    }
  } else {
    // No control: keep momentum, bleed horizontal speed when grounded.
    f.charging = false
    f.crouching = false
    if (f.onGround) f.vx *= 0.8
  }

  // Physics integration.
  f.vy += C.GRAVITY * C.DT
  f.x += f.vx * C.DT
  f.y += f.vy * C.DT
  f.x = clampX(f.x)

  if (f.y >= C.GROUND_Y) {
    f.y = C.GROUND_Y
    f.vy = 0
    f.onGround = true
  } else {
    f.onGround = false
  }

  // Animation state (throw anim holds briefly so the arm swing is visible).
  if (f.hp <= 0) setAction(f, 'ko')
  else if (stunned) setAction(f, 'hurt')
  else if (f.action === 'throw' && f.actionT < 0.22) {
    /* keep throw pose */
  } else if (!f.onGround) setAction(f, 'jump')
  else if (f.crouching) setAction(f, 'crouch')
  else if (Math.abs(f.vx) > 20) setAction(f, 'run')
  else setAction(f, 'idle')
}

// Keep the two bodies from occupying the same spot on the ground.
function separate(a: Fighter, b: Fighter) {
  if (!a.onGround || !b.onGround) return
  const dx = b.x - a.x
  const overlap = C.FIGHTER_W - Math.abs(dx)
  if (overlap > 0) {
    const push = (overlap / 2) * (dx >= 0 ? 1 : -1)
    a.x = clampX(a.x - push)
    b.x = clampX(b.x + push)
  }
}

function stepSlipper(s: GameState, slip: Slipper) {
  slip.vy += C.SLIPPER_GRAVITY * C.DT
  slip.x += slip.vx * C.DT
  slip.y += slip.vy * C.DT
  slip.spin += (slip.vx >= 0 ? 1 : -1) * 0.4

  const target = slip.owner === 'p1' ? s.fighters.p2 : s.fighters.p1
  if (target.hp > 0 && target.invuln <= 0) {
    const h = bodyHeight(target)
    const tLeft = target.x - C.FIGHTER_W / 2
    const tRight = target.x + C.FIGHTER_W / 2
    const tTop = target.y - h
    const tBottom = target.y
    const sLeft = slip.x - C.SLIPPER_W / 2
    const sRight = slip.x + C.SLIPPER_W / 2
    const sTop = slip.y - C.SLIPPER_H / 2
    const sBottom = slip.y + C.SLIPPER_H / 2
    const hit = sRight > tLeft && sLeft < tRight && sBottom > tTop && sTop < tBottom
    if (hit) {
      target.hp = Math.max(0, target.hp - slip.dmg)
      target.hurtT = slip.super ? C.HURT_STUN * 1.7 : C.HURT_STUN
      target.invuln = 0.28
      const dir = slip.vx >= 0 ? 1 : -1
      target.vx = dir * (slip.super ? C.SUPER_KNOCKBACK_X : C.KNOCKBACK_X)
      target.vy = slip.super ? C.SUPER_KNOCKBACK_Y : C.KNOCKBACK_Y
      target.onGround = false
      target.charging = false
      const attacker = slip.owner === 'p1' ? s.fighters.p1 : s.fighters.p2
      attacker.energy = Math.min(C.ENERGY_MAX, attacker.energy + C.ENERGY_ON_HIT)
      target.energy = Math.min(C.ENERGY_MAX, target.energy + C.ENERGY_ON_TAKE)
      s.events.push({ t: 'hit', who: target.id, x: slip.x, y: slip.y, super: slip.super, dmg: slip.dmg })
      slip.alive = false
      return
    }
  }

  // Died against the floor or flew off-screen.
  if (slip.y >= C.GROUND_Y + 10) {
    s.events.push({ t: 'whiff', x: slip.x, y: C.GROUND_Y })
    slip.alive = false
  } else if (slip.x < -80 || slip.x > C.ARENA_W + 80) {
    slip.alive = false
  }
}

function decideRoundWinner(s: GameState): PlayerId | null {
  const { p1, p2 } = s.fighters
  if (p1.hp <= 0 && p2.hp <= 0) return null // double KO → draw
  if (p1.hp <= 0) return 'p2'
  if (p2.hp <= 0) return 'p1'
  if (p1.hp > p2.hp) return 'p1'
  if (p2.hp > p1.hp) return 'p2'
  return null
}

export function step(s: GameState, inputs: Inputs): GameState {
  s.frame++
  s.events = []
  s.phaseT += C.DT

  const active = s.phase === 'fight'

  stepFighter(s, s.fighters.p1, s.fighters.p2, inputs.p1, active)
  stepFighter(s, s.fighters.p2, s.fighters.p1, inputs.p2, active)
  separate(s.fighters.p1, s.fighters.p2)

  for (const slip of s.slippers) stepSlipper(s, slip)
  if (s.slippers.some((x) => !x.alive)) s.slippers = s.slippers.filter((x) => x.alive)

  switch (s.phase) {
    case 'intro': {
      s.fighters.p1.ready = false
      s.fighters.p2.ready = false
      if (s.phaseT >= 1.2) {
        s.phase = 'fight'
        s.phaseT = 0
        s.fighters.p1.ready = true
        s.fighters.p2.ready = true
        s.events.push({ t: 'roundStart', round: s.round })
      }
      break
    }
    case 'fight': {
      s.timeLeft = Math.max(0, s.timeLeft - C.DT)
      const ko = s.fighters.p1.hp <= 0 || s.fighters.p2.hp <= 0
      const timeUp = s.timeLeft <= 0
      if (ko || timeUp) {
        const w = decideRoundWinner(s)
        if (w) s.wins[w] += 1
        s.phase = 'roundover'
        s.phaseT = 0
        const loser: PlayerId | null = w ? (w === 'p1' ? 'p2' : 'p1') : null
        s.events.push({ t: 'roundEnd', winner: w })
        if (loser) s.events.push({ t: 'ko', loser })
      }
      break
    }
    case 'roundover': {
      s.fighters.p1.ready = false
      s.fighters.p2.ready = false
      if (s.phaseT >= C.ROUNDOVER_HOLD) {
        if (s.wins.p1 >= C.ROUNDS_TO_WIN || s.wins.p2 >= C.ROUNDS_TO_WIN) {
          s.winner = s.wins.p1 > s.wins.p2 ? 'p1' : 'p2'
          s.phase = 'matchover'
          s.phaseT = 0
          setAction(s.fighters[s.winner], 'win')
          s.events.push({ t: 'matchEnd', winner: s.winner })
        } else {
          s.round += 1
          resetRound(s)
        }
      }
      break
    }
    case 'matchover': {
      const w = s.winner
      if (w) {
        setAction(s.fighters[w], 'win')
        setAction(s.fighters[w === 'p1' ? 'p2' : 'p1'], 'ko')
      }
      break
    }
  }

  return s
}
