import { describe, expect, it } from 'vitest'

import {
  FixtureVehicleService,
  activityItems,
  agentJournalItems,
  conversationMessages,
  driverLabel,
  knownAgentModel,
  projectWorkflowOntology,
  projectVehicleSession,
  readVehicleConfig,
  stringAt,
  valueAt,
} from '../vehicle-service.js'
import { projectVehicleChatMessages } from '../chat-projection.js'
import type { VehicleAgentSessionEvent } from '../types.js'

describe('Vehicle service projection', () => {
  it('defaults to the local Choreograph live stack', () => {
    const config = readVehicleConfig('')
    expect(config.fixture).toBe(false)
    expect(config.baseUrl).toBe('http://127.0.0.1:3456')
    expect(config.auth.internalServiceSecret).toBe('dev-internal-secret')
    expect(config.auth.userId).toBe('vehicle-local-user')
    expect(config.clientId).toBe('vehicle-web')
  })

  it('keeps fixture mode explicit for offline UI development', () => {
    const config = readVehicleConfig('?fixture=true')
    expect(config.fixture).toBe(true)
    expect(config.baseUrl).toBe('')
    expect(config.auth.internalServiceSecret).toBeNull()
    expect(config.auth.userId).toBeNull()
  })

  it('has an explicit local live mode alias for the Choreograph VM', () => {
    const config = readVehicleConfig('?fixture=false')
    expect(config.fixture).toBe(false)
    expect(config.baseUrl).toBe('http://127.0.0.1:3456')
    expect(config.auth.internalServiceSecret).toBe('dev-internal-secret')
    expect(config.auth.userId).toBe('vehicle-local-user')
  })

  it('projects live Choreograph agent-session documents into cockpit state', () => {
    const session = projectVehicleSession({
      session: {
        sessionId: 'ags-live',
        runId: 'wfr-live',
        workflowName: 'learner-1',
        graphId: 'vehicle-local',
        label: 'learner-1',
        status: 'completed',
        agentId: 'agent-live',
        model: 'mock:done',
        sandboxId: 'sandbox-live',
      },
      documentRevision: 4,
      document: {
        sessionId: 'ags-live',
        source: { graphId: 'vehicle-local', label: 'learner-1', runId: 'wfr-live' },
        prompts: { system: { title: 'System', text: 'Prompt text', digest: 'abc' } },
        transcript: {
          order: ['result-1'],
          items: { 'result-1': { role: 'assistant', text: 'Mock sandbox validation completed.' } },
        },
        control: {
          driverLease: { holder: 'vehicle-web', epoch: 2 },
          steeringQueue: [{ clientId: 'vehicle-web', text: 'inspect' }],
        },
        runtime: { status: 'completed', sandboxId: 'sandbox-live' },
        view: { panes: [{ id: 'transcript', kind: 'transcript' }, { id: 'control', kind: 'control' }] },
      },
    })

    expect(session.sessionId).toBe('ags-live')
    expect(session.runId).toBe('wfr-live')
    expect(session.workflowName).toBe('learner-1')
    expect(session.agentId).toBe('agent-live')
    expect(session.graphId).toBe('vehicle-local')
    expect(session.status).toBe('completed')
    expect(session.model).toBe('mock:done')
    expect(session.sandboxId).toBe('sandbox-live')
    expect(session.revision).toBe(4)
    expect(session.driver.holder).toBe('vehicle-web')
    expect(session.transcript[0]?.text).toContain('Mock sandbox')
    expect(session.pendingControlEvents[0]?.text).toBe('inspect')
    expect(session.panes.map((pane) => pane.kind)).toEqual(
      expect.arrayContaining(['transcript', 'control', 'prompt', 'runtime']),
    )
  })

  it('renders the known learner-1 model when the live session omits a model', () => {
    const session = projectVehicleSession({
      session: {
        sessionId: 'ags-learner',
        runId: 'wfr-learner',
        workflowName: 'learner-1',
        graphId: 'vehicle-local',
        label: 'learner-1',
        status: 'running',
        agentId: 'agent-learner',
        model: '',
      },
      document: {
        sessionId: 'ags-learner',
        source: { graphId: 'vehicle-local', label: 'learner-1', runId: 'wfr-learner', model: '' },
        runtime: { status: 'running', model: '' },
      },
    })

    expect(knownAgentModel(['learner-1'])).toBe('deepseek-v4-pro')
    expect(session.model).toBe('deepseek-v4-pro')
  })

  it('projects attributed world messages into conversation and activity evidence', async () => {
    const service = new FixtureVehicleService()
    const world = await service.readAgentWorld('agent-research-1')
    const poll = await service.pollAgentWorld('agent-research-1', -1)

    expect(conversationMessages(world).map((message) => message.authorId)).toContain('research-room')
    expect(activityItems(poll.events).some((item) => item.title === 'vera/user')).toBe(true)
    expect(activityItems(poll.events).some((item) => item.title === 'research-room/agent')).toBe(true)
  })

  it('indexes explicit Emporium wf:Workflow definitions before run history', async () => {
    const service = new FixtureVehicleService()
    const workflows = await service.listWorkflows()
    const labels = workflows.workflows.map((workflow) => workflow.label)
    const chatTurn = workflows.workflows.find((workflow) => workflow.workflowId === 'do-chat-turn')
    const readBook = workflows.workflows.find((workflow) => workflow.workflowId === 'read-book')
    const compose = workflows.workflows.find((workflow) => workflow.workflowId === 'compose-workflow')

    expect(labels).toEqual(expect.arrayContaining(['Do a chat turn', 'Read a book']))
    expect(readBook?.runCount).toBe(0)
    expect(readBook?.definitionSubject).toBe('urn:sophia:wf:workflow:read-book')
    expect(readBook?.sourceKind).toBe('current-state')
    expect(readBook?.identityKind).toBe('doc-uri')
    expect(readBook?.draft?.derivedFromQuery).toContain('workflow_authoring_session.draft')
    expect(chatTurn?.binding?.workflowName).toBe('do-chat-turn')
    expect(compose?.draft?.gaps.some((gap) => gap.gapKind === 'wf:scriptBlock' && gap.gapBlocking)).toBe(true)
  })

  it('starts a run from the selected workflow definition rather than the selected agent label', async () => {
    const service = new FixtureVehicleService()
    const workflows = await service.listWorkflows()
    const workflow = workflows.workflows.find((item) => item.workflowId === 'do-chat-turn')
    expect(workflow).toBeTruthy()

    const run = await service.startWorkflow(workflow!, 'Reply to the latest user message.')
    const poll = await service.pollAgentWorld('agent-research-1', -1)

    expect(run.workflowId).toBe('do-chat-turn')
    expect(poll.run?.workflowName).toBe('do-chat-turn')
    expect(valueAt(poll.worldDoc.ontology, ['workflowDefinition', 'definitionSubject'])).toBe(
      'urn:sophia:wf:workflow:do-chat-turn',
    )
    expect(poll.events.some((event) => event.type === 'workflow.run.started')).toBe(true)
  })

  it('projects AgentWorld into a workflow ontology graph', async () => {
    const service = new FixtureVehicleService()
    const agent = (await service.listAgents()).agents[0]
    const world = await service.readAgentWorld(agent.agentId)
    const ontology = projectWorkflowOntology(world, agent)

    expect(ontology.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'wf:Workflow',
        'wf:Run',
        'wf:AgentRun',
        'agt:Session',
        'agt:Run',
        'agt:Agent',
        'contract:AgentWorld',
        'shape:Gate',
      ]),
    )
    expect(ontology.edges.some((edge) => edge.predicate === 'agt:ofSession')).toBe(true)
    expect(ontology.edges.some((edge) => edge.predicate === 'agt:systemPromptBinding')).toBe(true)
    expect(ontology.facts.some((fact) => fact.label === 'shape gate' && fact.value === 'conformant')).toBe(true)
  })

  it('projects turn tool events inline onto the following assistant chat message', async () => {
    const service = new FixtureVehicleService()
    const world = await service.readAgentWorld('agent-research-1')
    const poll = await service.pollAgentWorld('agent-research-1', -1)
    const messages = projectVehicleChatMessages(world, poll.events, { authorId: 'vera', now: 1 })
    const assistant = messages.find((message) => message.id === 'msg-2')

    expect(assistant?.toolCalls).toHaveLength(1)
    expect(assistant?.toolCalls[0]?.tool).toBe('search_blocks')
    expect(assistant?.toolCalls[0]?.status).toBe('completed')
    expect(assistant?.toolCalls[0]?.output).toContain('SRS workspace')
    expect(assistant?.parts.map((part) => part.type)).toEqual(['text', 'tool'])
  })

  it('formats AgentWorld transcript fragments as readable markdown with JSON fences', async () => {
    const service = new FixtureVehicleService()
    const world = await service.readAgentWorld('agent-research-1')
    const messages = projectVehicleChatMessages(
      {
        ...world,
        worldDoc: {
          ...world.worldDoc,
          conversation: {
            messages: [
              {
                id: 'transcript-msg',
                role: 'agent',
                authorId: 'learner-1',
                visibility: 'agent-visible',
                createdAt: 1,
                text: [
                  '[stream text #1]',
                  'Plain answer.',
                  '',
                  'Second paragraph that used to be dropped after a blank line.',
                  '',
                  '---',
                  '',
                  '**Still the same stream fragment.**',
                  '',
                  '[stream text #2]',
                  '{',
                  '',
                  '[stream text #3]',
                  '{ "count": 1, "memories": [{ "content": "hello" }] }',
                  '',
                  '[done output #4]',
                  'Finished.',
                ].join('\n'),
              },
            ],
          },
        },
      },
      [],
      { authorId: 'vera', now: 1 },
    )
    const assistant = messages[0]

    expect(assistant?.content).toContain('### voice leaf 01')
    expect(assistant?.content).toContain('Plain answer.')
    expect(assistant?.content).toContain('Second paragraph that used to be dropped')
    expect(assistant?.content).toContain('Still the same stream fragment')
    expect(assistant?.content).toContain('```json')
    expect(assistant?.content).toContain('"memories"')
    expect(assistant?.content).toContain('### done ribbon 03')
    expect(assistant?.parts.map((part) => part.type)).toEqual([
      'text',
      'transcript',
      'transcript',
      'transcript',
    ])
    expect(assistant?.content).not.toMatch(/### voice leaf \d+\n\n\{\n\n###/)
  })

  it('interleaves AgentWorld stream chunks and tool calls into one transcript lane', async () => {
    const service = new FixtureVehicleService()
    const world = await service.readAgentWorld('agent-research-1')
    const turnId = 'turn-interleaved'
    const events: VehicleAgentSessionEvent[] = [
      {
        sessionId: 'session-research-1',
        seq: 1,
        ts: 2,
        type: 'conversation.turn.stream',
        payload: { turnId, stream: 'text', text: 'First voice chunk.' },
      },
      {
        sessionId: 'session-research-1',
        seq: 2,
        ts: 3,
        type: 'conversation.turn.tool.started',
        payload: { turnId, toolName: 'recall', toolCallId: 'recall-1', args: { graphId: 'vehicle-local' } },
      },
      {
        sessionId: 'session-research-1',
        seq: 3,
        ts: 4,
        type: 'conversation.turn.tool.completed',
        payload: { turnId, toolName: 'recall', toolCallId: 'recall-1', result: '{"count":1}' },
      },
      {
        sessionId: 'session-research-1',
        seq: 4,
        ts: 5,
        type: 'conversation.turn.stream',
        payload: { turnId, stream: 'text', text: '{ "count": 1 }' },
      },
      {
        sessionId: 'session-research-1',
        seq: 5,
        ts: 6,
        type: 'conversation.turn.agent.done',
        payload: { turnId, output: 'Finished with a summary.' },
      },
    ]
    const messages = projectVehicleChatMessages(
      {
        ...world,
        worldDoc: {
          ...world.worldDoc,
          conversation: {
            messages: [
              {
                id: 'interleaved-msg',
                role: 'agent',
                authorId: 'learner-1',
                visibility: 'agent-visible',
                createdAt: 10,
                text: [
                  '[stream text #1]',
                  'First voice chunk.',
                  '',
                  '[stream text #2]',
                  '{ "count": 1 }',
                  '',
                  '[done output #3]',
                  'Finished with a summary.',
                ].join('\n'),
              },
            ],
          },
        },
      },
      events,
      { authorId: 'vera', now: 1 },
    )
    const assistant = messages[0]

    expect(assistant?.parts.map((part) => part.type)).toEqual([
      'text',
      'transcript',
      'tool',
      'transcript',
      'transcript',
    ])
    expect(assistant?.toolCalls[0]?.tool).toBe('recall')
    const transcriptTitles = assistant?.parts.flatMap((part) => (part.type === 'transcript' ? [part.title] : []))
    expect(transcriptTitles).toEqual(['voice leaf 01', 'data leaf 02', 'done ribbon 03'])
  })

  it('uses AgentWorld createdAt timestamps before falling back to replay time', async () => {
    const service = new FixtureVehicleService()
    const world = await service.readAgentWorld('agent-research-1')
    const createdAt = Date.UTC(2026, 5, 27, 19, 10, 23, 948)
    const messages = projectVehicleChatMessages(
      {
        ...world,
        worldDoc: {
          ...world.worldDoc,
          conversation: {
            messages: [
              {
                id: 'backfill-created-at',
                authorId: 'research-room',
                role: 'agent',
                visibility: 'agent-visible',
                text: 'historical message',
                createdAt,
              },
            ],
          },
        },
      },
      [],
      { authorId: 'vera', now: 999 },
    )

    expect(messages[0]?.createdAt).toBe(createdAt)
  })

  it('mutates the local AgentWorld for messages, driver lease, and steering', async () => {
    const service = new FixtureVehicleService()
    const before = await service.pollAgentWorld('agent-research-1', -1)
    const cursor = before.nextCursor

    await service.postMessage('agent-research-1', {
      authorId: 'vera',
      role: 'user',
      visibility: 'agent-visible',
      text: 'test the room',
    })
    await service.claimDriver('agent-research-1', 'vehicle-test', false)
    await service.steer('agent-research-1', 'vehicle-test', 'slow down')

    const after = await service.pollAgentWorld('agent-research-1', cursor)
    expect(after.events.length).toBeGreaterThanOrEqual(4)
    expect(conversationMessages(after).some((message) => message.text === 'test the room')).toBe(true)
    expect(driverLabel(after.worldDoc.control.driverLease)).toBe('vehicle-test')
    expect(JSON.stringify(after.worldDoc.control)).toContain('slow down')
  })

  it('starts fresh conversations and saves the system prompt in the fixture world', async () => {
    const service = new FixtureVehicleService()
    const agent = (await service.listAgents()).agents[0]
    const run = await service.startConversation(agent, 'Open a clean research thread.')
    let world = await service.readAgentWorld(agent.agentId)
    expect(run.status).toBe('running')
    expect(stringAt(world.worldDoc.status, ['summary'])).toBe('Open a clean research thread.')

    world = await service.saveSystemPrompt(agent.agentId, {
      authorId: 'vera',
      title: 'System prompt',
      text: 'Stay calm, cite evidence, and keep the driver oriented.',
    })
    expect(stringAt(world.worldDoc.prompts, ['system', 'text'])).toContain('cite evidence')
    expect(stringAt(world.worldDoc.prompts, ['effectivePromptDigest'])).toMatch(/^fixture-/)
    expect(valueAt(world.worldDoc.prompts, ['system', 'updatedBy'])).toBe('vera')

    await service.promoteSystemPrompt(agent.agentId)
    const poll = await service.pollAgentWorld(agent.agentId, -1)
    expect(poll.events.some((event) => event.type === 'agent.prompt.system.promoted')).toBe(true)

    const preview = await service.previewTurnContext(agent.agentId, {
      authorId: 'vera',
      role: 'user',
      visibility: 'agent-visible',
      text: 'Show me your packet.',
    })
    expect(preview.preview.systemPrompt).toContain('cite evidence')
    expect(preview.preview.turnPrompt).toContain('Show me your packet.')
    expect(preview.preview.turnPrompt).toContain('Agent-visible world packet')
  })

  it('projects agent ontology history including creation and prompt changes', async () => {
    const service = new FixtureVehicleService()
    const agent = (await service.listAgents()).agents[0]
    await service.saveSystemPrompt(agent.agentId, {
      authorId: 'vera',
      title: 'System prompt',
      text: 'Change the agent instructions deliberately.',
    })
    const poll = await service.pollAgentWorld(agent.agentId, -1)
    const journal = agentJournalItems({ world: poll, agent, events: poll.events, now: 1 })

    expect(journal.some((item) => item.origin === 'projection' && item.label === 'agent' && item.title === 'created')).toBe(true)
    expect(journal.some((item) => item.label === 'prompt' && item.title === 'system changed')).toBe(true)
    expect(journal.some((item) => item.label === 'tools' && item.title === 'mounted')).toBe(true)
    expect(journal.some((item) => item.event.type === 'agent.prompt.system.updated')).toBe(true)
  })

  it('records model changes as agent ontology journal events', async () => {
    const service = new FixtureVehicleService()
    const agent = (await service.listAgents()).agents[0]
    const before = await service.pollAgentWorld(agent.agentId, -1)
    const cursor = before.nextCursor

    const world = await service.setAgentModel(agent.agentId, {
      authorId: 'vera',
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    })
    const after = await service.pollAgentWorld(agent.agentId, cursor)
    const journal = agentJournalItems({ world: after, agent: { ...agent, model: 'deepseek-v4-pro' }, events: after.events })

    expect(stringAt(world.worldDoc.status, ['model'])).toBe('deepseek-v4-pro')
    expect(after.events.some((event) => event.type === 'agent.model.changed')).toBe(true)
    expect(journal.some((item) => item.label === 'agent' && item.title === 'model changed')).toBe(true)
  })

  it('keeps the bridge fixture mutable until a live bridge endpoint exists', async () => {
    const service = new FixtureVehicleService()
    const before = await service.readBridgeProjection()
    const firstEditable = before.lines.find((line) => line.support === 'editable-text')
    expect(firstEditable).toBeTruthy()

    const after = await service.applyBridgeOperation({
      type: 'replace-block-text',
      blockId: firstEditable!.blockId,
      text: 'Edited through the bridge fixture',
    })

    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.lines.find((line) => line.blockId === firstEditable!.blockId)?.text).toBe(
      'Edited through the bridge fixture',
    )
  })
})
