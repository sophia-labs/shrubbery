/**
 * The page behind `chat-writes-browser-harness.mts`: the REAL `<sh-chat-host>` over the REAL hosted chat
 * service, with the shell's own `workspace` grant (change links, the live HTML preview port the shell
 * builds in main.ts), pointed at whatever gateway the harness serves. Nothing here stands in for the code
 * under test; the host's answers are scripted on the other side of a real socket.
 *
 * The person is an editor; what they have open is the document `plan`, cursor in block `b7`.
 * The live preview's room watch is the harness: it raises `harness-artifact-changed` when the
 * agent rewrites the artifact, as the workspace room would.
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { html, render } from 'lit'
import { type ChatChangeIntent, makeHostedChatService, mountChatHost } from '@shrubbery/runtime'
import { ensureActiveChatSession } from '../src/cell/active-chat-session.js'
import type { ArtifactTextSnapshot } from '../src/cell/artifact-live-preview.js'
import { makeChatArtifactPreviewPort } from '../src/cell/chat-workspace.js'

declare global {
  interface Window {
    __chatWrites?: { ready: boolean; error?: string; sessionId?: string; intents: ChatChangeIntent[] }
  }
}

const params = new URL(location.href).searchParams
const gateway = (params.get('gateway') ?? '').replace(/\/+$/, '')
const graph = params.get('graph') ?? 'writes-qa-20261006'
const user = params.get('user') ?? 'harness-user'
const intents: ChatChangeIntent[] = []

async function main(): Promise<void> {
  if (!gateway) throw new Error('no ?gateway= given')
  const graphBase = (id: string) => `${gateway}/g/${encodeURIComponent(id)}`
  const service = makeHostedChatService({
    gatewayBaseUrl: gateway,
    graphBaseUrl: graphBase,
    graphId: () => graph,
    userId: () => user,
    token: () => 'harness-token',
    storage: window.localStorage,
    role: () => 'editor',
    contextRefs: () => ['plan', 'plan#b7'],
  })
  const artifactPreview = makeChatArtifactPreviewPort({
    graphId: () => graph,
    read: async (artifactId, signal) => {
      const response = await fetch(`${graphBase(graph)}/artifacts/${encodeURIComponent(graph)}/${encodeURIComponent(artifactId)}/text`, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`Artifact read failed (HTTP ${response.status}).`)
      return await response.json() as ArtifactTextSnapshot
    },
    watch: (artifactId, invalidate, unavailable) => {
      const changed = (event: Event) => {
        if ((event as CustomEvent<string>).detail === artifactId) invalidate()
      }
      window.addEventListener('harness-artifact-changed', changed)
      unavailable(null)
      return () => window.removeEventListener('harness-artifact-changed', changed)
    },
  })
  const sessionId = await ensureActiveChatSession(service, { title: 'organism-chat', graphId: graph })
  const rail = document.getElementById('rail')!
  render(html`${mountChatHost(service, sessionId, {
    presentation: 'rail',
    workspace: {
      onChangeAction: intent => { intents.push(intent) },
      changeTitle: (_subject, id) => (id === 'plan' ? 'Q4 plan' : null),
      artifactPreview,
    },
  }) as never}`, rail)
  window.__chatWrites = { ready: true, sessionId, intents }
}

main().catch(error => {
  window.__chatWrites = { ready: true, intents, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
})
