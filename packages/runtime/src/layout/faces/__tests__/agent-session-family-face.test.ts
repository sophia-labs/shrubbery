/**
 * @vitest-environment jsdom
 *
 * Deterministic Arc-F fixture proof. These are normalized SPARQL bindings,
 * never invented live/cloud triples.
 */

import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { Store } from 'oxigraph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryStore } from '../../../__tests__/named-graph-store.js'
import type {
  QueryBlockResult,
  QueryBlockRow,
  QueryBlockService,
  QueryBlockTerm,
} from '../../../editor-services/query-block-service.js'
import { FaceRegistry } from '../../face-registry.js'
import { createFragmentFaceRegistry } from '../../fragment-face-set.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import {
  AGENT_SESSION_FAMILY_ADAPTER_ID,
  AGENT_SESSION_FAMILY_FACE_ID,
  AGENT_SESSION_FAMILY_REFRESH_MS,
  agentSessionFamilyFromResult,
  agentSessionFamilyQuery,
  createAgentSessionFamilyFace,
  createAgentSessionFamilyResourceAdapter,
} from '../agent-session-family-face.js'
import '../agent-session-family-view-element.js'
import {
  type AgentSessionFamilyViewModel,
  type ShAgentSessionFamilyView,
  shortAgentSessionId,
} from '../agent-session-family-view-element.js'

const GRAPH_ID = 'prime-notebook-lab'
const PARENT_IRI = 'urn:sophia:agent:agent-deadbeef:session:ags_parent_0123456789'
const PARENT = {
  parentSessionId: 'ags_parent_0123456789',
  parentState: 'open',
  projectionRevision: '17',
  directAcceptedChildren: '1',
  maxChildren: '4',
  occupiedChildren: '1',
  maxConcurrentChildren: '2',
  budgetCostSpentUsdMicros: '100000',
  budgetCostReservedUsdMicros: '250000',
  budgetCostRemainingUsdMicros: '650000',
  budgetCostMaxUsdMicros: '1000000',
  budgetAccountRevision: '7',
  budgetAccountExhausted: 'false',
} as const

const BUDGET_ACCOUNT = {
  directAcceptedChildren: 1,
  maxChildren: 4,
  occupiedChildren: 1,
  maxConcurrentChildren: 2,
  budgetCostSpentUsdMicros: 100000,
  budgetCostReservedUsdMicros: 250000,
  budgetCostRemainingUsdMicros: 650000,
  budgetCostMaxUsdMicros: 1000000,
  budgetAccountRevision: 7,
  budgetAccountExhausted: false,
} as const

function term(value: string, type: QueryBlockTerm['type'] = 'literal'): QueryBlockTerm {
  return { type, value }
}

function fixtureRow(values: Record<string, string>): QueryBlockRow {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    term(value, key === 'relation' || key === 'child' ? 'uri' : 'literal'),
  ]))
}

function bindings(rows: readonly QueryBlockRow[]): QueryBlockResult {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return {
    queryKind: 'select',
    resultKind: 'bindings',
    columns,
    rows,
    totalRowCount: rows.length,
    durationMs: 1,
    raw: null,
  }
}

function parentOnly(state: string = PARENT.parentState): QueryBlockResult {
  return bindings([fixtureRow({ ...PARENT, parentState: state })])
}

function f1Child(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...PARENT,
    relation: 'urn:sophia:agent-runtime:relation:parent:research',
    registrationStatus: 'registered',
    registeredAt: '2026-08-08T01:02:03.000Z',
    child: 'urn:sophia:agent:agent-deadbeef:session:ags_child_research_abcdef',
    childName: 'research',
    childSessionId: 'ags_child_research_abcdef',
    childSessionState: 'open',
    depth: '1',
    ...overrides,
  }
}

function f2Child(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...f1Child(),
    admissionStatus: 'admitted',
    runtimeKind: 'simple',
    childRunState: 'queued',
    allocationState: 'reserved',
    allocatedTurns: '12',
    allocatedWallTimeMs: '45000',
    allocatedTokens: '8192',
    allocatedCostUsdMicros: '250000',
    allocatedArtifactBytes: '1048576',
    ...overrides,
  }
}

