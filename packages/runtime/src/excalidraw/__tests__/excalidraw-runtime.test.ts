import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXCALIDRAW_NODE_DND_MIME,
  EXCALIDRAW_SCENE_MIME,
  decodeExcalidrawArtifact,
  embedExcalidrawProjection,
  mountExcalidrawRuntime,
  type ExcalidrawApi,
  type ExcalidrawArtifactPayload,
  type ExcalidrawArtifactSaveRequest,
  type ExcalidrawCanvasHost,
  type ExcalidrawDroppedNodeIntent,
  type ExcalidrawEngineContext,
  type ExcalidrawInitialData,
  type ExcalidrawLinkCallbacks,
  type ExcalidrawProjectionRequest,
  type ExcalidrawProjectionView,
  type ExcalidrawRuntimeHandle,
  type ExcalidrawRuntimeModule,
  type ExcalidrawWireCallbacks,
} from '../excalidraw-runtime.js'

interface FakeVNode {
  readonly props: Record<string, unknown>
}

interface Harness {
  readonly host: ExcalidrawCanvasHost
  readonly handle: ExcalidrawRuntimeHandle
  readonly api: ExcalidrawApi
  readonly load: ReturnType<typeof vi.fn>
  readonly save: ReturnType<typeof vi.fn>
  readonly onChange: ReturnType<typeof vi.fn>
  readonly project: ReturnType<typeof vi.fn>
  readonly rootRender: ReturnType<typeof vi.fn>
  readonly rootUnmount: ReturnType<typeof vi.fn>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly updateScene: ReturnType<typeof vi.fn>
  props(): Record<string, unknown>
  change(elements: readonly unknown[], appState?: Record<string, unknown>, files?: unknown): void
}

const handles: ExcalidrawRuntimeHandle[] = []

