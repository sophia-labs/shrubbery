import type { ShellFeature } from './shell-feature-host.js'
import { FLOW_APP_ID, FLOW_FRAME_TAG } from './flow-workspace.js'
import './flow-app-frame.js'
import type { ShFlowAppFrame } from './flow-app-frame.js'

/**
 * Keeps ONE Flow frame per graph alive across workspace re-renders: the
 * render host stamps a fresh `<sh-flow-app-frame>` placeholder each pass; the
 * feature swaps the retained frame back in (same pattern as the Grapevine
 * pane), so the board is not reloaded on every Garden chrome change. A graph
 * switch drops the retained frame; leaving the Flow app keeps it for return.
 */
export function createFlowAppFeature<TContract = unknown>(
  options: { readonly enabled: boolean; readonly flowBase?: string },
): ShellFeature<TContract> {
  let frame: ShFlowAppFrame | null = null
  return {
    id: 'mithras-flow-app',
    afterWorkspaceRender(context) {
      if (!options.enabled) return
      if (frame && frame.graphId !== context.graphId) frame = null
      if (context.app !== FLOW_APP_ID) return
      const placeholder = context.host.querySelector<ShFlowAppFrame>(FLOW_FRAME_TAG)
      if (!placeholder) return
      if (frame && placeholder !== frame) {
        placeholder.replaceWith(frame)
        return
      }
      placeholder.graphId = context.graphId
      if (options.flowBase) placeholder.flowBase = options.flowBase
      frame = placeholder
    },
    destroy() {
      frame = null
    },
  }
}
