// [SHABSHAB] CPU opponent. `makeAI(id, level)` returns a small stateful
// controller whose `think(state)` yields one frame of Input. It only runs on
// the host (single-player / local practice), so Math.random here is fine.
//
// Behaviour: hold a mid throwing range, duck under high slippers, hop over low
// ones, and mix quick throws with the occasional charged / golden-super shot.

import * as C from './constants'
import type { GameState, Input, PlayerId } from './types'
import { emptyInput } from './types'

export type AiLevel = 'easy' | 'normal' | 'hard'

interface Tuning {
  react: number // dodge reaction window (s) — bigger = smarter
  throwGap: number // min seconds between throw decisions
  aggression: number // 0..1 chance to throw when in range
  chargeChance: number // chance a throw is charged/heavy
}

const TUNING: Record<AiLevel, Tuning> = {
  easy: { react: 0.16, throwGap: 0.9, aggression: 0.5, chargeChance: 0.15 },
  normal: { react: 0.26, throwGap: 0.6, aggression: 0.7, chargeChance: 0.3 },
  hard: { react: 0.36, throwGap: 0.38, aggression: 0.9, chargeChance: 0.5 },
}

export interface Ai {
  think(state: GameState): Input
}

export function makeAI(id: PlayerId, level: AiLevel = 'normal'): Ai {
  const t = TUNING[level]
  let decisionCd = 0
  let throwHold = 0 // remaining seconds to keep the attack button held
  let jitter = 0 // re-rolled positional bias so movement isn't robotic
  let jitterCd = 0

  const PREFERRED = 430

  return {
    think(state: GameState): Input {
      const input = emptyInput()
      const self = state.fighters[id]
      const opp = state.fighters[id === 'p1' ? 'p2' : 'p1']
      if (state.phase !== 'fight' || self.hp <= 0 || self.hurtT > 0) {
        throwHold = 0
        return input
      }

      decisionCd = Math.max(0, decisionCd - C.DT)
      jitterCd -= C.DT
      if (jitterCd <= 0) {
        jitter = (Math.random() - 0.5) * 120
        jitterCd = 0.7 + Math.random() * 0.9
      }

      const dx = opp.x - self.x
      const adist = Math.abs(dx)
      const toOpp = dx >= 0 ? 1 : -1

      // --- Dodge incoming slippers -------------------------------------------
      let dodging = false
      for (const slip of state.slippers) {
        if (slip.owner === id) continue
        const towardMe = Math.sign(self.x - slip.x) === Math.sign(slip.vx)
        if (!towardMe) continue
        const gap = Math.abs(self.x - slip.x)
        const speed = Math.abs(slip.vx) || 1
        const eta = gap / speed
        if (gap < 340 && eta < t.react) {
          const high = slip.y < self.y - C.CROUCH_H
          if (high) input.crouch = true
          else if (self.onGround) input.jump = true
          dodging = true
          break
        }
      }

      // --- Movement: hold a comfortable throwing range -----------------------
      if (!dodging) {
        const target = PREFERRED + jitter
        if (adist > target + 70) {
          if (toOpp > 0) input.right = true
          else input.left = true
        } else if (adist < target - 70) {
          if (toOpp > 0) input.left = true
          else input.right = true
        }
      }

      // --- Attack ------------------------------------------------------------
      if (throwHold > 0) {
        input.attack = true
        throwHold -= C.DT
      } else if (
        !dodging &&
        decisionCd <= 0 &&
        self.throwCd <= 0 &&
        self.ammo > 0 &&
        adist > 160 &&
        adist < 760 &&
        Math.random() < t.aggression
      ) {
        const wantSuper = self.energy >= C.ENERGY_MAX && Math.random() < 0.6
        const wantCharge = wantSuper || Math.random() < t.chargeChance
        // Hold long enough to charge (or unleash super), else a quick tap.
        throwHold = wantSuper ? C.MAX_CHARGE + 0.1 : wantCharge ? 0.4 + Math.random() * 0.5 : 0.04
        decisionCd = t.throwGap + Math.random() * 0.3
      }

      return input
    },
  }
}
