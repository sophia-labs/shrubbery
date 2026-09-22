import { describe, expect, it } from 'vitest'

import { buildTurnAccount, parseTranscriptFragments } from '../kinds/index.js'

const MULTI_SECTION_LIVE_SAMPLE = `[stream text #1]
I will store that.

[stream text #2]
{"count":1,"memories":[{"id":"memory-1","text":"Greenhouse separates reply and conduct."}]}

[done output #3]
Stored a durable memory.`

const JSON_HEAVY_LIVE_SAMPLE = `[stream text #1]
{"tool":"recall","query":"greenhouse","count":2,"memories":[{"id":"m1"},{"id":"m2"}]}

[terminal output #2]
{"status":"completed","output":"ok","tokens":1204}

[done output #3]
I found the two remembered notes.`

const DONE_ONLY_LIVE_SAMPLE = `[done output #1]
Mock sandbox validation completed.`

const TRUNCATED_TERMINAL_ASSISTANT_SAMPLE = `[assistant text #1]
Assistant draft text.

[truncated output #2]
Output was truncated.

[terminal output #3]
Terminal ended with status 0.

[done output #4]
Here is the final answer.`

describe('buildTurnAccount', () => {
  it('separates real stream sections from the done reply', () => {
    const account = buildTurnAccount(MULTI_SECTION_LIVE_SAMPLE)

    expect(account.reply).toBe('Stored a durable memory.')
    expect(account.conduct).toEqual([
      { verb: 'stream text', detail: 'I will store that.' },
      {
        verb: 'stream text',
        detail: '{"count":1,"memories":[{"id":"memory-1","text":"Greenhouse separates reply and conduct."}]}',
      },
    ])
  })

  it('keeps JSON heavy conduct as attested text', () => {
    const account = buildTurnAccount(JSON_HEAVY_LIVE_SAMPLE)

    expect(account.reply).toBe('I found the two remembered notes.')
    expect(account.conduct.map((step) => step.verb)).toEqual(['stream text', 'terminal output'])
    expect(account.conduct[0].detail).toContain('"memories"')
    expect(account.conduct[1].detail).toContain('"tokens":1204')
  })

  it('renders done-only output as reply with no unearned conduct', () => {
    expect(buildTurnAccount(DONE_ONLY_LIVE_SAMPLE)).toEqual({
      reply: 'Mock sandbox validation completed.',
      conduct: [],
    })
  })

  it('accepts assistant, truncated, and terminal markers as conduct labels', () => {
    const account = buildTurnAccount(TRUNCATED_TERMINAL_ASSISTANT_SAMPLE)

    expect(account.reply).toBe('Here is the final answer.')
    expect(account.conduct.map((step) => step.verb)).toEqual(['assistant text', 'truncated output', 'terminal output'])
  })

  it('returns unparseable garbage verbatim as prose', () => {
    const text = '[[stream text #1]]\nno backend marker here\n{"still":"prose"}'

    expect(buildTurnAccount(text)).toEqual({ reply: text, conduct: [] })
  })

  it('adds tool and usage testimony only from correlated turn events', () => {
    const account = buildTurnAccount(DONE_ONLY_LIVE_SAMPLE, [
      {
        seq: 1,
        ts: 1783177200000,
        type: 'conversation.turn.tool.started',
        payload: { turnId: 'turn-1', toolName: 'recall', argsPreview: '{"query":"greenhouse"}' },
      },
      {
        seq: 2,
        ts: 1783177201000,
        type: 'conversation.turn.tool.completed',
        payload: { turnId: 'turn-1', toolName: 'recall', toolCallId: 'tool-1', resultPreview: '{"count":1}' },
      },
      {
        seq: 3,
        ts: 1783177202000,
        type: 'conversation.turn.completed',
        payload: {
          turnId: 'turn-1',
          responseMessageId: 'reply-1',
          state: 'completed',
          model: 'gpt-5',
          provider: 'openai',
          tokens: 1204,
          toolCalls: 1,
        },
      },
    ])

    expect(account.reply).toBe('Mock sandbox validation completed.')
    expect(account.conduct.map((step) => step.verb)).toEqual(['tool started', 'tool completed', 'turn completed'])
    expect(account.conduct[1].outcome).toBe('{"count":1}')
    expect(account.usage).toEqual({ tokens: 1204, toolCalls: 1 })
  })
})

describe('parseTranscriptFragments', () => {
  it('returns the producer marker fragments in order', () => {
    expect(parseTranscriptFragments(MULTI_SECTION_LIVE_SAMPLE).map((fragment) => fragment.label)).toEqual([
      'stream text',
      'stream text',
      'done output',
    ])
  })
})
