/**
 * UNDEFINED-TOKEN LINT (review P0.1, design §9). NO MOCKS: it scans the real
 * token CSS and the real component sources in this repository.
 *
 * The incident. `mn-files-view` styled its focus ring, its selected border and
 * its folder glyph with `var(--mn-color-accent-primary, #49785a)`. No token file
 * defines `--mn-color-accent-primary`, so the literal fallback won in all ten
 * skin/theme combinations: a green rounded ring on navy 98, on purple Emporium
 * and on monochrome Mithras. `semantic.css` had already closed one "undefined
 * name debt" (lines 82–98) and it regressed. A fallback does not make a name
 * defined; it only hides that it is not. This test fails on that class.
 *
 * Three promises, three kinds of subject:
 *   1. The token layer is closed. Every name it reads, it defines.
 *   2. The Files surface (the stylesheets this campaign owns) has ZERO
 *      undefined references. No allowlist, ever.
 *   3. Everywhere else is a ratchet. The references that were already undefined
 *      when this test landed are recorded, each with its reason, in
 *      `undefined-token-debt.ts`. The register can only shrink: a new undefined
 *      reference fails, and so does a register entry that has been fixed and not
 *      removed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPO_ROOT, TOKEN_CSS_DIR, componentSources, declaredNames, referencesIn, stripComments,
  tokenLayerFiles, tokenLayerNames, undefinedReferences,
} from './token-reference-scan.js'
import { UNDEFINED_TOKEN_DEBT } from './undefined-token-debt.js'

/**
 * The Files surface, by path. A pattern, not a list of today's files, so a new
 * Files stylesheet is a subject the day it exists.
 */
const FILES_SURFACE: readonly RegExp[] = [
  // The one glyph, the list, the status line, the pane (waves 0, 4, 2).
  /^packages\/components\/src\/mn-files?-[\w-]+\.ts$/,
  // The Files tree. Shared with the rest of Garden, and the surface P0.2 repairs.
  /^packages\/components\/src\/mn-sidebar-panel\.ts$/,
  // The card plane.
  /^packages\/runtime\/src\/files-canvas\//,
  // The shell's Files pane (breadcrumbs, faces, list, preview, status line).
  /^packages\/runtime\/src\/files-pane\.ts$/,
]
const inFilesSurface = (file: string) => FILES_SURFACE.some(pattern => pattern.test(file))

const layer = tokenLayerNames()
const sources = componentSources()
const found = [...sources].flatMap(([file, source]) => undefinedReferences(file, source, layer))
const pair = (file: string, name: string) => `${file}  ${name}`
const describeRef = (ref: { file: string; line: number; name: string; hasFallback: boolean }) =>
  `${ref.file}:${ref.line}  ${ref.name}${ref.hasFallback ? '  (a fallback hides it)' : '  (no fallback)'}`

