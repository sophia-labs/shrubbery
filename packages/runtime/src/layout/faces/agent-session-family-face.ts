/**
 * Read-only family inspector for a graph-projected Sophia Agent Session.
 *
 * The resource is a graph-scoped parent `agt:Session`. The fixed query reads
 * only that cell's user-RDF authority named graph; it never scans `GRAPH ?g`
 * and never asks for conversation bodies, prompts, model coordinates, binding
 * digests, or body identifiers. The face owns a one-second refresh cadence over
 * one retained store, matching `stat.scalar`'s live-Surface discipline.
 */
import type { StoreState } from '@shrubbery/nucleus'
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import {
  plainQueryBlockTermValue,
  type QueryBlockResult,
  type QueryBlockRow,
  type QueryBlockService,
} from '../../editor-services/query-block-service.js'
import './agent-session-family-view-element.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import type {
  AgentSessionFamilyBudgetAccountView,
  AgentSessionFamilyBudgetView,
  AgentSessionFamilyChildView,
  AgentSessionFamilyMaterializationView,
  AgentSessionFamilyViewModel,
  ShAgentSessionFamilyView,
} from './agent-session-family-view-element.js'

export const AGENT_SESSION_FAMILY_FACE_ID = 'agent.session-family'
export const AGENT_SESSION_FAMILY_ADAPTER_ID = 'agent.session-family.graph-query'
export const AGENT_RUNTIME_NS = 'http://sophia.ai/agent-runtime#'
export const AGENT_SESSION_FAMILY_REFRESH_MS = 1_000
const AGENT_NS = 'http://mnemosyne.dev/agent#'
const PROV_NS = 'http://www.w3.org/ns/prov#'
const SERVICE_MAX_ROWS = 500
const SPARQL_IRIREF_PUNCTUATION = new Set(['<', '>', '"', '{', '}', '|', '^', '`', '\\'])

export interface AgentSessionFamilyQueryHandle {
  readonly graphId: string
  readonly parentSessionIri: string
  readonly store: SurfaceResourceStore<QueryBlockResult>
}

function isSafeIriText(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const code = character.charCodeAt(0)
    return code > 0x20 && code !== 0x7f && !SPARQL_IRIREF_PUNCTUATION.has(character)
  })
}

function isAgentSessionFamilyLocator(locator: ResourceLocator): boolean {
  return locator.kind === 'graph'
    && isSafeIriText(locator.graphId)
    && typeof locator.subjectIri === 'string'
    && isSafeIriText(locator.subjectIri)
}

function familyCoordinates(locator: ResourceLocator): { readonly graphId: string; readonly parentSessionIri: string } {
  if (!isAgentSessionFamilyLocator(locator) || locator.kind !== 'graph' || !locator.subjectIri) {
    throw new Error('agent.session-family requires a safe graph locator with a parent session subjectIri')
  }
  return { graphId: locator.graphId, parentSessionIri: locator.subjectIri }
}

/** The only named graph this face is permitted to read for a workspace graph. */
export function agentSessionUserRdfGraphIri(graphId: string): string {
  if (!isSafeIriText(graphId)) throw new Error('agent.session-family graphId is not safe for an RDF graph IRI')
  return `urn:mnemosyne:local:graph:${graphId}:user:rdf`
}

/**
 * Fixed, projection-only query. Optional groups correspond to Arc F's staged
 * facts: F1 relation, F2 admission/allocation, F3 materialized bodies, F4
 * aggregate capacity/cost enforcement, and F5 crash/cancellation testimony.
 */
