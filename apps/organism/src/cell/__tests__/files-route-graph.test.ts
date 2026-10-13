/**
 * The Files route's static import graph never reaches Excalidraw (design §14, wave 4): the folder canvas is DOM and the
 * house engine, and the drawing editor loads only where a drawing is opened. Walks the real sources, type-only imports
 * excluded (they are erased).
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const ALIASES: Record<string, string> = {
  '@shrubbery/nucleus/files-canvas': 'packages/nucleus/src/workspace/files-canvas/index.ts',
  '@shrubbery/nucleus/roving-toolbar': 'packages/nucleus/src/roving-toolbar.ts',
  '@shrubbery/nucleus/web-crypto': 'packages/nucleus/src/web-crypto.ts',
}

function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) if (!m[1]) out.push(m[2]!)
  return out
}

function reach(entries: readonly string[]): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>(); const bare = new Set<string>()
  const queue = entries.map(e => resolve(root, e))
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file) || !existsSync(file)) continue
    files.add(file)
    for (const spec of staticImports(file)) {
      if (spec.startsWith('.')) {
        const base = resolve(dirname(file), spec.replace(/\.js$/, ''))
        queue.push(...[`${base}.ts`, resolve(base, 'index.ts')].filter(existsSync))
      } else if (ALIASES[spec]) queue.push(resolve(root, ALIASES[spec]!))
      else bare.add(spec)
    }
  }
  return { files, bare }
}

describe('the Files route imports', () => {
  it('never reach Excalidraw statically', () => {
    const { files, bare } = reach([
      'packages/runtime/src/files-pane.ts',
      'packages/runtime/src/files-canvas/files-canvas-host.ts',
      'packages/nucleus/src/workspace/files-canvas/index.ts',
      'apps/organism/src/cell/files-shell.ts',
    ])
    expect(files.size).toBeGreaterThan(10)       // the walk really walked
    expect([...files].filter(f => /excalidraw/i.test(f))).toEqual([])
    expect([...bare].filter(s => /excalidraw/i.test(s))).toEqual([])
  })

  it('never reach the viewers\' heavy parts statically (Word, spreadsheets, grammars, Markdown load when a file opens)', () => {
    const { files, bare } = reach(['packages/runtime/src/files-pane.ts', 'apps/organism/src/cell/files-shell.ts'])
    // The registry and the text sniff are on the route (they decide the viewer); the viewers themselves are not.
    expect([...files].some(f => f.endsWith('files-viewers/registry.ts'))).toBe(true)
    expect([...files].filter(f => /files-viewers\/(render|docx|sheet|highlight)\.ts$/.test(f))).toEqual([])
    expect([...bare].filter(s => /^(mammoth|xlsx|lowlight|highlight\.js|marked)(\/|$)/.test(s))).toEqual([])
  })
})