afterEach(() => {
  for (const handle of handles) handle.destroy()
  handles.length = 0
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function fakeHost(): ExcalidrawCanvasHost {
  const host = document.createElement('div') as unknown as ExcalidrawCanvasHost
  Object.assign(host, {
    graphId: '',
    artifactId: '',
    status: 'idle',
    error: '',
    saveStatus: 'idle',
    projectionStatus: 'idle',
    syncStatus: 'idle',
    hydrateStatus: 'idle',
    liveMessage: '',
    nodeLinkPickerOpen: false,
    projection: null,
    diagnostics: [],
    selectedElement: null,
    wireSummary: null,
    requestUpdate: vi.fn(),
  })
  document.body.appendChild(host)
  return host
}

function initialScene(): ExcalidrawInitialData {
  return {
    type: 'excalidraw',
    version: 2,
    elements: [{ id: 'shape-a', type: 'rectangle', x: 10, y: 20 }],
    appState: { viewBackgroundColor: '#fff', collaborators: { transient: true } },
    files: { fileA: { id: 'fileA' } },
  }
}

function makeHarness(overrides: {
  payload?: ExcalidrawArtifactPayload
  cssText?: string
  scheduleFrame?: (callback: FrameRequestCallback) => number
  project?: (request: ExcalidrawProjectionRequest) => ExcalidrawProjectionView | Promise<ExcalidrawProjectionView>
  save?: (request: ExcalidrawArtifactSaveRequest) => void | Promise<void>
  links?: ExcalidrawLinkCallbacks
  wires?: ExcalidrawWireCallbacks
} = {}): Harness {
  const host = fakeHost()
  let elements: readonly unknown[] = []
  let appState: Record<string, unknown> = {}
  let files: unknown = {}
  let latestProps: Record<string, unknown> = {}
  const refresh = vi.fn()
  const updateScene = vi.fn((data: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => {
    if (data.elements) elements = data.elements
    if (data.appState) appState = data.appState
  })
  const api: ExcalidrawApi = {
    getSceneElements: () => elements,
    getAppState: () => appState,
    getFiles: () => files,
    updateScene,
    refresh,
  }
  const rootRender = vi.fn((node: unknown) => {
    latestProps = (node as FakeVNode).props
    const data = latestProps.initialData as ExcalidrawInitialData
    elements = data.elements ?? []
    appState = data.appState ?? {}
    files = data.files ?? {}
    ;(latestProps.excalidrawAPI as (value: ExcalidrawApi) => void)(api)
  })
  const rootUnmount = vi.fn()
  const runtime: ExcalidrawRuntimeModule = {
    Excalidraw: Symbol('Excalidraw'),
    cssText: overrides.cssText,
    createElement: (_type, props) => ({ props }),
    createRoot: () => ({ render: rootRender, unmount: rootUnmount }),
    serializeAsJSON: (sceneElements, sceneAppState, sceneFiles) => JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: sceneElements,
      appState: sceneAppState,
      files: sceneFiles,
    }),
    convertToExcalidrawElements: (skeleton) => skeleton,
    viewportCoordsToSceneCoords: (point) => ({ x: point.clientX - 1, y: point.clientY - 2 }),
  }
  const load = vi.fn(async (): Promise<ExcalidrawArtifactPayload> => overrides.payload ?? JSON.stringify(initialScene()))
  const save = vi.fn(async (request: ExcalidrawArtifactSaveRequest): Promise<void> => {
    await overrides.save?.(request)
  })
  const onChange = vi.fn(async () => {})
  const project = vi.fn(overrides.project ?? ((request: ExcalidrawProjectionRequest): ExcalidrawProjectionView => {
    const selectedElementId = request.selectedElementId
    const count = request.elements.length
    return {
      summary: { anchors: count, arrows: 0, wireCandidates: 0, diagnostics: 0 },
      diagnostics: [],
      selectedElement: selectedElementId ? { id: selectedElementId, label: `Selected ${selectedElementId}` } : null,
      wireSummary: { missing: 0, hydratable: 0 },
      embedded: { schemaVersion: 1, counts: { anchors: count } },
      raw: { kind: 'full-projection', anchors: count },
    }
  }))
  const handle = mountExcalidrawRuntime(host, {
    scope: { graphId: 'graph-a', artifactId: 'scene-a' },
    artifacts: { load, save, onChange },
    projection: { project },
    links: overrides.links,
    wires: overrides.wires,
    loader: async () => runtime,
    scheduleFrame: overrides.scheduleFrame ?? ((callback) => {
      callback(0)
      return 1
    }),
  })
  handles.push(handle)
  return {
    host,
    handle,
    api,
    load,
    save,
    onChange,
    project,
    rootRender,
    rootUnmount,
    refresh,
    updateScene,
    props: () => latestProps,
    change(nextElements, nextAppState = {}, nextFiles = {}) {
      elements = nextElements
      appState = nextAppState
      files = nextFiles
      ;(latestProps.onChange as (
        changedElements: readonly unknown[],
        changedAppState: Record<string, unknown>,
        changedFiles: unknown,
      ) => void)(elements, appState, files)
    },
  }
}

async function until(predicate: () => boolean, message = 'condition did not become true'): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

function intent(host: ExcalidrawCanvasHost, type: string, detail: Record<string, unknown> = {}): void {
  host.dispatchEvent(new CustomEvent(type, {
    detail: { graphId: 'graph-a', artifactId: 'scene-a', ...detail },
    bubbles: true,
    composed: true,
  }))
}

describe('Excalidraw artifact codec', () => {
  it('decodes string/bytes/blob and strips transient collaborators', async () => {
    const json = JSON.stringify(initialScene())
    for (const payload of [
      json,
      new TextEncoder().encode(json),
      new TextEncoder().encode(json).buffer,
      new Blob([json], { type: EXCALIDRAW_SCENE_MIME }),
    ]) {
      const decoded = await decodeExcalidrawArtifact(payload)
      expect(decoded.elements).toHaveLength(1)
      expect(decoded.appState?.collaborators).toBeUndefined()
      expect(decoded.appState?.viewBackgroundColor).toBe('#fff')
    }
  })

  it('normalizes empty payloads and rejects corrupt/non-object artifacts', async () => {
    expect(await decodeExcalidrawArtifact(null)).toEqual({ elements: [], appState: {}, files: {} })
    await expect(decodeExcalidrawArtifact('{not-json')).rejects.toBeInstanceOf(SyntaxError)
    await expect(decodeExcalidrawArtifact('[]')).rejects.toThrow('JSON object')
  })

  it('embeds the semantic projection without losing native scene fields', () => {
    const json = embedExcalidrawProjection(
      JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a' }] }),
      { schemaVersion: 1, counts: { anchors: 1 } },
    )
    expect(JSON.parse(json)).toEqual({
      type: 'excalidraw',
      elements: [{ id: 'a' }],
      mnemosyneProjection: { schemaVersion: 1, counts: { anchors: 1 } },
    })
  })
})

describe('mountExcalidrawRuntime — named-slot React lifecycle', () => {
  it('loads bytes, mounts once into the named slot, claims the API, and projects the scene', async () => {
    const h = makeHarness({ cssText: ':root { --zIndex-layerUI: 2; } .excalidraw { color: red; }' })
    expect(h.handle.mountElement.slot).toBe('canvas')
    expect(h.handle.mountElement.parentElement).toBe(h.host)
    expect(h.host.status).toBe('loading')

    await h.handle.ready
    expect(h.load).toHaveBeenCalledWith(expect.objectContaining({
      graphId: 'graph-a',
      artifactId: 'scene-a',
      signal: expect.any(AbortSignal),
    }))
    expect(h.rootRender).toHaveBeenCalledOnce()
    expect((h.props().initialData as ExcalidrawInitialData).appState?.collaborators).toBeUndefined()
    expect(h.handle.api).toBe(h.api)
    expect(h.host.status).toBe('ready')
    expect(h.host.projection).toMatchObject({ anchors: 1 })
    expect(h.project).toHaveBeenCalledWith(expect.objectContaining({ reason: 'load' }))
    expect(h.refresh).toHaveBeenCalledOnce()
    const style = h.handle.mountElement.shadowRoot?.querySelector('style[data-excalidraw-runtime-style]')
    expect(style?.textContent).toContain('.excalidraw { --zIndex-layerUI: 2; }')
    expect(document.head.querySelector('style[data-excalidraw-runtime-style]')).toBeNull()
  })

  it('lets a rapid reload supersede an aborted initial load without rejecting readiness', async () => {
    const host = fakeHost()
    let latestProps: Record<string, unknown> = {}
    const api: ExcalidrawApi = {
      getSceneElements: () => [],
      getAppState: () => ({}),
      getFiles: () => ({}),
      updateScene: () => {},
    }
    const runtime: ExcalidrawRuntimeModule = {
      Excalidraw: Symbol('Excalidraw'),
      createElement: (_type, props) => ({ props }),
      createRoot: () => ({
        render(node) {
          latestProps = (node as FakeVNode).props
          ;(latestProps.excalidrawAPI as (value: ExcalidrawApi) => void)(api)
        },
        unmount() {},
      }),
      serializeAsJSON: () => JSON.stringify({ type: 'excalidraw', elements: [] }),
    }
    let loadCount = 0
    const handle = mountExcalidrawRuntime(host, {
      scope: { graphId: 'graph-a', artifactId: 'scene-a' },
      artifacts: {
        load: ({ signal }) => {
          loadCount += 1
          if (loadCount > 1) return Promise.resolve(JSON.stringify({ type: 'excalidraw', elements: [] }))
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('superseded', 'AbortError')), { once: true })
          })
        },
        save: async () => {},
      },
      loader: async () => runtime,
      scheduleFrame: (callback) => { callback(0); return 1 },
    })
    handles.push(handle)

    await handle.reload()
    await expect(handle.ready).resolves.toBeUndefined()
    expect(loadCount).toBe(2)
    expect(host.status).toBe('ready')
    expect(host.error).toBe('')
  })

  it('owns onChange snapshots, exact single selection, and latest controlled projection', async () => {
    const h = makeHarness()
    await h.handle.ready
    h.change(
      [{ id: 'a' }, { id: 'b' }],
      { selectedElementIds: { b: true } },
      { image: { id: 'image' } },
    )
    await until(() => h.onChange.mock.calls.length === 1 && h.host.selectedElement?.label === 'Selected b')

    expect(h.onChange).toHaveBeenCalledWith(expect.objectContaining({
      graphId: 'graph-a',
      artifactId: 'scene-a',
      snapshot: expect.objectContaining({
        elements: [{ id: 'a' }, { id: 'b' }],
        selectedElementId: 'b',
      }),
    }))
    expect(h.project).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'change', selectedElementId: 'b' }))
    expect(h.host.projection).toMatchObject({ anchors: 2 })
  })

  it('coalesces high-frequency onChange projection and observation work to one animation frame', async () => {
    const frames: FrameRequestCallback[] = []
    const h = makeHarness({
      scheduleFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
    })
    await h.handle.ready
    frames.shift()?.(0) // initial API layout refresh
    const projectionCalls = h.project.mock.calls.length

    h.change([{ id: 'a' }], { selectedElementIds: { a: true } })
    h.change([{ id: 'a' }, { id: 'b' }], { selectedElementIds: { b: true } })
    h.change([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { selectedElementIds: { c: true } })
    expect(frames).toHaveLength(1)
    expect(h.onChange).not.toHaveBeenCalled()
    frames.shift()?.(16)
    await until(() => h.onChange.mock.calls.length === 1 && h.project.mock.calls.length === projectionCalls + 1)

    expect(h.onChange.mock.calls[0]?.[0]).toMatchObject({
      snapshot: { elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], selectedElementId: 'c' },
    })
  })

  it('serializes current API state, embeds projection, saves bytes, and emits completion', async () => {
    const h = makeHarness()
    await h.handle.ready
    h.change([{ id: 'saved-shape' }], { zoom: { value: 1 } }, {})
    await until(() => h.host.projection?.anchors === 1)
    const savedEvents: unknown[] = []
    h.host.addEventListener('mn-excalidraw-runtime-saved', (event) => {
      savedEvents.push((event as CustomEvent).detail)
    })

    await h.handle.save()
    expect(h.host.saveStatus).toBe('saved')
    expect(h.save).toHaveBeenCalledOnce()
    const request = h.save.mock.calls[0]?.[0] as { json: string; bytes: Uint8Array; mimeType: string; label: string }
    expect(request.mimeType).toBe(EXCALIDRAW_SCENE_MIME)
    expect(request.label).toBe('Edited')
    expect(new TextDecoder().decode(request.bytes)).toBe(request.json)
    expect(JSON.parse(request.json)).toMatchObject({
      type: 'excalidraw',
      elements: [{ id: 'saved-shape' }],
      mnemosyneProjection: { schemaVersion: 1, counts: { anchors: 1 } },
    })
    expect(savedEvents).toHaveLength(1)
  })

  it('reloads with a new keyed React tree while retaining one root and one slot', async () => {
    const h = makeHarness()
    await h.handle.ready
    const firstKey = h.props().key
    await h.handle.reload()
    expect(h.load).toHaveBeenCalledTimes(2)
    expect(h.rootRender).toHaveBeenCalledTimes(2)
    expect(h.props().key).not.toBe(firstKey)
    expect(h.host.querySelectorAll('[slot="canvas"]')).toHaveLength(1)
    expect(h.rootUnmount).not.toHaveBeenCalled()
  })

  it('reports mount and save failures through the controlled host', async () => {
    const host = fakeHost()
    const failed = mountExcalidrawRuntime(host, {
      scope: { graphId: 'graph-a', artifactId: 'scene-a' },
      artifacts: { load: async () => { throw new Error('load exploded') }, save: async () => {} },
      loader: async () => { throw new Error('engine exploded') },
    })
    handles.push(failed)
    await expect(failed.ready).rejects.toThrow(/exploded/)
    expect(host.status).toBe('error')
    expect(host.error).toMatch(/exploded/)

    const h = makeHarness({ save: async () => { throw new Error('revision rejected') } })
    await h.handle.ready
    await expect(h.handle.save()).rejects.toThrow('revision rejected')
    expect(h.host.saveStatus).toBe('error')
    expect(h.host.error).toBe('revision rejected')
  })

  it('aborts work, removes listeners/slot, and unmounts React exactly once', async () => {
    const h = makeHarness()
    await h.handle.ready
    h.handle.destroy()
    h.handle.destroy()
    expect(h.handle.destroyed).toBe(true)
    expect(h.rootUnmount).toHaveBeenCalledOnce()
    expect(h.handle.mountElement.isConnected).toBe(false)
    expect(h.host.status).toBe('idle')
    expect(h.host).toMatchObject({
      error: '',
      projection: null,
      diagnostics: [],
      selectedElement: null,
      wireSummary: null,
      nodeLinkPickerOpen: false,
    })

    const renders = h.rootRender.mock.calls.length
    intent(h.host, 'mn-excalidraw-reload')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.rootRender).toHaveBeenCalledTimes(renders)
  })
})

