/**
 * Cards on the board against the real thing: real Lit elements (`<sh-injerto>`, `<sh-object-view>`) in the test DOM,
 * a real typed-object service over the fixtures' Oxigraph store, the real `WhiteboardBinding` over a real Y.Doc.
 * `createElement` is a tiny real function that builds DOM, not a stand-in for Excalidraw's decisions.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { ShInjerto } from '../object-view/injerto-element.js'
import { OBJECT_VIEW_INTENT_EVENT, type ObjectViewIntent } from '../object-view/object-view-element.js'
import { fixtureTypedObjectService, loadFixtures, TYPED_ITEM } from '../object-view/__tests__/typed-fixture-store.js'
import {
  addCard, attachSidebarDrop, cardSkeleton, createCardHost, isCard, makeCardRenderer, readSidebarDrop, sceneFromClient,
  type WbCardFlowDeps,
} from './card-embed.js'
import { documentLink, objectLink, recordOfElement } from './links.js'
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import { WB_CARD_EVENT, type WbCreateElement, type WbObjectTarget, type WbTarget, type WbTypedObjects } from './semantic-types.js'
import { WhiteboardBinding, type WbElement, type WbScene } from './whiteboard-binding.js'

const GRAPH = 'freud-dreams'
const store = loadFixtures()
const present: WbTypedObjects = { ...fixtureTypedObjectService(store), search: async () => [] }

const MISSING_IRI = 'urn:mnemosyne:local:graph:freud-dreams:dream:never-written'

const objectTarget: WbObjectTarget = { kind: 'object', graphId: GRAPH, iri: TYPED_ITEM, label: 'Meier', classLabel: 'Dream report' }
const documentTarget: WbTarget = { kind: 'document', graphId: GRAPH, documentId: 'doc-7', title: 'Seminar notes' }

/** A real function that builds DOM for what Excalidraw's `createElement` would build; calls the ref as React would. */
const created: HTMLElement[] = []
const makeDom: WbCreateElement = (type, props, ...children) => {
  const el = document.createElement(type as string)
  const p = props ?? {}
  if (p.style) Object.assign(el.style, p.style as object)
  for (const child of children) el.append(child as Node)
  created.push(el)
  ;(p.ref as ((node: HTMLElement) => void) | undefined)?.(el)
  return el
}

