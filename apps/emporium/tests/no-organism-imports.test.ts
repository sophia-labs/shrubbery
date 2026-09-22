/**
 * no-organism-imports.test.ts — the U10 grep-gate (design §5, D9).
 *
 * apps/emporium was the last external consumer of `@shrubbery/organism/cell/*`
 * (emporium-store, emporium-client via vocab-views, spawn-gardend in both
 * integration tests). U10 migrated the transport/store code to
 * `@shrubbery/source/emporium`, moved the pure DOM view (vocab-views.ts) into
 * this app, and repointed all four verified import sites. This test PINS that:
 * zero `@shrubbery/organism` import specifiers remain anywhere under
 * apps/emporium (src/ or tests/) — the surviving adapter-consumption
 * convention is @shrubbery/source.
 *
 * A real filesystem walk over the shipped/test sources (not a bundler
 * simulation, not a snapshot of a point-in-time grep run) — it re-checks on
 * every run, so a future accidental re-import of the organism cell fails
 * loudly here instead of silently reintroducing the retired convention.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOTS = [resolve(APP_DIR, 'src'), resolve(APP_DIR, 'tests')]

/** Import/export-from specifiers, static AND dynamic (both are a "consumer"). */
const SPECIFIER_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"();]*?from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkTsFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function organismSpecifiersIn(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const found: string[] = []
  let m: RegExpExecArray | null
  SPECIFIER_RE.lastIndex = 0
  while ((m = SPECIFIER_RE.exec(text)) !== null) {
    const spec = m[1] ?? m[2]
    if (spec && (spec === '@shrubbery/organism' || spec.startsWith('@shrubbery/organism/'))) {
      found.push(spec)
    }
  }
  return found
}

describe('U10 grep-gate: zero @shrubbery/organism import specifiers in apps/emporium', () => {
  const files = SCAN_ROOTS.flatMap(walkTsFiles)

  it('scans a non-trivial set of files (sanity: this app has source + tests)', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((f) => f.endsWith('shell.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('vocab-views.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('emporium-shell.integration.test.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('emporium-graph-view.integration.test.ts'))).toBe(true)
  })

  it('zero @shrubbery/organism import specifiers anywhere under src/ or tests/', () => {
    const offenders = files
      .map((f) => ({ file: f, specs: organismSpecifiersIn(f) }))
      .filter((r) => r.specs.length > 0)
    expect(offenders).toEqual([])
  })

  it('the migrated transport/store convention IS reachable (@shrubbery/source/emporium)', () => {
    const shellText = readFileSync(join(APP_DIR, 'src/shell.ts'), 'utf8')
    expect(shellText).toContain('@shrubbery/source/emporium')
  })
})