export function agentSessionFamilyQuery(graphId: string, parentSessionIri: string): string {
  if (!isSafeIriText(parentSessionIri)) throw new Error('agent.session-family parent session IRI is unsafe')
  const userRdf = agentSessionUserRdfGraphIri(graphId)
  return `PREFIX ar: <${AGENT_RUNTIME_NS}>
PREFIX agt: <${AGENT_NS}>
PREFIX prov: <${PROV_NS}>
SELECT ?parentSessionId ?parentState ?projectionRevision
       ?parentMaterializationGeneration ?parentMaterializationState
       ?parentWorkerState ?parentKernelState
       ?parentMaterializationFaultKind ?parentMaterializationRecoverable
       ?directAcceptedChildren ?maxChildren
       ?occupiedChildren ?maxConcurrentChildren
       ?budgetCostSpentUsdMicros ?budgetCostReservedUsdMicros
       ?budgetCostRemainingUsdMicros ?budgetCostMaxUsdMicros
       ?budgetAccountRevision ?budgetAccountExhausted
       ?relation ?registrationStatus ?registeredAt ?depth
       ?child ?childName ?childSessionId ?childSessionState
       ?admissionStatus ?runtimeKind ?childRunState
       ?allocationState ?allocationHoldKind ?settledActualCostUsdMicros
       ?materializationGeneration ?materializationState ?workerState ?kernelState
       ?materializationFaultKind ?materializationRecoverable
       ?allocatedTurns ?allocatedWallTimeMs ?allocatedTokens
       ?allocatedCostUsdMicros ?allocatedArtifactBytes
WHERE {
  GRAPH <${userRdf}> {
    <${parentSessionIri}> a agt:Session ;
      agt:sessionId ?parentSessionId ;
      ar:sessionState ?parentState ;
      ar:projectionRevision ?projectionRevision ;
      ar:directAcceptedChildren ?directAcceptedChildren ;
      ar:maxChildren ?maxChildren ;
      ar:occupiedChildren ?occupiedChildren ;
      ar:maxConcurrentChildren ?maxConcurrentChildren ;
      ar:budgetCostSpentUsdMicros ?budgetCostSpentUsdMicros ;
      ar:budgetCostReservedUsdMicros ?budgetCostReservedUsdMicros ;
      ar:budgetCostRemainingUsdMicros ?budgetCostRemainingUsdMicros ;
      ar:budgetCostMaxUsdMicros ?budgetCostMaxUsdMicros ;
      ar:budgetAccountRevision ?budgetAccountRevision ;
      ar:budgetAccountExhausted ?budgetAccountExhausted .
    OPTIONAL { <${parentSessionIri}> ar:materializationGeneration ?parentMaterializationGeneration . }
    OPTIONAL { <${parentSessionIri}> ar:materializationState ?parentMaterializationState . }
    OPTIONAL { <${parentSessionIri}> ar:workerState ?parentWorkerState . }
    OPTIONAL { <${parentSessionIri}> ar:kernelState ?parentKernelState . }
    OPTIONAL { <${parentSessionIri}> ar:materializationFaultKind ?parentMaterializationFaultKind . }
    OPTIONAL { <${parentSessionIri}> ar:materializationRecoverable ?parentMaterializationRecoverable . }
    OPTIONAL {
      <${parentSessionIri}> (^ar:parentSession/ar:childSession)+ ?child .
      ?relation a ar:ChildSessionRelation ;
        ar:parentSession ?immediateParent ;
        ar:childSession ?child ;
        ar:childName ?childName ;
        ar:depth ?depth ;
        ar:registrationStatus ?registrationStatus ;
        prov:generatedAtTime ?registeredAt .
      ?child a agt:Session ;
        agt:sessionId ?childSessionId ;
        ar:sessionState ?childSessionState .
      OPTIONAL { ?relation ar:admissionStatus ?admissionStatus . }
      OPTIONAL { ?relation ar:runtimeKind ?runtimeKind . }
      OPTIONAL { ?relation ar:childRunState ?childRunState . }
      OPTIONAL { ?relation ar:allocationState ?allocationState . }
      OPTIONAL { ?relation ar:allocationHoldKind ?allocationHoldKind . }
      OPTIONAL { ?relation ar:allocatedTurns ?allocatedTurns . }
      OPTIONAL { ?relation ar:allocatedWallTimeMs ?allocatedWallTimeMs . }
      OPTIONAL { ?relation ar:allocatedTokens ?allocatedTokens . }
      OPTIONAL { ?relation ar:allocatedCostUsdMicros ?allocatedCostUsdMicros . }
      OPTIONAL { ?relation ar:allocatedArtifactBytes ?allocatedArtifactBytes . }
      OPTIONAL { ?relation ar:settledActualCostUsdMicros ?settledActualCostUsdMicros . }
      OPTIONAL { ?child ar:materializationGeneration ?materializationGeneration . }
      OPTIONAL { ?child ar:materializationState ?materializationState . }
      OPTIONAL { ?child ar:workerState ?workerState . }
      OPTIONAL { ?child ar:kernelState ?kernelState . }
      OPTIONAL { ?child ar:materializationFaultKind ?materializationFaultKind . }
      OPTIONAL { ?child ar:materializationRecoverable ?materializationRecoverable . }
    }
  }
}
ORDER BY ?depth ?registeredAt ?childSessionId
LIMIT ${SERVICE_MAX_ROWS}`
}

