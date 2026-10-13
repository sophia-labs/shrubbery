/**
 * The workspace chat's writes reach the real <sh-chat-host> and <sh-chat-panel> (NO MOCKS: the
 * production renderWorkspace, mountChatHost, the real hosted ChatService over the scripted Choreograph
 * on a real socket, the real local service, the real elements).
 *
 *  - the panel says what the chat may do here, from the person's role and the host's advert;
 *  - the shell's `chatHost.workspace` reaches the panel on every path that mounts the chat: change
 *    links go to the shell, titles come from it, and an HTML artifact is previewed live through its port;
 *  - the preview is an <mn-artifact-view> with scripts off, whatever any port says, and it follows the
 *    port's reads; its revisions button goes to the shell as a change link; closing the chat lets go.
 */
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import type { ChatChangeIntent, ShChatPanel } from '@shrubbery/chat-kernel'
import { html, render } from 'lit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatArtifactPreviewPort, ChatArtifactPreviewView } from '../chat-host/chat-artifact-preview.js'
import type { ShChatHost } from '../chat-host/chat-host.js'
import { mountChatHost } from '../chat-host/mount-chat-host.js'
import { makeHostedChatService } from '../chat-services/hosted-chat-service.js'
import { makeLocalChatService } from '../chat-services/local-chat-service.js'
import { ChoreographSim, DOMAIN_WORKFLOW, workspaceWorkflow } from '../chat-services/__tests__/fixtures/choreograph-sim.js'
import { renderWorkspace } from '../render-workspace.js'

const chatHost = (container: ParentNode): ShChatHost | null => container.querySelector('#sh-chat-host') as ShChatHost | null
const panelOf = (host: ShChatHost): ShChatPanel => host.renderRoot.querySelector('sh-chat-panel') as ShChatPanel

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function settle(container: ParentNode): Promise<void> {
  const host = chatHost(container)
  if (!host) return
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

/** A port that serves what a test tells it, and records what it was asked. */
class ScriptedPort implements ChatArtifactPreviewPort {
  readonly opened: string[] = []
  readonly closed: string[] = []
  readonly refreshed: string[] = []
  readonly downloads: string[] = []
  private readonly listeners = new Map<string, (view: ChatArtifactPreviewView) => void>()

  open(artifactId: string, onChange: (view: ChatArtifactPreviewView) => void) {
    this.opened.push(artifactId)
    this.listeners.set(artifactId, onChange)
    onChange({ status: 'loading', graphId: 'g', title: null, mimeType: null, html: null, identity: null })
    return {
      refresh: () => { this.refreshed.push(artifactId) },
      close: () => { this.closed.push(artifactId); this.listeners.delete(artifactId) },
    }
  }

  download(artifactId: string): void {
    this.downloads.push(artifactId)
  }

  push(artifactId: string, view: Partial<ChatArtifactPreviewView>): void {
    this.listeners.get(artifactId)?.({
      status: 'ready', graphId: 'g', title: 'board.html', mimeType: 'text/html', html: '<p>v1</p>', identity: 'i:1', ...view,
    })
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('what the chat may do here, said by the real panel', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('an owner or editor on the empowered release writes; a viewer reads only; the reader-only release reads', async () => {
    // The reader-only release's `workspace-chat-v1` (Choreograph efc3d64); the empowered one's (cad0507).
    const readerOnly = '1855ba904ada0de02fdbd12fe2b69410adbe88316a3d809da9ca7559f294eef0'
    const empowered = '5a9e54bc641a8754db4aeb822454670e6aec9865564763f71b4b68d68fb540c4'
    const cases = [
      { digest: empowered, access: undefined, role: 'editor' as const, mode: 'write', words: 'Sophia can read and change this workspace, as you.' },
      { digest: empowered, access: { owner: 'write', editor: 'write', viewer: 'read' }, role: 'owner' as const, mode: 'write', words: 'Sophia can read and change this workspace, as you.' },
      { digest: empowered, access: undefined, role: 'viewer' as const, mode: 'read', words: 'Read-only: you can view this workspace' },
      { digest: readerOnly, access: undefined, role: 'owner' as const, mode: 'read', words: 'Sophia can read and search this workspace, but not change it.' },
    ]
    for (const item of cases) {
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ host: item.access ? { access: item.access } : {}, definitionDigest: item.digest })]
      const service = makeHostedChatService({
        graphBaseUrl: graph => sim.graphBase(graph),
        graphId: () => 'writes-qa',
        userId: () => 'probe',
        token: () => 'jwt',
        storage: new MemoryStorage(),
        role: () => item.role,
      })
      const session = await service.createSession()
      const container = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id } })
      document.body.appendChild(container)
      await settle(container)
      const panel = panelOf(chatHost(container)!)
      await until(() => panel.querySelector('.chat-access') !== null)
      const line = panel.querySelector<HTMLElement>('.chat-access')!
      expect(line.dataset.access, item.role).toBe(item.mode)
      expect(line.textContent).toContain(item.words)
      container.remove()
    }
  })

  it('a local chat (no hosted access to speak of) says nothing', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'local' })
    const container = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id } })
    document.body.appendChild(container)
    await settle(container)
    expect(panelOf(chatHost(container)!).querySelector('.chat-access')).toBeNull()
  })
})

