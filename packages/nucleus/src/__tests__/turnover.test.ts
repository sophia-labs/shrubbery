import { describe, expect, it } from 'vitest'

import {
  advanceWatermark,
  buildTurnoverBrief,
  watermarkStorageKey,
  type AgentWatermark,
  type TurnoverBriefInput,
  type TurnoverEvent,
} from '@shrubbery/nucleus'

const NOW = 1783287900000
const LEFT = NOW - 23 * 60_000

function turnCompleted(seq: number, over: Partial<Record<string, unknown>> = {}): TurnoverEvent {
  return {
    seq,
    ts: LEFT + seq * 1000,
    type: 'conversation.turn.completed',
    payload: { turnId: `awt_${seq}`, state: 'done', responseMessageId: `msg-${seq}`, tokens: 700, ...over },
  }
}

function base(over: Partial<TurnoverBriefInput> = {}): TurnoverBriefInput {
  return { events: [], selfClientId: 'vehicle-web', leftAt: LEFT, now: NOW, ...over }
}

describe('watermark', () => {
  it('keys one mark per user per agent', () => {
    expect(watermarkStorageKey('vehicle-local-user', 'agent-132c2f7244ec645b')).toBe(
      'gh-watermark:vehicle-local-user:agent-132c2f7244ec645b',
    )
    expect(watermarkStorageKey('', 'a')).toBe('gh-watermark:anon:a')
  })

  it('advances the cursor and memory high-water only forward, and takes the fresh session/tokens/model', () => {
    const previous: AgentWatermark = { sessionId: 'ags_a', cursor: 30, readAt: LEFT, memoryHigh: 50, tokens: 1200, model: 'gpt-5' }
    const advanced = advanceWatermark(previous, {
      cursor: 34,
      readAt: NOW,
      sessionId: 'ags_b',
      memoryHigh: 52,
      tokens: 2100,
      model: 'deepseek-v4-pro',
    })
    expect(advanced).toEqual({ sessionId: 'ags_b', cursor: 34, readAt: NOW, memoryHigh: 52, tokens: 2100, model: 'deepseek-v4-pro' })
    // An out-of-order poll never rewinds your place.
    const held = advanceWatermark(advanced, { cursor: 10, readAt: NOW + 1, memoryHigh: 1 })
    expect(held.cursor).toBe(34)
    expect(held.memoryHigh).toBe(52)
  })
})

describe('buildTurnoverBrief — the unchanged is unwritten', () => {
  it('produces zero lines and is not eventful for an empty absence', () => {
    const brief = buildTurnoverBrief(base())
    expect(brief.lines).toEqual([])
    expect(brief.eventful).toBe(false)
    // The unchanged model produces no "model unchanged" line.
    expect(brief.lines.some((line) => line.tier === 'constitution')).toBe(false)
  })

  it('counts turns and hands the latest reply off below, with a token whisper carrying its trend', () => {
    const brief = buildTurnoverBrief(base({ events: [turnCompleted(1), turnCompleted(2), turnCompleted(3)], previousWatchTokens: 1200 }))
    const turns = brief.lines.find((line) => line.variant === 'turns')
    expect(turns).toMatchObject({ tier: 'activity', count: 3, handoff: '— latest reply waits below', affordance: { label: 'read it', intent: 'reply', ref: 'msg-3' } })
    const whisper = brief.lines.find((line) => line.variant === 'tokens')
    expect(whisper).toMatchObject({ tier: 'whisper', tokens: 2100, trend: 'up', previous: 1200 })
    expect(brief.eventful).toBe(true)
  })

  it('says the reply is the next thing below for a single turn', () => {
    const brief = buildTurnoverBrief(base({ events: [turnCompleted(1)] }))
    expect(brief.lines.find((line) => line.variant === 'turns')).toMatchObject({ handoff: '— its reply is the next thing below' })
    // No previous watch → no baseline → the whisper stays unwritten entirely
    // (Vincennes: a number with a past never renders naked; a first watch has no past).
    expect(brief.lines.find((line) => line.variant === 'tokens')).toBeUndefined()
  })
})

