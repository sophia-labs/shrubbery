import { describe, expect, it } from 'vitest'

import { buildRoomMessages, buildRoomSpeech, buildTurnActivity } from '@shrubbery/nucleus'

describe('buildRoomMessages', () => {
  it('orders messages newest at the bottom while preserving backend attribution', () => {
    const messages = buildRoomMessages({
      selfAuthorId: 'vera',
      world: {
        worldDoc: {
          conversation: {
            messages: [
              { id: 'm2', authorId: 'learner-1', role: 'agent', text: 'I heard the room.', createdAt: 1783177300000 },
              { id: 'm1', authorId: 'vera', role: 'user', text: 'hello', createdAt: 1783177200000 },
            ],
          },
        },
      },
    })

    expect(messages).toEqual([
      {
        id: 'm1',
        author: { id: 'vera', role: 'user', isSelf: true },
        text: 'hello',
        at: 1783177200000,
      },
      {
        id: 'm2',
        author: { id: 'learner-1', role: 'agent', isSelf: false },
        text: 'I heard the room.',
        at: 1783177300000,
        turnAccount: { reply: 'I heard the room.', conduct: [] },
      },
    ])
  })

  it('merges attested send responses and message-created events by backend id', () => {
    const messages = buildRoomMessages({
      selfAuthorId: 'vera',
      messages: [{ id: 'm1', authorId: 'vera', role: 'user', text: 'attested', createdAt: 1783177200000 }],
      events: [
        {
          seq: 3,
          ts: 1783177210000,
          type: 'conversation.message.created',
          payload: {
            message: { id: 'm2', authorId: 'learner-1', role: 'agent', text: 'reply', createdAt: 1783177210000 },
          },
        },
      ],
    })

    expect(messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(messages[1].author).toEqual({ id: 'learner-1', role: 'agent', isSelf: false })
    expect(messages[1].turnAccount).toEqual({ reply: 'reply', conduct: [] })
  })

  it('returns an empty list for empty input instead of inventing placeholder ink', () => {
    expect(buildRoomMessages({ selfAuthorId: 'vera' })).toEqual([])
  })
})

describe('buildTurnActivity', () => {
  it('renders in-flight activity from real turn events and clears it on completion', () => {
    expect(
      buildTurnActivity([
        {
          seq: 1,
          ts: 1783177200000,
          type: 'conversation.turn.queued',
          payload: { turnId: 'turn-1' },
        },
        {
          seq: 2,
          ts: 1783177201000,
          type: 'conversation.turn.running',
          payload: { turnId: 'turn-1' },
        },
      ]),
    ).toEqual({ state: 'running', since: 1783177200000 })

    expect(
      buildTurnActivity([
        {
          seq: 1,
          ts: 1783177200000,
          type: 'conversation.turn.queued',
          payload: { turnId: 'turn-1' },
        },
        {
          seq: 2,
          ts: 1783177201000,
          type: 'conversation.turn.completed',
          payload: { turnId: 'turn-1', responseMessageId: 'm2' },
        },
      ]),
    ).toEqual({ state: 'idle' })
  })
})

describe('buildRoomSpeech', () => {
  it('combines transcript and turn activity for the render layer', () => {
    const speech = buildRoomSpeech({
      selfAuthorId: 'vera',
      world: {
        worldDoc: {
          conversation: {
            messages: [{ id: 'm1', authorId: 'vera', role: 'user', text: 'turn?', createdAt: 1783177200000 }],
          },
        },
      },
      events: [
        {
          seq: 1,
          ts: 1783177201000,
          type: 'conversation.turn.queued',
          payload: { turnId: 'turn-1' },
        },
      ],
    })

    expect(speech.messages).toHaveLength(1)
    expect(speech.turnActivity).toEqual({ state: 'queued', since: 1783177201000 })
  })

  it('correlates agent reply accounts to completed turn events by response message id', () => {
    const speech = buildRoomSpeech({
      selfAuthorId: 'vera',
      world: {
        worldDoc: {
          conversation: {
            messages: [
              {
                id: 'm2',
                authorId: 'learner-1',
                role: 'agent',
                text: `[done output #1]\nStored a durable memory.`,
                createdAt: 1783177203000,
              },
            ],
          },
        },
      },
      events: [
        {
          seq: 1,
          ts: 1783177200000,
          type: 'conversation.turn.tool.completed',
          payload: { turnId: 'turn-1', toolName: 'remember', toolCallId: 'tool-1', resultPreview: '{"ok":true}' },
        },
        {
          seq: 2,
          ts: 1783177202000,
          type: 'conversation.turn.completed',
          payload: {
            turnId: 'turn-1',
            responseMessageId: 'm2',
            state: 'completed',
            tokens: 1204,
            toolCalls: 1,
          },
        },
      ],
    })

    expect(speech.messages[0].turnAccount?.reply).toBe('Stored a durable memory.')
    expect(speech.messages[0].turnAccount?.conduct.map((step) => step.verb)).toEqual(['tool completed', 'turn completed'])
    expect(speech.messages[0].turnAccount?.usage).toEqual({ tokens: 1204, toolCalls: 1 })
  })
})
