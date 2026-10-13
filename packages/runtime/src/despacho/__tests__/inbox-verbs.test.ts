/**
 * inbox-verbs.test.ts — the closed `read` verb (el Despacho W4): validate →
 * plan → dry run → apply, and every refusal typed with the cell's own words.
 *
 * The port here is a spy over the SAME `emporium_write` wire shape the real
 * cell answers (receipts copied from this campaign's own applies), never a
 * mock of the verb itself: the planner's records and the two-phase discipline
 * are what is under test.
 */
import { describe, expect, it, vi } from 'vitest'
import { createInboxVerbExecutor, planInboxVerb, readerSlug, validateInboxVerb } from '../inbox-verbs.js'
import type { CuentaVerbPort } from '../cuenta-verbs.js'

const CUENTAS = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const REND = `${CUENTAS}:rendicion:despacho-w1-proof-gate-r1`
const READER = 'e9e949fe-0091-7015-0ab8-10bf259084ab'
const NOW = new Date('2026-09-16T06:30:00.123Z')

function receipt(subject: string, dryRun: boolean) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          graphId: 'sophia-cluster',
          vocab: 'cuentas',
          dryRun,
          ok: true,
          results: [{ subject, outcome: 'applied' }],
          journalRef: dryRun ? null : '000000000116-1789520981948',
          warnings: [],
          violations: null,
        }),
      },
    ],
  }
}

function spyPort(answer: (tool: string, args: Record<string, unknown>) => unknown): { port: CuentaVerbPort; calls: Array<{ tool: string; args: Record<string, unknown> }> } {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  return {
    calls,
    port: {
      async callTool(tool: string, args: Record<string, unknown>) {
        calls.push({ tool, args })
        return answer(tool, args)
      },
    },
  }
}

describe('validateInboxVerb — the closed shape', () => {
  it('accepts a well-formed reading', () => {
    const verdict = validateInboxVerb({ verb: 'read', rendicion: REND, reader: READER })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.spec.reader).toBe(READER)
  })

  it('refuses an unknown verb, naming the closed set', () => {
    const verdict = validateInboxVerb({ verb: 'archive', rendicion: REND, reader: READER })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('the closed set is read')
  })

  it('refuses a field that is not part of the verb — no smuggling', () => {
    const verdict = validateInboxVerb({ verb: 'read', rendicion: REND, reader: READER, records: [{ kind: 'Cuenta' }] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain("field 'records' is not part of the 'read' verb")
  })

  it('refuses a reading with no reader — a reading without a reader is not testimony', () => {
    const verdict = validateInboxVerb({ verb: 'read', rendicion: REND, reader: '  ' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('reader is required')
  })

  it('refuses a subject that is not an account', () => {
    const verdict = validateInboxVerb({ verb: 'read', rendicion: `${CUENTAS}:cuenta:despacho-g-name`, reader: READER })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('not a cuentas account')
  })

  it('refuses a subject that is not an absolute IRI at all', () => {
    const verdict = validateInboxVerb({ verb: 'read', rendicion: 'rendicion:despacho-w1-proof-gate-r1', reader: READER })
    expect(verdict.ok).toBe(false)
  })
})

describe('planInboxVerb — the record a reading becomes', () => {
  it('plans exactly one Lectura, keyed one per reader per account', () => {
    const plan = planInboxVerb({ verb: 'read', rendicion: REND, reader: READER }, NOW)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.records).toEqual([
      {
        kind: 'Lectura',
        localId: `despacho-w1-proof-gate-r1-read-by-${READER}`,
        'cta:forRendicion': REND,
        'cta:reader': READER,
        'cta:readAt': '2026-09-16T06:30:00Z',
      },
    ])
    expect(plan.operationId).toBe(`despacho-read-despacho-w1-proof-gate-r1-read-by-${READER}`)
  })

  it('converges: the same reader reading the same account twice plans the SAME local id', () => {
    const first = planInboxVerb({ verb: 'read', rendicion: REND, reader: READER }, NOW)
    const second = planInboxVerb({ verb: 'read', rendicion: REND, reader: READER }, new Date('2026-09-17T00:00:00Z'))
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(first.localIds).toEqual(second.localIds)
  })

  it('keeps a note when one is given, and omits the field when it is not', () => {
    const withNote = planInboxVerb({ verb: 'read', rendicion: REND, reader: READER, note: 'read on the train' }, NOW)
    expect(withNote.ok && withNote.records[0]!['cta:note']).toBe('read on the train')
    const without = planInboxVerb({ verb: 'read', rendicion: REND, reader: READER }, NOW)
    expect(without.ok && 'cta:note' in without.records[0]!).toBe(false)
  })

  it('slugs a reader into the emporium id alphabet without collapsing distinct readers', () => {
    expect(readerSlug(READER)).toBe(READER)
    expect(readerSlug('vera@example.com')).toBe('vera@example.com')
    expect(readerSlug('a b/c')).toBe('a-b-c')
  })
})

describe('the executor — dry run first, always', () => {
  it('previews without writing: exactly one call, dryRun true', async () => {
    const { port, calls } = spyPort((_tool, args) => receipt(`${CUENTAS}:lectura:x`, args.dryRun === true))
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.preview({ verb: 'read', rendicion: REND, reader: READER })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.phase).toBe('dry-run')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.tool).toBe('emporium_write')
    expect(calls[0]!.args.dryRun).toBe(true)
    expect(calls[0]!.args.vocab).toBe('cuentas')
  })

  it('applies only after a clean dry run: two calls, the second without dryRun', async () => {
    const { port, calls } = spyPort((_tool, args) => receipt(`${CUENTAS}:lectura:x`, args.dryRun === true))
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.execute({ verb: 'read', rendicion: REND, reader: READER })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.phase).toBe('applied')
      expect(outcome.subjects).toEqual([`${CUENTAS}:lectura:x`])
    }
    expect(calls.map((c) => c.args.dryRun)).toEqual([true, undefined])
  })

  it('never reaches apply when the dry run is refused, and keeps the cell’s words', async () => {
    const answer = vi.fn(() => ({
      content: [{ type: 'text', text: JSON.stringify({ graphId: 'sophia-cluster', vocab: 'cuentas', dryRun: true, ok: false, results: [], journalRef: null, warnings: [], violations: [{ message: 'cta:reader is required' }] }) }],
    }))
    const { port, calls } = spyPort(answer)
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.execute({ verb: 'read', rendicion: REND, reader: READER })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.phase).toBe('dry-run')
      expect(outcome.message).toContain('cta:reader is required')
    }
    expect(calls).toHaveLength(1)
  })

  it('refuses a bad spec before touching the cell at all', async () => {
    const { port, calls } = spyPort(() => receipt('x', true))
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.execute({ verb: 'read', rendicion: 'nope', reader: READER })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.phase).toBe('validate')
    expect(calls).toHaveLength(0)
  })

  it('reports a transport failure as a refusal, not a crash', async () => {
    const port: CuentaVerbPort = {
      async callTool() {
        throw new Error('the cell is hydrating')
      },
    }
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.preview({ verb: 'read', rendicion: REND, reader: READER })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toBe('the cell is hydrating')
  })

  it('refuses an answer that is not an emporium_write receipt', async () => {
    const { port } = spyPort(() => ({ content: [{ type: 'text', text: 'not json' }] }))
    const executor = createInboxVerbExecutor({ port, graphId: 'sophia-cluster', now: () => NOW })
    const outcome = await executor.preview({ verb: 'read', rendicion: REND, reader: READER })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toContain('not with an emporium_write receipt')
  })
})
