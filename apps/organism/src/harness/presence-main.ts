import '@shrubbery/components'
import type { MnBottomBar } from '@shrubbery/components'
import { createLiveCollabEditor } from '@shrubbery/runtime'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import {
  projectPresence,
  revealFollowedPresenceCursor,
  type OrganismChromePresencePerson,
} from '../cell/chrome-controller.js'
import {
  clearLocalPresence,
  installLocalPresence,
  PRESENCE_COLORS,
  PresenceIdentityController,
  updateLocalPresenceProfile,
  type LocalPresenceState,
  type PresenceActorType,
  type PresenceRoomLocation,
} from '../cell/crdt-presence.js'

interface HarnessRoom {
  readonly graphId: string
  readonly documentId: string
}

interface HarnessSnapshot {
  readonly room: HarnessRoom | null
  readonly status: string
  readonly synced: boolean
  readonly people: readonly OrganismChromePresencePerson[]
  readonly raw: ReadonlyArray<{
    readonly awarenessClientId: number
    readonly humanId: string | null
    readonly deviceId: string | null
    readonly clientId: string | null
    readonly connectionEpoch: number | null
  }>
  readonly text: string
}

interface PresenceHarnessApi {
  open(room?: HarnessRoom): Promise<void>
  normalClose(): void
  hardClose(): void
  dropTransport(): void
  snapshot(): HarnessSnapshot
  insertText(text: string): void
  focusSelection(): void
}

declare global {
  interface Window {
    __presenceHarness?: PresenceHarnessApi
  }
}

const params = new URLSearchParams(location.search)
const humanId = params.get('human')?.trim() || 'vera'
const displayName = params.get('name')?.trim() || humanId
const deviceId = params.get('device')?.trim()
const clientId = params.get('client')?.trim()
const actorType: PresenceActorType = params.get('type') === 'agent' ? 'agent' : 'human'
const defaultRoom: HarnessRoom = {
  graphId: params.get('graph')?.trim() || 'presence-graph',
  documentId: params.get('doc')?.trim() || 'presence-doc',
}

const identity = new PresenceIdentityController({
  ...(deviceId ? { deviceId } : {}),
  ...(clientId ? { clientId } : {}),
})
const bar = document.querySelector<MnBottomBar>('#presence-bar')!
const editorElement = document.querySelector<HTMLElement>('#editor')!
const stateElement = document.querySelector<HTMLElement>('#state')!

let provider: WebsocketProvider | null = null
let editor: ReturnType<typeof createLiveCollabEditor> | null = null
let room: HarnessRoom | null = null
let status = 'idle'
let statusListener: ((event: { status: string }) => void) | null = null
let awarenessListener: (() => void) | null = null
let openPresenceId: string | null = null
let followedPresenceClientId: string | null = null
let presenceOverflowOpen = false

function roomLocation(value: HarnessRoom): PresenceRoomLocation {
  return {
    graphId: value.graphId,
    kind: 'document',
    documentId: value.documentId,
  }
}

function endpoint(value: HarnessRoom): { serverUrl: string; roomName: string } {
  const base = new URL('/cell', location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    serverUrl: `${base.href.replace(/\/$/, '')}/hocuspocus/docs/${encodeURIComponent(value.graphId)}`,
    roomName: encodeURIComponent(value.documentId),
  }
}

function snapshot(): HarnessSnapshot {
  const people = projectPresence(provider?.awareness)
  const raw = provider
    ? [...provider.awareness.getStates()].map(([awarenessClientId, value]) => {
        const metadata = value && typeof value === 'object'
          ? (value as { presence?: Record<string, unknown> }).presence
          : undefined
        return {
          awarenessClientId,
          humanId: typeof metadata?.humanId === 'string' ? metadata.humanId : null,
          deviceId: typeof metadata?.deviceId === 'string' ? metadata.deviceId : null,
          clientId: typeof metadata?.clientId === 'string' ? metadata.clientId : null,
          connectionEpoch: typeof metadata?.connectionEpoch === 'number'
            ? metadata.connectionEpoch
            : null,
        }
      }).sort((left, right) => left.awarenessClientId - right.awarenessClientId)
    : []
  return {
    room,
    status,
    synced: provider?.synced ?? false,
    people,
    raw,
    text: editor?.getText() ?? '',
  }
}

function render(): void {
  const current = snapshot()
  bar.presence = current.people
  if (openPresenceId && !current.people.some(person => person.id === openPresenceId)) {
    openPresenceId = null
  }
  if (followedPresenceClientId && !current.people.some(person =>
    person.sessions.some(session => session.clientId === followedPresenceClientId))) {
    followedPresenceClientId = null
  }
  bar.openPresenceId = openPresenceId
  bar.followedPresenceClientId = followedPresenceClientId
  bar.presenceOverflowOpen = presenceOverflowOpen
  bar.selfPresenceEditable = actorType === 'human' && Boolean(provider)
  bar.presenceColors = PRESENCE_COLORS
  bar.syncState = current.synced
    ? 'synced'
    : status === 'error'
      ? 'error'
      : status === 'idle' || status === 'hard-closed'
        ? 'idle'
        : 'connecting'
  bar.runtimeMode = 'local'
  revealFollowedPresenceCursor(editorElement, followedPresenceClientId)
  stateElement.textContent = JSON.stringify(current, null, 2)
}