export function createAgentSessionFamilyResourceAdapter(
  service: QueryBlockService,
): DerivedResourceAdapter<AgentSessionFamilyQueryHandle> {
  return {
    adapterId: AGENT_SESSION_FAMILY_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isAgentSessionFamilyLocator,
    resourceKey(locator): ResourceKey {
      const { graphId, parentSessionIri } = familyCoordinates(locator)
      return resourceKeyTuple('agent-session-family', graphId, parentSessionIri)
    },
    async compute(locator, context) {
      const { graphId, parentSessionIri } = familyCoordinates(locator)
      return {
        graphId,
        parentSessionIri,
        store: createSurfaceResourceStore(
          () => service.run(graphId, agentSessionFamilyQuery(graphId, parentSessionIri), SERVICE_MAX_ROWS),
          context,
        ),
      }
    },
  }
}

function required(row: QueryBlockRow, field: string, context = 'agent.session-family'): string {
  const value = plainQueryBlockTermValue(row[field])
  if (!value) throw new Error(`${context} is missing ${field}`)
  return value
}

function optional(row: QueryBlockRow, field: string): string | null {
  return plainQueryBlockTermValue(row[field]) || null
}

function exactNonNegativeInteger(row: QueryBlockRow, field: string, context: string): number {
  const raw = required(row, field, context)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} has invalid ${field}`)
  }
  return value
}

function exactBoolean(row: QueryBlockRow, field: string, context: string): boolean {
  const raw = required(row, field, context)
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${context} has invalid ${field}`)
}

function budgetAccountFromRow(row: QueryBlockRow): AgentSessionFamilyBudgetAccountView {
  const context = 'agent.session-family parent budget account'
  const account: AgentSessionFamilyBudgetAccountView = {
    directAcceptedChildren: exactNonNegativeInteger(row, 'directAcceptedChildren', context),
    maxChildren: exactNonNegativeInteger(row, 'maxChildren', context),
    occupiedChildren: exactNonNegativeInteger(row, 'occupiedChildren', context),
    maxConcurrentChildren: exactNonNegativeInteger(row, 'maxConcurrentChildren', context),
    budgetCostSpentUsdMicros: exactNonNegativeInteger(row, 'budgetCostSpentUsdMicros', context),
    budgetCostReservedUsdMicros: exactNonNegativeInteger(row, 'budgetCostReservedUsdMicros', context),
    budgetCostRemainingUsdMicros: exactNonNegativeInteger(row, 'budgetCostRemainingUsdMicros', context),
    budgetCostMaxUsdMicros: exactNonNegativeInteger(row, 'budgetCostMaxUsdMicros', context),
    budgetAccountRevision: exactNonNegativeInteger(row, 'budgetAccountRevision', context),
    budgetAccountExhausted: exactBoolean(row, 'budgetAccountExhausted', context),
  }
  if (
    account.directAcceptedChildren > account.maxChildren
    || account.occupiedChildren > account.maxConcurrentChildren
    || account.occupiedChildren > account.directAcceptedChildren
  ) {
    throw new Error(`${context} has divergent child capacity aggregates`)
  }
  const spentOverLimit = account.budgetCostSpentUsdMicros > account.budgetCostMaxUsdMicros
  const unspent = account.budgetCostSpentUsdMicros >= account.budgetCostMaxUsdMicros
    ? 0
    : account.budgetCostMaxUsdMicros - account.budgetCostSpentUsdMicros
  const aggregateOverLimit = spentOverLimit || account.budgetCostReservedUsdMicros > unspent
  const expectedRemaining = account.budgetCostReservedUsdMicros >= unspent
    ? 0
    : unspent - account.budgetCostReservedUsdMicros
  if (account.budgetCostRemainingUsdMicros !== expectedRemaining) {
    throw new Error(`${context} has divergent remaining cost budget`)
  }
  if (aggregateOverLimit && !account.budgetAccountExhausted) {
    throw new Error(`${context} has unacknowledged cost overage`)
  }
  return account
}