describe('undefined-token lint: the scanner itself', () => {
  const layerOf = (...names: string[]) => new Set(names)

  it('flags a name no token file and no part of the file defines, fallback or not', () => {
    const css = '.x { color: var(--mn-color-accent-primary, #49785a); border: 1px solid var(--mn-color-rule); }'
    const refs = undefinedReferences('x.ts', css, layerOf('--mn-color-rule'))
    expect(refs.map(r => [r.name, r.hasFallback])).toEqual([['--mn-color-accent-primary', true]])
  })

  it('accepts a name the token layer defines', () => {
    expect(undefinedReferences('x.ts', 'a { color: var(--mn-color-accent); }', layerOf('--mn-color-accent'))).toEqual([])
  })

  it('accepts a knob the same file declares (CSS or setProperty), and nothing another file declares', () => {
    const own = ':host { --mn-tile-gap: 4px } .x { gap: var(--mn-tile-gap); margin: var(--mn-other-knob, 0) }'
    expect(undefinedReferences('x.ts', own, layerOf()).map(r => r.name)).toEqual(['--mn-other-knob'])
    const viaScript = "el.style.setProperty('--mn-inset', '0px'); const css = 'top: var(--mn-inset)'"
    expect(undefinedReferences('x.ts', viaScript, layerOf())).toEqual([])
  })

  it('follows nested fallbacks and reports each undefined name on its own line', () => {
    const css = 'a {\n  color: var(--mn-missing-a, var(--mn-color-text-primary));\n  background: var(--mn-missing-b);\n}'
    const refs = undefinedReferences('x.ts', css, layerOf('--mn-color-text-primary'))
    expect(refs.map(r => [r.name, r.line, r.hasFallback])).toEqual([['--mn-missing-a', 2, true], ['--mn-missing-b', 3, false]])
  })

  it('ignores comments and dynamic names, but keeps line numbers true', () => {
    const source = [
      '/* var(--mn-in-block-comment) */',
      '// var(--mn-in-line-comment)',
      'const url = "https://example.com/a"; const css = `color: var(--mn-real-miss)`',
      // A name built at runtime (`--mn-tone-` + an expression) is not a reference the scanner can judge.
      ['const dynamic = `color: var(--mn-tone-', '$', '{tone})`'].join(''),
    ].join('\n')
    expect(referencesIn('x.ts', source).map(r => [r.name, r.line])).toEqual([['--mn-real-miss', 3]])
    expect(stripComments('a /* b\nc */ d').split('\n')).toHaveLength(2)
    expect(declaredNames('/* --mn-ghost: 1 */ :root { --mn-live: 2 }')).toEqual(new Set(['--mn-live']))
  })
})

describe('undefined-token lint: the token layer is closed', () => {
  it('reads a name only if the layer defines it', () => {
    const own = tokenLayerFiles().flatMap(file => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      return referencesIn(file, source).filter(ref => !layer.has(ref.name))
    })
    expect(own.map(describeRef)).toEqual([])
  })

  it('imports every CSS file in its directory, so no definition is orphaned', () => {
    const imported = new Set(tokenLayerFiles().map(file => file.slice(TOKEN_CSS_DIR.length + 1)))
    const onDisk = readdirSync(join(REPO_ROOT, TOKEN_CSS_DIR)).filter(name => name.endsWith('.css') && name !== 'tokens.css')
    expect(onDisk.filter(name => !imported.has(name))).toEqual([])
  })
})

describe('undefined-token lint: the Files surface has zero undefined references', () => {
  it('has subjects: the stylesheets this campaign owns are in scope', () => {
    const subjects = [...sources.keys()].filter(inFilesSurface)
    for (const expected of [
      'packages/components/src/mn-file-glyph.ts',
      'packages/components/src/mn-sidebar-panel.ts',
      'packages/runtime/src/files-canvas/files-canvas-host.ts',
      'packages/runtime/src/files-pane.ts',
    ]) expect(subjects, `${expected} must be a subject of the lint`).toContain(expected)
  })

  it('reads only names the token layer or the file itself defines', () => {
    const bad = found.filter(ref => inFilesSurface(ref.file))
    expect(bad.map(describeRef)).toEqual([])
  })

  it('has no entry in the debt register', () => {
    const registered = Object.keys(UNDEFINED_TOKEN_DEBT).filter(inFilesSurface)
    expect(registered).toEqual([])
  })
})

describe('undefined-token lint: everywhere else is a ratchet', () => {
  const current = new Set(found.filter(ref => !inFilesSurface(ref.file)).map(ref => pair(ref.file, ref.name)))
  const registered = new Set(Object.entries(UNDEFINED_TOKEN_DEBT).flatMap(([file, names]) =>
    Object.keys(names).map(name => pair(file, name))))

  it('gains no new undefined reference', () => {
    const added = found.filter(ref => !inFilesSurface(ref.file) && !registered.has(pair(ref.file, ref.name)))
    expect(added.map(describeRef),
      'define the token, read an existing role, or declare the knob in the component; a register entry needs a reason').toEqual([])
  })

  it('loses no fixed reference silently: a register entry that is no longer a violation must be removed', () => {
    expect([...registered].filter(entry => !current.has(entry))).toEqual([])
  })
})
