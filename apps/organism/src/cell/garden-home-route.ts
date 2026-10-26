/**
 * Account-level Garden Home route controller.
 *
 * `mn-garden-home` stays backend-free. This shell controller owns async route
 * state and delegates every effect to a deployment service supplied by
 * Organism (hosted gateway, local gardend, or a deterministic test service).
 */

import { html, nothing, render as litRender } from 'lit'
import type {
  MnGardenHome,
  MnGardenHomeAccount,
  MnGardenHomeWorkspaceDetail,
  MnWorkspaceSummary,
} from '@shrubbery/components'

export interface OrganismGardenHomeSnapshot {
  readonly account: MnGardenHomeAccount
  readonly workspaces: readonly MnWorkspaceSummary[]
}

export interface OrganismGardenHomeService {
  load(): Promise<OrganismGardenHomeSnapshot>
  openGraph(workspace: MnWorkspaceSummary): void | Promise<void>
  manageAccess?(workspace: MnWorkspaceSummary): void | Promise<void>
  create?(): void | Promise<void>
  /** Explicit host-owned creation/seed action; never called by route load. */
  startOnboarding?(): void | Promise<void>
  openAccount?(account: MnGardenHomeAccount): void | Promise<void>
  /** Ask the cloud again for a workspace saved here whose creation was refused or is unconfirmed. */
  retryCreate?(workspace: MnWorkspaceSummary): void | Promise<void>
  /** Remove a refused local workspace and its local work (the service confirms first). */
  discardCreate?(workspace: MnWorkspaceSummary): void | Promise<void>
}

export interface GardenHomeRouteMount {
  readonly ready: Promise<void>
  destroy(): void
}

export interface GardenGraphLocation {
  readonly graphId: string
}

function decodedSegment(value: string | undefined): string {
  if (!value) return ''
  try { return decodeURIComponent(value).trim() } catch { return '' }
}

/** Parse the shared SPA graph grammar: /g/:graphId. */
export function gardenGraphLocation(
  location: Pick<Location, 'href'> | URL,
): GardenGraphLocation | null {
  const url = location instanceof URL ? location : new URL(location.href)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'g' || parts.length < 2) return null
  const graphId = decodedSegment(parts[1])
  if (!graphId) return null
  return { graphId }
}

/** Build a same-origin path without allowing a graph id to reshape it. */
export function gardenGraphPath(graphId: string): string {
  const graph = graphId.trim()
  if (!graph) throw new Error('Garden graph path requires a graph id')
  return `/g/${encodeURIComponent(graph)}`
}

/**
 * A graph's address: `/g/<id>` for the account's own graph (every existing link keeps working), and
 * `/g/<id>?owner=user:<sub>` for another account's, since ids are unique only per owner.
 */
export function gardenGraphHref(
  graph: { readonly graphId: string; readonly owner?: string | null },
  params: Readonly<Record<string, string>> = {},
): string {
  const query = new URLSearchParams()
  if (graph.owner?.trim()) query.set('owner', graph.owner.trim())
  for (const [name, value] of Object.entries(params)) query.set(name, value)
  const search = query.toString()
  return search ? `${gardenGraphPath(graph.graphId)}?${search}` : gardenGraphPath(graph.graphId)
}