function sameBudgetAccount(
  left: AgentSessionFamilyBudgetAccountView,
  right: AgentSessionFamilyBudgetAccountView,
): boolean {
  return left.directAcceptedChildren === right.directAcceptedChildren
    && left.maxChildren === right.maxChildren
    && left.occupiedChildren === right.occupiedChildren
    && left.maxConcurrentChildren === right.maxConcurrentChildren
    && left.budgetCostSpentUsdMicros === right.budgetCostSpentUsdMicros
    && left.budgetCostReservedUsdMicros === right.budgetCostReservedUsdMicros
    && left.budgetCostRemainingUsdMicros === right.budgetCostRemainingUsdMicros
    && left.budgetCostMaxUsdMicros === right.budgetCostMaxUsdMicros
    && left.budgetAccountRevision === right.budgetAccountRevision
    && left.budgetAccountExhausted === right.budgetAccountExhausted
}

function allocationStateFromRow(row: QueryBlockRow): AgentSessionFamilyBudgetView['allocationState'] {
  const state = required(row, 'allocationState', 'agent.session-family child allocation')
  if (state !== 'reserved' && state !== 'settled' && state !== 'released' && state !== 'accounting_hold') {
    throw new Error('agent.session-family child allocation has invalid allocationState')
  }
  return state
}

function sessionStateFromRow(row: QueryBlockRow, field: string, context: string): AgentSessionFamilyViewModel['parentState'] {
  const state = required(row, field, context)
  if (state !== 'open' && state !== 'closing' && state !== 'closed' && state !== 'faulted') {
    throw new Error(`${context} has invalid ${field}`)
  }
  return state
}

function childRunStateFromRow(row: QueryBlockRow): AgentSessionFamilyChildView['childRunState'] {
  const state = required(row, 'childRunState', 'agent.session-family child run')
  if (
    state !== 'queued'
    && state !== 'claimed'
    && state !== 'cancelling'
    && state !== 'completed'
    && state !== 'failed'
    && state !== 'cancelled'
  ) {
    throw new Error('agent.session-family child run has invalid childRunState')
  }
  return state
}

function materializationState(value: string, context: string): AgentSessionFamilyMaterializationView['state'] {
  if (
    value !== 'claimed'
    && value !== 'running'
    && value !== 'quiescing'
    && value !== 'quiescent'
    && value !== 'passivated'
    && value !== 'completed'
    && value !== 'faulted'
    && value !== 'cancelled'
  ) {
    throw new Error(`${context} has invalid materializationState`)
  }
  return value
}

function workerState(value: string, context: string): AgentSessionFamilyMaterializationView['workerState'] {
  return materializationState(value, context)
}

