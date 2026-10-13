/**
 * cuenta-verbs.test.ts — the closed verb union, the pure `word` planner,
 * and the executor's dry-run → apply path (el Despacho W1).
 *
 * The executor is exercised against the REAL cell's own receipts, recorded
 * from the Sirin `sophia-cluster` cell on 2026-09-15 (fixtures/*.json, each
 * naming its receipt, kept outside this repository): the
 * dry-run acceptance and the apply-time refusal `unknown embedded
 * vocabulary 'cuentas'` the deployed gardend returns today (prime's finding:
 * the generic ingest never consults `:projection:chamber`; the cell fix is
 * being deployed separately). A port here REPLAYS those recorded answers —
 * it is a recording of the real cell, not an imagined one — and the test's
 * claim is exactly the executor's contract: dry run first, and a refusal is
 * surfaced with the cell's words, never swallowed.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { CTA_NS, readCuenta, type CuentaReading } from '../cuenta-reading.js'
import {
  CUENTA_VERBS,
  CUENTA_WORDS,
  createCuentaVerbExecutor,
  parseEmporiumWriteReceipt,
  planCuentaVerb,
  restateCuenta,
  validateCuentaVerb,
  type CuentaVerbPort,
} from '../cuenta-verbs.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const GATE = `${G}:cuenta:despacho-w1-proof-gate`
const NOW = new Date('2026-09-15T20:00:00.000Z')

// node:path/node:url, not the ambient (happy-dom-shadowed) global `URL` — the
// same idiom sophia-home-face.test.ts uses to reach a real file.
const HERE = dirname(fileURLToPath(import.meta.url))

function fixture(name: string): { jsonrpc: { result?: unknown; error?: { code: number; message: string } } } {
  return JSON.parse(readFileSync(resolve(HERE, `./fixtures/${name}.json`), 'utf8'))
}

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string, datatype?: string) {
  return datatype ? { type: 'literal' as const, value, datatype } : { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}

/** The proof gate exactly as `string-despacho`/the receipts describe it, as the cell would read it back. */
function proofGate(status = 'open'): CuentaReading {
  const rows: QueryBlockRow[] = [
    { p: uri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), o: uri(`${CTA_NS}Cuenta`) },
    { p: uri(`${CTA_NS}beadKind`), o: lit('gate') },
    { p: uri(`${CTA_NS}title`), o: lit("Demi's word - the surface can close a gate (proof)") },
    { p: uri(`${CTA_NS}status`), o: lit(status) },
    { p: uri(`${CTA_NS}owner`), o: lit('demi') },
    { p: uri(`${CTA_NS}venue`), o: lit('human') },
    { p: uri(`${CTA_NS}priority`), o: lit('2', 'http://www.w3.org/2001/XMLSchema#integer') },
    { p: uri(`${CTA_NS}createdAt`), o: lit('2026-09-15T19:20:00Z', 'http://www.w3.org/2001/XMLSchema#dateTime') },
    { p: uri(`${CTA_NS}partOf`), o: uri(`${G}:cuenta:despacho-w1-proof`) },
    { p: uri(`${CTA_NS}evidence`), o: lit('receipts/a') },
    { p: uri(`${CTA_NS}evidence`), o: lit('receipts/b') },
  ]
  return readCuenta(GATE, bindings(['p', 'o'], rows), bindings(['p'], []), bindings(['r'], []))
}

const WORD = { verb: 'word', cuenta: GATE, word: 'yes', utterance: 'Yes - the surface can close a gate.', witness: 'demi w1 builder (fork)' }

describe('validateCuentaVerb — the closed union', () => {
  it('accepts a well-formed word and refuses every malformed field with the field named', () => {
    expect(validateCuentaVerb(WORD)).toEqual({ ok: true, spec: WORD })
    expect(validateCuentaVerb({ ...WORD, utterance: '   ' })).toMatchObject({ ok: false, phase: 'validate', message: expect.stringContaining('utterance') })
    expect(validateCuentaVerb({ ...WORD, word: 'maybe' })).toMatchObject({ ok: false, message: expect.stringContaining(CUENTA_WORDS.join(', ')) })
    expect(validateCuentaVerb({ ...WORD, witness: '' })).toMatchObject({ ok: false, message: expect.stringContaining('witness') })
    expect(validateCuentaVerb({ ...WORD, cuenta: 'not an iri' })).toMatchObject({ ok: false, message: expect.stringContaining('cuenta') })
    expect(validateCuentaVerb({ ...WORD, sparql: 'DROP ALL' })).toMatchObject({ ok: false, message: expect.stringContaining("'sparql'") })
    expect(validateCuentaVerb({ verb: 'wake', cuenta: GATE, witness: 'x' })).toMatchObject({ ok: false, message: expect.stringContaining(CUENTA_VERBS.join(', ')) })
    expect(validateCuentaVerb('word')).toMatchObject({ ok: false, phase: 'validate' })
  })

  it('declares claim/close/string in the same shape', () => {
    expect(validateCuentaVerb({ verb: 'claim', cuenta: GATE, witness: 'demi' })).toMatchObject({ ok: true })
    expect(validateCuentaVerb({ verb: 'close', cuenta: GATE, verdict: 'done', summary: 'one paragraph', witness: 'demi', evidence: ['a'] })).toMatchObject({ ok: true })
    expect(validateCuentaVerb({ verb: 'close', cuenta: GATE, verdict: 'maybe', summary: 'x', witness: 'demi' })).toMatchObject({ ok: false })
    expect(validateCuentaVerb({ verb: 'string', title: 'found work', beadKind: 'task', discoveredFrom: GATE, owner: 'demi', witness: 'demi' })).toMatchObject({ ok: true })
  })
})

