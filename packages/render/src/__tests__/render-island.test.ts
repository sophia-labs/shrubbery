/**
 * PURITY guard — @shrubbery/render is a PURE, Lit-free, DOM-free, network-free
 * library. The whole point (per the design) is that the SAME renderer code runs
 * in a Vite build hook (Node) and in the gardend cell — neither has a browser.
 *
 * This statically reads the shipped source and asserts:
 *   1. every external import is @shrubbery/nucleus or jsonld (the only deps) —
 *      NOT lit, NOT a DOM lib, NOT an http client.
 *   2. forbidden tokens that mark a UI/backend coupling are absent (lit, document,
 *      window, customElements, fetch, WebSocket, tauri, store).
 *
 * A source-of-truth guard, not a behavioral test — it keeps the package pure as
 * it grows (and is why the conneg dev server lives in apps/storybook, not here).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..')

function shippedSourceFiles(): string[] {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => resolve(srcDir, f))
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

describe('PURITY — render imports only nucleus + jsonld; no Lit / DOM / network', () => {
  const files = shippedSourceFiles()

  it('has shipped source files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every external import is @shrubbery/nucleus or jsonld (relative = sibling .js only)', () => {
    const offenders: Array<{ file: string; spec: string }> = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(src)) {
        const isRelative = spec.startsWith('./') || spec.startsWith('../')
        const isNucleus = spec === '@shrubbery/nucleus' || spec.startsWith('@shrubbery/nucleus/')
        const isJsonld = spec === 'jsonld'
        if (!isRelative && !isNucleus && !isJsonld) offenders.push({ file, spec })
      }
    }
    expect(offenders).toEqual([])
  })

  it('source is free of Lit / DOM / network / backend tokens', () => {
    const forbidden: Array<{ label: string; re: RegExp }> = [
      { label: 'lit-import', re: /from\s+['"]lit['"]/ },
      // DOM-global USE (not the English word "document" in a comment): a member
      // access on the actual global, e.g. `document.createElement`, `window.foo`.
      { label: 'document.<m>', re: /(?<![A-Za-z_.])document\.[A-Za-z]/ },
      { label: 'window.<m>', re: /(?<![A-Za-z_.])window\.[A-Za-z]/ },
      { label: 'customElements', re: /\bcustomElements\b/ },
      { label: 'fetch(', re: /\bfetch\s*\(/ },
      { label: 'WebSocket', re: /\bWebSocket\b/ },
      { label: 'tauri', re: /\btauri\b/i },
      { label: 'zustand', re: /\bzustand\b/i },
    ]
    const hits: Array<{ file: string; token: string }> = []
    for (const file of files) {
      if (file.endsWith('render-island.test.ts')) continue // this file lists them
      const src = readFileSync(file, 'utf8')
      for (const { label, re } of forbidden) {
        if (re.test(src)) hits.push({ file, token: label })
      }
    }
    expect(hits).toEqual([])
  })
})
