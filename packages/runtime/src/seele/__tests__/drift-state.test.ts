/**
 * drift-state.test.ts — W9.1a's table-driven oracle over the v1 wax seal.
 *
 * Pure function, real reports: the `SeeleCompileReport` fixtures below are the
 * literal shapes `nature seele compile --json` emits (a clean circle-1 report
 * and a refused one), transcribed field-for-field rather than invented — the
 * end-to-end suites in `apps/seele-workbench` run the binary itself; this file
 * exists to enumerate combinations a real compiler would take a long time to
 * produce on demand, INCLUDING the ones that must be impossible.
 *
 * The two assertions this file exists for:
 *   - a `contractHash` present with a MISMATCHED source is `drifted`, never
 *     `sealed`. That is the lie the seal exists to prevent;
 *   - the union has exactly five members and no renderer maps any of them to a
 *     durability glyph or a warning tier (W9.3's enforceable half).
 */
import { describe, expect, it } from 'vitest'
import { deriveDriftState, describeDriftState, DRIFT_STATE_KINDS, type DriftState } from '../drift-state.js'
import type { SeeleCompileReport } from '../compile-seam.js'

const SOURCE = 'apiVersion: nature.sophia.dev/v1alpha2\nkind: Ecology\n'
const OTHER_SOURCE = 'apiVersion: nature.sophia.dev/v1alpha2\nkind: Ecology\n# edited\n'

const CLEAN: SeeleCompileReport = {
  schema: 'nature.seele.compile-report.v1',
  clean: true,
  producer: 'nature',
  compilerVersion: '0.1.0',
  compilerSemanticsId: 'nature-seele/2',
  sourceDigest: '5bbdffb87a2dd218e9ada20cc186b0fa90531cdee891a2420a7b6bac871e4122',
  vocabDigest: 'fe105f1b2d128183729f7c1de83feff4d976dcba316f9946dee1daa1f0709927',
  vocabSemanticsDigest: '2164d7cb7228ee61c45a336277a2cba0a41d9c2f66c1ca1cf4c15bd51d1693e6',
  contractHash: '15a3e47fdc187c0cfe183d459624c22377951a2569c72dd69e2a9e2984c69f72',
  compilationReceiptDigest: 'ac4fcb4d5dfb0c2dc06755d0d3bcc3e51f10a7ed24da713e749fe16ff2276d08',
  canonicalNTriples: '<urn:sophia:ecology:circle-1> <http://mnemosyne.dev/seele#id> "circle-1" .\n',
  tripleCount: 62,
  declaredObjects: [{ id: 'circle-1', iri: 'urn:sophia:ecology:circle-1', type: 'http://mnemosyne.dev/seele#Ecology' }],
  diagnostics: [],
}

const REFUSED: SeeleCompileReport = {
  ...CLEAN,
  clean: false,
  contractHash: null,
  compilationReceiptDigest: null,
  canonicalNTriples: null,
  tripleCount: 0,
  declaredObjects: [],
  diagnostics: [
    { severity: 'error', code: 'source_schema', message: 'unknown field `ecology`', anchor: '$' },
    { severity: 'error', code: 'source_schema', message: 'missing field `kind`', anchor: '$' },
  ],
}

