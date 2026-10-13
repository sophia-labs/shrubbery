/**
 * The page behind `voices-browser-harness.mts`: the REAL `<sh-chat-host>` (the same element the
 * workspace mounts in its chat rail) over the REAL hosted service, pointed at whatever gateway
 * the harness serves. Nothing here is a stand-in for the code under test; the only things scripted
 * are the host's answers, on the other side of a real socket.
 *
 * The token is a placeholder: the harness's gateway is local and asks nobody who they are.
 */
import '@shrubbery/tokens/tokens.css'
import { html, render } from 'lit'
import { makeHostedChatService, mountChatHost } from '@shrubbery/runtime'
import { ensureActiveChatSession } from '../src/cell/active-chat-session.js'

declare global {
  interface Window {
    __voices?: { ready: boolean; error?: string; sessionId?: string }
  }
}

const params = new URL(location.href).searchParams
const gateway = (params.get('gateway') ?? '').replace(/\/+$/, '')
const graph = params.get('graph') ?? 'atelier-20260930'
const user = params.get('user') ?? 'harness-user'

async function main(): Promise<void> {
  if (!gateway) throw new Error('no ?gateway= given')
  const service = makeHostedChatService({
    gatewayBaseUrl: gateway,
    graphBaseUrl: (id: string) => `${gateway}/g/${encodeURIComponent(id)}`,
    graphId: () => graph,
    userId: () => user,
    token: () => 'harness-token',
    storage: window.localStorage,
  })
  // The shell's own way of finding the conversation: the active slot's, else a new one. A reload finds the same one.
  const sessionId = await ensureActiveChatSession(service, { title: 'organism-chat', graphId: graph })
  const rail = document.getElementById('rail')!
  // The workspace mounts the host exactly so, and never says it can take a person to add credits.
  render(html`${mountChatHost(service, sessionId, { presentation: 'rail' }) as never}`, rail)
  window.__voices = { ready: true, sessionId }
}

main().catch(error => {
  window.__voices = { ready: true, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
})
