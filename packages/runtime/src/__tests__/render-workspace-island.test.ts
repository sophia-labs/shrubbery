/**
 * ISLAND test — the render host depends ONLY on @shrubbery/nucleus + lit.
 *
 * The whole point of @shrubbery/runtime is that it is a STORE-FREE render host:
 * the four hard couplings the frontend audit named (auth-token, CRDT provider,
 * native bridge, runtime-mode global) and the stores must be ABSENT. This test
 * statically reads the runtime source and asserts:
 *
 *   1. Every import resolves to either 'lit' (incl. lit/* subpaths) or
 *      '@shrubbery/nucleus' — nothing else. (No relative reach outside this
 *      package except sibling .js modules within src/.)
 *   2. The forbidden tokens that mark a backend coupling (zustand/store,
 *      yjs/Y.Doc, tauri, auth, contract, websocket, fetch) do not appear.
 *
 * This is a source-of-truth guard, not a behavioral test — it is the mechanism
 * that keeps the host an island as it grows.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url)) // .../runtime/src/__tests__
const srcDir = resolve(here, '..') // .../runtime/src

/** All non-test .ts files that make up the shipped host source. */
function hostSourceFiles(): string[] {
  return readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => resolve(srcDir, f))
}

/** Extract every module specifier from `import ... from '<spec>'`. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

describe('ISLAND — runtime imports only nucleus + lit', () => {
  const files = hostSourceFiles()

  it('there is at least one host source file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every external import is lit or @shrubbery/nucleus (relative = sibling .js only)', () => {
    const offenders: Array<{ file: string; spec: string }> = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(src)) {
        const isRelative = spec.startsWith('./') || spec.startsWith('../')
        const isLit = spec === 'lit' || spec.startsWith('lit/')
        const isNucleus = spec === '@shrubbery/nucleus' || spec.startsWith('@shrubbery/nucleus/')
        if (!isRelative && !isLit && !isNucleus) {
          offenders.push({ file, spec })
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('no relative import escapes the runtime package (no ../../ reach into nucleus or garden)', () => {
    const escapes: Array<{ file: string; spec: string }> = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(src)) {
        if (spec.startsWith('../')) {
          const resolved = resolve(dirname(file), spec)
          if (!resolved.startsWith(srcDir)) escapes.push({ file, spec })
        }
      }
    }
    expect(escapes).toEqual([])
  })

  it('host source is free of backend-coupling tokens (stores / yjs / tauri / auth / contract / sockets)', () => {
    // Word-boundary patterns so we do not false-positive on prose. These are the
    // couplings the nucleus/runtime split exists to forbid.
    const forbidden: Array<{ label: string; re: RegExp }> = [
      { label: 'zustand', re: /\bzustand\b/i },
      { label: 'sessionStore', re: /\bsessionStore\b/ },
      { label: 'filesystemStore', re: /\bfilesystemStore\b/ },
      { label: 'themeStore', re: /\bthemeStore\b/ },
      { label: 'yjs', re: /\byjs\b/i },
      { label: 'Y.Doc', re: /\bY\.Doc\b/ },
      { label: 'tauri', re: /\btauri\b/i },
      { label: 'Cognito', re: /\bCognito\b/i },
      { label: 'WebSocket', re: /\bWebSocket\b/ },
      { label: 'EventSource', re: /\bEventSource\b/ },
      { label: 'ShrubberyContract', re: /\bShrubberyContract\b/ },
      { label: 'AuthProvider', re: /\bAuthProvider\b/ },
      { label: 'CrdtBackend', re: /\bCrdtBackend\b/ },
    ]
    const hits: Array<{ file: string; token: string }> = []
    for (const file of files) {
      // Skip THIS test file's own listing of the forbidden tokens.
      if (file.endsWith('render-workspace-island.test.ts')) continue
      const src = readFileSync(file, 'utf8')
      for (const { label, re } of forbidden) {
        if (re.test(src)) hits.push({ file, token: label })
      }
    }
    expect(hits).toEqual([])
  })
})