function familyDocument(): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'agent-family-fixture',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'family',
    nodes: {
      family: {
        kind: 'leaf',
        id: 'family',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: AGENT_SESSION_FAMILY_FACE_ID,
          resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri: PARENT_IRI },
        },
      },
    },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }
}

describe('agent.session-family — sealed projection contract', () => {
  it('is in the sealed graph-authorable catalogue with a closed zero-field params schema', () => {
    const registry = createFragmentFaceRegistry()
    const node = familyDocument().nodes.family
    if (node?.kind !== 'leaf') throw new Error('fixture family node is not a leaf')
    expect(registry.sealed()).toBe(true)
    expect(registry.has(AGENT_SESSION_FAMILY_FACE_ID)).toBe(true)
    expect(registry.validate(node.descriptor)).toMatchObject({ ok: true })
    expect(registry.validate({
      ...node.descriptor,
      params: { arbitrary: true },
    })).toMatchObject({ ok: false, reason: 'invalid-params' })
    expect(createAgentSessionFamilyFace().resourceAdapterId).toBe(AGENT_SESSION_FAMILY_ADAPTER_ID)
  })

  it('accepts only a safe graph+subject locator', () => {
    const adapter = createAgentSessionFamilyResourceAdapter({ async run() { return parentOnly() } })
    expect(adapter.accepts({ kind: 'graph', graphId: GRAPH_ID, subjectIri: PARENT_IRI })).toBe(true)
    expect(adapter.accepts({ kind: 'graph', graphId: GRAPH_ID })).toBe(false)
    expect(adapter.accepts({ kind: 'iri', iri: PARENT_IRI })).toBe(false)
    expect(adapter.accepts({ kind: 'graph', graphId: GRAPH_ID, subjectIri: `${PARENT_IRI}> } UNION { ?s ?p ?o` })).toBe(false)
  })

  it('targets exactly user:rdf, never a variable graph, and selects no sensitive payload coordinate', () => {
    const query = agentSessionFamilyQuery(GRAPH_ID, PARENT_IRI)
    expect(query).toContain(`GRAPH <urn:mnemosyne:local:graph:${GRAPH_ID}:user:rdf>`)
    expect(query).toContain('(^ar:parentSession/ar:childSession)+')
    for (const predicate of [
      'directAcceptedChildren', 'maxChildren', 'occupiedChildren', 'maxConcurrentChildren',
      'budgetCostSpentUsdMicros', 'budgetCostReservedUsdMicros', 'budgetCostRemainingUsdMicros',
      'budgetCostMaxUsdMicros', 'budgetAccountRevision', 'budgetAccountExhausted',
      'childRunState', 'allocationState', 'allocationHoldKind', 'settledActualCostUsdMicros',
      'materializationGeneration', 'materializationFaultKind', 'materializationRecoverable',
    ]) {
      expect(query).toContain(`ar:${predicate}`)
    }
    expect(query).not.toMatch(/GRAPH\s+\?\w+/i)
    expect(query).not.toMatch(/:(?:projection|ux):/)
    expect(query).not.toContain('ar:sessionStatus')
    for (const forbidden of [
      'prompt', 'model', 'provider', 'digest', 'body', 'childRunId', 'admissionId', 'allocationId',
      'requestId', 'claimToken', 'claimExpires', 'consumer', 'causationId', 'correlationId',
      'sandboxId', 'leaseId', 'terminalDigest', 'errorDetail', 'exitCode',
    ]) {
      expect(query.toLowerCase()).not.toMatch(new RegExp(`\\b${forbidden.toLowerCase()}\\b`))
    }
  })

  it('executes the F5 lifecycle, run, fault, and allocation path against real Oxigraph with nested descendants', () => {
    const userRdf = `urn:mnemosyne:local:graph:${GRAPH_ID}:user:rdf`
    const child = 'urn:sophia:agent:agent-deadbeef:session:ags_child_one'
    const grandchild = 'urn:sophia:agent:agent-deadbeef:session:ags_grandchild_two'
    const store = new Store()
    store.update(`PREFIX ar: <http://sophia.ai/agent-runtime#>
PREFIX agt: <http://mnemosyne.dev/agent#>
PREFIX prov: <http://www.w3.org/ns/prov#>
INSERT DATA { GRAPH <${userRdf}> {
  <${PARENT_IRI}> a agt:Session ;
    agt:sessionId "${PARENT.parentSessionId}" ; ar:sessionState "open" ; ar:projectionRevision 17 ;
    ar:materializationGeneration 3 ; ar:materializationState "running" ;
    ar:workerState "running" ; ar:kernelState "running" ;
    ar:directAcceptedChildren 1 ; ar:maxChildren 4 ;
    ar:occupiedChildren 1 ; ar:maxConcurrentChildren 2 ;
    ar:budgetCostSpentUsdMicros 100000 ; ar:budgetCostReservedUsdMicros 250000 ;
    ar:budgetCostRemainingUsdMicros 650000 ; ar:budgetCostMaxUsdMicros 1000000 ;
    ar:budgetAccountRevision 7 ; ar:budgetAccountExhausted false .
  <urn:relation:one> a ar:ChildSessionRelation ; ar:parentSession <${PARENT_IRI}> ; ar:childSession <${child}> ;
    ar:childName "one" ; ar:depth 1 ; ar:registrationStatus "registered" ;
    ar:admissionStatus "admitted" ; ar:runtimeKind "simple" ; ar:childRunState "completed" ;
    ar:allocationState "settled" ;
    ar:settledActualCostUsdMicros 300000 ; ar:allocatedTurns 12 ; ar:allocatedWallTimeMs 45000 ;
    ar:allocatedTokens 8192 ; ar:allocatedCostUsdMicros 250000 ; ar:allocatedArtifactBytes 1048576 ;
    prov:generatedAtTime "2026-08-08T01:00:00Z" .
  <${child}> a agt:Session ; agt:sessionId "ags_child_one" ; ar:sessionState "closed" .
  <${child}> ar:materializationGeneration 0 ; ar:materializationState "faulted" ;
    ar:workerState "faulted" ; ar:kernelState "faulted" ;
    ar:materializationFaultKind "worker_exit" ; ar:materializationRecoverable true .
  <urn:relation:two> a ar:ChildSessionRelation ; ar:parentSession <${child}> ; ar:childSession <${grandchild}> ;
    ar:childName "two" ; ar:depth 2 ; ar:registrationStatus "registered" ; prov:generatedAtTime "2026-08-08T02:00:00Z" .
  <${grandchild}> a agt:Session ; agt:sessionId "ags_grandchild_two" ; ar:sessionState "open" .
} }`)

    const result = queryStore(store, agentSessionFamilyQuery(GRAPH_ID, PARENT_IRI))
    expect(result.rows.map((row) => row.childSessionId)).toEqual(['"ags_child_one"', '"ags_grandchild_two"'])
    expect(result.rows.map((row) => row.depth)).toEqual([
      '"1"^^<http://www.w3.org/2001/XMLSchema#integer>',
      '"2"^^<http://www.w3.org/2001/XMLSchema#integer>',
    ])
    expect(result.rows[0]).toMatchObject({
      directAcceptedChildren: '"1"^^<http://www.w3.org/2001/XMLSchema#integer>',
      budgetAccountExhausted: '"false"^^<http://www.w3.org/2001/XMLSchema#boolean>',
      allocationState: '"settled"',
      childRunState: '"completed"',
      materializationGeneration: '"0"^^<http://www.w3.org/2001/XMLSchema#integer>',
      materializationFaultKind: '"worker_exit"',
      materializationRecoverable: '"true"^^<http://www.w3.org/2001/XMLSchema#boolean>',
      settledActualCostUsdMicros: '"300000"^^<http://www.w3.org/2001/XMLSchema#integer>',
    })
    expect(result.rows[1]?.allocationState).toBeUndefined()
  })
})