describe('restateCuenta / planCuentaVerb — pure', () => {
  it('restates the whole bead with lists as lists, integers as numbers, and the status overridden', () => {
    const restated = restateCuenta(proofGate(), 'done')
    expect(restated).toEqual({
      kind: 'Cuenta',
      localId: 'despacho-w1-proof-gate',
      'cta:beadKind': 'gate',
      'cta:title': "Demi's word - the surface can close a gate (proof)",
      'cta:owner': 'demi',
      'cta:venue': 'human',
      'cta:priority': 2,
      'cta:createdAt': '2026-09-15T19:20:00Z',
      'cta:partOf': `${G}:cuenta:despacho-w1-proof`,
      'cta:evidence': ['receipts/a', 'receipts/b'],
      'cta:status': 'done',
    })
  })

  it('plans a word as ONE Rendición (verdict done, word, utterance verbatim, witness, renderedAt) plus the gate restated done', () => {
    const validated = validateCuentaVerb(WORD)
    if (!validated.ok) throw new Error(validated.message)
    const plan = planCuentaVerb(validated.spec, proofGate(), NOW)
    if (!plan.ok) throw new Error(plan.message)
    expect(plan.operationId).toBe('despacho-word-despacho-w1-proof-gate-r1')
    expect(plan.localIds).toEqual(['despacho-w1-proof-gate-r1', 'despacho-w1-proof-gate'])
    expect(plan.records[0]).toEqual({
      kind: 'Rendicion',
      localId: 'despacho-w1-proof-gate-r1',
      'cta:forCuenta': GATE,
      'cta:verdict': 'done',
      'cta:word': 'yes',
      'cta:utterance': 'Yes - the surface can close a gate.',
      'cta:witness': 'demi w1 builder (fork)',
      'cta:summary': 'Word given from el Despacho: yes.',
      'cta:renderedAt': '2026-09-15T20:00:00Z',
    })
    expect(plan.records[1]).toMatchObject({ kind: 'Cuenta', localId: 'despacho-w1-proof-gate', 'cta:status': 'done' })
    // No record ever carries `subject` — the cell mints identity.
    for (const record of plan.records) expect(record).not.toHaveProperty('subject')
  })

  it('refuses at plan time: a gate already closed, a non-gate, an unknown subject, a not-yet-implemented verb', () => {
    const spec = (validateCuentaVerb(WORD) as { ok: true; spec: never }).spec
    expect(planCuentaVerb(spec, proofGate('done'), NOW)).toMatchObject({ ok: false, phase: 'plan', message: expect.stringContaining('already been given') })
    const task = readCuenta(GATE, bindings(['p', 'o'], [{ p: uri(`${CTA_NS}beadKind`), o: lit('task') }, { p: uri(`${CTA_NS}status`), o: lit('open') }]), bindings(['p'], []), bindings(['r'], []))
    expect(planCuentaVerb(spec, task, NOW)).toMatchObject({ ok: false, phase: 'plan', message: expect.stringContaining('only a gate') })
    const missing = readCuenta(GATE, bindings(['p', 'o'], []), bindings(['p'], []), bindings(['r'], []))
    expect(planCuentaVerb(spec, missing, NOW)).toMatchObject({ ok: false, phase: 'plan', message: expect.stringContaining('no record') })
    const claim = (validateCuentaVerb({ verb: 'claim', cuenta: GATE, witness: 'demi' }) as { ok: true; spec: never }).spec
    expect(planCuentaVerb(claim, proofGate(), NOW)).toMatchObject({ ok: false, phase: 'plan', message: expect.stringContaining('not yet implemented') })
  })
})