function cardElement(target: WbTarget, extra: Record<string, unknown> = {}): WbElement {
  return { ...cardSkeleton(target, { x: 10, y: 20 }, [], 'person', 1760000000000), ...extra } as WbElement
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(card: HTMLElement): Promise<ShInjerto> {
  const frame = card.querySelector('sh-injerto') as ShInjerto
  await tick()
  await frame.updateComplete
  const view = frame.shadowRoot?.querySelector('sh-object-view') as (HTMLElement & { updateComplete?: Promise<unknown> }) | null
  if (view?.updateComplete) await view.updateComplete
  return frame
}

afterEach(() => {
  document.body.replaceChildren()
  created.length = 0
})

describe('is a card', () => {
  it('is_card_needs_embeddable_and_a_mnemosyne_link', () => {
    const base = { id: 'a', version: 1, versionNonce: 1 }
    expect(isCard({ ...base, type: 'embeddable', link: objectLink(GRAPH, TYPED_ITEM) })).toBe(true)
    expect(isCard({ ...base, type: 'embeddable', link: documentLink(GRAPH, 'doc-7') })).toBe(true)
    // A web embed is not a card; a rectangle with a link is a linked shape, not a card; a tombstone is not live.
    expect(isCard({ ...base, type: 'embeddable', link: 'https://example.com/video' })).toBe(false)
    expect(isCard({ ...base, type: 'embeddable', link: null })).toBe(false)
    expect(isCard({ ...base, type: 'rectangle', link: objectLink(GRAPH, TYPED_ITEM) })).toBe(false)
    expect(isCard({ ...base, type: 'embeddable', link: objectLink(GRAPH, TYPED_ITEM), isDeleted: true })).toBe(false)
  })

  it('validate_embeddable_true_only_for_mnemosyne', () => {
    const host = createCardHost({ createElement: makeDom, typedObjects: present, graphId: GRAPH })
    expect(host.validateEmbeddable(objectLink(GRAPH, TYPED_ITEM))).toBe(true)
    expect(host.validateEmbeddable(documentLink(GRAPH, 'doc-7'))).toBe(true)
    for (const other of ['https://youtube.com/watch?v=1', 'http://x', '', 'mnemosyne:/nope', null, undefined, 42, /youtube/]) {
      expect(host.validateEmbeddable(other)).toBe(false)
    }
    host.dispose()
  })
})

describe('the card renderer', () => {
  it('card_renders_an_injerto_with_an_object_view', async () => {
    const render = makeCardRenderer(present, GRAPH)
    const card = render(cardElement(objectTarget), 'light')
    document.body.append(card)
    const frame = await settle(card)
    expect(frame.status).toBe('ready')
    expect(frame.iri).toBe(TYPED_ITEM)
    expect(frame.graphId).toBe(GRAPH)
    expect(frame.label).toBe('Meier')
    expect(frame.classLabel).toBe('Dream report')
    const view = frame.shadowRoot!.querySelector('sh-object-view')!
    expect(view.getAttribute('slot')).toBe('card')
    expect(card.querySelectorAll('sh-injerto')).toHaveLength(1)
    expect(card.dataset.theme).toBe('light')
  })

  it('card_reads_the_object_live_and_shows_the_snapshot_when_gone', async () => {
    // The same card, drawn twice against a reader that changes under it: the board stores no object, only a snapshot.
    const live = loadFixtures()
    const liveService: WbTypedObjects = { ...fixtureTypedObjectService(live), search: async () => [] }
    const render = makeCardRenderer(liveService, GRAPH)
    const element = cardElement(objectTarget)
    const first = render(element, 'light')
    document.body.append(first)
    expect((await settle(first)).status).toBe('ready')

    // The object disappears from the real store under the card.
    live.update('DROP ALL')
    const second = render({ ...element, version: element.version + 1 }, 'light')
    document.body.append(second)
    const frame = await settle(second)
    expect(frame.status).toBe('absent')
    expect(frame.model).toBeNull()
    const text = frame.shadowRoot!.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('Not in this graph')
    expect(text).toContain('Meier')

    // An IRI the graph never held is gone too; a failing reader is an honest error.
    const lostCard = makeCardRenderer(present, GRAPH)(cardElement({ ...objectTarget, iri: MISSING_IRI, label: 'Lost dream' }), 'dark')
    document.body.append(lostCard)
    expect((await settle(lostCard)).status).toBe('absent')
    // A real failure: an IRI the real query builder refuses makes the real read reject.
    const bad = makeCardRenderer(present, GRAPH)(cardElement({ ...objectTarget, iri: 'not-an-iri' }), 'light')
    document.body.append(bad)
    const badFrame = await settle(bad)
    expect(badFrame.status).toBe('error')
    expect(badFrame.error).toContain('not an absolute IRI')
    // No service at all: still a card, still honest, never a throw.
    const none = makeCardRenderer(() => null, GRAPH)(element, 'light')
    document.body.append(none)
    expect((await settle(none)).status).toBe('error')
  })

  it('a document card draws its title with an Open door and reads nothing', () => {
    let reads = 0
    const counting: WbTypedObjects = { ...present, read: (g, i) => { reads += 1; return present.read(g, i) } }
    const card = makeCardRenderer(counting, GRAPH)(cardElement(documentTarget), 'light')
    document.body.append(card)
    expect(card.querySelector('sh-injerto')).toBeNull()
    expect(card.textContent).toContain('Seminar notes')
    const intents: ObjectViewIntent[] = []
    document.addEventListener(OBJECT_VIEW_INTENT_EVENT, (e) => intents.push((e as CustomEvent<{ intent: ObjectViewIntent }>).detail.intent))
    card.querySelector('button')!.click()
    expect(intents).toEqual([{ kind: 'open-document', documentId: 'doc-7', blockId: null, graphId: GRAPH }])
    expect(reads).toBe(0)
    // Open works before the card is active (pointer events on, canvas not told); the rest of the card is Excalidraw's.
    const button = card.querySelector('button')!
    expect(button.style.pointerEvents).toBe('auto')
    let reached = false
    document.body.addEventListener('pointerdown', () => { reached = true })
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reached).toBe(false)
  })

  it('the injerto Open intent crosses the card once, bubbling and composed', async () => {
    const host = createCardHost({ createElement: makeDom, typedObjects: present, graphId: GRAPH })
    const node = host.renderEmbeddable(cardElement(objectTarget), { theme: 'light' }) as HTMLElement
    document.body.append(node)
    const frame = await settle(node.firstElementChild as HTMLElement)
    const heard: CustomEvent[] = []
    // The target is read while the event is in flight: a composed event's target is cleared once dispatch ends.
    const targets: unknown[] = []
    document.addEventListener(OBJECT_VIEW_INTENT_EVENT, (e) => { heard.push(e as CustomEvent); targets.push(e.target) })
    frame.shadowRoot!.querySelector<HTMLButtonElement>('.door')!.click()
    expect(heard).toHaveLength(1)
    expect(heard[0]!.bubbles).toBe(true)
    expect(heard[0]!.composed).toBe(true)
    // One event, re-dispatched from the card itself, not the injerto's own.
    expect(targets[0]).toBe(node.firstElementChild)
    expect(heard[0]!.detail.intent).toEqual({ kind: 'open-object', iri: TYPED_ITEM, graphId: GRAPH })
    host.dispose()
  })
})

