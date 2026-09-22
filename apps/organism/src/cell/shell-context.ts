/**
 * Immutable context shared with shell feature controllers.
 *
 * Organism still owns all mutable application state in `main.ts`.  Features get
 * a fresh value snapshot at each lifecycle boundary instead of importing that
 * module's globals.  This is deliberately a small capability surface: it lets a
 * controller render controlled props, bind the current provider, request a
 * rerender, and use the active cell contract without becoming another store.
 */

import type { AppId } from '@shrubbery/nucleus'

export type OrganismSourceMode =
  | 'GARDEN_DEFAULT'
  | 'GARDEN_VARIANT'
  | 'SEED_NT'
  | 'CELL_LIVE'
  | 'EMPORIUM_LIVE'

export type OrganismDeploymentMode = 'playground' | 'hosted'

export interface ShellContext<TContract = unknown> {
  /** The stable DOM root owned by Organism. */
  readonly host: HTMLElement
  /** Current graph/document identity at the instant the hook runs. */
  readonly graphId: string
  readonly documentId: string | null
  /** Current workspace app dimension and data source. */
  readonly app: AppId | undefined
  readonly source: OrganismSourceMode
  readonly deploymentMode: OrganismDeploymentMode
  /** Active local/hosted cell contract, when the shell has established one. */
  readonly contract: TContract | null
  /** Defensive URL copy, so later history mutations cannot stale-mutate a hook. */
  readonly location: URL
  /** Request the existing authoritative Organism render path. */
  readonly rerender: () => void
}

export interface CreateShellContextOptions<TContract = unknown>
  extends Omit<ShellContext<TContract>, 'location'> {
  readonly location: Pick<Location, 'href'> | URL
}

/** Build one shallow-frozen, point-in-time shell context. */
export function createShellContext<TContract = unknown>(
  options: CreateShellContextOptions<TContract>,
): ShellContext<TContract> {
  const location = new URL(options.location.href)

  return Object.freeze({
    host: options.host,
    graphId: options.graphId,
    documentId: options.documentId,
    app: options.app,
    source: options.source,
    deploymentMode: options.deploymentMode,
    contract: options.contract,
    location,
    rerender: options.rerender,
  })
}