describe('parseEmporiumWriteReceipt — the cell’s own shape', () => {
  it('reads the structured content or the text payload of the real dry-run receipt', () => {
    const real = fixture('proof-gate.word.dryrun').jsonrpc.result
    const receipt = parseEmporiumWriteReceipt(real)
    expect(receipt).toMatchObject({ ok: true, dryRun: true, violations: null })
    expect(receipt?.results.map((r) => r.subject)).toEqual([`${G}:rendicion:despacho-w1-proof-gate-r1`, GATE])
    expect(parseEmporiumWriteReceipt({ hello: 'world' })).toBeNull()
  })
})

/** A port that replays the REAL recorded answers: dry runs answer with the recorded dry-run receipt; applies answer as the deployed cell did. */
function recordingPort(applyBehaviour: 'refuse-as-recorded' | 'accept'): { port: CuentaVerbPort; calls: Array<Record<string, unknown>> } {
  const dry = fixture('proof-gate.word.dryrun').jsonrpc.result
  const refusal = fixture('proof-gate.string.apply').jsonrpc.error
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    port: {
      async callTool(name, args) {
        calls.push({ name, ...args })
        if (name !== 'emporium_write') throw new Error(`unexpected tool ${name}`)
        if (args.dryRun === true) return dry
        if (applyBehaviour === 'refuse-as-recorded') {
          // GatewayMcpError's own message composition (gateway-transport.ts).
          throw new Error(`Gateway MCP error for emporium_write: ${refusal?.message}`)
        }
        return { ...(dry as Record<string, unknown>), dryRun: false }
      },
    },
  }
}

describe('createCuentaVerbExecutor — dry run first, refusal verbatim', () => {
  it('dry-runs before applying, with the SAME records and the dryRun flag only on the first call', async () => {
    const { port, calls } = recordingPort('accept')
    const executor = createCuentaVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.execute(WORD, proofGate())
    expect(outcome).toMatchObject({ ok: true, phase: 'applied', operationId: 'despacho-word-despacho-w1-proof-gate-r1' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ name: 'emporium_write', graphId: 'sophia-cluster', vocab: 'cuentas', dryRun: true })
    expect(calls[1]).toMatchObject({ name: 'emporium_write', graphId: 'sophia-cluster', vocab: 'cuentas' })
    expect(calls[1]).not.toHaveProperty('dryRun')
    expect(calls[0].records).toEqual(calls[1].records)
    if (outcome.ok) expect(outcome.subjects).toEqual([`${G}:rendicion:despacho-w1-proof-gate-r1`, GATE])
  })

  it("surfaces the deployed cell's apply refusal with its words — `unknown embedded vocabulary 'cuentas'` — after a passing dry run", async () => {
    const { port, calls } = recordingPort('refuse-as-recorded')
    const executor = createCuentaVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.execute(WORD, proofGate())
    expect(outcome).toMatchObject({ ok: false, phase: 'apply', message: expect.stringContaining("unknown embedded vocabulary 'cuentas'") })
    expect(calls).toHaveLength(2)
  })

  it('preview never applies', async () => {
    const { port, calls } = recordingPort('refuse-as-recorded')
    const executor = createCuentaVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.preview(WORD, proofGate())
    expect(outcome).toMatchObject({ ok: true, phase: 'dry-run' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ dryRun: true })
  })

  it('a validation or plan refusal never reaches the cell', async () => {
    const { port, calls } = recordingPort('accept')
    const executor = createCuentaVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    expect(await executor.execute({ ...WORD, utterance: '' }, proofGate())).toMatchObject({ ok: false, phase: 'validate' })
    expect(await executor.execute(WORD, proofGate('done'))).toMatchObject({ ok: false, phase: 'plan' })
    expect(calls).toHaveLength(0)
  })

  it('a dry-run answer that is not a receipt, or a receipt with violations, is a dry-run refusal', async () => {
    const executor = createCuentaVerbExecutor({
      port: { async callTool() { return { ok: false, dryRun: true, results: [], violations: [{ message: 'sh:minCount 1 on cta:utterance' }], warnings: [] } } },
      graphId: 'sophia-cluster',
      now: () => NOW,
    })
    expect(await executor.execute(WORD, proofGate())).toMatchObject({ ok: false, phase: 'dry-run', message: expect.stringContaining('sh:minCount 1 on cta:utterance') })
    const odd = createCuentaVerbExecutor({ port: { async callTool() { return 'not a receipt' } }, graphId: 'sophia-cluster', now: () => NOW })
    expect(await odd.execute(WORD, proofGate())).toMatchObject({ ok: false, phase: 'dry-run', message: expect.stringContaining('not with an emporium_write receipt') })
  })
})