describe('mountExcalidrawRuntime — controlled intent bridge', () => {
  it('serializes async scene operations so stale wire mutations cannot overtake each other', async () => {
    let resolveSync!: () => void
    let resolveHydrate!: () => void
    const order: string[] = []
    const sync = vi.fn(async () => {
      order.push('sync:start')
      await new Promise<void>((resolve) => { resolveSync = resolve })
      order.push('sync:end')
      return { message: 'sync done' }
    })
    const hydrate = vi.fn(async () => {
      order.push('hydrate:start')
      await new Promise<void>((resolve) => { resolveHydrate = resolve })
      order.push('hydrate:end')
      return { message: 'hydrate done' }
    })
    const h = makeHarness({ wires: { sync, hydrate } })
    await h.handle.ready

    intent(h.host, 'mn-excalidraw-sync-wires')
    intent(h.host, 'mn-excalidraw-hydrate-wires')
    await until(() => sync.mock.calls.length === 1)
    expect(hydrate).not.toHaveBeenCalled()
    resolveSync()
    await until(() => hydrate.mock.calls.length === 1)
    expect(order).toEqual(['sync:start', 'sync:end', 'hydrate:start'])
    resolveHydrate()
    await until(() => h.host.hydrateStatus === 'success')
    expect(order).toEqual(['sync:start', 'sync:end', 'hydrate:start', 'hydrate:end'])
  })

  it('runs projection/wire operations and applies hydrate mutations with persistence', async () => {
    const sync = vi.fn(async () => ({
      view: { wireSummary: { missing: 0, created: 2, lastMessage: 'two created' } },
      message: 'two created',
    }))
    const hydrate = vi.fn(async () => ({
      elements: [{ id: 'hydrated-arrow', type: 'arrow' }],
      save: true,
      message: 'one hydrated',
    }))
    const h = makeHarness({ wires: { sync, hydrate } })
    await h.handle.ready

    intent(h.host, 'mn-excalidraw-sync-wires')
    await until(() => h.host.syncStatus === 'success')
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({
      graphId: 'graph-a',
      artifactId: 'scene-a',
      api: h.api,
    }))
    expect(h.host.wireSummary).toMatchObject({ created: 2 })

    intent(h.host, 'mn-excalidraw-hydrate-wires')
    await until(() => h.host.hydrateStatus === 'success' && h.save.mock.calls.length === 1)
    expect(h.updateScene).toHaveBeenCalledWith({ elements: [{ id: 'hydrated-arrow', type: 'arrow' }] })
    expect(JSON.parse((h.save.mock.calls[0]?.[0] as { json: string }).json).elements).toEqual([
      { id: 'hydrated-arrow', type: 'arrow' },
    ])
  })

  it('opens the picker and bridges pick/open/recreate/unlink/predicate/link-refresh intents', async () => {
    const linkSelected = vi.fn(async () => ({ elements: [{ id: 'linked' }] }))
    const openSelected = vi.fn()
    const recreateTarget = vi.fn()
    const removeSelected = vi.fn(async () => ({ elements: [{ id: 'unlinked' }] }))
    const changePredicate = vi.fn(async () => ({ elements: [{ id: 'arrow', predicate: 'supports' }] }))
    const refreshTitles = vi.fn()
    const h = makeHarness({
      links: { linkSelected, openSelected, recreateTarget, removeSelected, changePredicate, refreshTitles },
    })
    await h.handle.ready
    h.change([{ id: 'shape-a' }], { selectedElementIds: { 'shape-a': true } })
    await until(() => h.host.selectedElement?.id === 'shape-a')

    intent(h.host, 'mn-excalidraw-link-selected', { elementId: 'shape-a' })
    expect(h.host.nodeLinkPickerOpen).toBe(true)
    intent(h.host, 'mn-excalidraw-node-link-pick', {
      elementId: 'shape-a',
      kind: 'document',
      id: 'doc-a',
      title: 'Document A',
    })
    await until(() => linkSelected.mock.calls.length === 1)
    expect(h.host.nodeLinkPickerOpen).toBe(false)
    expect(linkSelected).toHaveBeenCalledWith(expect.anything(), {
      elementId: 'shape-a',
      kind: 'document',
      id: 'doc-a',
      title: 'Document A',
      mimeType: undefined,
    })

    intent(h.host, 'mn-excalidraw-open-selected-link', { elementId: 'shape-a' })
    intent(h.host, 'mn-excalidraw-recreate-target', { elementId: 'shape-a' })
    intent(h.host, 'mn-excalidraw-remove-selected-link', { elementId: 'shape-a' })
    intent(h.host, 'mn-excalidraw-predicate-change', { elementId: 'shape-a', predicate: 'supports' })
    intent(h.host, 'mn-excalidraw-refresh-link-titles')
    await until(() => (
      openSelected.mock.calls.length === 1
      && recreateTarget.mock.calls.length === 1
      && removeSelected.mock.calls.length === 1
      && changePredicate.mock.calls.length === 1
      && refreshTitles.mock.calls.length === 1
    ))
    expect(changePredicate).toHaveBeenCalledWith(expect.anything(), {
      elementId: 'shape-a',
      predicate: 'supports',
    })
  })

  it('intercepts Excalidraw link-open synchronously only when the shell handles it', async () => {
    const openElementLink = vi.fn(() => true)
    const h = makeHarness({ links: { openElementLink } })
    await h.handle.ready
    const preventDefault = vi.fn()
    ;(h.props().onLinkOpen as (element: unknown, event: unknown) => void)(
      { id: 'linked-shape', link: 'mnemosyne://document/graph-a/doc-a' },
      { preventDefault },
    )
    expect(openElementLink).toHaveBeenCalledWith(
      expect.objectContaining({ api: h.api }),
      expect.objectContaining({ element: expect.objectContaining({ id: 'linked-shape' }) }),
    )
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('bridges HTML5 and native pointer node drops through one shell callback', async () => {
    const dropNode = vi.fn(async (
      _context: ExcalidrawEngineContext,
      _intent: ExcalidrawDroppedNodeIntent,
    ) => ({ elements: [{ id: 'dropped-node' }] }))
    const h = makeHarness({ links: { dropNode } })
    await h.handle.ready

    const transfer = {
      types: [EXCALIDRAW_NODE_DND_MIME],
      dropEffect: 'none',
      getData: () => JSON.stringify({ id: 'doc-a', type: 'document' }),
    }
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(drop, {
      dataTransfer: { value: transfer },
      clientX: { value: 40 },
      clientY: { value: 50 },
    })
    h.handle.mountElement.dispatchEvent(drop)
    await until(() => dropNode.mock.calls.length === 1)
    expect(drop.defaultPrevented).toBe(true)
    expect(dropNode).toHaveBeenCalledWith(expect.anything(), {
      node: { id: 'doc-a', type: 'document' },
      clientX: 40,
      clientY: 50,
    })

    Object.defineProperty(h.handle.mountElement, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
    })
    window.dispatchEvent(new CustomEvent('mn-sidebar-node-drop', {
      detail: { node: { id: 'artifact-a', type: 'artifact' }, clientX: 100, clientY: 100 },
    }))
    await until(() => dropNode.mock.calls.length === 2)
    expect(dropNode.mock.calls[1]?.[1]).toEqual({
      node: { id: 'artifact-a', type: 'artifact' },
      clientX: 100,
      clientY: 100,
    })
  })

  it('ignores intents scoped to a different graph/artifact', async () => {
    const sync = vi.fn()
    const h = makeHarness({ wires: { sync } })
    await h.handle.ready
    h.host.dispatchEvent(new CustomEvent('mn-excalidraw-sync-wires', {
      detail: { graphId: 'graph-other', artifactId: 'scene-other' },
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sync).not.toHaveBeenCalled()
  })
})