describe('the card host', () => {
  it('render_is_memoised_on_version_and_theme', async () => {
    const host = createCardHost({ createElement: makeDom, typedObjects: present, graphId: GRAPH })
    const element = cardElement(objectTarget)
    const a = host.renderEmbeddable(element, { theme: 'light' })
    const b = host.renderEmbeddable({ ...element }, { theme: 'light' })
    expect(b).toBe(a)
    expect(created).toHaveLength(1)
    document.body.append(a as Node)
    await settle((a as HTMLElement).firstElementChild as HTMLElement)
    expect(document.querySelectorAll('sh-injerto')).toHaveLength(1)

    // A drag or resize bumps `version` on every frame; the card must not rebuild for it.
    const bumped = host.renderEmbeddable({ ...element, version: element.version + 1 }, { theme: 'light' })
    expect(bumped).toBe(a)
    const dark = host.renderEmbeddable({ ...element, version: element.version + 1 }, { theme: 'dark' })
    expect(dark).not.toBe(bumped)
    expect(((dark as HTMLElement).firstElementChild as HTMLElement).dataset.theme).toBe('dark')
    // One entry per card: a second card has its own node; the first is still memoised.
    const other = host.renderEmbeddable(cardElement(documentTarget), { theme: 'dark' })
    expect(other).not.toBe(dark)
    expect(host.renderEmbeddable({ ...element, version: element.version + 1 }, { theme: 'dark' })).toBe(dark)
    // A different link is a different card.
    const relinked = host.renderEmbeddable({ ...element, link: documentTarget.link } as WbElement, { theme: 'dark' })
    expect(relinked).not.toBe(dark)
    // Excalidraw's active-state gating owns pointer events: the wrapper forces none on, and a pointerdown on the card
    // still reaches the canvas (so a click selects the card).
    expect((dark as HTMLElement).style.pointerEvents).toBe('')
    let reached = false
    document.body.addEventListener('pointerdown', () => { reached = true })
    document.body.append(dark as Node)
    ;((dark as HTMLElement).firstElementChild as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reached).toBe(true)
    host.dispose()
    expect(host.renderEmbeddable(element, { theme: 'light' })).not.toBe(a)
  })
})

