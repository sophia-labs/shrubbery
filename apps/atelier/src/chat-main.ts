/**
 * chat-main.ts — the ATELIER chat shell (the chat analog of main.ts's render loop).
 *
 * C3: the host-side glue (the ChatServiceStore ownership + the buildChatKernelOptions
 * bind-on-tick loop + the imperatively-held <sh-chat-panel>) has been LIFTED into the
 * reusable <sh-chat-host> (packages/runtime/src/chat-host/). The atelier shell now
 * shrinks to SHELL POLICY only:
 *   - assembleChatServices(contract, scope, 'local')  — assemble the seam;
 *   - svc.createSession({ title })                     — which session/title (policy);
 *   - render(html`${mountChatHost(svc, session.id)}`)  — mount the ONE live host node
 *     at a FIXED FINAL template slot (mount-once: the keyed() ChildPart survives any
 *     interface-grow re-render).
 *
 * The host now OWNS the store + the panel + the round-trip + session hydration. The
 * shell never mints the store or the panel (the editor analog: the shell opens the
 * provider + mounts the host; the host owns the live node).
 *
 * The whole organism is real + infra-free (the local in-process ChatService needs
 * NO gardend cell, NO choreograph): type into the real <sh-chat-panel> the host
 * mounts, the conversation renders + updates live as the ECHO driver streams. The
 * 'hosted' branch (the choreograph remote backend) is the labeled C4 seam.
 *
 * NOTE: apps are NOT island-guarded — they freely import @shrubbery/runtime
 * (mountChatHost side-effect-registers <sh-chat-host> + <sh-chat-panel>).
 */

import { html, render } from 'lit'
import type { EditorScope } from '@shrubbery/nucleus'
import {
  assembleChatServices,
  makeGrowTurnDriver,
  mountChatHost,
  makeGrowCell,
  rdfLoadArgs,
  type GrowCell,
  type ShChatHost,
} from '@shrubbery/runtime'
import type { ShChatPanel } from '@shrubbery/chat-kernel'

import { createGardendContract, type GardendContract } from './cell/gardend-contract.js'
import { loadConfigFromCell } from './cell/session-store.js'

const GRAPH_ID = 'atelier-dev'

/**
 * Build the host-side GROW port over the SAME contract the chat (and the render
 * loop) use — NO new transport, via the shared runtime recipe (makeGrowCell +
 * rdfLoadArgs). This is the seam the grow-driver closes over:
 *   - readConfig = the PRODUCTION read path (loadConfigFromCell: rdf_dump →
 *     parseNT → parseTriplesToConfig).
 *   - loadDelta  = rdf_load in the admitted literal-:ux:config-graph form (the
 *     EXACT arg shape spawn-gardend.ts + the grow-cycle integration test use).
 * grow() owns the catalog + spine + additive gates; this port is the cell I/O.
 */
export function buildGrowCell(contract: GardendContract): GrowCell {
  return makeGrowCell({
    readConfig: async (graphId) => (await loadConfigFromCell(contract, graphId)).config,
    loadDelta: async (graphId, nt, targetGraphIri) => {
      await contract.mcp.toolsCall('rdf_load', rdfLoadArgs(graphId, nt, targetGraphIri))
    },
  })
}

/**
 * Mount the chat organism into a container. Returns the live host + its panel so a
 * test (or the page) can drive + inspect it. Pure DOM wiring — no mocks. The host
 * owns the store + the round-trip; the shell only assembles + creates the session.
 */
export async function mountChat(container: HTMLElement): Promise<{
  host: ShChatHost
  panel: ShChatPanel
}> {
  // The SAME contract the render loop uses (browser: same-origin /cell proxy).
  const contract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })
  const scope = (): EditorScope => ({
    centerMode: 'document',
    graphId: GRAPH_ID,
    documentId: null,
    app: undefined,
  })

  // LOCAL-N0: inject the DETERMINISTIC GROW-DRIVER (the swap for the default ECHO
  // driver). It closes over a GrowCell port built on the SAME contract + graphId,
  // so a phrase like "give me a top bar" calls the REAL grow() — the cell's
  // :ux:config grows, and the EXISTING render-loop poll re-reads it within ≤3s and
  // the canvas (#host) GROWS. The C4 LLM driver slots into this SAME 4th param.
  // (HOSTED = the labeled C4 seam — would throw.)
  const growCell = buildGrowCell(contract)
  const svc = assembleChatServices(contract, scope, 'local', makeGrowTurnDriver(growCell, GRAPH_ID))

  // SHELL POLICY: create the session (which session/title). The host never mints it.
  const session = await svc.createSession({ title: 'atelier-chat' })

  // Mount the ONE live host at a FIXED FINAL template slot (mount-once via keyed()).
  // The host sits inside a `.main` wrapper (a real element child, not a trailing
  // bare child-binding — the happy-dom child-binding gotcha) so a later spine grow
  // re-renders the wrapper while the keyed host node survives.
  render(html`<div class="main">${mountChatHost(svc, session.id)}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await host.updateComplete
  // Drain a microtask so firstUpdated has mounted the imperative panel.
  await Promise.resolve()
  const panel = host.panel as ShChatPanel

  return { host, panel }
}

// Auto-boot when a #chat host exists (the page shell). Guarded so importing this
// module in a test does NOT auto-mount.
//
// mountChat's render() OWNS its container's children — so we mount into a
// dedicated child (#chat-mount) appended after the page's static #chat-header,
// leaving the header (and any other chat-shell chrome) intact.
const chatEl = typeof document !== 'undefined' ? document.getElementById('chat') : null
if (chatEl) {
  const mountEl = document.createElement('div')
  mountEl.id = 'chat-mount'
  mountEl.style.cssText = 'flex:1 1 auto; min-height:0; display:flex;'
  chatEl.appendChild(mountEl)
  void mountChat(mountEl)
}
