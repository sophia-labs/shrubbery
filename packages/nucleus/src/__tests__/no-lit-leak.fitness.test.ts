import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * FITNESS FUNCTION — the pure RDF->config pipeline stays Lit/DOM/CRDT-free.
 *
 * WHY this exists: nucleus is "a pure RDF->UI interpreter". But "pure" is only
 * enforced by convention today, and a directory layout is not an isolation
 * boundary — nothing stops someone `import`ing `lit` into the codec the way
 * interpreter.ts already does (it legitimately imports lit/static-html for the
 * stamp path; UiServices.icon also returns a Lit TemplateResult). So a blanket
 * "nucleus has zero Lit" claim is FALSE and we deliberately do NOT assert it.
 *
 * What IS true — and what this test ratchets — is that the SEMANTIC pipeline
 * modules (the RDF codec, the config types, the config validator, and the whole
 * Phase-1 layout solver family) parse/validate/solve over plain data and reach
 * for NO renderer, DOM, or CRDT dependency. Keeping these Lit-free is what lets
 * the same config be validated on the read path (session-store), rendered on a
 * server (planter/source), or diffed in a golden test without dragging a DOM in.
 *
 * If a future edit leaks `lit` (or react/yjs/a component package) directly into
 * one of these files, CI fails HERE with a named file + specifier, instead of
 * the coupling silently deepening. This scans each file's own import statements
 * (a direct-import boundary): the allowlisted files below currently import only
 * each other's sibling pure modules — verified module-by-module — so a forbidden
 * specifier appearing in any of them is a real new coupling, not transitive noise.
 */

// Resolved relative to this test file (src/__tests__/). Kept EXPLICIT rather than
// glob-discovered: the whole point is a curated roster of "must stay pure" files
// whose membership is a reviewed decision. interpreter.ts is intentionally ABSENT
// — it is the renderer-coupled stamp layer and is allowed to import lit.
const PURE_PIPELINE_FILES = [
  // RDF codec: term/triple model + N-Triples parse/serialize. Zero imports today.
  '../workspace/rdf-model.ts',
  // sux: <-> WorkspaceConfig projection. Imports only ./types + ./rdf-model.
  '../workspace/ux-rdf.ts',
  // WorkspaceConfig shape. Pure type + guard module, zero imports.
  '../workspace/types.ts',
  // Config invariants (I1/I2/I3/I5/I6), incl. the acyclic-spine brick-stopper.
  // Imports only ./types + ./known-components (both themselves zero-import).
  '../workspace/validate.ts',
  // Phase-1 layout solver family — a self-contained module set that, per its own
  // handoff note, imports nothing outside src/layout/*.ts.
  '../layout/types.ts',
  '../layout/diagnostics.ts',
  '../layout/immutable.ts',
  '../layout/validate.ts',
  '../layout/solver.ts',
  '../layout/operations.ts',
] as const

// Forbidden module specifiers. A specifier is rejected if it EQUALS one of these
// or is a subpath of it (`lit` also bans `lit/static-html.js`, `lit/directives/*`).
// Each entry names a coupling the semantic pipeline must never take on directly.
const FORBIDDEN_SPECIFIERS = [
  'lit', // the renderer — TemplateResult/html/unsafeStatic belong to the stamp layer, not the codec
  'lit-html', // ditto, the standalone template engine
  'lit-element', // ditto, the base element
  '@lit/reactive-element', // ditto, Lit's reactivity core
  'react', // no alternate renderer sneaking in either
  'react-dom',
  'yjs', // CRDT/persistence — config is plain data; sync lives above this layer
  'y-protocols',
  '@shrubbery/components', // the web-component library (custom elements = DOM)
  '@shrubbery/runtime', // the host/render runtime (render-workspace, host-lift)
] as const

// Bare DOM-global type packages are also a smell in a "plain data" module.
const FORBIDDEN_SPECIFIERS_EXACT = ['@types/react', '@types/react-dom'] as const

/** Extract every module specifier a source file references (static, side-effect, dynamic, require). */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import x from '...' / export ... from '...'
    /\bimport\s+['"]([^'"]+)['"]/g, // side-effect: import '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic: import('...')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...')
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) specifiers.push(m[1])
  }
  return specifiers
}

function isForbidden(specifier: string): string | null {
  for (const banned of FORBIDDEN_SPECIFIERS) {
    if (specifier === banned || specifier.startsWith(`${banned}/`)) return banned
  }
  for (const banned of FORBIDDEN_SPECIFIERS_EXACT) {
    if (specifier === banned) return banned
  }
  return null
}

describe('fitness: nucleus semantic pipeline stays Lit/DOM/CRDT-free', () => {
  it.each(PURE_PIPELINE_FILES)('%s imports no renderer/DOM/CRDT package', (relPath) => {
    const absPath = fileURLToPath(new URL(relPath, import.meta.url))
    const source = readFileSync(absPath, 'utf8')
    const offenders = extractSpecifiers(source)
      .map((spec) => ({ spec, banned: isForbidden(spec) }))
      .filter((o) => o.banned !== null)
    expect(
      offenders,
      `${relPath} must not import ${offenders.map((o) => `'${o.spec}'`).join(', ')} — ` +
        `the semantic pipeline stays free of the renderer/DOM/CRDT layer (see file header for why).`,
    ).toEqual([])
  })

  it('the pure-file roster and forbidden list are non-empty (guards against a no-op fitness test)', () => {
    // A fitness function that checks nothing silently rots. Assert both curated
    // lists still have teeth, so an accidental emptying can't turn this green.
    expect(PURE_PIPELINE_FILES.length).toBeGreaterThanOrEqual(10)
    expect(FORBIDDEN_SPECIFIERS).toContain('lit')
  })
})