describe('chatHost.workspace reaches the panel', () => {
  it('on every path that mounts the chat: change links go to the shell, and titles come from it', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-threaded' })
    const intents: ChatChangeIntent[] = []
    const workspace = {
      onChangeAction: (intent: ChatChangeIntent) => { intents.push(intent) },
      changeTitle: (_subject: string, id: string) => (id === 'plan' ? 'Q4 plan' : null),
    }
    for (const options of [{}, { chrome: { rightPanel: 'chat' as const } }]) {
      const container = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id, workspace }, ...options })
      document.body.appendChild(container)
      await settle(container)
      const panel = panelOf(chatHost(container)!)
      panel.onChangeAction?.({ type: 'open-history', documentId: 'plan', before: 1 })
      expect(panel.changeTitle?.('document', 'plan')).toBe('Q4 plan')
      container.remove()
    }
    expect(intents).toEqual([
      { type: 'open-history', documentId: 'plan', before: 1 },
      { type: 'open-history', documentId: 'plan', before: 1 },
    ])
  })

  it('without a workspace the panel draws no links and frames no preview', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'no-workspace' })
    const container = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id } })
    document.body.appendChild(container)
    await settle(container)
    const panel = panelOf(chatHost(container)!)
    expect(panel.onChangeAction).toBeUndefined()
    expect(panel.renderArtifactPreview).toBeUndefined()
  })
})

describe('the live HTML artifact preview in the chat', () => {
  async function previewOf(port: ScriptedPort, intents: ChatChangeIntent[]) {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'preview' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(html`<div class="main">${mountChatHost(service, session.id, {
      workspace: { artifactPreview: port, onChangeAction: intent => { intents.push(intent) } },
    }) as never}</div>`, container)
    await settle(container)
    const panel = panelOf(chatHost(container)!)
    const frame = document.createElement('div')
    container.appendChild(frame)
    render(html`<div class="frame">${panel.renderArtifactPreview!({ artifactId: 'board', messageId: 'a1', mediaType: 'text/html', title: 'board.html' }) as never}</div>`, frame)
    const preview = frame.querySelector('sh-chat-artifact-preview') as HTMLElement & { updateComplete: Promise<unknown> }
    await preview.updateComplete
    return { container, frame, preview }
  }

  const viewOf = (preview: HTMLElement) =>
    preview.shadowRoot!.querySelector('mn-artifact-view') as HTMLElement & Record<string, unknown>

  it('is an <mn-artifact-view> with scripts off that follows the port, live', async () => {
    const port = new ScriptedPort()
    const { preview } = await previewOf(port, [])
    expect(port.opened).toEqual(['board'])
    let view = viewOf(preview)
    expect(view.status).toBe('loading')
    expect(view.allowHtmlScripts).toBe(false)

    port.push('board', {})
    await (preview as { updateComplete: Promise<unknown> }).updateComplete
    view = viewOf(preview)
    expect(view.status).toBe('ready')
    expect(view.previewHtml).toBe('<p>v1</p>')
    expect(view.previewIdentity).toBe('i:1')
    expect(view.mimeType).toBe('text/html')
    expect(view.artifactId).toBe('board')
    expect(view.allowHtmlScripts).toBe(false)

    // The agent rewrites it: every open view updates.
    port.push('board', { html: '<p>v2</p>', identity: 'i:2' })
    await (preview as { updateComplete: Promise<unknown> }).updateComplete
    expect(viewOf(preview).previewHtml).toBe('<p>v2</p>')
  })

  it('never runs scripts, whatever a port or a view says', async () => {
    const port = new ScriptedPort()
    const { preview } = await previewOf(port, [])
    port.push('board', { allowHtmlScripts: true } as Partial<ChatArtifactPreviewView>)
    await (preview as { updateComplete: Promise<unknown> }).updateComplete
    expect(viewOf(preview).allowHtmlScripts).toBe(false)
  })

  it('hides itself for an artifact that is not HTML', async () => {
    const port = new ScriptedPort()
    const { preview } = await previewOf(port, [])
    port.push('board', { mimeType: 'text/plain', html: 'plain words' })
    await (preview as { updateComplete: Promise<unknown> }).updateComplete
    expect(preview.hasAttribute('hidden')).toBe(true)
    expect(viewOf(preview)).toBeNull()
  })

  it('routes its own buttons: refresh to the port, revisions to the shell, download to the port; none escapes', async () => {
    const port = new ScriptedPort()
    const intents: ChatChangeIntent[] = []
    const { preview } = await previewOf(port, intents)
    port.push('board', {})
    await (preview as { updateComplete: Promise<unknown> }).updateComplete
    const escaped: string[] = []
    for (const type of ['mn-artifact-refresh', 'mn-artifact-history-open', 'mn-artifact-download']) {
      document.addEventListener(type, () => escaped.push(type))
    }
    const view = viewOf(preview)
    for (const type of ['mn-artifact-refresh', 'mn-artifact-history-open', 'mn-artifact-download']) {
      view.dispatchEvent(new CustomEvent(type, { detail: { graphId: 'g', artifactId: 'board' }, bubbles: true, composed: true }))
    }
    expect(port.refreshed).toEqual(['board'])
    expect(port.downloads).toEqual(['board'])
    expect(intents).toEqual([{ type: 'open-artifact', artifactId: 'board', revisions: true }])
    expect(escaped).toEqual([])
  })

  it('lets go of the artifact when it leaves the page', async () => {
    const port = new ScriptedPort()
    const { frame } = await previewOf(port, [])
    frame.remove()
    expect(port.closed).toEqual(['board'])
  })
})
