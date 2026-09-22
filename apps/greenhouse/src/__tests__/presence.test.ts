import { describe, expect, it } from 'vitest'

import { buildAgentPresence } from '@shrubbery/nucleus'

describe('buildAgentPresence', () => {
  it('composes the first agent presence view model', () => {
    expect(
      buildAgentPresence({
        name: 'learner-1',
        kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
        lifecycle: 'resident',
        model: 'gpt-5',
        attribution: { value: 'gpt-5', actorId: 'vera', at: 1783177200000 },
        driver: 'vera',
        graph: 'sophia-code-lab',
        runId: 'run-greenhouse',
        sessionId: 'session-learner-1',
        updatedAt: '7/4/2026, 12:00:00 PM',
      }),
    ).toEqual({
      identity: {
        name: 'learner-1',
        kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
      },
      state: {
        lifecycle: 'resident',
        tone: 'live',
      },
      model: {
        value: 'gpt-5',
        observedAt: 1783177200000,
        observer: 'vera',
      },
      references: [
        { label: 'driver', value: 'vera' },
        { label: 'graph', value: 'sophia-code-lab' },
      ],
      meta: [
        { label: 'run', value: 'run-greenhouse' },
        { label: 'session', value: 'session-learner-1' },
        { label: 'updated', value: '7/4/2026, 12:00:00 PM' },
      ],
    })
  })

  it('renders the real one-line kind from testimony and never a fallback string', () => {
    expect(
      buildAgentPresence({
        name: 'learner-1',
        kindLine: '  A named Sophia-standard learner agent with dynamic Mnemosyne tools.  ',
        lifecycle: 'resident',
        model: 'gpt-5',
      }).identity.kindLine,
    ).toBe('A named Sophia-standard learner agent with dynamic Mnemosyne tools.')

    // No kind attested → the slot is empty, never a composed placeholder.
    expect(buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5' }).identity.kindLine).toBe('')
    expect(
      buildAgentPresence({ name: 'learner-1', kindLine: '   ', lifecycle: 'resident', model: 'gpt-5' }).identity.kindLine,
    ).toBe('')
  })

  it('maps the closed lifecycle set to tones and never collapses unknowns', () => {
    const base = {
      name: 'learner-1',
      model: 'claude-sonnet',
      driver: 'vehicle-test',
      graph: 'sophia-code-lab',
      runId: 'run-learner',
      sessionId: 'session-learner',
      updatedAt: '-',
    }

    // live: present or awakening
    expect(buildAgentPresence({ ...base, lifecycle: 'resident' }).state).toEqual({ lifecycle: 'resident', tone: 'live' })
    expect(buildAgentPresence({ ...base, lifecycle: 'reviving' }).state).toEqual({ lifecycle: 'reviving', tone: 'live' })
    // held: attention — paused, and error as anomaly-worthy
    expect(buildAgentPresence({ ...base, lifecycle: 'paused' }).state).toEqual({ lifecycle: 'paused', tone: 'held' })
    expect(buildAgentPresence({ ...base, lifecycle: 'error' }).state).toEqual({ lifecycle: 'error', tone: 'held' })
    // dormant: honest rest
    expect(buildAgentPresence({ ...base, lifecycle: 'dormant' }).state).toEqual({ lifecycle: 'dormant', tone: 'dormant' })
    expect(buildAgentPresence({ ...base, lifecycle: 'completed' }).state).toEqual({
      lifecycle: 'completed',
      tone: 'dormant',
    })
    expect(buildAgentPresence({ ...base, lifecycle: 'restartable' }).state).toEqual({
      lifecycle: 'restartable',
      tone: 'dormant',
    })
    expect(buildAgentPresence({ ...base, lifecycle: 'retired' }).state).toEqual({ lifecycle: 'retired', tone: 'dormant' })
  })

  it('renders the unknown tone for absent and genuinely unrecognized lifecycles', () => {
    const base = { name: 'learner-1', model: 'claude-sonnet' }

    // absent → unknown tone, unknown words
    expect(buildAgentPresence({ ...base, lifecycle: null }).state).toEqual({ lifecycle: 'unknown', tone: 'unknown' })
    expect(buildAgentPresence({ ...base, lifecycle: '-' }).state).toEqual({ lifecycle: 'unknown', tone: 'unknown' })
    expect(buildAgentPresence({ ...base, lifecycle: '   ' }).state).toEqual({ lifecycle: 'unknown', tone: 'unknown' })

    // attested but not in the closed set → unknown tone, plain words preserved
    expect(buildAgentPresence({ ...base, lifecycle: 'running' }).state).toEqual({ lifecycle: 'running', tone: 'unknown' })
    expect(buildAgentPresence({ ...base, lifecycle: 'thinking' }).state).toEqual({
      lifecycle: 'thinking',
      tone: 'unknown',
    })
  })

  it('omits placeholder dashes instead of earning ink for absent values', () => {
    const presence = buildAgentPresence({
      name: 'learner-1',
      lifecycle: 'resident',
      model: 'gpt-5',
      driver: '-',
      graph: '-',
      runId: '-',
      sessionId: '   ',
      updatedAt: '',
    })

    expect(presence.references).toEqual([])
    expect(presence.meta).toEqual([])
  })

  it('carries served model attribution as testimony and is silent when unwitnessed', () => {
    // Served attribution → observer + observedAt.
    expect(
      buildAgentPresence({
        name: 'learner-1',
        lifecycle: 'completed',
        model: 'deepseek-v4-pro',
        attribution: { value: 'deepseek-v4-pro', actorId: 'vera', at: 1783177200000 },
      }).model,
    ).toEqual({ value: 'deepseek-v4-pro', observedAt: 1783177200000, observer: 'vera' })

    // Null / empty attribution → silence, just the value.
    expect(
      buildAgentPresence({ name: 'learner-1', lifecycle: 'completed', model: 'deepseek-v4-pro', attribution: null }).model,
    ).toEqual({ value: 'deepseek-v4-pro' })
    expect(buildAgentPresence({ name: 'learner-1', lifecycle: 'completed', model: 'deepseek-v4-pro' }).model).toEqual({
      value: 'deepseek-v4-pro',
    })
  })

  it('carries `seeded` only when explicitly true — phosphor honesty for a fallback model', () => {
    // Served true (the graph read failed, choreograph fell back to a hardcoded model).
    expect(
      buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5', seeded: true }).model,
    ).toEqual({ value: 'gpt-5', seeded: true })

    // Not seeded (the common case) — no `seeded` key at all, byte-identical to before.
    expect(
      buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5', seeded: false }).model,
    ).toEqual({ value: 'gpt-5' })
    expect(buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5' }).model).toEqual({
      value: 'gpt-5',
    })
  })

  it('does not attach attribution testimony for a model other than the current one', () => {
    // The operator just changed the model; stale provenance for the previous value is not shown.
    expect(
      buildAgentPresence({
        name: 'learner-1',
        lifecycle: 'resident',
        model: 'gpt-5',
        attribution: { value: 'deepseek-v4-pro', actorId: 'vera', at: 1783177200000 },
      }).model,
    ).toEqual({ value: 'gpt-5' })
  })
})