describe('the skeleton', () => {
  const existing = [
    { id: 'p', type: 'rectangle', version: 1, versionNonce: 1, index: 'a0' },
    { id: 'q', type: 'rectangle', version: 1, versionNonce: 1, index: 'aA' },
    { id: 'r', type: 'rectangle', version: 1, versionNonce: 1, index: 'a1', isDeleted: true },
  ] as WbElement[]

  it('card_skeleton_is_an_embeddable_with_link_record_and_stamp', () => {
    const el = cardSkeleton(objectTarget, { x: 40, y: 50 }, existing, 'person', 1760000001234)
    expect(el.type).toBe('embeddable')
    expect([el.x, el.y, el.width, el.height]).toEqual([40, 50, 320, 180])
    expect(el.id).toHaveLength(21)
    expect(cardSkeleton(objectTarget, { x: 0, y: 0 }, [], 'person', 1).id).not.toBe(el.id)
    expect(el.index! > 'aA').toBe(true)
    expect(cardSkeleton(objectTarget, { x: 0, y: 0 }, [], 'person', 1).index).toBe('a0')
    expect(el.link).toBe(objectLink(GRAPH, TYPED_ITEM))
    expect(recordOfElement(el as any)).toEqual({ kind: 'object', graphId: GRAPH, iri: TYPED_ITEM, label: 'Meier', classLabel: 'Dream report' })
    expect((el.customData as any).sophia).toEqual({ by: 'person', at: 1760000001234 })
    expect(el.isDeleted).toBe(false)
    expect(el.groupIds).toEqual([])
    expect(el.boundElements).toEqual([])
    expect(isCard(el)).toBe(true)
    const doc = cardSkeleton(documentTarget, { x: 0, y: 0 }, existing, 'agent-1', 5)
    expect(doc.link).toBe(documentLink(GRAPH, 'doc-7'))
    expect(recordOfElement(doc as any)).toEqual({ kind: 'document', graphId: GRAPH, id: 'doc-7', title: 'Seminar notes' })
    expect((doc.customData as any).sophia.by).toBe('agent-1')
  })

  it('card_skeleton_round_trips_through_the_binding', () => {
    const NOW = 1760000009999
    const card = cardSkeleton(objectTarget, { x: 5, y: 6 }, existing, 'person', NOW)
    class Scene implements WbScene {
      elements: WbElement[] = []
      getElements() { return this.elements }
      setElements(elements: readonly WbElement[]) { this.elements = [...elements] }
      busyIds() { return new Set<string>() }
    }
    const doc = new Y.Doc()
    const scene = new Scene()
    const binding = new WhiteboardBinding(doc, { throttleMs: 0, now: () => NOW, schedule: (cb) => { cb(); return 1 }, cancel: () => {} })
    scene.elements = [...binding.initialElements()]
    binding.attach(scene)
    scene.elements = [card]
    binding.localChanged()
    binding.flushNow()

    // A second reader of the same room sees the card exactly as built.
    const reader = new Y.Doc()
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(doc))
    const loaded = new WhiteboardBinding(reader).initialElements()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toEqual(card)
    expect(isCard(loaded[0]!)).toBe(true)
  })
})