describe('buildTurnoverBrief — the aggregation grammar', () => {
  it('names each failed turn individually and never rolls them into a count', () => {
    const brief = buildTurnoverBrief(
      base({
        events: [
          { seq: 1, ts: LEFT + 1000, type: 'conversation.turn.completed', payload: { turnId: 'awt_1', state: 'error', reason: 'recall timed out after 30s' } },
          turnCompleted(2),
        ],
      }),
    )
    const failures = brief.lines.filter((line) => line.variant === 'failedTurn')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ tier: 'anomaly', lead: '1 turn failed:' })
    expect((failures[0] as { detail: string }).detail).toContain('recall timed out after 30s')
    // Anomalies hold the top of the brief, ahead of the counted turns.
    expect(brief.lines[0].tier).toBe('anomaly')
  })

  it('surfaces an unanswered permission as an anomaly, and drops it once resolved', () => {
    const request: TurnoverEvent = { seq: 1, ts: LEFT, type: 'control.permission.requested', payload: { callId: 'c1', tool: 'remember', graphId: 'vehicle-local' } }
    const unanswered = buildTurnoverBrief(base({ events: [request] }))
    expect(unanswered.lines.find((line) => line.variant === 'permission')).toMatchObject({ tier: 'anomaly', affordance: { intent: 'permission' } })
    const resolved = buildTurnoverBrief(base({ events: [request, { seq: 2, ts: LEFT + 1000, type: 'control.permission.resolved', payload: { callId: 'c1' } }] }))
    expect(resolved.lines.some((line) => line.variant === 'permission')).toBe(false)
  })

  it('surfaces a present-tense pending approval when no granular event names it', () => {
    const brief = buildTurnoverBrief(base({ pendingApprovals: 1 }))
    expect(brief.lines.find((line) => line.variant === 'permission')).toMatchObject({ tier: 'anomaly', lead: '1 unanswered permission waiting:' })
  })

  it('keeps a model chain whole when it returned home, and collapses it to endpoints otherwise', () => {
    const changed = (seq: number, model: string, actor: string): TurnoverEvent => ({
      seq,
      ts: LEFT + seq * 1000,
      type: 'agent.model.changed',
      payload: { model, actorId: actor },
    })
    const home = buildTurnoverBrief(base({ modelBaseline: 'deepseek-v4-pro', events: [changed(1, 'opus-4.1', 'vera'), changed(2, 'deepseek-v4-pro', 'eschaton')] }))
    expect(home.lines.find((line) => line.variant === 'modelChain')).toMatchObject({
      tier: 'constitution',
      chain: ['deepseek-v4-pro', 'opus-4.1', 'deepseek-v4-pro'],
      attribution: 'by vera, then eschaton',
    })
    const away = buildTurnoverBrief(base({ modelBaseline: 'deepseek-v4-pro', events: [changed(1, 'opus-4.1', 'vera'), changed(2, 'gpt-5', 'vera')] }))
    expect(away.lines.find((line) => line.variant === 'modelChain')).toMatchObject({ chain: ['deepseek-v4-pro', 'gpt-5'], attribution: 'by vera' })
  })

  it('counts memory writes above the watermark baseline with the latest snippet, and claims nothing on a first visit', () => {
    const remembered = [
      { number: 48, content: 'old' },
      { number: 49, content: 'Logged and disregarded — cadence held.' },
      { number: 50, content: 'Gap ≈186ms; infrastructure noise.' },
    ]
    const brief = buildTurnoverBrief(base({ memory: { remembered, baselineHigh: 48 } }))
    expect(brief.lines.find((line) => line.variant === 'memory')).toMatchObject({ tier: 'activity', count: 2, latestSnippet: 'Gap ≈186ms; infrastructure noise.' })
    // No baseline (first visit) → we did not witness a before → claim nothing.
    expect(buildTurnoverBrief(base({ memory: { remembered, baselineHigh: null } })).lines.some((line) => line.variant === 'memory')).toBe(false)
  })

  it('reports the wheel moving and a new conversation beginning', () => {
    const brief = buildTurnoverBrief(
      base({
        watermarkSessionId: 'ags_a',
        activeSessionId: 'ags_b',
        events: [
          { seq: 1, ts: LEFT + 1000, type: 'control.driver-claimed', payload: { authorId: 'vera' } },
          { seq: 2, ts: LEFT + 2000, type: 'control.driver-released', payload: { authorId: 'vera' } },
        ],
      }),
    )
    expect(brief.sessionBoundary).toBe(true)
    expect(brief.lines.find((line) => line.variant === 'newConversation')).toBeTruthy()
    expect((brief.lines.find((line) => line.variant === 'floor') as { text: string }).text).toContain('vera took it, then released')
  })

  it('orders the tiers anomaly → constitution → activity → whisper', () => {
    const brief = buildTurnoverBrief(
      base({
        modelBaseline: 'gpt-5',
        previousWatchTokens: 500,
        events: [
          turnCompleted(5),
          { seq: 1, ts: LEFT + 500, type: 'agent.model.changed', payload: { model: 'opus-4.1', actorId: 'vera' } },
          { seq: 2, ts: LEFT + 600, type: 'conversation.turn.completed', payload: { turnId: 'x', state: 'error', reason: 'boom' } },
        ],
      }),
    )
    expect(brief.lines.map((line) => line.tier)).toEqual(['anomaly', 'constitution', 'activity', 'whisper'])
  })
})