function kernelState(value: string, context: string): NonNullable<AgentSessionFamilyMaterializationView['kernelState']> {
  if (value !== 'running' && value !== 'released' && value !== 'shutdown' && value !== 'faulted' && value !== 'cancelled') {
    throw new Error(`${context} has invalid kernelState`)
  }
  return value
}

function faultKind(value: string, context: string): NonNullable<AgentSessionFamilyMaterializationView['faultKind']> {
  if (
    value !== 'worker_spawn'
    && value !== 'worker_exit'
    && value !== 'worker_timeout'
    && value !== 'worker_oom'
    && value !== 'worker_protocol'
    && value !== 'kernel_fault'
    && value !== 'quiescence_fault'
    && value !== 'checkpoint_fault'
    && value !== 'replay_divergence'
    && value !== 'host_invariant'
  ) {
    throw new Error(`${context} has invalid materializationFaultKind`)
  }
  return value
}

function materializationFromRow(
  row: QueryBlockRow,
  fields: {
    readonly generation: string
    readonly state: string
    readonly worker: string
    readonly kernel: string
    readonly faultKind: string
    readonly recoverable: string
  },
  context: string,
): AgentSessionFamilyMaterializationView | null {
  const values = Object.values(fields).map((field) => optional(row, field))
  if (values.every((value) => value === null)) return null
  const generation = optional(row, fields.generation)
  const stateValue = optional(row, fields.state)
  const workerValue = optional(row, fields.worker)
  if (generation === null || stateValue === null || workerValue === null) {
    throw new Error(`${context} has partial materialization testimony`)
  }
  const state = materializationState(stateValue, context)
  const faultKindValue = optional(row, fields.faultKind)
  const recoverableValue = optional(row, fields.recoverable)
  if ((faultKindValue === null) !== (recoverableValue === null) || ((state === 'faulted') !== (faultKindValue !== null))) {
    throw new Error(`${context} has dishonest fault testimony`)
  }
  return {
    generation: exactNonNegativeInteger(row, fields.generation, context),
    state,
    workerState: workerState(workerValue, context),
    kernelState: optional(row, fields.kernel) === null
      ? null
      : kernelState(required(row, fields.kernel, context), context),
    faultKind: faultKindValue === null ? null : faultKind(faultKindValue, context),
    recoverable: recoverableValue === null ? null : exactBoolean(row, fields.recoverable, context),
  }
}

function admissionFromRow(row: QueryBlockRow): {
  readonly childRunState: AgentSessionFamilyChildView['childRunState']
  readonly budget: AgentSessionFamilyBudgetView
} | null {
  const fields = [
    'admissionStatus',
    'runtimeKind',
    'childRunState',
    'allocationState',
    'allocatedTurns',
    'allocatedWallTimeMs',
    'allocatedTokens',
    'allocatedCostUsdMicros',
    'allocatedArtifactBytes',
  ] as const
  const present = fields.filter((field) => optional(row, field) !== null)
  if (present.length === 0) {
    if (optional(row, 'settledActualCostUsdMicros') !== null || optional(row, 'allocationHoldKind') !== null) {
      throw new Error('agent.session-family child has orphaned allocation outcome testimony')
    }
    return null
  }
  if (present.length !== fields.length) {
    throw new Error('agent.session-family child has a partial admission/allocation projection')
  }
  const allocationState = allocationStateFromRow(row)
  const settledActualCost = optional(row, 'settledActualCostUsdMicros')
  if ((allocationState === 'settled') !== (settledActualCost !== null)) {
    throw new Error('agent.session-family child allocation has dishonest settled cost testimony')
  }
  const holdKind = optional(row, 'allocationHoldKind')
  if ((allocationState === 'accounting_hold') !== (holdKind !== null)) {
    throw new Error('agent.session-family child allocation has dishonest accounting hold testimony')
  }
  if (holdKind !== null && holdKind !== 'unresolved_child_reservations') {
    throw new Error('agent.session-family child allocation has invalid allocationHoldKind')
  }
  const admissionStatus = required(row, 'admissionStatus')
  if (admissionStatus !== 'admitted') throw new Error('agent.session-family child has invalid admissionStatus')
  const runtimeKind = required(row, 'runtimeKind')
  if (runtimeKind !== 'simple' && runtimeKind !== 'prime') {
    throw new Error('agent.session-family child has invalid runtimeKind')
  }
  return {
    childRunState: childRunStateFromRow(row),
    budget: {
    admissionStatus,
    runtimeKind,
    allocationState,
    allocationHoldKind: holdKind,
    settledActualCostUsdMicros: settledActualCost === null
      ? null
      : exactNonNegativeInteger(row, 'settledActualCostUsdMicros', 'agent.session-family child allocation'),
    allocatedTurns: exactNonNegativeInteger(row, 'allocatedTurns', 'agent.session-family child allocation'),
    allocatedWallTimeMs: exactNonNegativeInteger(row, 'allocatedWallTimeMs', 'agent.session-family child allocation'),
    allocatedTokens: exactNonNegativeInteger(row, 'allocatedTokens', 'agent.session-family child allocation'),
    allocatedCostUsdMicros: exactNonNegativeInteger(row, 'allocatedCostUsdMicros', 'agent.session-family child allocation'),
    allocatedArtifactBytes: exactNonNegativeInteger(row, 'allocatedArtifactBytes', 'agent.session-family child allocation'),
    },
  }
}

