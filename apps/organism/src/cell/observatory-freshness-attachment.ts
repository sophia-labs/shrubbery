/**
 * observatory-freshness-attachment.ts — P3b: the freshness governor's HOSTED
 * attachment (ruling 3: "staleness: CONFESS"). Wires the P3a governor
 * (`createObservatoryFreshnessGovernor`) to the Observatory's well-known
 * fragment surface (`configDeclaresObservatoryCenter`, workspace-fragments.ts)
 * — page-level chrome, gated to that one dashboard rather than every
 * graph-authored fragment, and torn down/rebuilt on the exact same
 * session-change edges `WorkspaceFragmentsController.optionsFor` uses.
 *
 * **Bounded lookup (spec P3b step 1 — a lookup with a definite answer, not a
 * design decision):** `grep -n "configDeclaresDashboardCenter\b" apps/organism/src/**\/*.ts`
 * finds exactly one shell call site: `main.ts` constructs
 * `WorkspaceFragmentsController` and calls `optionsFor` from
 * `currentFragmentOptions`, itself called from `renderConfig`, which renders
 * into the shell's ONE render host — `hostEl` (`document.getElementById('host')`
 * in `main.ts`, the `#host` div in `index.html`). That same `hostEl` is
 * ALREADY the mount point for the shell's other unmanaged-sibling status
 * chrome (`default-workspace-ui.ts`'s `renderCellErrorPanel` / the static
 * `.boot-placeholder`) — Lit's `render()` into a container leaves DOM nodes
 * it did not itself create alone (`renderConfig`'s own comment: "Lit
 * intentionally preserves unmanaged siblings in its render container"), and
 * both `bootPublicShellRoute` and `bootOrganismAppRoute` mount into this SAME
 * `hostEl` too — so it is the shell's one host across every route, not just
 * the workspace path. No new chrome element was needed; ruling 2 forbids
 * inventing Observatory-specific chrome beyond one host, and `hostEl`
 * already qualifies. `registerEls` names `hostEl` itself (the fragment
 * region's own container is not independently addressable through
 * `renderWorkspace`'s public surface without restructuring the shell, which
 * ruling 2 / this packet's own risk note forbid) — a defensible, narrower
 * approximation: when `configDeclaresDashboardCenter` is true the workspace
 * IS the dashboard, so ringing the whole render host rings exactly the
 * content that might be stale.
 */
import type { WorkspaceConfig } from '@shrubbery/nucleus'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { makeQueryBlockService } from '@shrubbery/runtime'
import {
  createObservatoryFreshnessGovernor,
  type FreshnessGovernor,
} from '../harness/observatory-freshness-governor.js'
import { configDeclaresObservatoryCenter } from './workspace-fragments.js'

/** The live cell session the attachment is scoped to — same shape as `WorkspaceFragmentSession` (`workspace-fragments.ts`), kept independent so this module has no dependency on that class. */
export interface ObservatoryFreshnessSession {
  readonly rest: RestClient
  readonly graphId: string
}

export interface ObservatoryFreshnessAttachmentOptions {
  /** The governor renders its strip inside this — see this module's own header for the bounded lookup that chose it. */
  readonly hostEl: HTMLElement
  /** Default `document.documentElement`. */
  readonly stampEl?: HTMLElement
}

export interface ObservatoryFreshnessAttachment {
  /**
   * Idempotent — call on every render pass, mirroring
   * `WorkspaceFragmentsController.optionsFor`'s own reset-on-change shape.
   * Mounts when `configDeclaresObservatoryCenter(config)` is true AND a live
   * session is given; disposes and rebuilds on any session/graph change;
   * disposes when the condition stops holding. Never throws.
   */
  sync(config: WorkspaceConfig, session: ObservatoryFreshnessSession | null): void
  /** The live governor, or null when not mounted. */
  current(): FreshnessGovernor | null
  dispose(): void
}

export function createObservatoryFreshnessAttachment(
  options: ObservatoryFreshnessAttachmentOptions,
): ObservatoryFreshnessAttachment {
  const { hostEl, stampEl } = options
  let governor: FreshnessGovernor | null = null
  let sessionRest: RestClient | null = null
  let sessionGraphId: string | null = null

  function teardown(): void {
    governor?.dispose()
    governor = null
    sessionRest = null
    sessionGraphId = null
  }

  return {
    sync(config, session): void {
      const wants = configDeclaresObservatoryCenter(config) && session != null
      if (!wants) {
        teardown()
        return
      }
      if (governor && sessionRest === session.rest && sessionGraphId === session.graphId) {
        return // already mounted for this exact session — idempotent
      }
      teardown()
      sessionRest = session.rest
      sessionGraphId = session.graphId
      governor = createObservatoryFreshnessGovernor({
        queryService: makeQueryBlockService(session.rest),
        graphId: session.graphId,
        hostEl,
        ...(stampEl ? { stampEl } : {}),
        registerEls: [hostEl],
      })
      // Unawaited, before the fragment load resolves — the confession paints
      // before the panes (P3b contract).
      governor.start()
    },
    current: () => governor,
    dispose: teardown,
  }
}