describe('placing', () => {
  it('scene_from_client_inverts_scroll_and_zoom', () => {
    const app = { scrollX: -100, scrollY: 40, zoom: { value: 2 } }
    // client = (scene + scroll) * zoom + offset, so scene = (client - offset) / zoom - scroll
    expect(sceneFromClient({ x: 300, y: 250 }, app, { left: 100, top: 50 })).toEqual({ x: 200, y: 60 })
    const scene = { x: 37, y: -12 }
    const client = { x: (scene.x + app.scrollX) * 2 + 100, y: (scene.y + app.scrollY) * 2 + 50 }
    expect(sceneFromClient(client, app, { left: 100, top: 50 })).toEqual(scene)
    expect(sceneFromClient({ x: 10, y: 20 }, {}, { left: 0, top: 0 })).toEqual({ x: 10, y: 20 })
  })

  it('read_sidebar_drop_parses_the_payload_and_refuses_malformed', () => {
    const MIME = 'application/x-shrubbery-sidebar-node'
    const carrying = (text: string | null, types: string[] = [MIME]) => ({ types, getData: (t: string) => (t === MIME && text !== null ? text : '') })
    expect(readSidebarDrop(carrying(JSON.stringify({ id: 'doc-7', kind: 'document', parentId: 'f1', section: 'documents' })))).toEqual({
      id: 'doc-7', kind: 'document', parentId: 'f1', section: 'documents',
    })
    expect(readSidebarDrop(carrying(JSON.stringify({ id: 'doc-7', kind: 'document' })))).toEqual({ id: 'doc-7', kind: 'document' })
    expect(readSidebarDrop(carrying('{not json'))).toBeNull()
    expect(readSidebarDrop(carrying('null'))).toBeNull()
    expect(readSidebarDrop(carrying('[1,2]'))).toBeNull()
    expect(readSidebarDrop(carrying(JSON.stringify({ id: 7, kind: 'document' })))).toBeNull()
    expect(readSidebarDrop(carrying(JSON.stringify({ id: 'x' })))).toBeNull()
    expect(readSidebarDrop(carrying(JSON.stringify({ id: 'x', kind: 'document' }), ['text/plain']))).toBeNull()
  })

  /** A canvas API over a real list of elements, as Excalidraw's keeps one. */
  function canvas(appState: Record<string, any>) {
    const state = { elements: [] as unknown[], appState, updates: [] as Record<string, any>[] }
    return {
      state,
      api: {
        getSceneElementsIncludingDeleted: () => state.elements,
        getAppState: () => state.appState,
        updateScene(data: Record<string, any>) {
          state.updates.push(data)
          if (data.elements) state.elements = [...data.elements]
          if (data.appState) state.appState = { ...state.appState, ...data.appState }
        },
      },
    }
  }

  function flow(page: Partial<WhiteboardPageOptions> | null, appState: Record<string, any> = {}) {
    const c = canvas(appState)
    const notes: string[] = []
    const events = document.createElement('div')
    const added: CustomEvent[] = []
    events.addEventListener(WB_CARD_EVENT, (e) => added.push(e as CustomEvent))
    const deps: WbCardFlowDeps = {
      eventTarget: events,
      page: () => (page ? ({ graphId: GRAPH, documentId: 'board-1', title: 'Board', status: 'ready', provider: null, ...page } as WhiteboardPageOptions) : null),
      api: () => c.api,
      notify: (m) => notes.push(m),
    }
    return { deps, c, notes, added }
  }

  it('sidebar_drop_adds_a_card_at_the_pointer', async () => {
    const asked: unknown[] = []
    const { deps, c, added } = flow(
      { targetOfSidebarNode: (node) => { asked.push(node); return node.kind === 'document' ? documentTarget : null } },
      { scrollX: -20, scrollY: 10, zoom: { value: 2 }, width: 800, height: 600 },
    )
    const stage = document.createElement('div')
    document.body.append(stage)
    const detach = attachSidebarDrop(stage, deps)
    const payload = (node: object) => ({
      types: ['application/x-shrubbery-sidebar-node'],
      getData: () => JSON.stringify(node),
      dropEffect: 'none',
    })

    const over = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer: payload({ id: 'doc-7', kind: 'document' }) })
    stage.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect((over as any).dataTransfer.dropEffect).toBe('move')
    // Something else being dragged is not ours to accept.
    const foreign = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], getData: () => '' } })
    stage.dispatchEvent(foreign)
    expect(foreign.defaultPrevented).toBe(false)

    const drop = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
      dataTransfer: payload({ id: 'doc-7', kind: 'document' }), clientX: 200, clientY: 120,
    })
    stage.dispatchEvent(drop)
    expect(asked).toEqual([{ id: 'doc-7', kind: 'document' }])
    expect(c.state.elements).toHaveLength(1)
    const card = c.state.elements[0] as WbElement
    // stage at 0,0 in the test DOM: scene = client / zoom - scroll
    expect([card.x, card.y]).toEqual([200 / 2 + 20, 120 / 2 - 10])
    expect(isCard(card)).toBe(true)
    expect(card.link).toBe(documentLink(GRAPH, 'doc-7'))
    expect(added).toHaveLength(1)
    expect(added[0]!.detail).toEqual({ elementId: card.id, target: documentTarget })

    // A node a board cannot hold (a folder) adds nothing.
    const folder = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
      dataTransfer: payload({ id: 'f1', kind: 'folder' }), clientX: 1, clientY: 1,
    })
    stage.dispatchEvent(folder)
    expect(c.state.elements).toHaveLength(1)

    detach()
    stage.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: payload({ id: 'doc-7', kind: 'document' }), clientX: 1, clientY: 1 }))
    expect(c.state.elements).toHaveLength(1)
  })

  it('a read-only board ignores drops', () => {
    const { deps, c } = flow({ readOnly: true, targetOfSidebarNode: () => documentTarget })
    const stage = document.createElement('div')
    const detach = attachSidebarDrop(stage, deps)
    const dt = { types: ['application/x-shrubbery-sidebar-node'], getData: () => JSON.stringify({ id: 'doc-7', kind: 'document' }), dropEffect: 'none' }
    const over = Object.assign(new Event('dragover', { cancelable: true }), { dataTransfer: dt })
    stage.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(false)
    stage.dispatchEvent(Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: dt, clientX: 0, clientY: 0 }))
    expect(c.state.elements).toHaveLength(0)
    detach()
  })

  it('add_card_picks_places_selects_and_announces', async () => {
    const requests: unknown[] = []
    const { deps, c, notes, added } = flow(
      { pickLink: async (request) => { requests.push(request); return objectTarget } },
      { scrollX: -100, scrollY: -50, zoom: { value: 2 }, width: 800, height: 600 },
    )
    const existing = { id: 'old', type: 'rectangle', version: 1, versionNonce: 1, index: 'a0', isDeleted: true } as WbElement
    c.state.elements = [existing]

    const card = await addCard(deps)
    expect(requests).toEqual([{ graphId: GRAPH, heading: 'Add a card', accept: 'any', excludeDocumentId: 'board-1' }])
    expect(card).not.toBeNull()
    // The centre of the visible canvas: 800/2/2 + 100 = 300, 600/2/2 + 50 = 200; the card is centred on it.
    expect([card!.x, card!.y]).toEqual([300 - 160, 200 - 90])
    expect(c.state.elements).toEqual([existing, card])
    expect(c.state.updates[0]!.appState.selectedElementIds).toEqual({ [card!.id]: true })
    expect(c.state.updates[0]!.captureUpdate).toBe('IMMEDIATELY')
    expect(card!.index! > 'a0').toBe(true)
    expect(added).toHaveLength(1)
    expect(added[0]!.detail).toEqual({ elementId: card!.id, target: objectTarget })
    expect(notes.at(-1)).toContain('Meier')

    // An explicit place wins over the centre.
    const placed = await addCard(deps, { x: 7, y: 9 })
    expect([placed!.x, placed!.y]).toEqual([7, 9])

    // Cancelled: nothing added.
    const cancelled = flow({ pickLink: async () => null })
    expect(await addCard(cancelled.deps)).toBeNull()
    expect(cancelled.c.state.updates).toHaveLength(0)
    // No picker: told, and null.
    const none = flow({})
    expect(await addCard(none.deps)).toBeNull()
    expect(none.notes).toHaveLength(1)
    // Read-only: told, and the picker is never opened.
    let opened = false
    const ro = flow({ readOnly: true, pickLink: async () => { opened = true; return objectTarget } })
    expect(await addCard(ro.deps)).toBeNull()
    expect(opened).toBe(false)
    expect(ro.notes).toHaveLength(1)
  })
})