function childFromRow(row: QueryBlockRow): AgentSessionFamilyChildView | null {
  const childMarkers = ['relation', 'child', 'childName', 'childSessionId', 'registrationStatus', 'registeredAt', 'depth']
  const present = childMarkers.filter((field) => optional(row, field) !== null)
  if (present.length === 0) return null
  if (present.length !== childMarkers.length) {
    throw new Error('agent.session-family child relation projection is incomplete')
  }
  const registrationStatus = required(row, 'registrationStatus')
  if (registrationStatus !== 'registered') {
    throw new Error('agent.session-family child relation has invalid registrationStatus')
  }
  const admission = admissionFromRow(row)
  const depth = exactNonNegativeInteger(row, 'depth', 'agent.session-family child relation')
  if (depth < 1) throw new Error('agent.session-family child relation has invalid depth')
  return {
    childName: required(row, 'childName'),
    childSessionId: required(row, 'childSessionId'),
    depth,
    registrationStatus,
    registeredAt: required(row, 'registeredAt'),
    sessionState: sessionStateFromRow(row, 'childSessionState', 'agent.session-family child Session'),
    childRunState: admission?.childRunState ?? null,
    budget: admission?.budget ?? null,
    materialization: materializationFromRow(row, {
      generation: 'materializationGeneration',
      state: 'materializationState',
      worker: 'workerState',
      kernel: 'kernelState',
      faultKind: 'materializationFaultKind',
      recoverable: 'materializationRecoverable',
    }, 'agent.session-family child materialization'),
  }
}

