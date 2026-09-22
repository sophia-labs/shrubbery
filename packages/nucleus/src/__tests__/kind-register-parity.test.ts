/**
 * kind-register-parity.test.ts — THREE-way kind-register equality (R4a).
 *
 * The DisplayKind vocabulary lives in three places that may not import each
 * other (tokens is dependency-free by design; nucleus must not depend on the
 * styling layer):
 *
 *   1. nucleus `DISPLAY_KINDS` (the runtime register, exhaustiveness-checked
 *      against the `DisplayKind` union at compile time),
 *   2. tokens `KIND_APPLICATIONS` keys (the programmatic applier register),
 *   3. tokens `css/kind.css` `.mn-kind[data-kind=…]` selectors READ FROM DISK
 *      (the register the browser actually lights).
 *
 * Drift in ANY of the three fails here. Tokens is a devDependency of nucleus
 * (test-only — no runtime cross-import in either direction; hex-agreement-test
 * precedent).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KIND_APPLICATIONS } from '@shrubbery/tokens'
import { DISPLAY_KINDS } from '../kinds/index.js'

const KIND_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tokens/css/kind.css',
)

/** Every kind named by a `.mn-kind[data-kind="…"]` selector in kind.css, deduped. */
function kindCssRegister(): string[] {
  const css = readFileSync(KIND_CSS_PATH, 'utf8')
  const out = new Set<string>()
  for (const match of css.matchAll(/\.mn-kind\[data-kind="([^"]+)"\]/g)) {
    out.add(match[1])
  }
  return [...out].sort()
}

describe('kind-register parity — DISPLAY_KINDS ≡ KIND_APPLICATIONS ≡ kind.css', () => {
  const nucleusRegister = [...DISPLAY_KINDS].sort()
  const tokensRegister = Object.keys(KIND_APPLICATIONS).sort()
  const cssRegister = kindCssRegister()

  it('nucleus DISPLAY_KINDS ≡ tokens KIND_APPLICATIONS keys', () => {
    expect(tokensRegister).toEqual(nucleusRegister)
  })

  it('nucleus DISPLAY_KINDS ≡ kind.css [data-kind=…] selectors (read from disk)', () => {
    expect(cssRegister).toEqual(nucleusRegister)
  })

  it('tokens KIND_APPLICATIONS keys ≡ kind.css [data-kind=…] selectors', () => {
    expect(cssRegister).toEqual(tokensRegister)
  })

  it('each KIND_APPLICATIONS entry stamps data-kind to its own literal', () => {
    for (const [kind, application] of Object.entries(KIND_APPLICATIONS)) {
      expect(application.attr).toBe('data-kind')
      expect(application.value).toBe(kind)
      expect(application.literalValue).toBe(kind)
      expect(application.appliesAttribute).toBe(`[data-kind=${kind}]`)
    }
  })
})