bar.addEventListener('mn-presence-open', event => {
  const person = (event as CustomEvent<{ person?: OrganismChromePresencePerson }>).detail?.person
  if (!person) return
  openPresenceId = openPresenceId === person.id ? null : person.id
  presenceOverflowOpen = false
  render()
})
bar.addEventListener('mn-presence-close', () => {
  openPresenceId = null
  render()
})
bar.addEventListener('mn-presence-follow', event => {
  const detail = (event as CustomEvent<{
    session?: { clientId?: string }
    following?: boolean
  }>).detail
  followedPresenceClientId = detail?.following && detail.session?.clientId
    ? detail.session.clientId
    : null
  render()
})
bar.addEventListener('mn-presence-self-update', event => {
  if (!provider) return
  const detail = (event as CustomEvent<{ name?: string; color?: string }>).detail
  updateLocalPresenceProfile(provider.awareness, {
    ...(detail?.name === undefined ? {} : { name: detail.name }),
    ...(detail?.color === undefined ? {} : { color: detail.color }),
  })
  render()
})
bar.addEventListener('mn-presence-overflow-toggle', event => {
  presenceOverflowOpen = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open)
  if (presenceOverflowOpen) openPresenceId = null
  render()
})

function detachCurrent(cooperative: boolean): void {
  if (!provider) return
  if (awarenessListener) provider.awareness.off('change', awarenessListener)
  if (statusListener) provider.off('status', statusListener)
  if (cooperative) clearLocalPresence(provider.awareness)
  editor?.destroy()
  provider.destroy()
  provider = null
  editor = null
  awarenessListener = null
  statusListener = null
  status = 'idle'
  openPresenceId = null
  followedPresenceClientId = null
  presenceOverflowOpen = false
}

async function open(nextRoom: HarnessRoom = defaultRoom): Promise<void> {
  detachCurrent(true)
  room = nextRoom
  const doc = new Y.Doc()
  const target = endpoint(nextRoom)
  const nextProvider = new WebsocketProvider(target.serverUrl, target.roomName, doc, {
    connect: true,
    disableBc: true,
  })
  provider = nextProvider
  const publish = (): void => {
    const base = identity.next(humanId, roomLocation(nextRoom), displayName)
    const state: LocalPresenceState = actorType === 'agent'
      ? { ...base, user: { ...base.user, type: 'agent' } }
      : base
    installLocalPresence(
      nextProvider.awareness,
      state,
    )
  }
  publish()
  statusListener = event => {
    status = event.status
    if (event.status === 'connected') publish()
    render()
  }
  awarenessListener = render
  nextProvider.on('status', statusListener)
  nextProvider.awareness.on('change', awarenessListener)
  render()
  await new Promise<void>((resolve, reject) => {
    if (nextProvider.synced) {
      resolve()
      return
    }
    const timeout = window.setTimeout(() => reject(new Error('presence provider sync timeout')), 15_000)
    nextProvider.once('sync', synced => {
      if (!synced) return
      window.clearTimeout(timeout)
      resolve()
    })
  })
  if (provider !== nextProvider) return
  editor = createLiveCollabEditor({ element: editorElement, doc, awareness: nextProvider.awareness })
  render()
}

function normalClose(): void {
  detachCurrent(true)
  room = null
  render()
}

function hardClose(): void {
  if (!provider) return
  // Harness-only transport kill: suppress y-websocket retry, then close the
  // socket without publishing a null awareness state. Gardend must own cleanup.
  const rawProvider = provider as WebsocketProvider & {
    shouldConnect: boolean
    ws: WebSocket | null
  }
  rawProvider.shouldConnect = false
  rawProvider.ws?.close(4100, 'hard-close-without-awareness-removal')
  status = 'hard-closed'
  render()
}

function dropTransport(): void {
  if (!provider) return
  // Keep shouldConnect=true: y-websocket must reconnect, and the status seam
  // must publish a newer logical connection epoch before its awareness frame.
  const rawProvider = provider as WebsocketProvider & { ws: WebSocket | null }
  rawProvider.ws?.close(4101, 'transport-loss-reconnect')
}

function insertText(text: string): void {
  if (!editor) throw new Error('editor is not mounted')
  editor.chain().focus().insertContent(text).run()
  render()
}

function focusSelection(): void {
  if (!editor) throw new Error('editor is not mounted')
  const end = Math.max(1, editor.state.doc.content.size - 1)
  editor.chain().focus().setTextSelection(end).run()
  render()
}

window.__presenceHarness = {
  open,
  normalClose,
  hardClose,
  dropTransport,
  snapshot,
  insertText,
  focusSelection,
}

void open().catch(error => {
  status = 'error'
  stateElement.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error)
  throw error
})