/** Decode only the allowlisted display variables selected by the fixed query. */
export function agentSessionFamilyFromResult(result: QueryBlockResult): AgentSessionFamilyViewModel {
  if (result.resultKind !== 'bindings') throw new Error('agent.session-family requires a SELECT bindings result')
  const first = result.rows[0]
  if (!first) throw new Error('agent.session-family parent session was not found')
  const parentSessionId = required(first, 'parentSessionId')
  const parentState = sessionStateFromRow(first, 'parentState', 'agent.session-family parent Session')
  const projectionRevision = exactNonNegativeInteger(first, 'projectionRevision', 'agent.session-family projection')
  const parentMaterialization = materializationFromRow(first, {
    generation: 'parentMaterializationGeneration',
    state: 'parentMaterializationState',
    worker: 'parentWorkerState',
    kernel: 'parentKernelState',
    faultKind: 'parentMaterializationFaultKind',
    recoverable: 'parentMaterializationRecoverable',
  }, 'agent.session-family parent materialization')
  const budgetAccount = budgetAccountFromRow(first)
  const children: AgentSessionFamilyChildView[] = []
  const seenSessionIds = new Set<string>()
  for (const row of result.rows) {
    if (
      required(row, 'parentSessionId') !== parentSessionId
      || sessionStateFromRow(row, 'parentState', 'agent.session-family parent Session') !== parentState
      || exactNonNegativeInteger(row, 'projectionRevision', 'agent.session-family projection') !== projectionRevision
      || JSON.stringify(materializationFromRow(row, {
        generation: 'parentMaterializationGeneration',
        state: 'parentMaterializationState',
        worker: 'parentWorkerState',
        kernel: 'parentKernelState',
        faultKind: 'parentMaterializationFaultKind',
        recoverable: 'parentMaterializationRecoverable',
      }, 'agent.session-family parent materialization')) !== JSON.stringify(parentMaterialization)
    ) {
      throw new Error('agent.session-family result mixes parent Session testimony')
    }
    if (!sameBudgetAccount(budgetAccountFromRow(row), budgetAccount)) {
      throw new Error('agent.session-family result mixes parent budget accounts')
    }
    const child = childFromRow(row)
    if (!child) continue
    if (seenSessionIds.has(child.childSessionId)) {
      throw new Error('agent.session-family result repeats a child session')
    }
    seenSessionIds.add(child.childSessionId)
    children.push(child)
  }
  children.sort((left, right) => left.depth - right.depth
    || left.registeredAt.localeCompare(right.registeredAt)
    || left.childSessionId.localeCompare(right.childSessionId))
  return { parentSessionId, parentState, projectionRevision, parentMaterialization, budgetAccount, children }
}

function constraints(): LeafConstraints {
  return { minWidth: 420, minHeight: 220, overflow: 'clip' }
}

export function createAgentSessionFamilyFace(): FaceRegistration {
  return {
    faceId: AGENT_SESSION_FAMILY_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: AGENT_SESSION_FAMILY_ADAPTER_ID,
    accepts: isAgentSessionFamilyLocator,
    paramsSchema: closedParamsSchema({}),
    constraints,
    async mount({ target, descriptor, lease }) {
      const handle = lease.value as AgentSessionFamilyQueryHandle
      const view = document.createElement('sh-agent-session-family-view') as ShAgentSessionFamilyView
      view.status = 'loading'
      target.replaceChildren(view)

      let disposed = false
      let timer: ReturnType<typeof setInterval> | null = null
      const applyState = (state: StoreState<QueryBlockResult>): void => {
        if (disposed) return
        view.dataset.resourceState = state.status
        if (state.read !== null) {
          try {
            view.family = agentSessionFamilyFromResult(state.read)
            view.status = 'ready'
            view.error = ''
            if (state.status === 'ready') delete view.dataset.resourceStale
            else view.dataset.resourceStale = 'true'
          } catch (error) {
            view.status = 'error'
            view.error = error instanceof Error ? error.message : String(error)
          }
          return
        }
        delete view.dataset.resourceStale
        if (state.status === 'error') {
          view.status = 'error'
          view.error = state.error ?? 'Unable to load this Agent Session family.'
        } else {
          view.status = 'loading'
        }
      }
      const unsubscribe = observeSurfaceResourceStore(handle.store, applyState)
      const refresh = async (): Promise<void> => {
        if (!disposed) await handle.store.refresh()
      }
      await refresh()
      if (!disposed) timer = setInterval(() => void refresh(), AGENT_SESSION_FAMILY_REFRESH_MS)

      const faceView: FaceView = {
        focus() {
          view.focus()
          return true
        },
        blur() { view.blur() },
        resize() {},
        serialize(): ViewDescriptor { return descriptor },
        dispose() {
          if (disposed) return
          disposed = true
          if (timer !== null) clearInterval(timer)
          unsubscribe()
          view.remove()
        },
      }
      return faceView
    },
  }
}
