import { describe, expect, it, vi } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import {
  ChoreographStudioController,
  ChoreographStudioService,
} from '../choreograph-studio-service.js'

function fakeContract(
  restQuery: (graphId: string, sparql: string) => Promise<unknown> = async () => ({ rows: [] }),
  runtimeMode: 'local' | 'hosted' = 'hosted',
) {
  return {
    auth: {
      token: () => 'fresh-id-token',
      userId: () => 'user-7',
      isAuthenticated: () => true,
      whenReady: async () => {},
      onChange: () => () => {},
    },
    runtime: {
      mode: () => runtimeMode,
      isGateway: () => runtimeMode === 'hosted',
      graphBaseUrl: (graphId: string) => `https://gateway.test/g/${encodeURIComponent(graphId)}`,
    },
    rest: {
      graphs: async () => [],
      query: restQuery,
      update: async () => {},
    },
  } satisfies Pick<ShrubberyContract, 'auth' | 'runtime' | 'rest'>
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sse(events: readonly Record<string, unknown>[]): Response {
  const body = events
    .map((event) => `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('ChoreographStudioService', () => {
  it('loads the graph-scoped run index with fresh host auth and normalizes both wire conventions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({
      runs: [
        {
          runId: 'wfr-new',
          workflowName: 'Survey',
          status: 'running',
          startedAt: 1_700_000_000_000,
          durationMs: null,
        },
        {
          run_id: 'wfr-old',
          workflow_name: 'Synthesis',
          status: 'finished',
          started_at: 1_600_000_000_000,
          duration_ms: 2300,
        },
      ],
      count: 2,
    }))
    const service = new ChoreographStudioService(fakeContract(), { fetch: fetchMock })

    await expect(service.loadRuns('graph-a')).resolves.toEqual({
      kind: 'ok',
      runs: [
        {
          runId: 'wfr-new',
          workflowName: 'Survey',
          status: 'running',
          startedAt: 1_700_000_000_000,
          durationMs: null,
        },
        {
          runId: 'wfr-old',
          workflowName: 'Synthesis',
          status: 'finished',
          startedAt: 1_600_000_000_000,
          durationMs: 2300,
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://gateway.test/g/graph-a/workflows/runs?graph_id=graph-a&limit=200')
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer fresh-id-token',
    })
    expect(new Headers(init?.headers).get('x-user-id')).toBeNull()
  })

  it('keeps the local loopback identity header where the cell consumes it directly', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ runs: [] }))
    const service = new ChoreographStudioService(fakeContract(undefined, 'local'), { fetch: fetchMock })

    await expect(service.loadRuns('graph-a')).resolves.toEqual({ kind: 'ok', runs: [] })

    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-user-id')).toBe('user-7')
    expect(headers.get('authorization')).toBe('Bearer fresh-id-token')
  })

  it('loads the workflow registry and launches with authoritative graph and workflow fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/workflows')) {
        return json({
          workflows: [{
            name: 'survey-synthesize',
            description: 'Survey graph documents.',
            whenToUse: 'Evidence synthesis',
            phases: [{ title: 'Survey' }, { title: 'Synthesize', detail: 'Write the result.' }],
          }],
        })
      }
      expect(init?.method).toBe('POST')
      return json({ runId: 'wfr-launched', status: 'running' }, 202)
    })
    const service = new ChoreographStudioService(fakeContract(), { fetch: fetchMock })

    await expect(service.loadWorkflows('angels')).resolves.toEqual({
      kind: 'ok',
      workflows: [{
        name: 'survey-synthesize',
        description: 'Survey graph documents.',
        whenToUse: 'Evidence synthesis',
        phases: [
          { title: 'Survey', detail: null },
          { title: 'Synthesize', detail: 'Write the result.' },
        ],
      }],
    })
    await expect(service.launchWorkflow({
      graphId: 'angels',
      workflowName: 'survey-synthesize',
      inputs: {
        question: 'What is here?',
        graph_id: 'wrong',
        workflow_name: 'wrong',
      },
    })).resolves.toEqual({ kind: 'ok', runId: 'wfr-launched' })

    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe('https://gateway.test/g/angels/workflows/run')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer fresh-id-token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'What is here?',
      graph_id: 'angels',
      workflow_name: 'survey-synthesize',
    })
  })

  it('reads the frozen run and agent projections from the graph user-RDF authority', async () => {
    const queries: string[] = []
    const restQuery = vi.fn(async (_graphId: string, sparql: string) => {
      queries.push(sparql)
      if (sparql.includes('SELECT DISTINCT ?run ')) {
        return {
          rows: [
            {
              run: '<urn:sophia:wf-run:wfr-7>',
              runId: '"wfr-7"',
              workflowName: '"Survey \\"Moon\\""',
              status: '"stopped"',
              durationMs: '"0"^^<http://www.w3.org/2001/XMLSchema#integer>',
              startedAt: '"2026-07-10T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
            },
            {
              run: '<urn:sophia:wf-run:wfr-7>',
              runId: '"wfr-7"',
              workflowName: '"Survey \\"Moon\\""',
              status: '"completed"',
              durationMs: '"4200"^^<http://www.w3.org/2001/XMLSchema#integer>',
              startedAt: '"2026-07-10T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
            },
          ],
        }
      }
      return {
        rows: [
          {
            agent: '<urn:sophia:wf-run:wfr-7:agent:research>',
            label: '"Research"',
            state: '"running"',
            durationMs: '"0"^^<http://www.w3.org/2001/XMLSchema#integer>',
            startedAt: '"2026-07-10T12:00:01Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
          },
          {
            agent: '<urn:sophia:wf-run:wfr-7:agent:research>',
            label: '"Research"',
            state: '"finished"',
            durationMs: '"1200"^^<http://www.w3.org/2001/XMLSchema#integer>',
            startedAt: '"2026-07-10T12:00:01Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
          },
        ],
      }
    })
    const service = new ChoreographStudioService(fakeContract(restQuery))

    await expect(service.loadProvenance('graph-a', 'wfr-7')).resolves.toEqual({
      kind: 'ok',
      provenance: {
        runId: 'wfr-7',
        workflowName: 'Survey "Moon"',
        status: 'completed',
        startedAt: '2026-07-10T12:00:00Z',
        durationMs: 4200,
        agentRuns: [{
          id: 'urn:sophia:wf-run:wfr-7:agent:research',
          label: 'Research',
          status: 'finished',
          startedAt: '2026-07-10T12:00:01Z',
          durationMs: 1200,
        }],
      },
    })
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('FROM <urn:mnemosyne:local:graph:graph-a:user:rdf>')
    expect(queries[0]).toContain('FILTER(STR(?runId) = "wfr-7")')
    expect(queries[1]).toContain('?agent a wf:AgentRun')
  })

  it('reduces a real named-event SSE stream, deduplicates sequence numbers, and preserves output detail', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse([
      {
        type: 'run.started', runId: 'wfr-7', workflowName: 'Survey', seq: 0,
        phaseIndex: 0, phaseTitle: '', nodeId: '',
      },
      {
        type: 'phase.entered', runId: 'wfr-7', workflowName: 'Survey', seq: 1,
        phaseIndex: 1, phaseTitle: 'Research', nodeId: '',
      },
      {
        type: 'node.output', runId: 'wfr-7', workflowName: 'Survey', seq: 2,
        phaseIndex: 1, phaseTitle: 'Research', nodeId: 'agent-a',
        resultRef: 'urn:result:2', payload: { text: 'evidence' },
      },
      {
        type: 'node.failed', runId: 'other-run', workflowName: 'Ignored', seq: 2,
        phaseIndex: 1, phaseTitle: 'Research', nodeId: 'agent-a', status: 'failed',
      },
      {
        type: 'run.finished', runId: 'wfr-7', workflowName: 'Survey', seq: 3,
        phaseIndex: 0, phaseTitle: '', nodeId: '', status: 'completed',
      },
    ]))
    const service = new ChoreographStudioService(fakeContract(), { fetch: fetchMock })
    const connection = service.connect('graph-a', 'wfr-7')

    await connection.start()

    expect(connection.getState()).toMatchObject({
      status: 'ready',
      error: '',
      liveMessage: 'Run completed',
      run: {
        runId: 'wfr-7',
        workflowName: 'Survey',
        status: 'completed',
        phases: [{
          phaseIndex: 1,
          label: 'Research',
          status: 'exited',
          nodes: [{
            id: 'agent-a',
            status: 'finished',
            resultRef: 'urn:result:2',
            resultDetail: '{\n  "text": "evidence"\n}',
          }],
        }],
      },
    })
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get('accept')).toBe('text/event-stream')
    expect(headers.get('authorization')).toBe('Bearer fresh-id-token')
    expect(headers.get('x-user-id')).toBeNull()
    connection.close()
  })

  it('accepts the JSON poll transport and advances its cursor from X-Next-Since', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json([
      {
        type: 'run.finished', runId: 'wfr-9', workflowName: 'Synthesis', seq: 8,
        phaseIndex: 0, phaseTitle: '', nodeId: '', status: 'failed',
      },
    ], 200, { 'x-next-since': '9' }))
    const connection = new ChoreographStudioService(fakeContract(), { fetch: fetchMock })
      .connect('graph-a', 'wfr-9')

    await connection.start()

    expect(connection.getState()).toMatchObject({
      status: 'ready',
      run: { runId: 'wfr-9', status: 'failed' },
      liveMessage: 'Run failed',
    })
    connection.close()
  })

  it('drives history and monitor snapshots through the lifecycle controller', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/workflows/runs?graph_id=graph-a&limit=200')) {
        return json({ runs: [{ runId: 'wfr-1', workflowName: 'Survey', status: 'running' }] })
      }
      if (url.endsWith('/workflows')) return json({ workflows: [] })
      return sse([{
        type: 'run.finished', runId: 'wfr-1', workflowName: 'Survey', seq: 0,
        phaseIndex: 0, phaseTitle: '', nodeId: '', status: 'finished',
      }])
    })
    const restQuery = vi.fn(async (_graph: string, query: string) => query.includes('SELECT DISTINCT ?run ')
      ? { rows: [{ runId: '"wfr-1"', workflowName: '"Survey"', status: '"finished"' }] }
      : { rows: [] })
    const controller = new ChoreographStudioController(
      new ChoreographStudioService(fakeContract(restQuery), { fetch: fetchMock }),
    )

    await controller.start('runs', 'graph-a', '')
    expect(controller.getState()).toMatchObject({
      historyStatus: 'ready',
      historyRuns: [{ runId: 'wfr-1' }],
    })

    await controller.openRun('graph-a', 'wfr-1')
    await vi.waitFor(() => {
      expect(controller.getState()).toMatchObject({
        monitorStatus: 'ready',
        provenance: { runId: 'wfr-1', workflowName: 'Survey' },
        telemetry: { runId: 'wfr-1', status: 'finished' },
      })
    })
    controller.destroy()
  })
})
