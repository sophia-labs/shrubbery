/**
 * Connect the Choreograph app (modes v1) to the active graph's MCP.
 *
 * The workspace stamps `<choreo-modes-surface>` into `region-choreo-center`
 * through the RDF layout. This feature is the host seam: after each render it
 * hands the surface a `ChoreographModesService` over `contract.rawMcp` for the
 * active graph, and — when a gateway is present — the viewer's graph ids as
 * scope suggestions. The standalone `/choreograph` route uses the same helpers.
 */
import { isValidGraphId, type ChoreoModesSurface, type ChoreoRunOverviewPort } from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { ShellFeature } from './shell-feature-host.js'
import { ChoreographModesService, type ChoreographModesMcp } from './choreograph-modes-service.js'
import { ChoreographStudioService } from './choreograph-studio-service.js'

interface ModesContract {
  readonly rawMcp?: unknown
  readonly gateway?: { graphs(): Promise<unknown> }
  readonly auth?: unknown
  readonly runtime?: unknown
  readonly rest?: unknown
}

function runOverviewPort(contract: unknown, graphId: string): ChoreoRunOverviewPort | null {
  if (!contract || typeof contract !== 'object') return null
  const candidate = contract as ModesContract
  const auth = candidate.auth as { whenReady?: unknown } | undefined
  const runtime = candidate.runtime as { graphBaseUrl?: unknown; mode?: unknown } | undefined
  if (typeof auth?.whenReady !== 'function' || typeof runtime?.graphBaseUrl !== 'function'
    || typeof runtime.mode !== 'function' || !candidate.rest) return null
  const service = new ChoreographStudioService(contract as Pick<ShrubberyContract, 'auth' | 'runtime' | 'rest'>)
  return { async runs() {
    const read = await service.loadRuns(graphId)
    if (read.kind !== 'ok') return read
    return { kind: 'ok', runs: read.runs.map(run => {
      const date = run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt ?? '')
      const ended = run.endedAt instanceof Date ? run.endedAt : new Date(run.endedAt ?? '')
      return {
        runId: run.runId,
        workflowName: run.workflowName ?? '',
        status: run.status ?? 'unknown',
        startedAt: Number.isFinite(date.getTime()) ? date.toISOString() : '',
        durationMs: run.durationMs ?? null,
        ...(Number.isFinite(ended.getTime()) ? { endedAt: ended.toISOString() } : {}),
        ...(run.agentCount == null ? {} : { agentCount: run.agentCount }),
        ...(run.totalTokens == null ? {} : { totalTokens: run.totalTokens }),
      }
    }) }
  } }
}

/** The contract's unwrapped MCP caller, when it has one. */
export function choreographModesMcp(contract: unknown): ChoreographModesMcp | null {
  if (!contract || typeof contract !== 'object') return null
  const raw = (contract as ModesContract).rawMcp
  if (!raw || typeof raw !== 'object' || typeof (raw as ChoreographModesMcp).callTool !== 'function') return null
  return raw as ChoreographModesMcp
}

/** Graph ids from the gateway directory (`GatewayGraphInfo.graphId`). */
export async function choreographModesGraphIds(contract: unknown): Promise<string[]> {
  const gateway = contract && typeof contract === 'object' ? (contract as ModesContract).gateway : undefined
  if (!gateway || typeof gateway.graphs !== 'function') return []
  const listed = await gateway.graphs()
  if (!Array.isArray(listed)) return []
  const ids = listed
    .map(entry => entry && typeof entry === 'object' ? (entry as { graphId?: unknown }).graphId : undefined)
    .filter((id): id is string => typeof id === 'string' && isValidGraphId(id))
  return [...new Set(ids)].sort()
}

/** Point one surface at one graph; returns a disposer that ignores late graph-id answers. */
export function bindChoreographModesSurface(
  surface: ChoreoModesSurface,
  contract: unknown,
  graphId: string,
): () => void {
  const mcp = choreographModesMcp(contract)
  const id = graphId.trim()
  if (!mcp || !isValidGraphId(id)) {
    surface.port = null
    surface.runOverviewPort = null
    return () => {}
  }
  surface.port = new ChoreographModesService(mcp, id)
  surface.runOverviewPort = runOverviewPort(contract, id)
  let live = true
  choreographModesGraphIds(contract)
    .then(ids => { if (live) surface.graphIds = ids })
    // Suggestions only: the scope field still accepts a typed graph id.
    .catch(() => { if (live) surface.graphIds = [] })
  return () => { live = false }
}

export function createChoreographModesFeature<TContract = unknown>(): ShellFeature<TContract> {
  let surface: ChoreoModesSurface | null = null
  let boundContract: unknown = null
  let boundGraph = ''
  let release: () => void = () => {}

  const reset = (): void => {
    release()
    release = () => {}
    surface = null
    boundContract = null
    boundGraph = ''
  }

  return {
    id: 'choreograph-modes',
    afterWorkspaceRender(context) {
      const next = context.app === 'choreograph'
        ? context.host.querySelector<ChoreoModesSurface>('choreo-modes-surface')
        : null
      if (!next) {
        reset()
        return
      }
      const graphId = context.graphId.trim()
      if (next === surface && context.contract === boundContract && graphId === boundGraph) return
      release()
      surface = next
      boundContract = context.contract
      boundGraph = graphId
      release = bindChoreographModesSurface(next, context.contract, graphId)
    },
    destroy() {
      reset()
    },
  }
}
