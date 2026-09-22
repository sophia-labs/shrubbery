/**
 * stance-register-parity.test.ts — THREE-way stance-register equality (WS1 S1).
 *
 * The Stance vocabulary lives in three places that may not import each other
 * (tokens is dependency-free by design; nucleus must not depend on the
 * styling layer):
 *
 *   1. nucleus `STANCES` (the runtime register, exhaustiveness-checked
 *      against the `Stance` union at compile time),
 *   2. tokens `STANCE_APPLICATIONS` keys (the programmatic applier register),
 *   3. tokens `css/stance.css` `[data-stance=…]` selectors READ FROM DISK
 *      (the register the browser actually lights).
 *
 * Drift in ANY of the three fails here. Structural clone of
 * `kind-register-parity.test.ts`. Tokens is a devDependency of nucleus
 * (test-only — no runtime cross-import in either direction).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOM_POSTURE_STANCES as TOKENS_ROOM_POSTURE_STANCES, STANCE_APPLICATIONS } from '@shrubbery/tokens'
import { ROOM_POSTURE_STANCES, STANCES } from '../kinds/index.js'

const STANCE_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tokens/css/stance.css',
)

/** Every stance named by a `[data-stance="…"]` selector in stance.css, deduped. */
function stanceCssRegister(): string[] {
  const css = readFileSync(STANCE_CSS_PATH, 'utf8')
  const out = new Set<string>()
  for (const match of css.matchAll(/\[data-stance="([^"]+)"\]/g)) {
    out.add(match[1])
  }
  return [...out].sort()
}

describe('stance-register parity — STANCES ≡ STANCE_APPLICATIONS ≡ stance.css', () => {
  const nucleusRegister = [...STANCES].sort()
  const tokensRegister = Object.keys(STANCE_APPLICATIONS).sort()
  const cssRegister = stanceCssRegister()

  it('nucleus STANCES ≡ tokens STANCE_APPLICATIONS keys', () => {
    expect(tokensRegister).toEqual(nucleusRegister)
  })

  it('nucleus STANCES ≡ stance.css [data-stance=…] selectors (read from disk)', () => {
    expect(cssRegister).toEqual(nucleusRegister)
  })

  it('tokens STANCE_APPLICATIONS keys ≡ stance.css [data-stance=…] selectors', () => {
    expect(cssRegister).toEqual(tokensRegister)
  })

  it('each STANCE_APPLICATIONS entry stamps data-stance to its own literal', () => {
    for (const [stance, application] of Object.entries(STANCE_APPLICATIONS)) {
      expect(application.attr).toBe('data-stance')
      expect(application.value).toBe(stance)
      expect(application.literalValue).toBe(stance)
      expect(application.appliesAttribute).toBe(`[data-stance=${stance}]`)
    }
  })

  it('ROOM_POSTURE_STANCES ⊂ STANCES and excludes contested (nucleus and tokens agree)', () => {
    expect(new Set(STANCES).has('contested')).toBe(true)
    expect(ROOM_POSTURE_STANCES).not.toContain('contested')
    expect(TOKENS_ROOM_POSTURE_STANCES).not.toContain('contested')
    for (const stance of ROOM_POSTURE_STANCES) {
      expect(STANCES).toContain(stance)
    }
    expect([...ROOM_POSTURE_STANCES].sort()).toEqual([...TOKENS_ROOM_POSTURE_STANCES].sort())
  })
})
