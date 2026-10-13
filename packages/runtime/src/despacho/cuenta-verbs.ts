/**
 * cuenta-verbs.ts — the CLOSED verb union of el Despacho and its one W1
 * implementation, `word` (plans/2026-09-15-despacho-design.md §4/§7).
 *
 * Same discipline as `grow/` (the interface-grow cycle): the surface never
 * emits SPARQL or raw records. It emits a `CuentaVerbSpec` — a closed, typed
 * intent — and this module owns the whole path:
 *
 *   validate (shape) → plan (pure: spec + the bead's real reading → the exact
 *   `emporium_write` records) → DRY RUN against the real cell (the cell's own
 *   SHACL/shape preview, nothing written) → APPLY → the cell's receipt.
 *
 * Every refusal is surfaced as a typed `CuentaVerbRefusal` carrying the
 * cell's message verbatim — the phase names WHERE it refused. Nothing is
 * swallowed, nothing is retried, and no refusal is dressed as success.
 *
 * Writes go ONLY through `emporium_write(vocab="cuentas")`: the cell's
 * `rdf_authority` guard refuses `sparql_update` into `:projection:*`, and
 * the Emporium is the path that validates against the chamber ontology and
 * mints subjects (`{graph}:projection:cuentas:{class}:{localId}`) — the
 * client never mints identity, so records carry `localId`, never `subject`.
 *
 * A word closes a gate: one `Rendicion` (verdict `done`, `cta:word`,
 * `cta:utterance` verbatim — cuentas v0.2.0) plus the gate RESTATED in full
 * with `cta:status` `done` (the generic ingest is current-state-materialize:
 * a restatement is the whole record, so every predicate the bead already
 * carries rides along, lists as lists, integers as integers).
 */
import {
  CTA_NS,
  CUENTA_INTEGER_PREDICATES,
  CUENTA_MULTI_PREDICATES,
  cuentaAwaitsWord,
  type CuentaReading,
} from './cuenta-reading.js'
import { isEmbeddableFocusIri } from '../layout/named-query-registry.js'

export const CUENTA_WORDS = ['yes', 'no', 'defer', 'amend'] as const
export type CuentaWord = (typeof CUENTA_WORDS)[number]

export const CUENTA_VERBS = ['word', 'claim', 'close', 'string'] as const
export type CuentaVerb = (typeof CUENTA_VERBS)[number]

/** The closed verb union. `word` is implemented in W1; the other three are declared in the same shape and refuse at plan time until their wave. */
export type CuentaVerbSpec =
  | {
      readonly verb: 'word'
      /** The gate bead's subject IRI. */
      readonly cuenta: string
      readonly word: CuentaWord
      /** The words themselves, verbatim — required, never paraphrased. */
      readonly utterance: string
      /** Who attests: the viewer's identity as the session knows it. */
      readonly witness: string
    }
  | { readonly verb: 'claim'; readonly cuenta: string; readonly witness: string }
  | {
      readonly verb: 'close'
      readonly cuenta: string
      readonly verdict: 'done' | 'refused' | 'empty' | 'failed' | 'superseded'
      readonly summary: string
      readonly witness: string
      readonly evidence?: readonly string[]
    }
  | {
      readonly verb: 'string'
      readonly title: string
      readonly beadKind: 'task' | 'gate'
      readonly discoveredFrom: string
      readonly owner: string
      readonly witness: string
    }

export type CuentaVerbPhase = 'validate' | 'plan' | 'dry-run' | 'apply'

export interface CuentaVerbRefusal {
  readonly ok: false
  readonly phase: CuentaVerbPhase
  /** The refusing party's own words — the cell's error message verbatim when the cell refused. */
  readonly message: string
  readonly detail?: unknown
}

/** One `emporium_write` record: the wire shape the generic ingest accepts (`{kind, localId, "cta:…": …}`). */
export type EmporiumRecord = Readonly<Record<string, unknown>> & { readonly kind: string; readonly localId: string }

/** A type alias (not an interface) so it is assignable to the port's `Readonly<Record<string, unknown>>` argument. */
export type EmporiumWriteArgs = {
  readonly graphId: string
  readonly vocab: 'cuentas'
  readonly operationId: string
  readonly records: readonly EmporiumRecord[]
  readonly dryRun?: true
}

export interface CuentaVerbPlan {
  readonly ok: true
  readonly operationId: string
  readonly records: readonly EmporiumRecord[]
  /** The subjects the cell will mint, in record order (informational — the receipt is authoritative). */
  readonly localIds: readonly string[]
}

