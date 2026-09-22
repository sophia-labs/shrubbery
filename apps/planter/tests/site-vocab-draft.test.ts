// @vitest-environment node
//
// site-vocab-draft.test.ts — machine-check of the registered shrubbery-site
// golden vocabulary. The filename remains as a history breadcrumb.
//
// This is a PURE structural check of the on-disk JSON — no network, no
// gardend, no garden-side Rust. It exists so the golden can never silently
// drift from the invariants the design negotiated:
//   1. every predicate datatype is one of the 8 tokens the pack format
//      understands;
//   2. every class's subject_rule is a {graph_subject}-rooted template using
//      only legal `{tokenName}` placeholders;
//   3. every predicate that cross-references an EXISTING sux: layout node
//      (its own "source" text says "typed sux:...") is datatype 'uri' — a
//      cross-reference can never be a string CURIE or a literal;
//   4. no instance IRI is minted under either ontology namespace (site: or
//      sux:): every appearance of the bare namespace URIs
//      (http://sophia.ai/site# / http://sophia.ai/ux#) in the document is
//      EITHER the namespaces block's own declaration OR part of a
//      "never/NEVER ... under <namespace>" cautionary phrase — never a
//      standalone example instance IRI;
//   5. registration.registry_name === the golden's own 'name' field
//      (registry_names_match_golden_names, per the registration block's own
//      comment).
//
// The old DESIGN-20260711 Appendix A remains historical design input. The
// registered golden is now independently SHA-pinned by Garden's registry.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(HERE, '..', '..', '..', 'docs', 'planter', 'site-vocab', 'shrubbery-site.golden.json')

const GOLDEN_RAW = readFileSync(GOLDEN_PATH, 'utf8')

interface PredicateSpec {
  readonly datatype: string
  readonly multi: boolean
  readonly required: boolean
  readonly source: string
}

interface ClassSpec {
  readonly comment: string
  readonly predicates: Record<string, PredicateSpec>
  readonly rdf_types: readonly string[]
  readonly subject_rule: string
  readonly [key: string]: unknown
}

interface GoldenPack {
  readonly classes: Record<string, ClassSpec>
  readonly comanaged_forbidden: readonly string[]
  readonly name: string
  readonly namespaces: Record<string, string>
  readonly registration: { readonly registry_name: string; readonly [key: string]: unknown }
  readonly [key: string]: unknown
}

const GOLDEN: GoldenPack = JSON.parse(GOLDEN_RAW) as GoldenPack

const LEGAL_DATATYPES = new Set([
  'string',
  'uri',
  'integer',
  'long',
  'float',
  'double',
  'boolean',
  'dateTime',
])

// ── 0. the golden parses, and is non-trivial ────────────────────────────────

describe('shrubbery-site golden — basic shape', () => {
  it('parses as JSON and declares the expected top-level pack name', () => {
    expect(GOLDEN.name).toBe('shrubbery-site')
    expect(GOLDEN.version).toBe('0.2.1')
    expect(Object.keys(GOLDEN.classes)).toEqual([
      'ComponentBinding',
      'ContentSource',
      'PackProvenance',
      'PublicationRoute',
      'Route',
      'SiteDefinition',
      'Surface',
      'Theme',
    ])
  })
})

// ── 1. datatype closure ──────────────────────────────────────────────────────

