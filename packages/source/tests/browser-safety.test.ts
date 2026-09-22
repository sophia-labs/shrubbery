/**
 * browser-safety.test.ts — walks the '.' barrel's STATIC import graph and
 * proves the browser-safe contract of @shrubbery/source:
 *
 *   1. no node builtin is statically imported anywhere in the graph (the
 *      sanctioned pattern for node:http / node:fs is a guarded DYNAMIC
 *      import — organism's loopback-mcp recipe — which never enters the
 *      browser bundle);
 *   2. external deps of '.' are @shrubbery/nucleus ONLY (in particular:
 *      vitest never leaks in — the conformance kit lives behind the
 *      './conformance' subpath);
 *   3. every relative import resolves to a real file (no dangling edges),
 *      and neither the node-only subpath (src/node/) nor the conformance
 *      kit (src/conformance/) is reachable from the barrel.
 *
 * This is a REAL walk over the shipped sources, not a bundler simulation:
 * the property enforced is exactly "no static `import ... from 'node:*'`
 * statement is reachable from src/index.ts".
 */

import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const ENTRY = resolve(SRC_DIR, 'index.ts')

const BUILTINS = new Set(builtinModules)

/** Static import/export-from specifiers (dynamic `import(...)` deliberately
 *  excluded — the guarded-dynamic pattern is the sanctioned node split). */
function staticSpecifiers(sourceText: string): string[] {
  const out: string[] = []
  // import ... from 'x' | export ... from 'x' | import 'x'
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"();]*?from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sourceText)) !== null) out.push(m[1])
  return out
}

interface WalkResult {
  files: string[]
  bareSpecifiers: string[]
}

function walkImportGraph(entry: string): WalkResult {
  const seen = new Set<string>()
  const bare: string[] = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf8') // throws loudly on a dangling edge
    for (const spec of staticSpecifiers(text)) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'))
        queue.push(target)
      } else {
        bare.push(spec)
      }
    }
  }
  return { files: [...seen], bareSpecifiers: bare }
}

describe("browser safety of the '.' barrel", () => {
  const walk = walkImportGraph(ENTRY)

  it('walks a non-trivial graph (sanity: the barrel has modules)', () => {
    expect(walk.files.length).toBeGreaterThan(5)
    expect(walk.files).toContain(resolve(SRC_DIR, 'boot.ts'))
    expect(walk.files).toContain(resolve(SRC_DIR, 'transport/mcp-client.ts'))
    expect(walk.files).toContain(resolve(SRC_DIR, 'fossil/fossil-source.ts'))
    expect(walk.files).toContain(resolve(SRC_DIR, 'store/source-store.ts'))
  })

  it('no node builtin leaks via a static import', () => {
    const nodeish = walk.bareSpecifiers.filter(
      s => s.startsWith('node:') || BUILTINS.has(s.split('/')[0]),
    )
    expect(nodeish).toEqual([])
  })

  it('external deps are @shrubbery/nucleus ONLY (no vitest, no DOM libs)', () => {
    const external = [...new Set(walk.bareSpecifiers)]
    const offenders = external.filter(
      s => s !== '@shrubbery/nucleus' && !s.startsWith('@shrubbery/nucleus/'),
    )
    expect(offenders).toEqual([])
  })

  it('neither the node-only subpath nor the conformance kit is reachable', () => {
    const reached = walk.files.filter(
      f => f.includes(`${SRC_DIR}/node/`) || f.includes(`${SRC_DIR}/conformance/`),
    )
    expect(reached).toEqual([])
  })
})
