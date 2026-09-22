/**
 * The app-switcher Choreograph surface is rendered through the RDF workspace
 * interpreter, not the standalone route. This real Happy DOM test proves that
 * its host feature supplies the same graph-scoped run history to the actual
 * Lit Studio element, including a graph switch and a user Refresh click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import '@shrubbery/components'
import type { WfChoreographView, WfStudioShell } from '@shrubbery/components'
import { createShellContext } from '../shell-context.js'
import { createChoreographStudioFeature } from '../shell-features.js'

type StudioContract = Pick<ShrubberyContract, 'auth' | 'runtime' | 'rest'>

function contract(): StudioContract {
  return {
    auth: {
      token: () => 'fresh-id-token',
      userId: () => 'user-7',
      isAuthenticated: () => true,
      whenReady: async () => {},
      onChange: () => () => {},
    },
    runtime: {
      mode: () => 'hosted',
      isGateway: () => true,
      graphBaseUrl: (graphId: string) => `https://gateway.test/g/${encodeURIComponent(graphId)}`,
    },
    rest: {
      graphs: async () => [],
      query: async () => ({ rows: [] }),
      update: async () => {},
    },
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
}

function context(host: HTMLElement, graphId: string, activeContract: StudioContract) {
  return createShellContext({
    host,
    graphId,
    documentId: null,
    app: 'choreograph',
    source: 'CELL_LIVE',
    deploymentMode: 'hosted',
    contract: activeContract,
    location: new URL(`https://canary.test/?graph=${encodeURIComponent(graphId)}`),
    rerender: vi.fn(),
  })
}

async function mountStudio(host: HTMLElement): Promise<WfStudioShell> {
  const studio = document.createElement('wf-studio-shell') as WfStudioShell
  studio.screen = 'runs'
  host.replaceChildren(studio)
  await studio.updateComplete
  return studio
}

async function historyView(studio: WfStudioShell): Promise<WfChoreographView> {
  await studio.updateComplete
  const view = studio.shadowRoot?.querySelector('wf-choreograph-view') as WfChoreographView | null
  expect(view).not.toBeNull()
  await view!.updateComplete
  return view!
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('Choreograph workspace feature', () => {
  it('loads the active graph into the real app-switcher Studio, then refreshes the replacement graph', async () => {
    let resolveSophiaCodeLab: (response: Response) => void = () => {
      throw new Error('The sophia-code-lab response was not requested.')
    }
    const sophiaCodeLab = new Promise<Response>((resolve) => {
      resolveSophiaCodeLab = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/workflows')) {
        return json({ workflows: [{ name: 'survey-synthesize', phases: [{ title: 'Survey' }] }] })
      }
      if (url === 'https://gateway.test/g/graph-a/workflows/runs?graph_id=graph-a&limit=200') {
        return json({ runs: [{ runId: 'wfr-a', workflowName: 'Alpha survey', status: 'finished' }] })
      }
      if (url === 'https://gateway.test/g/sophia-code-lab/workflows/runs?graph_id=sophia-code-lab&limit=200') {
        return sophiaCodeLab
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const host = document.createElement('div')
    document.body.append(host)
    const activeContract = contract()
    const feature = createChoreographStudioFeature<StudioContract>()

    const firstStudio = await mountStudio(host)
    feature.afterWorkspaceRender!(context(host, 'graph-a', activeContract), {})
    await vi.waitFor(() => {
      expect(firstStudio.historyRuns).toEqual([
        expect.objectContaining({ runId: 'wfr-a', workflowName: 'Alpha survey' }),
      ])
      expect(firstStudio.workflows).toEqual([
        expect.objectContaining({ name: 'survey-synthesize' }),
      ])
    })
    const firstRequestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(firstRequestHeaders.get('authorization')).toBe('Bearer fresh-id-token')
    expect(firstRequestHeaders.get('x-user-id')).toBeNull()
    const firstHistory = await historyView(firstStudio)
    expect(firstHistory.shadowRoot?.querySelector('.subtitle')?.textContent).toContain('graph-a')
    expect(firstHistory.shadowRoot?.querySelectorAll('.history-row')).toHaveLength(1)

    feature.afterWorkspaceRender!(context(host, 'sophia-code-lab', activeContract), {})
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(firstStudio.historyRuns).toEqual([])
    })
    resolveSophiaCodeLab(json({
      runs: [{ runId: 'wfr-live', workflowName: 'Graph survey synthesize', status: 'finished' }],
    }))
    await vi.waitFor(() => {
      expect(firstStudio.historyRuns).toEqual([
        expect.objectContaining({ runId: 'wfr-live', workflowName: 'Graph survey synthesize' }),
      ])
    })
    const firstGraphBHistory = await historyView(firstStudio)
    expect(firstGraphBHistory.shadowRoot?.querySelector('.subtitle')?.textContent).toContain('sophia-code-lab')

    // A workspace render can replace the stamped Studio node. The feature keeps
    // the controller and rehydrates the replacement without a second stale read.
    const secondStudio = await mountStudio(host)
    feature.afterWorkspaceRender!(context(host, 'sophia-code-lab', activeContract), {})
    await vi.waitFor(() => {
      expect(secondStudio.historyRuns).toEqual([
        expect.objectContaining({ runId: 'wfr-live', workflowName: 'Graph survey synthesize' }),
      ])
    })
    const secondHistory = await historyView(secondStudio)
    expect(secondHistory.shadowRoot?.querySelector('.subtitle')?.textContent).toContain('sophia-code-lab')
    expect(secondHistory.shadowRoot?.querySelectorAll('.history-row')).toHaveLength(1)

    const refresh = secondHistory.shadowRoot?.querySelector('[aria-label="Refresh workflow runs"]') as HTMLButtonElement
    refresh.click()
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain('/g/sophia-code-lab/workflows/runs?graph_id=sophia-code-lab')

    feature.destroy?.()
  })
})
