/**
 * Actual catalogue SPARQL × preserved Garden mapper golden RDF.
 * Source: garden f56af05b35f271a3a6cccfb47685516c0610c05a, mapping.rs
 * SHA256 5d0bedd486c2d0d3d73218160a81811740b97cf2e1adef49583c115b2aa98e3f.
 * These two goldens and the mapper are byte-identical at e842. The lifecycle
 * input is a hand-authored mapper fixture (its original comment says so), NOT
 * an actual projector/runtime/Sirin observation. Synthetic controls below are
 * marked separately; no source or deployed producer is invented by a test.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Store, namedNode } from 'oxigraph'
import { OBS_SURFACE_QUERY, createObservatorySurfaceNamedQueryRegistry } from './observatory-surface-query-catalog.js'

const OBS = 'http://mnemosyne.dev/observatory#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const PROV = 'http://www.w3.org/ns/prov#'
const graph = namedNode('urn:mnemosyne:local:graph:observatory:projection:obs:rollups')
const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const lifecycle = readFileSync(resolve(fixtureDirectory, 'observatory-lifecycle-f56.nt'), 'utf8')
const billing = readFileSync(resolve(fixtureDirectory, 'observatory-billing-f56.nt'), 'utf8')
const registry = createObservatorySurfaceNamedQueryRegistry()
const snapshots = (lines: number, unique: number, at = '2026-09-09T15:00:00Z', id = 'synthetic-snapshot') => `
  <urn:test:${id}> a <${OBS}SourceSnapshot> ; <${OBS}capturedAt> "${at}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
    <${OBS}lineCount> ${lines} ; <${OBS}uniqueEventCount> ${unique} .`
const projection = `<urn:test:projection> a <${OBS}ProjectionRun> ; <${OBS}computationStatus> "ok" ; <${OBS}evaluatedAt> "2026-09-09T15:01:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ; <${PROV}wasDerivedFrom> <urn:test:synthetic-snapshot> .`
const syntheticKnownMachine = `<urn:test:machine-run> a <http://mnemosyne.dev/machine#MachineRun> .`

function load(text: string, format = 'application/n-triples', store = new Store()): Store {
  store.load(text, { format, to_graph_name: graph })
  return store
}

function rows(store: Store, name: string): Record<string, string>[] {
  const result = store.query(registry.resolve(name, 'observatory'))
  if (!Array.isArray(result)) throw new Error('expected SELECT bindings')
  return result.map(row => {
    if (!(row instanceof Map)) throw new Error('expected a binding map')
    return Object.fromEntries([...row].map(([key, term]) => [key, term.value]))
  })
}
const values = (store: Store, name: string) => rows(store, name).map(row => row.value)

describe('Observatory catalogue joins actual f56 materializer vocabulary', () => {
  it('retains exact lifecycle mapper golden bytes', () => {
    expect(createHash('sha256').update(lifecycle).digest('hex')).toBe('05bc39fd867276a9bc63ac2ce0eb3c43ca5e9929e68e15e7fe31941afc7b159e')
  })
  it('retains exact billing mapper golden bytes', () => {
    expect(createHash('sha256').update(billing).digest('hex')).toBe('fa0ebbf583f9e5f5eff8cacb48f4ab8aaae4498ba7e3c70f22c2a0cef6155a1c')
  })
  it('finds the actual obs:SpawnAttempt (old mach:SpawnAttempt returned zero)', () => {
    expect(values(load(lifecycle), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual(['1'])
  })
  it.each([
    ['lineCount', '36'], ['uniqueCount', '36'], ['redeliveryPermille', '0'],
  ] as const)('reads %s through capturedAt, not nonexistent SourceSnapshot asOf', (key, expected) => {
    const store = load(billing, 'application/n-triples', load(lifecycle))
    expect(values(store, OBS_SURFACE_QUERY[key])).toEqual([expected])
  })
  it('preserves the actual recent MachineRun query as an unchanged positive control', () => {
    expect(rows(load(lifecycle), OBS_SURFACE_QUERY.recentRuns)).toHaveLength(1)
  })
  it('does not report an absent projection as zero attempts', () => {
    expect(rows(new Store(), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it('does not mistake billing-only telemetry for a lifecycle capture', () => {
    expect(rows(load(billing), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it('does not turn an unbound synthetic capture snapshot into a witnessed lifecycle projection', () => {
    expect(rows(load(snapshots(0, 0), 'text/turtle'), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it('returns zero for an explicitly successful known-machine projection with no attempts (not live-producer health)', () => {
    expect(values(load(snapshots(1, 1) + projection + syntheticKnownMachine, 'text/turtle'), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual(['0'])
  })
  it.each([null, 'error', 'unknown', 'no-data'])('does not turn computationStatus=%s into zero despite decorative outcome ok', (status) => {
    const witness = status === null
      ? projection.replace(`<${OBS}computationStatus> "ok" ; `, '')
      : projection.replace(`<${OBS}computationStatus> "ok"`, `<${OBS}computationStatus> "${status}"`)
    const store = load(snapshots(1, 1) + witness + `<urn:test:projection> <${OBS}outcome> "ok" .`, 'text/turtle')
    expect(rows(store, OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it.each([null, 'error', 'unknown', 'no-data'])('a newer computationStatus=%s never falls back to retained older success', (status) => {
    const witness = status === null
      ? projection.replace(`<${OBS}computationStatus> "ok" ; `, '')
      : projection.replace(`<${OBS}computationStatus> "ok"`, `<${OBS}computationStatus> "${status}"`)
    const store = load(snapshots(1, 1) + witness, 'text/turtle', load(lifecycle))
    expect(rows(store, OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it('same-time ambiguous latest projections do not choose a success arbitrarily', () => {
    const other = projection.replaceAll('urn:test:projection', 'urn:test:tied-error').replace(`<${OBS}computationStatus> "ok"`, `<${OBS}computationStatus> "error"`)
    expect(rows(load(snapshots(1, 1) + projection + other, 'text/turtle'), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
  })
  it('an older synthetic error does not hide a genuinely newer successful projection', () => {
    const older = projection.replaceAll('urn:test:projection', 'urn:test:older-error').replace('2026-09-09T15:01:00Z', '2026-09-09T14:01:00Z').replace(`<${OBS}computationStatus> "ok"`, `<${OBS}computationStatus> "error"`)
    expect(values(load(snapshots(1, 1) + projection + syntheticKnownMachine + older, 'text/turtle'), OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual(['0'])
  })
  it('does not multiply the spawn count when more snapshot/projection evidence is present', () => {
    const store = load(snapshots(0, 0) + projection, 'text/turtle', load(lifecycle))
    expect(values(store, OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual(['1'])
  })
  it('does not count the old wrong mach:SpawnAttempt type even beside a valid projection', () => {
    const store = load(`<urn:test:wrong-namespace> <${RDF_TYPE}> <http://mnemosyne.dev/machine#SpawnAttempt> .`, 'application/n-triples', load(lifecycle))
    expect(values(store, OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual(['1'])
  })
  it('selects the newest capturedAt value without relying on insertion order', () => {
    const store = load(snapshots(10, 8, '2026-09-09T16:00:00Z', 'latest') + snapshots(100, 100, '2026-09-09T15:00:00Z', 'older'), 'text/turtle')
    expect(values(store, OBS_SURFACE_QUERY.lineCount)).toEqual(['10'])
    expect(values(store, OBS_SURFACE_QUERY.uniqueCount)).toEqual(['8'])
    expect(values(store, OBS_SURFACE_QUERY.redeliveryPermille)).toEqual(['200'])
  })
  it('an empty latest snapshot has zero lines but no ratio, never an older nonempty ratio', () => {
    const store = load(snapshots(0, 0, '2026-09-09T16:00:00Z', 'latest') + snapshots(100, 50, '2026-09-09T15:00:00Z', 'older'), 'text/turtle')
    expect(values(store, OBS_SURFACE_QUERY.lineCount)).toEqual(['0'])
    expect(values(store, OBS_SURFACE_QUERY.uniqueCount)).toEqual(['0'])
    expect(rows(store, OBS_SURFACE_QUERY.redeliveryPermille)).toEqual([])
  })
  it('missing capture telemetry yields no line/unique/ratio values', () => {
    for (const name of [OBS_SURFACE_QUERY.lineCount, OBS_SURFACE_QUERY.uniqueCount, OBS_SURFACE_QUERY.redeliveryPermille]) {
      expect(rows(new Store(), name)).toEqual([])
    }
  })
  it('reads a synthetic mapper-shaped error and its optional diagnostic fields', () => {
    const store = load(`<urn:test:error> a <${OBS}MetricEvaluation> ; <${OBS}outcome> "error" ;
      <${OBS}evaluatedAt> "2026-09-09T15:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
      <${OBS}errorCode> "source_read_failed" ; <${OBS}errorSafeMessage> "The testimony snapshot could not be read." .`, 'text/turtle', load(billing))
    expect(rows(store, OBS_SURFACE_QUERY.evaluationFailures)).toEqual([{
      evaluation: 'urn:test:error', outcome: 'error', evaluatedAt: '2026-09-09T15:00:00Z',
      errorCode: 'source_read_failed', errorSafeMessage: 'The testimony snapshot could not be read.',
    }])
  })
  it('retains an error even when optional detail fields are absent', () => {
    const store = load(`<urn:test:error> a <${OBS}MetricEvaluation> ; <${OBS}outcome> "error" ; <${OBS}evaluatedAt> "2026-09-09T15:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`, 'text/turtle')
    expect(rows(store, OBS_SURFACE_QUERY.evaluationFailures)).toHaveLength(1)
  })
  it('does not label a successful no-data MetricObservation or unknown evaluation outcome as failure', () => {
    const store = load(`<urn:test:no-data> a <${OBS}MetricObservation> ; <${OBS}computationStatus> "no-data" .
      <urn:test:evaluation> a <${OBS}MetricEvaluation> ; <${OBS}outcome> "ok" ; <${OBS}producedObservation> <urn:test:no-data> ; <${OBS}evaluatedAt> "2026-09-09T15:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
      <urn:test:unknown> a <${OBS}MetricEvaluation> ; <${OBS}outcome> "unknown" ; <${OBS}evaluatedAt> "2026-09-09T15:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`, 'text/turtle', load(billing))
    expect(rows(store, OBS_SURFACE_QUERY.evaluationFailures)).toEqual([])
  })
  it('does not query a different graph that happens to contain matching vocabulary', () => {
    const store = new Store()
    store.load(lifecycle, { format: 'application/n-triples', to_graph_name: namedNode('urn:mnemosyne:local:graph:other:projection:obs:rollups') })
    expect(rows(store, OBS_SURFACE_QUERY.spawnUnmaterialized)).toEqual([])
    expect(rows(store, OBS_SURFACE_QUERY.lineCount)).toEqual([])
  })
})