describe('agent.session-family — parent/F1–F5 fixture decoding', () => {
  it('decodes a parent-only projection without fabricating a child', () => {
    expect(agentSessionFamilyFromResult(parentOnly())).toEqual({
      parentSessionId: PARENT.parentSessionId,
      parentState: PARENT.parentState,
      projectionRevision: 17,
      parentMaterialization: null,
      budgetAccount: BUDGET_ACCOUNT,
      children: [],
    })
  })

  it('decodes F1 registration and deterministically orders child relations', () => {
    const later = f1Child({
      relation: 'urn:relation:z', child: 'urn:child:z', childName: 'zeta',
      childSessionId: 'ags_child_zeta_123456', registeredAt: '2026-08-08T02:00:00.000Z',
    })
    const earlier = f1Child({
      relation: 'urn:relation:a', child: 'urn:child:a', childName: 'alpha',
      childSessionId: 'ags_child_alpha_123456', registeredAt: '2026-08-08T01:00:00.000Z',
    })
    const grandchild = f1Child({
      relation: 'urn:relation:grandchild', child: 'urn:child:grandchild', childName: 'nested',
      childSessionId: 'ags_grandchild_nested_1', depth: '2', registeredAt: '2026-08-08T00:00:00.000Z',
    })
    const family = agentSessionFamilyFromResult(bindings([
      fixtureRow(grandchild), fixtureRow(later), fixtureRow(earlier),
    ]))
    expect(family.children.map((child) => child.childName)).toEqual(['alpha', 'zeta', 'nested'])
    expect(family.children[0]).toMatchObject({ registrationStatus: 'registered', depth: 1, budget: null })
  })

  it('decodes F2 admission with every allocation as an exact integer', () => {
    const child = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child())])).children[0]
    expect(child.budget).toEqual({
      admissionStatus: 'admitted',
      runtimeKind: 'simple',
      allocationState: 'reserved',
      allocationHoldKind: null,
      settledActualCostUsdMicros: null,
      allocatedTurns: 12,
      allocatedWallTimeMs: 45000,
      allocatedTokens: 8192,
      allocatedCostUsdMicros: 250000,
      allocatedArtifactBytes: 1048576,
    })
  })

  it('decodes F3 body states only when the projection supplies them', () => {
    const child = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationGeneration: '0', materializationState: 'running', workerState: 'running', kernelState: 'running',
      childRunState: 'claimed',
    }))])).children[0]
    expect(child).toMatchObject({
      childRunState: 'claimed',
      materialization: {
        generation: 0, state: 'running', workerState: 'running', kernelState: 'running',
        faultKind: null, recoverable: null,
      },
    })
  })

  it('decodes F4 parent aggregates and exact settled child cost testimony', () => {
    const family = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      allocationState: 'settled',
      settledActualCostUsdMicros: '300000',
      occupiedChildren: '0',
      budgetCostSpentUsdMicros: '300000',
      budgetCostReservedUsdMicros: '0',
      budgetCostRemainingUsdMicros: '700000',
      budgetAccountRevision: '8',
      budgetAccountExhausted: 'true',
    }))]))
    expect(family.budgetAccount).toEqual({
      ...BUDGET_ACCOUNT,
      occupiedChildren: 0,
      budgetCostSpentUsdMicros: 300000,
      budgetCostReservedUsdMicros: 0,
      budgetCostRemainingUsdMicros: 700000,
      budgetAccountRevision: 8,
      budgetAccountExhausted: true,
    })
    expect(family.children[0]?.budget).toMatchObject({
      allocationState: 'settled',
      settledActualCostUsdMicros: 300000,
    })
  })

  it('decodes the exact F5 Session, run, cancellation, accounting-hold, generation, and fault testimony', () => {
    const family = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      parentState: 'closing',
      projectionRevision: '18',
      parentMaterializationGeneration: '4',
      parentMaterializationState: 'faulted',
      parentWorkerState: 'faulted',
      parentKernelState: 'faulted',
      parentMaterializationFaultKind: 'worker_timeout',
      parentMaterializationRecoverable: 'true',
      childSessionState: 'closing',
      childRunState: 'cancelling',
      allocationState: 'accounting_hold',
      allocationHoldKind: 'unresolved_child_reservations',
      materializationGeneration: '2',
      materializationState: 'faulted',
      workerState: 'faulted',
      kernelState: 'faulted',
      materializationFaultKind: 'kernel_fault',
      materializationRecoverable: 'false',
    }))]))
    expect(family).toMatchObject({
      parentState: 'closing',
      projectionRevision: 18,
      parentMaterialization: {
        generation: 4,
        state: 'faulted',
        workerState: 'faulted',
        kernelState: 'faulted',
        faultKind: 'worker_timeout',
        recoverable: true,
      },
    })
    expect(family.children[0]).toMatchObject({
      sessionState: 'closing',
      childRunState: 'cancelling',
      budget: {
        allocationState: 'accounting_hold',
        allocationHoldKind: 'unresolved_child_reservations',
        settledActualCostUsdMicros: null,
      },
      materialization: {
        generation: 2,
        state: 'faulted',
        workerState: 'faulted',
        kernelState: 'faulted',
        faultKind: 'kernel_fault',
        recoverable: false,
      },
    })
  })

  it('accepts every frozen Session/run state and cancellation as a non-fault body outcome', () => {
    for (const parentState of ['open', 'closing', 'closed', 'faulted']) {
      expect(agentSessionFamilyFromResult(parentOnly(parentState)).parentState).toBe(parentState)
    }
    for (const childRunState of ['queued', 'claimed', 'cancelling', 'completed', 'failed', 'cancelled']) {
      const child = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ childRunState }))])).children[0]
      expect(child?.childRunState).toBe(childRunState)
    }
    const cancelled = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      childSessionState: 'closed',
      childRunState: 'cancelled',
      allocationState: 'released',
      materializationGeneration: '0',
      materializationState: 'cancelled',
      workerState: 'cancelled',
      kernelState: 'cancelled',
    }))])).children[0]
    expect(cancelled).toMatchObject({
      sessionState: 'closed',
      childRunState: 'cancelled',
      budget: { allocationState: 'released', allocationHoldKind: null, settledActualCostUsdMicros: null },
      materialization: {
        generation: 0, state: 'cancelled', workerState: 'cancelled', kernelState: 'cancelled',
        faultKind: null, recoverable: null,
      },
    })
  })

  it('accepts every frozen materialization state and bounded fault kind without conflating passivation', () => {
    for (const state of ['claimed', 'running', 'quiescing', 'quiescent', 'passivated', 'completed', 'cancelled']) {
      const child = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
        materializationGeneration: '1', materializationState: state, workerState: state,
      }))])).children[0]
      expect(child?.materialization).toMatchObject({
        generation: 1, state, workerState: state, faultKind: null, recoverable: null,
      })
    }
    for (const kind of [
      'worker_spawn', 'worker_exit', 'worker_timeout', 'worker_oom', 'worker_protocol',
      'kernel_fault', 'quiescence_fault', 'checkpoint_fault', 'replay_divergence', 'host_invariant',
    ]) {
      const child = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
        materializationGeneration: '1', materializationState: 'faulted', workerState: 'faulted',
        materializationFaultKind: kind, materializationRecoverable: 'false',
      }))])).children[0]
      expect(child?.materialization).toMatchObject({ state: 'faulted', faultKind: kind, recoverable: false })
    }
    const passivated = agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      childRunState: 'completed',
      materializationGeneration: '1', materializationState: 'passivated', workerState: 'passivated',
      kernelState: 'shutdown',
    }))])).children[0]
    expect(passivated?.materialization).toEqual({
      generation: 1,
      state: 'passivated',
      workerState: 'passivated',
      kernelState: 'shutdown',
      faultKind: null,
      recoverable: null,
    })
  })

  it('rejects malformed rows and partial allocations instead of guessing', () => {
    expect(() => agentSessionFamilyFromResult(bindings([]))).toThrow(/parent session was not found/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({
      ...f1Child(), admissionStatus: 'admitted', runtimeKind: 'simple',
    })]))).toThrow(/partial admission\/allocation/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ allocatedTokens: '8.5' }))])))
      .toThrow(/invalid allocatedTokens/)
    expect(() => agentSessionFamilyFromResult(bindings([
      fixtureRow(f1Child()), fixtureRow(f1Child({ relation: 'urn:relation:duplicate' })),
    ]))).toThrow(/repeats a child session/)
  })

  it('rejects partial or divergent F4 account and settlement testimony instead of guessing', () => {
    const withoutRevision = { ...PARENT } as Record<string, string>
    delete withoutRevision.budgetAccountRevision
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(withoutRevision)])))
      .toThrow(/missing budgetAccountRevision/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({ ...PARENT, occupiedChildren: '2' })])))
      .toThrow(/child capacity aggregates/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({ ...PARENT, budgetCostRemainingUsdMicros: '1' })])))
      .toThrow(/remaining cost budget/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({
      ...PARENT,
      budgetCostSpentUsdMicros: '900000',
      budgetCostReservedUsdMicros: '200000',
      budgetCostRemainingUsdMicros: '0',
    })]))).toThrow(/unacknowledged cost overage/)
    expect(agentSessionFamilyFromResult(bindings([fixtureRow({
      ...PARENT,
      budgetCostSpentUsdMicros: '900000',
      budgetCostReservedUsdMicros: '200000',
      budgetCostRemainingUsdMicros: '0',
      budgetAccountExhausted: 'true',
    })])).budgetAccount).toMatchObject({ budgetCostRemainingUsdMicros: 0, budgetAccountExhausted: true })
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({ ...PARENT, budgetAccountExhausted: '1' })])))
      .toThrow(/invalid budgetAccountExhausted/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ allocationState: 'unknown' }))])))
      .toThrow(/invalid allocationState/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ allocationState: 'settled' }))])))
      .toThrow(/dishonest settled cost testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ settledActualCostUsdMicros: '1' }))])))
      .toThrow(/dishonest settled cost testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([
      fixtureRow(f1Child({ child: 'urn:child:a', childSessionId: 'ags_child_a' })),
      fixtureRow(f1Child({
        relation: 'urn:relation:b', child: 'urn:child:b', childSessionId: 'ags_child_b',
        budgetAccountRevision: '8',
      })),
    ]))).toThrow(/mixes parent budget accounts/)
  })

  it('rejects unknown or structurally dishonest F5 lifecycle testimony', () => {
    expect(() => agentSessionFamilyFromResult(parentOnly('completed'))).toThrow(/invalid parentState/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ childSessionState: 'cancelled' }))])))
      .toThrow(/invalid childSessionState/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({ childRunState: 'running' }))])))
      .toThrow(/invalid childRunState/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      allocationState: 'accounting_hold',
    }))]))).toThrow(/accounting hold testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      allocationState: 'reserved', allocationHoldKind: 'unresolved_child_reservations',
    }))]))).toThrow(/accounting hold testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      allocationState: 'accounting_hold', allocationHoldKind: 'arbitrary',
    }))]))).toThrow(/invalid allocationHoldKind/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationState: 'running', workerState: 'running',
    }))]))).toThrow(/partial materialization testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationGeneration: '0', materializationState: 'running', workerState: 'running',
      materializationFaultKind: 'worker_exit', materializationRecoverable: 'true',
    }))]))).toThrow(/dishonest fault testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationGeneration: '0', materializationState: 'faulted', workerState: 'faulted',
      materializationFaultKind: 'unbounded_fault', materializationRecoverable: 'false',
    }))]))).toThrow(/invalid materializationFaultKind/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationGeneration: '0', materializationState: 'faulted', workerState: 'faulted',
      materializationFaultKind: 'worker_exit',
    }))]))).toThrow(/dishonest fault testimony/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow(f2Child({
      materializationGeneration: '0', materializationState: 'faulted', workerState: 'faulted',
      materializationFaultKind: 'worker_exit', materializationRecoverable: '1',
    }))]))).toThrow(/invalid materializationRecoverable/)
    expect(() => agentSessionFamilyFromResult(bindings([fixtureRow({
      ...f2Child(), projectionRevision: '18', child: 'urn:child:b', relation: 'urn:relation:b',
      childName: 'other', childSessionId: 'ags_child_other',
    }), fixtureRow(f2Child())]))).toThrow(/mixes parent Session testimony/)
  })
})

