// @vitest-environment node
//
// Node env: this test spawns the build script as a child process and reads files
// — no DOM needed.

/**
 * build-static — the STATIC face multiplier writes the exact S3 object layout
 * (`<path>/index.{html,md,ttl,jsonld}`) for every real resource. We run it into a
 * temp dir and assert the files exist with correct content (REAL render, no mock),
 * so the static tier is provable WITHOUT any deploy (the gated follow-up).
 *
 * We invoke the build script as a child process (it is a top-level `main()`
 * script) into a throwaway OUT dir, then read the files back.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = mkdtempSync(join(tmpdir(), 'conneg-static-'))

// The WORKSPACE's own tsx (not `npx tsx`): resolved from this workspace so the
// esbuild lib/binary pair is the pnpm-linked one — `npx` can resolve a foreign
// tsx whose pinned esbuild binary clashes with the hoisted host version
// ("Host version 0.28.1 does not match binary version 0.21.5").
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')

afterAll(() => {
  rmSync(out, { recursive: true, force: true })
})

describe('build-static — writes the four-face S3 object layout', () => {
  it('produces index.{html,md,ttl,jsonld} for the catalog, items, and workspace', () => {
    execFileSync(process.execPath, [tsxCli, resolve(here, 'build-static.ts')], {
      cwd: resolve(here, '..'),
      env: { ...process.env, OUT: out, BASE_URL: 'https://example.test' },
      stdio: 'pipe',
    })

    // Catalog collection — all four faces (the B1 layout) + the .json alias.
    for (const ext of ['html', 'md', 'ttl', 'jsonld', 'json']) {
      expect(existsSync(join(out, 'catalog', `index.${ext}`)), `catalog/index.${ext}`).toBe(true)
    }
    // A component item.
    expect(existsSync(join(out, 'catalog', 'mn-top-bar', 'index.md'))).toBe(true)
    expect(existsSync(join(out, 'catalog', 'mn-top-bar', 'index.html'))).toBe(true)
    // The workspace.
    expect(existsSync(join(out, 'workspace', 'index.ttl'))).toBe(true)
    expect(existsSync(join(out, 'workspace', 'index.jsonld'))).toBe(true)
    // The EMPORIUM vocab catalogue + a vocab-pack item (all four faces).
    for (const ext of ['html', 'md', 'ttl', 'jsonld']) {
      expect(existsSync(join(out, 'emporium', `index.${ext}`)), `emporium/index.${ext}`).toBe(true)
    }
    expect(existsSync(join(out, 'emporium', 'workflow', 'index.md'))).toBe(true)
    expect(existsSync(join(out, 'emporium', 'workflow', 'index.ttl'))).toBe(true)

    // The written content is the REAL render (markdown title, turtle prefixes,
    // JSON-LD context) — and uses the build-time BASE_URL for links.
    const md = readFileSync(join(out, 'catalog', 'index.md'), 'utf8')
    expect(md).toContain('# Shrubbery Component Catalog')
    expect(md).toContain('https://example.test/catalog/mn-top-bar')

    const ttl = readFileSync(join(out, 'catalog', 'index.ttl'), 'utf8')
    expect(ttl).toContain('@prefix cat:')
    expect(ttl).toContain('a cat:Catalog')

    // The .jsonld face is the canonical JSON-LD; .json is a byte-identical alias.
    const jsonld = JSON.parse(readFileSync(join(out, 'catalog', 'index.jsonld'), 'utf8')) as Record<string, unknown>
    expect(jsonld['@context']).toBeDefined()
    expect(readFileSync(join(out, 'catalog', 'index.json'), 'utf8')).toBe(
      readFileSync(join(out, 'catalog', 'index.jsonld'), 'utf8'),
    )

    // The html face carries the FAIR Signposting links as <link> tags + the
    // markdown body (the dom shell), byte-shaped like the live server's html.
    const html = readFileSync(join(out, 'catalog', 'index.html'), 'utf8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<link rel="describedby"')
    expect(html).toContain('https://example.test/catalog.ttl')
  }, 60_000)
})