export interface EmporiumWriteReceipt {
  readonly ok: boolean
  readonly dryRun: boolean
  readonly results: ReadonlyArray<{ readonly subject: string; readonly outcome: string }>
  readonly violations: unknown
  readonly warnings: readonly string[]
}

export interface CuentaVerbApplied {
  readonly ok: true
  readonly phase: 'applied'
  readonly operationId: string
  readonly subjects: readonly string[]
  readonly receipt: EmporiumWriteReceipt
}

export interface CuentaVerbPreviewed {
  readonly ok: true
  readonly phase: 'dry-run'
  readonly operationId: string
  readonly subjects: readonly string[]
  readonly receipt: EmporiumWriteReceipt
}

export type CuentaVerbOutcome = CuentaVerbApplied | CuentaVerbRefusal

function refuse(phase: CuentaVerbPhase, message: string, detail?: unknown): CuentaVerbRefusal {
  return detail === undefined ? { ok: false, phase, message } : { ok: false, phase, message, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Shape gate: a `CuentaVerbSpec` or a `validate`-phase refusal naming the
 * first field that fails. Only the fields of the closed union are accepted;
 * an unknown key is refused (the by-shape boundary, as in `grow/apply-verb`).
 */
export function validateCuentaVerb(value: unknown): { readonly ok: true; readonly spec: CuentaVerbSpec } | CuentaVerbRefusal {
  if (!isRecord(value)) return refuse('validate', 'a verb must be an object')
  const verb = value.verb
  if (typeof verb !== 'string' || !(CUENTA_VERBS as readonly string[]).includes(verb)) {
    return refuse('validate', `unknown verb '${String(verb)}' — the closed set is ${CUENTA_VERBS.join(', ')}`)
  }
  const allowed: Record<CuentaVerb, readonly string[]> = {
    word: ['verb', 'cuenta', 'word', 'utterance', 'witness'],
    claim: ['verb', 'cuenta', 'witness'],
    close: ['verb', 'cuenta', 'verdict', 'summary', 'witness', 'evidence'],
    string: ['verb', 'title', 'beadKind', 'discoveredFrom', 'owner', 'witness'],
  }
  for (const key of Object.keys(value)) {
    if (!allowed[verb as CuentaVerb].includes(key)) return refuse('validate', `field '${key}' is not part of the '${verb}' verb`)
  }
  if (!nonEmpty(value.witness)) return refuse('validate', 'witness is required — a word without a witness is not testimony')
  if (verb === 'word') {
    if (!nonEmpty(value.cuenta) || !isEmbeddableFocusIri(value.cuenta)) return refuse('validate', 'cuenta must be the gate’s absolute IRI')
    if (typeof value.word !== 'string' || !(CUENTA_WORDS as readonly string[]).includes(value.word)) {
      return refuse('validate', `word must be one of ${CUENTA_WORDS.join(', ')}`)
    }
    if (!nonEmpty(value.utterance)) return refuse('validate', 'the utterance is required — the words themselves, verbatim')
    if (value.utterance.length > 4096) return refuse('validate', 'the utterance is longer than 4096 characters')
    return {
      ok: true,
      spec: { verb: 'word', cuenta: value.cuenta, word: value.word as CuentaWord, utterance: value.utterance, witness: value.witness },
    }
  }
  if (verb === 'claim') {
    if (!nonEmpty(value.cuenta) || !isEmbeddableFocusIri(value.cuenta)) return refuse('validate', 'cuenta must be the bead’s absolute IRI')
    return { ok: true, spec: { verb: 'claim', cuenta: value.cuenta, witness: value.witness } }
  }
  if (verb === 'close') {
    if (!nonEmpty(value.cuenta) || !isEmbeddableFocusIri(value.cuenta)) return refuse('validate', 'cuenta must be the bead’s absolute IRI')
    const verdicts = ['done', 'refused', 'empty', 'failed', 'superseded']
    if (typeof value.verdict !== 'string' || !verdicts.includes(value.verdict)) return refuse('validate', `verdict must be one of ${verdicts.join(', ')}`)
    if (!nonEmpty(value.summary)) return refuse('validate', 'summary is required — one honest paragraph')
    if (value.evidence !== undefined && !(Array.isArray(value.evidence) && value.evidence.every(nonEmpty))) {
      return refuse('validate', 'evidence must be a list of pointers')
    }
    return {
      ok: true,
      spec: {
        verb: 'close',
        cuenta: value.cuenta,
        verdict: value.verdict as 'done' | 'refused' | 'empty' | 'failed' | 'superseded',
        summary: value.summary,
        witness: value.witness,
        ...(value.evidence !== undefined ? { evidence: value.evidence as string[] } : {}),
      },
    }
  }
  if (!nonEmpty(value.title)) return refuse('validate', 'title is required')
  if (value.beadKind !== 'task' && value.beadKind !== 'gate') return refuse('validate', 'beadKind must be task or gate')
  if (!nonEmpty(value.discoveredFrom) || !isEmbeddableFocusIri(value.discoveredFrom)) return refuse('validate', 'discoveredFrom must be the parent bead’s absolute IRI')
  if (!nonEmpty(value.owner)) return refuse('validate', 'owner is required')
  return {
    ok: true,
    spec: { verb: 'string', title: value.title, beadKind: value.beadKind, discoveredFrom: value.discoveredFrom, owner: value.owner, witness: value.witness },
  }
}

/**
 * Restate a bead from its real reading as ONE generic-lane record with
 * `cta:status` overridden. Every `cta:*` predicate the bead carries rides
 * along (the ingest is current-state-materialize); lists stay lists,
 * integers become numbers, `rdf:type` is supplied by `kind`. Pure.
 */
export function restateCuenta(reading: CuentaReading, status: string): EmporiumRecord | null {
  if (!reading.localId) return null
  const record: Record<string, unknown> = { kind: 'Cuenta', localId: reading.localId }
  for (const [predicate, values] of Object.entries(reading.props)) {
    if (!predicate.startsWith(CTA_NS)) continue
    const local = predicate.slice(CTA_NS.length)
    if (local === 'status') continue
    if (values.length === 0) continue
    if (CUENTA_MULTI_PREDICATES.has(local)) record[`cta:${local}`] = [...values]
    else if (CUENTA_INTEGER_PREDICATES.has(local)) {
      const n = Number(values[0])
      if (Number.isFinite(n)) record[`cta:${local}`] = n
    } else record[`cta:${local}`] = values[0]
  }
  record['cta:status'] = status
  return record as EmporiumRecord
}

/**
 * Pure planner: the exact records a verb becomes, given the bead's REAL
 * reading (never a guessed state). `now` is injected for determinism.
 */
export function planCuentaVerb(spec: CuentaVerbSpec, reading: CuentaReading, now: Date): CuentaVerbPlan | CuentaVerbRefusal {
  if (spec.verb !== 'word') {
    return refuse('plan', `the '${spec.verb}' verb is declared but not yet implemented (W1 ships 'word'; see plans/2026-09-15-despacho-design.md §5)`)
  }
  if (reading.subject !== spec.cuenta) return refuse('plan', 'the reading is not of the gate the word is for')
  if (!reading.found) return refuse('plan', 'this gate has no record in the graph — nothing to give a word on')
  if (!reading.localId) return refuse('plan', 'the subject is not a cuentas bead (no `:cuenta:` local id)')
  if (!cuentaAwaitsWord(reading)) {
    return refuse(
      'plan',
      reading.beadKind !== 'gate'
        ? `only a gate takes a word; this bead is a ${reading.beadKind ?? 'bead of unknown kind'}`
        : `this gate is ${reading.status ?? 'in an unknown state'}, not open — its word has already been given`,
    )
  }
  const n = reading.rendiciones.length + 1
  const rendicionLocalId = `${reading.localId}-r${n}`
  const renderedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const rendicion: EmporiumRecord = {
    kind: 'Rendicion',
    localId: rendicionLocalId,
    'cta:forCuenta': reading.subject,
    'cta:verdict': 'done',
    'cta:word': spec.word,
    'cta:utterance': spec.utterance,
    'cta:witness': spec.witness,
    'cta:summary': `Word given from el Despacho: ${spec.word}.`,
    'cta:renderedAt': renderedAt,
  }
  const restated = restateCuenta(reading, 'done')
  if (!restated) return refuse('plan', 'the gate could not be restated')
  return {
    ok: true,
    operationId: `despacho-word-${rendicionLocalId}`,
    records: [rendicion, restated],
    localIds: [rendicionLocalId, reading.localId],
  }
}

/** The one tool-call seam the executor needs — the organism's gateway MCP client satisfies it. */
export interface CuentaVerbPort {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

/** Parse the cell's `emporium_write` result (structured content, or its text payload) into a receipt; null when it is not one. */
export function parseEmporiumWriteReceipt(raw: unknown): EmporiumWriteReceipt | null {
  let value: unknown = raw
  if (isRecord(value) && Array.isArray(value.content) && !('ok' in value)) {
    const text = (value.content as unknown[]).find((part) => isRecord(part) && part.type === 'text') as { text?: string } | undefined
    if (text?.text) {
      try {
        value = JSON.parse(text.text)
      } catch {
        return null
      }
    }
  }
  if (!isRecord(value) || typeof value.ok !== 'boolean' || !Array.isArray(value.results)) return null
  return {
    ok: value.ok,
    dryRun: value.dryRun === true,
    results: (value.results as unknown[]).flatMap((entry) =>
      isRecord(entry) && typeof entry.subject === 'string'
        ? [{ subject: entry.subject, outcome: typeof entry.outcome === 'string' ? entry.outcome : 'unknown' }]
        : [],
    ),
    violations: value.violations ?? null,
    warnings: Array.isArray(value.warnings) ? (value.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : [],
  }
}

function receiptRefusal(phase: 'dry-run' | 'apply', receipt: EmporiumWriteReceipt): CuentaVerbRefusal | null {
  if (receipt.ok && receipt.violations === null) return null
  const violations = receipt.violations
  const summary = Array.isArray(violations) && violations.length > 0
    ? violations.map((v) => (isRecord(v) && typeof v.message === 'string' ? v.message : JSON.stringify(v))).join('; ')
    : `the cell reported ok=${receipt.ok}`
  return refuse(phase, `the cell refused at ${phase}: ${summary}`, receipt)
}

export interface CuentaVerbExecutorOptions {
  readonly port: CuentaVerbPort
  readonly graphId: string
  readonly now?: () => Date
}

export interface CuentaVerbExecutor {
  /** validate → plan → dry run; nothing written. */
  preview(spec: unknown, reading: CuentaReading): Promise<CuentaVerbPreviewed | CuentaVerbRefusal>
  /** validate → plan → dry run → apply. The receipt is the cell's. */
  execute(spec: unknown, reading: CuentaReading): Promise<CuentaVerbOutcome>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createCuentaVerbExecutor(options: CuentaVerbExecutorOptions): CuentaVerbExecutor {
  const now = options.now ?? (() => new Date())
  const write = async (args: EmporiumWriteArgs): Promise<EmporiumWriteReceipt | CuentaVerbRefusal> => {
    const phase = args.dryRun ? 'dry-run' : 'apply'
    let raw: unknown
    try {
      raw = await options.port.callTool('emporium_write', args)
    } catch (error) {
      // The cell's own words, verbatim (e.g. "unknown embedded vocabulary 'cuentas'").
      return refuse(phase, errorMessage(error), error)
    }
    const receipt = parseEmporiumWriteReceipt(raw)
    if (!receipt) return refuse(phase, 'the cell answered, but not with an emporium_write receipt', raw)
    return receiptRefusal(phase, receipt) ?? receipt
  }
  const prepare = (spec: unknown, reading: CuentaReading): CuentaVerbPlan | CuentaVerbRefusal => {
    const validated = validateCuentaVerb(spec)
    if (!validated.ok) return validated
    return planCuentaVerb(validated.spec, reading, now())
  }
  const argsFor = (plan: CuentaVerbPlan, dryRun: boolean): EmporiumWriteArgs => ({
    graphId: options.graphId,
    vocab: 'cuentas',
    operationId: plan.operationId,
    records: plan.records,
    ...(dryRun ? { dryRun: true as const } : {}),
  })
  return {
    async preview(spec, reading) {
      const plan = prepare(spec, reading)
      if (!plan.ok) return plan
      const receipt = await write(argsFor(plan, true))
      if ('ok' in receipt && receipt.ok === false && 'phase' in receipt) return receipt
      const dry = receipt as EmporiumWriteReceipt
      return { ok: true, phase: 'dry-run', operationId: plan.operationId, subjects: dry.results.map((r) => r.subject), receipt: dry }
    },
    async execute(spec, reading) {
      const plan = prepare(spec, reading)
      if (!plan.ok) return plan
      const dry = await write(argsFor(plan, true))
      if ('phase' in dry) return dry
      const applied = await write(argsFor(plan, false))
      if ('phase' in applied) return applied
      return { ok: true, phase: 'applied', operationId: plan.operationId, subjects: applied.results.map((r) => r.subject), receipt: applied }
    },
  }
}
