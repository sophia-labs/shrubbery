/**
 * Real-browser proof for the Excalidraw React island.
 *
 * Unit tests inject a deterministic renderer to prove controller causality.
 * This story deliberately uses the default loader so Vite bundles the actual
 * @excalidraw/excalidraw + React + stylesheet path and a browser paints a real
 * canvas inside <mn-excalidraw-canvas>'s named slot.
 */
import type { Meta, StoryObj } from '@storybook/web-components'
import '@shrubbery/components'
import type { MnExcalidrawCanvas } from '@shrubbery/components'
import {
  mountExcalidrawRuntime,
  type ExcalidrawArtifactSaveRequest,
  type ExcalidrawProjectionRequest,
  type ExcalidrawRuntimeHandle,
} from '@shrubbery/runtime'

const meta: Meta = {
  title: 'Runtime/Excalidraw React Island',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

interface BrowserSmokeState {
  ready: boolean
  saves: number
  errors: string[]
  handle: ExcalidrawRuntimeHandle | null
}

declare global {
  interface Window {
    __shrubberyExcalidrawSmoke?: BrowserSmokeState
  }
}

function emptyScene(): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'shrubbery-storybook-runtime-smoke',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  })
}

function projection(request: ExcalidrawProjectionRequest) {
  const selected = request.selectedElementId
  const elements = request.elements.filter((value): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
  ))
  const arrows = elements.filter((element) => element.type === 'arrow').length
  const text = elements.filter((element) => element.type === 'text').length
  return {
    summary: {
      anchors: 0,
      arrows,
      wireCandidates: 0,
      text,
      frames: elements.filter((element) => element.type === 'frame').length,
      diagnostics: 0,
    },
    diagnostics: [],
    selectedElement: selected ? { id: selected } : null,
    wireSummary: { missing: 0, hydratable: 0 },
    embedded: {
      schemaVersion: 1,
      graphId: request.graphId,
      artifactId: request.artifactId,
      counts: { anchors: 0, arrows, wireCandidates: 0, text, diagnostics: 0 },
    },
  }
}

function mountRealCanvas(): MnExcalidrawCanvas {
  window.__shrubberyExcalidrawSmoke?.handle?.destroy()
  const state: BrowserSmokeState = { ready: false, saves: 0, errors: [], handle: null }
  window.__shrubberyExcalidrawSmoke = state

  const host = document.createElement('mn-excalidraw-canvas') as MnExcalidrawCanvas
  host.graphId = 'storybook-graph'
  host.artifactId = 'storybook-scene'
  host.title = 'Real Excalidraw runtime'
  host.style.display = 'block'
  host.style.width = '100vw'
  host.style.height = '100vh'

  const handle = mountExcalidrawRuntime(host, {
    scope: { graphId: host.graphId, artifactId: host.artifactId },
    artifacts: {
      load: async () => emptyScene(),
      save: async (_request: ExcalidrawArtifactSaveRequest) => {
        state.saves += 1
        host.dataset.savedRevisions = String(state.saves)
      },
    },
    projection: { project: projection },
  })
  state.handle = handle
  void handle.ready.then(() => {
    state.ready = true
    host.dataset.runtimeReady = 'true'
  }).catch((error: unknown) => {
    state.errors.push(error instanceof Error ? error.message : String(error))
  })
  return host
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

export const RealCanvas: Story = {
  name: 'Real canvas / load, paint, save',
  render: () => mountRealCanvas(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = canvasElement.querySelector('mn-excalidraw-canvas') as MnExcalidrawCanvas | null
    if (!host) throw new Error('RealCanvas.play: missing controlled host')
    await waitFor(
      () => {
        const runtime = host.querySelector<HTMLElement>('[data-excalidraw-runtime="true"]')
        return host.dataset.runtimeReady === 'true'
          && !!runtime?.shadowRoot?.querySelector('.excalidraw canvas')
      },
      `RealCanvas.play: actual Excalidraw canvas did not paint (${host.error || 'no host error'})`,
    )
    const save = host.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="save"]')
    if (!save || save.disabled) throw new Error('RealCanvas.play: save action is unavailable')
    save.click()
    await waitFor(
      () => host.dataset.savedRevisions === '1',
      'RealCanvas.play: explicit save did not reach artifact callback',
    )
    if ((window.__shrubberyExcalidrawSmoke?.errors.length ?? 0) > 0) {
      throw new Error(`RealCanvas.play: ${window.__shrubberyExcalidrawSmoke!.errors.join('; ')}`)
    }
  },
}