const EMPTY_SNAPSHOT: OrganismGardenHomeSnapshot = Object.freeze({
  account: Object.freeze({ userId: '', displayName: 'Garden account' }),
  workspaces: Object.freeze([]),
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the controlled Home component and drive it from one shell service.
 * Initial-load failure is rendered as retryable component state; it does not
 * reject `ready`, because the route itself mounted successfully.
 */
export function mountGardenHomeRoute(
  host: HTMLElement,
  service: OrganismGardenHomeService,
): GardenHomeRouteMount {
  let destroyed = false
  let loadGeneration = 0
  let snapshot = EMPTY_SNAPSHOT
  let status: MnGardenHome['status'] = 'loading'
  let error = ''
  let busyGraphId = ''
  let createStatus: MnGardenHome['createStatus'] = 'idle'
  let createError = ''
  let onboardingStatus: MnGardenHome['onboardingStatus'] = 'idle'
  let onboardingError = ''

  const render = (): void => {
    if (destroyed) return
    litRender(html`
      <mn-garden-home
        style="width:100%;min-height:100%;"
        .account=${snapshot.account}
        .workspaces=${snapshot.workspaces}
        .status=${status}
        .error=${error}
        .busyGraphId=${busyGraphId || null}
        .createStatus=${createStatus}
        .createError=${createError}
        .onboardingAvailable=${Boolean(service.startOnboarding)}
        .onboardingStatus=${onboardingStatus}
        .onboardingError=${onboardingError}
        @mn-garden-home-refresh=${() => { void load() }}
        @mn-garden-home-open-graph=${(event: CustomEvent<MnGardenHomeWorkspaceDetail>) => {
          void runGraphIntent(event.detail.workspace, () => service.openGraph(event.detail.workspace))
        }}
        @mn-garden-home-manage-access=${(event: CustomEvent<MnGardenHomeWorkspaceDetail>) => {
          if (!service.manageAccess) return
          void runGraphIntent(event.detail.workspace, () => service.manageAccess!(event.detail.workspace))
        }}
        @mn-garden-home-create=${() => {
          if (!service.create) return
          void createGraph()
        }}
        @mn-garden-home-start-onboarding=${() => {
          if (service.startOnboarding) void startOnboarding()
        }}
        @mn-garden-home-account=${(event: CustomEvent<{ account: MnGardenHomeAccount }>) => {
          void service.openAccount?.(event.detail.account)
        }}
        @mn-garden-home-retry-create=${(event: CustomEvent<MnGardenHomeWorkspaceDetail>) => {
          if (service.retryCreate) void runCreationIntent(event.detail.workspace, () => service.retryCreate!(event.detail.workspace))
        }}
        @mn-garden-home-discard-create=${(event: CustomEvent<MnGardenHomeWorkspaceDetail>) => {
          if (service.discardCreate) void runCreationIntent(event.detail.workspace, () => service.discardCreate!(event.detail.workspace))
        }}
      ></mn-garden-home>
    `, host)
  }

  const load = async (): Promise<void> => {
    if (destroyed) return
    const generation = ++loadGeneration
    status = 'loading'
    error = ''
    render()
    try {
      const next = await service.load()
      if (destroyed || generation !== loadGeneration) return
      snapshot = next
      status = 'ready'
    } catch (loadError) {
      if (destroyed || generation !== loadGeneration) return
      status = 'error'
      error = errorMessage(loadError)
    }
    render()
  }

  const runGraphIntent = async (
    workspace: MnWorkspaceSummary,
    effect: () => void | Promise<void>,
  ): Promise<void> => {
    busyGraphId = workspace.key || workspace.graphId
    error = ''
    render()
    try {
      await effect()
    } catch (intentError) {
      if (destroyed) return
      status = 'error'
      error = errorMessage(intentError)
    } finally {
      if (!destroyed) {
        busyGraphId = ''
        render()
      }
    }
  }

  /** Retry or Discard of a local creation, then the catalog again: the card shows what the cloud now says. */
  const runCreationIntent = async (
    workspace: MnWorkspaceSummary,
    effect: () => void | Promise<void>,
  ): Promise<void> => {
    if (destroyed || busyGraphId) return
    busyGraphId = workspace.key || workspace.graphId
    render()
    let failure: string | null = null
    try {
      await effect()
    } catch (intentError) {
      failure = errorMessage(intentError)
    }
    if (destroyed) return
    busyGraphId = ''
    await load()
    if (failure && !destroyed) {
      // Said beside "New graph", where creation errors live; Home itself stays open.
      createStatus = 'error'
      createError = failure
      render()
    }
  }

  const createGraph = async (): Promise<void> => {
    if (destroyed || status !== 'ready' || createStatus === 'creating' || onboardingStatus === 'creating') return
    createStatus = 'creating'
    createError = ''
    render()
    try {
      await service.create?.()
      if (destroyed) return
      createStatus = 'idle'
    } catch (createFailure) {
      if (destroyed) return
      createStatus = 'error'
      createError = errorMessage(createFailure)
    }
    // A failed hosted acknowledgement may still have durably saved a local
    // creation. Refresh its honest catalog representation without erasing the
    // creation error or requiring a page reload to find retained work.
    await load()
    render()
  }

  const startOnboarding = async (): Promise<void> => {
    if (destroyed || status !== 'ready' || onboardingStatus === 'creating' || createStatus === 'creating') return
    onboardingStatus = 'creating'
    onboardingError = ''
    render()
    try {
      await service.startOnboarding?.()
      if (destroyed) return
      onboardingStatus = 'idle'
    } catch (failure) {
      if (destroyed) return
      onboardingStatus = 'error'
      onboardingError = errorMessage(failure)
    }
    // A failed seed can have created a real graph. Refresh its catalog entry;
    // never delete it or automatically repeat an uncertain content write.
    await load()
  }

  const ready = load()
  return {
    ready,
    destroy() {
      if (destroyed) return
      destroyed = true
      litRender(nothing, host)
      host.replaceChildren()
    },
  }
}
