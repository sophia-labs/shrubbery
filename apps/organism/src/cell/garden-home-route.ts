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
  openAccount?(account: MnGardenHomeAccount): void | Promise<void>
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
  let snapshot = EMPTY_SNAPSHOT
  let status: MnGardenHome['status'] = 'loading'
  let error = ''
  let busyGraphId = ''
  let createStatus: MnGardenHome['createStatus'] = 'idle'
  let createError = ''

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
        @mn-garden-home-account=${(event: CustomEvent<{ account: MnGardenHomeAccount }>) => {
          void service.openAccount?.(event.detail.account)
        }}
      ></mn-garden-home>
    `, host)
  }

  const load = async (): Promise<void> => {
    status = 'loading'
    error = ''
    render()
    try {
      const next = await service.load()
      if (destroyed) return
      snapshot = next
      status = 'ready'
    } catch (loadError) {
      if (destroyed) return
      status = 'error'
      error = errorMessage(loadError)
    }
    render()
  }

  const runGraphIntent = async (
    workspace: MnWorkspaceSummary,
    effect: () => void | Promise<void>,
  ): Promise<void> => {
    busyGraphId = workspace.graphId
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

  const createGraph = async (): Promise<void> => {
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
    render()
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