describe('shrubbery-site golden — datatype closure', () => {
  it('every predicate datatype is one of the 8 legal pack-format tokens', () => {
    const offenders: string[] = []
    for (const [className, cls] of Object.entries(GOLDEN.classes)) {
      for (const [predName, pred] of Object.entries(cls.predicates)) {
        if (!LEGAL_DATATYPES.has(pred.datatype)) {
          offenders.push(`${className}.${predName} -> '${pred.datatype}'`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ── 2. subject_rule shape ───────────────────────────────────────────────────

// A subject_rule is a template string: `{token}` placeholders interleaved
// with literal path segments drawn from [A-Za-z0-9:_-]. Legal token names
// are identifier-shaped (`[a-zA-Z_][a-zA-Z0-9_]*`).
const TOKEN_RE = /\{([^}]*)\}/g
const LEGAL_TOKEN_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const LITERAL_SEGMENT_RE = /^[A-Za-z0-9:_-]*$/

function templateTokensAndLiterals(template: string): { tokens: string[]; literals: string[] } {
  const tokens: string[] = []
  const literals: string[] = []
  let lastIndex = 0
  for (const match of template.matchAll(TOKEN_RE)) {
    literals.push(template.slice(lastIndex, match.index))
    tokens.push(match[1] ?? '')
    lastIndex = (match.index ?? 0) + match[0].length
  }
  literals.push(template.slice(lastIndex))
  return { tokens, literals }
}

describe('shrubbery-site golden — subject_rule templates', () => {
  it('every class subject_rule is {graph_subject}-rooted with legal token names', () => {
    for (const [className, cls] of Object.entries(GOLDEN.classes)) {
      expect(cls.subject_rule.startsWith('{graph_subject}:'), `${className}.subject_rule`).toBe(
        true,
      )
      const { tokens, literals } = templateTokensAndLiterals(cls.subject_rule)
      for (const token of tokens) {
        expect(LEGAL_TOKEN_NAME_RE.test(token), `${className}.subject_rule token '${token}'`).toBe(
          true,
        )
      }
      for (const literal of literals) {
        expect(
          LITERAL_SEGMENT_RE.test(literal),
          `${className}.subject_rule literal segment '${literal}'`,
        ).toBe(true)
      }
      expect(tokens[0]).toBe('graph_subject')
    }
  })
})

// ── 3. layout cross-references are datatype uri ─────────────────────────────

describe('shrubbery-site golden — layout cross-references', () => {
  it("every predicate whose source documents it as a reference to an existing 'typed sux:' node is datatype uri", () => {
    let sawAtLeastOne = false
    for (const [className, cls] of Object.entries(GOLDEN.classes)) {
      for (const [predName, pred] of Object.entries(cls.predicates)) {
        if (pred.source.includes('typed sux:')) {
          sawAtLeastOne = true
          expect(pred.datatype, `${className}.${predName} (layout cross-reference)`).toBe('uri')
        }
      }
    }
    // sanity: the golden actually contains layout cross-references (Route,
    // Surface, Theme) — a check that vacuously passes on an empty set proves
    // nothing.
    expect(sawAtLeastOne).toBe(true)
  })
})

// ── 4. no instance IRIs minted under either ontology namespace ──────────────

describe('shrubbery-site golden — no instance IRIs under site: or sux:', () => {
  // Each ontology prefix declares its OWN namespace URI (site -> .../site#,
  // sux -> .../ux# — note the prefix and the namespace's own path segment
  // are not required to match letter-for-letter); match each declaration
  // independently rather than assuming a shared suffix.
  const NAMESPACE_DECLARATIONS: ReadonlyArray<readonly [string, RegExp]> = [
    ['http://sophia.ai/site#', /"site":\s*"http:\/\/sophia\.ai\/site#"/g],
    ['http://sophia.ai/ux#', /"sux":\s*"http:\/\/sophia\.ai\/ux#"/g],
  ]

  it('every occurrence of the bare namespace URI outside the namespaces block is a "never/under" caution, never a minted example', () => {
    for (const [ns, declRe] of NAMESPACE_DECLARATIONS) {
      let searchFrom = 0
      const occurrences: number[] = []
      for (;;) {
        const idx = GOLDEN_RAW.indexOf(ns, searchFrom)
        if (idx === -1) break
        occurrences.push(idx)
        searchFrom = idx + ns.length
      }
      expect(occurrences.length, `expected at least one occurrence of ${ns}`).toBeGreaterThan(0)

      // Namespace-declaration occurrences (inside the "namespaces" object)
      // are legitimate and excluded from the caution-phrasing requirement.
      const declOffsets = new Set<number>()
      for (const m of GOLDEN_RAW.matchAll(declRe)) {
        const nsIdx = m[0].indexOf(ns)
        declOffsets.add((m.index ?? 0) + nsIdx)
      }

      for (const idx of occurrences) {
        if (declOffsets.has(idx)) continue
        const window = GOLDEN_RAW.slice(Math.max(0, idx - 40), idx)
        // Raw SHACL legitimately declares the same ontology namespaces.
        if (/@prefix\s+[A-Za-z][A-Za-z0-9_-]*:\s+<$/.test(window)) continue
        expect(
          /\bunder\b/i.test(window),
          `occurrence of ${ns} at offset ${idx} is not a namespace declaration and is not ` +
            `phrased as "... under ${ns}" — preceding context: ${JSON.stringify(window)}`,
        ).toBe(true)
      }
    }
  })

  it('comanaged_forbidden names the doc/mnemo/nfo vocabularies (never re-minted by this pack)', () => {
    expect(GOLDEN.comanaged_forbidden).toEqual(['doc:', 'mnemo:', 'nfo:'])
  })
})

// ── 5. registration.registry_name === name ──────────────────────────────────

describe('shrubbery-site golden — registration contract', () => {
  it('registration.registry_name equals the golden\'s own name field exactly', () => {
    expect(GOLDEN.registration.registry_name).toBe(GOLDEN.name)
  })
})
