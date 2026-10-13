/**
 * inbox-verbs.ts — el Despacho W4: the closed verb of the inbox, `read`.
 *
 * "Mark read" is not a flag the surface flips; it is the reader's own dated
 * testimony that they read an account — a `cta:Lectura` (cuentas v0.3.0:
 * forRendicion, reader, readAt). Same discipline and the same seam as
 * `cuenta-verbs.ts`: validate (shape) → plan (pure) → DRY RUN against the
 * real cell → APPLY → the cell's receipt; every refusal typed, the cell's
 * words verbatim; writes only through `emporium_write(vocab="cuentas")`.
 *
 * A Lectura's localId is `<rendición localId>-read-by-<reader slug>`: one
 * reading per reader per account, so a second click converges instead of
 * duplicating (the generic ingest is current-state-materialize).
 */
import {
  parseEmporiumWriteReceipt,
  type CuentaVerbPort,
  type CuentaVerbRefusal,
  type EmporiumRecord,
  type EmporiumWriteArgs,
  type EmporiumWriteReceipt,
} from './cuenta-verbs.js'
import { isEmbeddableFocusIri } from '../layout/named-query-registry.js'
import { rendicionLocalId } from './inbox-reading.js'

export const INBOX_VERBS = ['read'] as const
export type InboxVerb = (typeof INBOX_VERBS)[number]

export type InboxVerbSpec = {
  readonly verb: 'read'
  /** The Rendición's subject IRI. */
  readonly rendicion: string
  /** Who read it — the viewer's identity as the session knows it. */
  readonly reader: string
  readonly note?: string
}

export type InboxVerbRefusal = CuentaVerbRefusal

export interface InboxVerbPlan {
  readonly ok: true
  readonly operationId: string
  readonly records: readonly EmporiumRecord[]
  readonly localIds: readonly string[]
}

export interface InboxVerbApplied {
  readonly ok: true
  readonly phase: 'applied'
  readonly operationId: string
  readonly subjects: readonly string[]
  readonly receipt: EmporiumWriteReceipt
}

export interface InboxVerbPreviewed {
  readonly ok: true
  readonly phase: 'dry-run'
  readonly operationId: string
  readonly subjects: readonly string[]
  readonly receipt: EmporiumWriteReceipt
}

function refuse(phase: CuentaVerbRefusal['phase'], message: string, detail?: unknown): InboxVerbRefusal {
  return detail === undefined ? { ok: false, phase, message } : { ok: false, phase, message, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** The reader as an id segment: the emporium's id alphabet, nothing else. */
export function readerSlug(reader: string): string {
  return reader.replace(/[^A-Za-z0-9._~:@+-]/g, '-').slice(0, 120)
}

export function validateInboxVerb(value: unknown): { readonly ok: true; readonly spec: InboxVerbSpec } | InboxVerbRefusal {
  if (!isRecord(value)) return refuse('validate', 'a verb must be an object')
  if (value.verb !== 'read') return refuse('validate', `unknown verb '${String(value.verb)}' — the closed set is ${INBOX_VERBS.join(', ')}`)
  for (const key of Object.keys(value)) {
    if (!['verb', 'rendicion', 'reader', 'note'].includes(key)) return refuse('validate', `field '${key}' is not part of the 'read' verb`)
  }
  if (!nonEmpty(value.reader)) return refuse('validate', 'reader is required — a reading without a reader is not testimony')
  if (!nonEmpty(value.rendicion) || !isEmbeddableFocusIri(value.rendicion)) return refuse('validate', 'rendicion must be the account’s absolute IRI')
  if (!rendicionLocalId(value.rendicion)) return refuse('validate', 'the subject is not a cuentas account (no `:rendicion:` local id)')
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 4096)) return refuse('validate', 'note must be a short string')
  return {
    ok: true,
    spec: { verb: 'read', rendicion: value.rendicion, reader: value.reader, ...(nonEmpty(value.note) ? { note: value.note } : {}) },
  }
}

