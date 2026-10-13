// @vitest-environment node
/**
 * Shipped browser code never calls `crypto.randomUUID` or `crypto.subtle`
 * directly: both are missing on a plain-HTTP origin (the Sophia Resident
 * add-on's http://<host>.local:8100), where a bare call throws. It calls
 * `@shrubbery/nucleus/web-crypto` (`randomUUID`, `sha256Digest`), which falls
 * back when the browser withholds them.
 *
 * Scans the organism and flow sources and every package they ship. Tests and
 * Node-only modules (anything importing a `node:` builtin) are out of scope.
 * The vendored Flow tree is guarded by apps/flow/tests/vendor-crypto.test.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const HELPER = 'packages/nucleus/src/web-crypto.ts'
const ALLOWED = new Map([
  [HELPER, 'the helper: its native branches'],
  ['apps/flow/src/vendor-crypto.ts', 'build-time only (vite.config.ts): names the call in its error message'],
])
const SHIPPED_ROOTS = [
  'apps/organism/src',
  'apps/flow/src',
  ...readdirSync(join(root, 'packages')).map(name => `packages/${name}/src`),
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' || entry === 'node_modules' ? [] : sources(full)
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') ? [full] : []
  })
}

/** Code without comments (prose may name the calls); block comments keep their newlines so line numbers hold. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

describe('no bare crypto.randomUUID / crypto.subtle in shipped browser code', () => {
  it('every call goes through @shrubbery/nucleus/web-crypto', () => {
    const offenders: string[] = []
    for (const shipped of SHIPPED_ROOTS) {
      let files: string[]
      try { files = sources(join(root, shipped)) } catch { continue }
      for (const file of files) {
        const path = relative(root, file)
        if (ALLOWED.has(path)) continue
        const code = codeOnly(readFileSync(file, 'utf8'))
        if (/\bfrom\s+['"]node:/.test(code)) continue
        code.split('\n').forEach((line, index) => {
          if (/\bcrypto\??\.(randomUUID|subtle)\b/.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })

  it('the scan is real: it sees the helper’s own native calls', () => {
    expect(/\bcrypto\??\.(randomUUID|subtle)\b/.test(codeOnly(readFileSync(join(root, HELPER), 'utf8')))).toBe(true)
  })
})
