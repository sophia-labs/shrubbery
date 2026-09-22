/**
 * view-transition-navigation.test.ts — asserts the cross-document View
 * Transition fix (index.html's `@view-transition` block) actually ships in
 * the production bundle, not just the source file, and stays scoped to the
 * SPA entry it targets.
 *
 * CONTEXT: the workspace ↔ settings/chat/legal/auth/ops-health/choreograph
 * boundary in this app is a real, same-origin, full-page browser navigation
 * (`window.location.assign`/`.replace` in `src/main.ts`'s `mn-settings-toggle`
 * handler, `onAuthSuccess`, and `bootOrganismAppRoute`'s `onClose`) — not an
 * in-SPA route swap. The browser's default behavior for that kind of
 * navigation is a blank white flash between the old document's teardown and
 * the new document's first paint. `@view-transition { navigation: auto; }`
 * opts every load of this file into the UA's default cross-fade instead,
 * with a `prefers-reduced-motion` guard that drops the animation (not the
 * navigation) for reduced-motion users.
 *
 * WHAT THIS TEST CAN AND CANNOT PROVE: this is a real `vite build()` (the
 * same idiom `production-mpa-smoke.test.ts` in this directory already
 * established) read back off disk — it proves the declarations are present,
 * syntactically intact, and survive the real production build unminified/
 * unmangled. It does NOT and CANNOT prove the crossfade actually renders, or
 * that it looks right, or that it fixes the reported white flash in a real
 * browser. Cross-document View Transitions have no observable effect a test
 * runner can exercise (no real cross-document navigation, no real
 * compositor/paint), and this repo has no headed-browser visual-diff
 * harness. That visual result is UNVERIFIED — see the morning handoff doc
 * for what a human needs to confirm by hand in a real browser.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Strip CSS comments and collapse whitespace so brace/formatting drift can't break the assertion. */
function normalizeCss(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
}

describe('cross-document View Transition CSS ships in the built index.html', () => {
  let outDir: string
  let indexHtml: string
  let observatoryHtml: string

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'organism-vt-build-'))
    await build({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true },
    })
    indexHtml = readFileSync(join(outDir, 'index.html'), 'utf8')
    observatoryHtml = readFileSync(join(outDir, 'observatory.html'), 'utf8')
  }, 180_000)

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  it('opts every load of the SPA entry into the default cross-document crossfade', () => {
    const normalized = normalizeCss(indexHtml)
    expect(normalized).toContain('@view-transition { navigation: auto; }')
  })

  it('guards the animation (not the navigation) for prefers-reduced-motion', () => {
    const normalized = normalizeCss(indexHtml)
    expect(normalized).toContain(
      '@media (prefers-reduced-motion: reduce) { '
      + '::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { '
      + 'animation: none !important; } }',
    )
  })

  it('does not leak the rule into the separate observatory.html production entry', () => {
    // observatory.html is a distinct hosted dashboard, not part of the
    // workspace ↔ settings/chat/legal/auth navigation family this fix
    // targets — keeping the fix scoped to index.html is deliberate.
    expect(observatoryHtml).not.toMatch(/@view-transition/)
  })
})