/** Pure planner: the one Lectura record a reading becomes. `now` injected for determinism. */
export function planInboxVerb(spec: InboxVerbSpec, now: Date): InboxVerbPlan | InboxVerbRefusal {
  const local = rendicionLocalId(spec.rendicion)
  if (!local) return refuse('plan', 'the subject is not a cuentas account')
  const localId = `${local}-read-by-${readerSlug(spec.reader)}`
  const readAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const record: EmporiumRecord = {
    kind: 'Lectura',
    localId,
    'cta:forRendicion': spec.rendicion,
    'cta:reader': spec.reader,
    'cta:readAt': readAt,
    ...(spec.note ? { 'cta:note': spec.note } : {}),
  }
  return { ok: true, operationId: `despacho-read-${localId}`, records: [record], localIds: [localId] }
}

function receiptRefusal(phase: 'dry-run' | 'apply', receipt: EmporiumWriteReceipt): InboxVerbRefusal | null {
  if (receipt.ok && receipt.violations === null) return null
  const violations = receipt.violations
  const summary =
    Array.isArray(violations) && violations.length > 0
      ? violations.map((v) => (isRecord(v) && typeof v.message === 'string' ? v.message : JSON.stringify(v))).join('; ')
      : `the cell reported ok=${receipt.ok}`
  return refuse(phase, `the cell refused at ${phase}: ${summary}`, receipt)
}

export interface InboxVerbExecutorOptions {
  readonly port: CuentaVerbPort
  readonly graphId: string
  readonly now?: () => Date
}

export interface InboxVerbExecutor {
  /** validate → plan → dry run; nothing written. */
  preview(spec: unknown): Promise<InboxVerbPreviewed | InboxVerbRefusal>
  /** validate → plan → dry run → apply. The receipt is the cell's. */
  execute(spec: unknown): Promise<InboxVerbApplied | InboxVerbRefusal>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createInboxVerbExecutor(options: InboxVerbExecutorOptions): InboxVerbExecutor {
  const now = options.now ?? (() => new Date())
  const write = async (args: EmporiumWriteArgs): Promise<EmporiumWriteReceipt | InboxVerbRefusal> => {
    const phase = args.dryRun ? 'dry-run' : 'apply'
    let raw: unknown
    try {
      raw = await options.port.callTool('emporium_write', args)
    } catch (error) {
      return refuse(phase, errorMessage(error), error)
    }
    const receipt = parseEmporiumWriteReceipt(raw)
    if (!receipt) return refuse(phase, 'the cell answered, but not with an emporium_write receipt', raw)
    return receiptRefusal(phase, receipt) ?? receipt
  }
  const prepare = (spec: unknown): InboxVerbPlan | InboxVerbRefusal => {
    const validated = validateInboxVerb(spec)
    if (!validated.ok) return validated
    return planInboxVerb(validated.spec, now())
  }
  const argsFor = (plan: InboxVerbPlan, dryRun: boolean): EmporiumWriteArgs => ({
    graphId: options.graphId,
    vocab: 'cuentas',
    operationId: plan.operationId,
    records: plan.records,
    ...(dryRun ? { dryRun: true as const } : {}),
  })
  return {
    async preview(spec) {
      const plan = prepare(spec)
      if (!plan.ok) return plan
      const receipt = await write(argsFor(plan, true))
      if ('phase' in receipt) return receipt
      return { ok: true, phase: 'dry-run', operationId: plan.operationId, subjects: receipt.results.map((r) => r.subject), receipt }
    },
    async execute(spec) {
      const plan = prepare(spec)
      if (!plan.ok) return plan
      const dry = await write(argsFor(plan, true))
      if ('phase' in dry) return dry
      const applied = await write(argsFor(plan, false))
      if ('phase' in applied) return applied
      return { ok: true, phase: 'applied', operationId: plan.operationId, subjects: applied.results.map((r) => r.subject), receipt: applied }
    },
  }
}
