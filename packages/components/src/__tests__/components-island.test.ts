/**
 * ISLAND test — the components depend ONLY on lit, @shrubbery/nucleus contract
 * TYPES, and explicit pure visual dependencies. They NEVER reach a backend.
 *
 * The whole point of @shrubbery/components is that it is a backend-free CHROME
 * layer: it must NOT read stores, auth, tauri, yjs, REST, or the render host.
 * This test statically reads the component source and asserts:
 *
 *   1. Every import resolves to 'lit' (incl. lit/*), '@shrubbery/nucleus'
 *      (TYPES only), explicit pure visual deps, or a sibling .js inside this
 *      package — nothing else. In particular NOT '@shrubbery/runtime'
 *      (components must not depend on the host).
 *   2. The forbidden backend-coupling tokens (zustand/store, yjs/Y.Doc, tauri,
 *      Cognito, sockets, the contract concretes, ApiClient, the render host) do
 *      not appear.
 *
 * Source-of-truth guard, not a behavioural test — it keeps the chrome layer an
 * island as it grows.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url)) // .../components/src/__tests__
const srcDir = resolve(here, '..') // .../components/src

/** All non-test .ts files that make up the shipped component source (recursive). */
function componentSourceFiles(dir: string = srcDir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue // skip the test dir
      out.push(...componentSourceFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Extract every module specifier from `import ... from '<spec>'`. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

/**
 * Strip block + line comments so the forbidden-token scan tests EXECUTABLE code,
 * not the doc prose. Each component file documents exactly which couplings were
 * DROPPED in the lift (sessionStore, ThemeController, ApiClient, nativeBridge,
 * runtimeConfig, …); naming them in that explanation must not trip the guard.
 * The guard's job is to catch a real USE of a coupling, not its absence-note.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // // line  (avoid eating http:// in strings)
}

describe('ISLAND — components import only lit + nucleus(types) + pure visuals; never a backend', () => {
  const files = componentSourceFiles()

  it('there is at least one component source file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every external import is lit, lucide, three, fabric, or @shrubbery/nucleus (relative = sibling .js only)', () => {
    const offenders: Array<{ file: string; spec: string }> = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(src)) {
        const isRelative = spec.startsWith('./') || spec.startsWith('../')
        const isLit = spec === 'lit' || spec.startsWith('lit/')
        const isNucleus = spec === '@shrubbery/nucleus' || spec.startsWith('@shrubbery/nucleus/')
        // lucide is the icon system's PURE dependency (lit + lucide only): inline
        // SVG icon nodes, no stores/auth/tauri/host. Allowed alongside lit/nucleus.
        const isLucide = spec === 'lucide' || spec.startsWith('lucide/')
        // three is allowed only as a pure visual dependency for the Garden hero
        // WebGL surface. It is a rendering library, not a store/backend/client.
        // (mn-vtuber, the OTHER three consumer, moved to @shrubbery/atelier-vtuber
        // along with its @pixiv/three-vrm dependency — this package no longer
        // imports @pixiv/three-vrm at all.)
        const isThree = spec === 'three' || spec.startsWith('three/')
        // fabric is allowed only as a pure local canvas editing dependency for
        // mn-artifact-editor. Generation/save effects stay host-owned events.
        const isFabric = spec === 'fabric' || spec.startsWith('fabric/')
        if (!isRelative && !isLit && !isNucleus && !isLucide && !isThree && !isFabric) {
          offenders.push({ file, spec })
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('NEVER imports the render host (@shrubbery/runtime) — chrome must not depend on the host', () => {
    const hits: Array<{ file: string; spec: string }> = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(src)) {
        if (spec === '@shrubbery/runtime' || spec.startsWith('@shrubbery/runtime/')) {
          hits.push({ file, spec })
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('no relative import escapes the components package', () => {
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

  it('component source is free of backend-coupling tokens (stores / yjs / tauri / auth / sockets / host)', () => {
    const forbidden: Array<{ label: string; re: RegExp }> = [
      { label: 'zustand', re: /\bzustand\b/i },
      { label: 'sessionStore', re: /\bsessionStore\b/ },
      { label: 'filesystemStore', re: /\bfilesystemStore\b/ },
      { label: 'billingStore', re: /\bbillingStore\b/ },
      { label: 'apiCacheStore', re: /\bapiCacheStore\b/ },
      { label: 'globalStatusStore', re: /\bglobalStatusStore\b/ },
      { label: 'documentStore', re: /\bdocumentStore\b/ },
      { label: 'themeStore', re: /\bthemeStore\b/ },
      { label: 'ThemeController', re: /\bThemeController\b/ },
      { label: 'ApiClient', re: /\bApiClient\b/ },
      { label: 'yjs', re: /\byjs\b/i },
      { label: 'Y.Doc', re: /\bY\.Doc\b/ },
      { label: 'tauri', re: /\btauri\b/i },
      { label: 'nativeBridge', re: /\bnativeBridge\b/ },
      { label: 'Cognito', re: /\bCognito\b/i },
      { label: 'WebSocket', re: /\bWebSocket\b/ },
      { label: 'EventSource', re: /\bEventSource\b/ },
      { label: 'runtimeConfig', re: /\bruntimeConfig\b/ },
      { label: 'renderWorkspace', re: /\brenderWorkspace\b/ },
    ]
    const hits: Array<{ file: string; token: string }> = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const { label, re } of forbidden) {
        if (re.test(src)) hits.push({ file, token: label })
      }
    }
    expect(hits).toEqual([])
  })
})
