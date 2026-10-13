import type { GraphLifecycleIntent, GraphLifecycleManager } from '@shrubbery/source'
import type { GatewayGraphInfo } from './gateway-transport.js'

export interface LocalWorkspaceCreation {
  readonly status: 'pending' | 'conflict'
  readonly error?: string
}

export type HostedWorkspaceInfo = GatewayGraphInfo & {
  /** Local ownership is not a claim that the cloud accepted this graph. */
  readonly localCreation?: LocalWorkspaceCreation
}

export interface WorkspaceCreationRuntime {
  openGraphLifecycle(): Promise<GraphLifecycleManager>
  provisionGraph(graphId: string, graphIncarnation: string): Promise<unknown>
}

/** Persist first, then observe the actual acknowledgement rather than a started flush. */
export async function prepareHostedWorkspace(
  runtime: WorkspaceCreationRuntime,
  request: { graphId: string; graphIncarnation: string; operationId: string; title: string },
): Promise<GraphLifecycleIntent> {
  const lifecycle = await runtime.openGraphLifecycle()
  const queued = await lifecycle.enqueueCreate(request)
  await runtime.provisionGraph(request.graphId, request.graphIncarnation)
  const records = await lifecycle.flush()
  const result = records.find(record => record.key === queued.key)
  if (!result) throw new Error('The saved workspace creation has no acknowledgement record.')
  return result
}

/** Both creation entry points wait for directory testimony before navigating. */
export async function confirmHostedWorkspaceCreation(
  intent: GraphLifecycleIntent,
  loadDirectory: () => Promise<readonly HostedWorkspaceInfo[]>,
): Promise<HostedWorkspaceInfo> {
  if (intent.status !== 'applied') throw new Error(unconfirmedWorkspaceMessage(intent))
  const matches = (await loadDirectory()).filter(graph => graph.graphId === intent.graphId)
  const graph = matches.length === 1 ? matches[0] : undefined
  const owner = intent.userId.startsWith('user:') ? intent.userId : `user:${intent.userId}`
  if (!graph || graph.localCreation || graph.role !== 'owner' || graph.owner !== owner) {
    throw new Error('Cloud creation was accepted, but the directory has not confirmed the new workspace yet. Local work is retained; refresh the workspace list before opening it.')
  }
  return graph
}

/** Keep local work discoverable without inventing a running hosted cell or ACL. */
export function mergeHostedWorkspaceCreations(
  graphs: readonly GatewayGraphInfo[],
  intents: readonly GraphLifecycleIntent[],
): readonly HostedWorkspaceInfo[] {
  const result: HostedWorkspaceInfo[] = [...graphs]
  const present = new Set(graphs.map(graph => graph.graphId))
  const deleted = new Set(intents.filter(intent => intent.kind === 'delete' && intent.status !== 'conflict')
    .map(intent => `${intent.graphId}\u001f${intent.graphIncarnation}`))
  for (const intent of intents) {
    if (intent.kind !== 'create' || present.has(intent.graphId)
      || deleted.has(`${intent.graphId}\u001f${intent.graphIncarnation}`)) continue
    present.add(intent.graphId)
    result.push({
      graphId: intent.graphId,
      title: intent.title || intent.graphId,
      role: 'owner',
      // This placeholder is never presented as cell testimony: localCreation
      // replaces the cell and role labels in both catalog consumers.
      cellState: 'stopped',
      localCreation: {
        status: intent.status === 'conflict' ? 'conflict' : 'pending',
        ...(intent.error ? { error: intent.error } : {}),
      },
    })
  }
  return result
}

export function unconfirmedWorkspaceMessage(intent: GraphLifecycleIntent): string {
  return `Workspace saved locally; cloud creation ${intent.status === 'conflict' ? 'was refused' : 'has not been confirmed'}. `
    + 'Your local work and creation intent are retained. Retry cloud confirmation before opening this workspace.'
    + (intent.error ? ` ${intent.error}` : '')
}