describe('agent.session-family — read-only rendering and retained-store polling', () => {
  let root: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    root.remove()
    vi.useRealTimers()
  })

  function interpreterFor(results: readonly QueryBlockResult[]) {
    const calls: Array<{ graphId: string; sparql: string; maxRows?: number }> = []
    let cursor = 0
    const service: QueryBlockService = {
      async run(graphId, sparql, maxRows) {
        calls.push({ graphId, sparql, maxRows })
        return results[Math.min(cursor++, results.length - 1)]
      },
    }
    const registry = new FaceRegistry()
    registry.register(createAgentSessionFamilyFace())
    registry.seal()
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createAgentSessionFamilyResourceAdapter(service))
    return { interpreter: new LayoutInterpreter(root, { registry, broker }), calls }
  }

  it('renders only allowlisted family facts, with opaque name + short ID and no actions or leaked result fields', async () => {
    const secretId = 'ags_child_research_extremely_secret_full_id'
    const fixture = fixtureRow({
      ...f2Child({
        childSessionId: secretId,
        allocationState: 'settled',
        settledActualCostUsdMicros: '300000',
        occupiedChildren: '0',
        budgetCostSpentUsdMicros: '300000',
        budgetCostReservedUsdMicros: '0',
        budgetCostRemainingUsdMicros: '700000',
        budgetAccountRevision: '8',
        budgetAccountExhausted: 'true',
      }),
      prompt: 'TOP SECRET PROMPT',
      model: 'private-model-coordinate',
      runtimeBindingDigest: 'sha256:private-digest',
      bodyId: 'sandbox-private-body-id',
      claimToken: 'private-claim-token',
      childRunId: 'acr_private_child_run',
      cancellationRequestId: 'private-cancellation-request',
    })
    const { interpreter } = interpreterFor([bindings([fixture])])
    await interpreter.reconcile(familyDocument(), { width: 900, height: 500 })
    const view = root.querySelector('sh-agent-session-family-view') as ShAgentSessionFamilyView
    await view.updateComplete
    const text = view.shadowRoot!.textContent ?? ''
    expect(text).toContain('research')
    expect(text).toContain(shortAgentSessionId(secretId))
    expect(text).not.toContain(secretId)
    expect(text).not.toContain('TOP SECRET PROMPT')
    expect(text).not.toContain('private-model-coordinate')
    expect(text).not.toContain('sha256:private-digest')
    expect(text).not.toContain('sandbox-private-body-id')
    expect(text).not.toContain('private-claim-token')
    expect(text).not.toContain('acr_private_child_run')
    expect(text).not.toContain('private-cancellation-request')
    expect(text).toContain('accepted1 / 4')
    expect(text).toContain('active0 / 2')
    expect(text).toContain('ledger rev 8')
    expect(text).toContain('session open')
    expect(text).toContain('run queued')
    expect(text).toContain('exhausted')
    expect(text).toContain('allocation settled')
    expect(text).toContain('cost overage')
    expect(text).toContain('actual300000µUSD')
    expect(view.shadowRoot!.querySelector('button, a, input, textarea, select')).toBeNull()
    await interpreter.dispose()
  })

  it('renders bounded fault, generation, cancellation, and accounting-hold facts without raw details', async () => {
    const fixture = fixtureRow(f2Child({
      parentMaterializationGeneration: '3',
      parentMaterializationState: 'running',
      parentWorkerState: 'running',
      parentKernelState: 'running',
      childSessionState: 'closing',
      childRunState: 'cancelling',
      allocationState: 'accounting_hold',
      allocationHoldKind: 'unresolved_child_reservations',
      materializationGeneration: '1',
      materializationState: 'faulted',
      workerState: 'faulted',
      kernelState: 'faulted',
      materializationFaultKind: 'worker_exit',
      materializationRecoverable: 'true',
    }))
    const { interpreter } = interpreterFor([bindings([fixture])])
    await interpreter.reconcile(familyDocument(), { width: 900, height: 500 })
    const view = root.querySelector('sh-agent-session-family-view') as ShAgentSessionFamilyView
    await view.updateComplete
    const shadow = view.shadowRoot!
    const text = (shadow.textContent ?? '').replace(/\s+/gu, ' ')
    expect(text).toContain('session closing')
    expect(text).toContain('run cancelling')
    expect(text).toContain('allocation accounting hold')
    expect(text).toContain('generation 1')
    expect(text).toContain('fault worker exit · recoverable')
    expect(shadow.querySelectorAll('.allocation-hold')).toHaveLength(1)
    expect(shadow.querySelectorAll('.fault-state.warning')).toHaveLength(1)
    expect(shadow.querySelector('button, a, input, textarea, select')).toBeNull()
    await interpreter.dispose()
  })

  it('polls every second into the same mounted element and disposal clears the timer', async () => {
    const { interpreter, calls } = interpreterFor([
      parentOnly('open'),
      bindings([fixtureRow(f1Child({ projectionRevision: '18' }))]),
      bindings([fixtureRow(f2Child({
        projectionRevision: '19',
        childRunState: 'claimed',
        materializationGeneration: '0',
        materializationState: 'running',
        workerState: 'running',
        kernelState: 'running',
      }))]),
      bindings([fixtureRow(f2Child({
        projectionRevision: '20',
        childSessionState: 'closed',
        childRunState: 'cancelled',
        allocationState: 'released',
        materializationGeneration: '0',
        materializationState: 'cancelled',
        workerState: 'cancelled',
        kernelState: 'cancelled',
        occupiedChildren: '0',
        budgetCostSpentUsdMicros: '100000',
        budgetCostReservedUsdMicros: '0',
        budgetCostRemainingUsdMicros: '900000',
        budgetAccountRevision: '8',
        budgetAccountExhausted: 'false',
      }))]),
    ])
    await interpreter.reconcile(familyDocument(), { width: 900, height: 500 })
    const view = root.querySelector('sh-agent-session-family-view') as ShAgentSessionFamilyView
    expect(view.family?.children).toHaveLength(0)
    expect(calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(AGENT_SESSION_FAMILY_REFRESH_MS)
    expect(root.querySelector('sh-agent-session-family-view')).toBe(view)
    expect(view.family?.children[0]?.registrationStatus).toBe('registered')
    expect(view.family?.children[0]?.budget).toBeNull()
    expect(calls).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(AGENT_SESSION_FAMILY_REFRESH_MS)
    expect(root.querySelector('sh-agent-session-family-view')).toBe(view)
    expect(view.family?.children[0]?.budget?.admissionStatus).toBe('admitted')
    expect(view.family?.children[0]?.childRunState).toBe('claimed')
    expect(view.family?.children[0]?.materialization).toMatchObject({ generation: 0, state: 'running' })
    expect(view.family?.projectionRevision).toBe(19)
    expect(calls).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(AGENT_SESSION_FAMILY_REFRESH_MS)
    expect(root.querySelector('sh-agent-session-family-view')).toBe(view)
    expect(view.family?.budgetAccount).toMatchObject({ budgetAccountRevision: 8, budgetAccountExhausted: false })
    expect(view.family?.children[0]?.budget).toMatchObject({
      allocationState: 'released', settledActualCostUsdMicros: null,
    })
    expect(view.family?.children[0]).toMatchObject({
      sessionState: 'closed',
      childRunState: 'cancelled',
      materialization: { generation: 0, state: 'cancelled', workerState: 'cancelled', kernelState: 'cancelled' },
    })
    expect(view.family?.projectionRevision).toBe(20)
    expect(calls).toHaveLength(4)

    const frozen: AgentSessionFamilyViewModel | null = view.family
    await interpreter.dispose()
    await vi.advanceTimersByTimeAsync(AGENT_SESSION_FAMILY_REFRESH_MS * 3)
    expect(calls).toHaveLength(4)
    expect(view.family).toBe(frozen)
  })
})