describe('deriveDriftState — the whole table', () => {
  const rows: ReadonlyArray<{
    readonly name: string
    readonly inputs: Parameters<typeof deriveDriftState>[0]
    readonly expected: DriftState | null
  }> = [
    {
      name: 'no source at all → NO chip (there is nothing to seal)',
      inputs: { source: null, pending: false, inFlight: false, report: null, compiledSource: null },
      expected: null,
    },
    {
      name: 'no source, and a stale report from before → still no chip',
      inputs: { source: null, pending: false, inFlight: true, report: CLEAN, compiledSource: SOURCE },
      expected: null,
    },
    {
      name: 'a change has landed, nothing asked of the compiler yet → typing',
      inputs: { source: SOURCE, pending: true, inFlight: false, report: null, compiledSource: null },
      expected: { kind: 'typing' },
    },
    {
      name: 'pending BEATS an older clean report — the chip never vouches for bytes that moved',
      inputs: { source: OTHER_SOURCE, pending: true, inFlight: false, report: CLEAN, compiledSource: SOURCE },
      expected: { kind: 'typing' },
    },
    {
      name: 'in flight → compiling',
      inputs: { source: SOURCE, pending: false, inFlight: true, report: null, compiledSource: null },
      expected: { kind: 'compiling' },
    },
    {
      name: 'in flight BEATS an older report too',
      inputs: { source: OTHER_SOURCE, pending: false, inFlight: true, report: CLEAN, compiledSource: SOURCE },
      expected: { kind: 'compiling' },
    },
    {
      name: 'source, but no report yet and nothing scheduled → typing',
      inputs: { source: SOURCE, pending: false, inFlight: false, report: null, compiledSource: null },
      expected: { kind: 'typing' },
    },
    {
      name: 'clean report for EXACTLY these bytes → sealed, with hash AND compiler version (C21)',
      inputs: { source: SOURCE, pending: false, inFlight: false, report: CLEAN, compiledSource: SOURCE },
      expected: { kind: 'sealed', contractHash: CLEAN.contractHash!, compilerVersion: '0.1.0' },
    },
    {
      name: 'MUST BE IMPOSSIBLE: a contractHash present with a mismatched source → drifted, NEVER sealed',
      inputs: { source: OTHER_SOURCE, pending: false, inFlight: false, report: CLEAN, compiledSource: SOURCE },
      expected: { kind: 'drifted' },
    },
    {
      name: 'refusal for these bytes → refused, with the ERROR count',
      inputs: { source: SOURCE, pending: false, inFlight: false, report: REFUSED, compiledSource: SOURCE },
      expected: { kind: 'refused', errorCount: 2 },
    },
    {
      name: 'a refusal about OTHER bytes is drift, not a refusal of what is on screen',
      inputs: { source: OTHER_SOURCE, pending: false, inFlight: false, report: REFUSED, compiledSource: SOURCE },
      expected: { kind: 'drifted' },
    },
    {
      name: 'a report with no recorded compiled source cannot be vouched for → typing',
      inputs: { source: SOURCE, pending: false, inFlight: false, report: CLEAN, compiledSource: null },
      expected: { kind: 'typing' },
    },
    {
      name: 'clean but HASHLESS (nature never emits this) → drifted, never sealed',
      inputs: {
        source: SOURCE,
        pending: false,
        inFlight: false,
        report: { ...CLEAN, contractHash: null },
        compiledSource: SOURCE,
      },
      expected: { kind: 'drifted' },
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      expect(deriveDriftState(row.inputs)).toEqual(row.expected)
    })
  }

  it('counts only `error`-severity diagnostics — nature constructs no warning tier (C5)', () => {
    const withNoise: SeeleCompileReport = {
      ...REFUSED,
      diagnostics: [...REFUSED.diagnostics, { severity: 'note', code: 'x', message: 'y', anchor: '$' }],
    }
    const state = deriveDriftState({ source: SOURCE, pending: false, inFlight: false, report: withNoise, compiledSource: SOURCE })
    expect(state).toEqual({ kind: 'refused', errorCount: 2 })
  })
})

describe('W9.3 — forbidden depictions, enforced over the whole union', () => {
  it('has exactly five states, and DRIFT_STATE_KINDS lists all of them', () => {
    expect([...DRIFT_STATE_KINDS]).toEqual(['typing', 'compiling', 'sealed', 'refused', 'drifted'])
    expect(DRIFT_STATE_KINDS).toHaveLength(5)
  })

  it('no state renders a persistence claim or a warning tier', () => {
    const every: DriftState[] = [
      { kind: 'typing' },
      { kind: 'compiling' },
      { kind: 'sealed', contractHash: CLEAN.contractHash!, compilerVersion: '0.1.0' },
      { kind: 'refused', errorCount: 3 },
      { kind: 'drifted' },
    ]
    expect(every.map(state => state.kind).sort()).toEqual([...DRIFT_STATE_KINDS].sort())
    for (const state of every) {
      const label = describeDriftState(state)
      expect(label.length).toBeGreaterThan(0)
      expect(label.toLowerCase()).not.toMatch(/\bsaved\b|\bsaving\b|\bdurable\b|\bpersist|\bwarning\b|\bsynced\b/)
    }
  })

  it('sealed shows the hash AND the compiler version; refused shows a count and never a hash', () => {
    const sealed = describeDriftState({ kind: 'sealed', contractHash: CLEAN.contractHash!, compilerVersion: '0.1.0' })
    expect(sealed).toContain(CLEAN.contractHash!.slice(0, 12))
    expect(sealed).toContain('0.1.0')

    const refused = describeDriftState({ kind: 'refused', errorCount: 3 })
    expect(refused).toContain('3')
    expect(refused).not.toContain(CLEAN.contractHash!.slice(0, 12))

    // Singular/plural, because a chip that says "1 errors" is a chip nobody trusts.
    expect(describeDriftState({ kind: 'refused', errorCount: 1 })).toContain('1 error')
    expect(describeDriftState({ kind: 'refused', errorCount: 1 })).not.toContain('errors')
  })
})
