/**
 * The Voice picker's pure helpers (NO MOCKS, no DOM). Each test names the defect
 * it guards: a wrong group order, a search that only sees loaded names, a price
 * that reads as a guess, a mark that claims an author.
 */
import { describe, expect, it } from 'vitest'

import {
  filterVoices,
  formatContextLength,
  formatPricePerMillion,
  groupVoices,
  modelIdTail,
  unrecordedVoiceMark,
  voiceDisplayName,
  voiceMarkFor,
  voiceMarkFromId,
  voiceMarkText,
  voicePriceSummary,
  voiceProviderLabel,
  voiceToolsBadge,
} from '../voice-roster.js'
import type { ChatModelOption } from '../types.js'
import { HOUSE_VOICE, legacyRoster, voiceRoster } from './fixtures/voice-roster.js'

describe('voiceProviderLabel', () => {
  it('groups OpenRouter ids by author slug, using the product vocabulary', () => {
    expect(voiceProviderLabel({ id: 'moonshotai/kimi-k2.6' })).toBe('Moonshot')
    expect(voiceProviderLabel({ id: 'google/gemini-2.5-flash' })).toBe('Google')
    expect(voiceProviderLabel({ id: 'meta-llama/llama-4-maverick' })).toBe('Meta')
    expect(voiceProviderLabel({ id: 'thinking-machines/inkling' })).toBe('Thinking Machines')
    expect(voiceProviderLabel({ id: '~anthropic/claude-sonnet-latest' })).toBe('Anthropic')
  })

  it('title-cases an author it has no name for rather than hiding it under Other', () => {
    expect(voiceProviderLabel({ id: 'allenai/olmo-3' })).toBe('Allenai')
    expect(voiceProviderLabel({ id: 'some-new-lab/model-1' })).toBe('Some New Lab')
  })

  it('keeps the legacy bare-id patterns, and Other for ids nothing recognises', () => {
    expect(voiceProviderLabel({ id: 'claude-sonnet-4-6' })).toBe('Anthropic')
    expect(voiceProviderLabel({ id: 'kimi-k2.5' })).toBe('Moonshot')
    expect(voiceProviderLabel({ id: 'qwen3-coder' })).toBe('Other')
  })

  it('lets the host name the maker explicitly', () => {
    expect(voiceProviderLabel({ id: 'moonshotai/kimi-k2.6', provider: 'Moonshot AI' })).toBe('Moonshot AI')
  })
})

describe('groupVoices', () => {
  it('orders the well-known makers first, then the rest alphabetically, then Other', () => {
    const groups = groupVoices(voiceRoster())
    const names = groups.map(group => group.provider)
    expect(names.slice(0, 5)).toEqual(['DeepSeek', 'Anthropic', 'OpenAI', 'Google', 'Moonshot'])
    expect(names[5]).toBe('Thinking Machines')
    const rest = names.slice(6)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    expect(names).not.toContain('Other')
  })

  it('sorts a group by display name and keeps every voice exactly once', () => {
    const roster = voiceRoster()
    const groups = groupVoices(roster)
    const moonshot = groups.find(group => group.provider === 'Moonshot')!
    expect(moonshot.models.map(model => model.label)).toEqual(['Kimi K2.5', 'Kimi K2.6', 'Kimi K3'])
    expect(groups.flatMap(group => group.models)).toHaveLength(roster.length)
  })

  it('reproduces the legacy grouping for a plain roster: named makers, then Other', () => {
    expect(groupVoices(legacyRoster()).map(group => group.provider)).toEqual([
      'Anthropic',
      'OpenAI',
      'Google',
      'Moonshot',
      'Other',
    ])
  })
})

describe('filterVoices', () => {
  const roster = voiceRoster()

  it('finds a voice by name, id or maker', () => {
    expect(filterVoices(roster, 'kimi').map(model => model.id)).toEqual([
      'moonshotai/kimi-k2.5',
      'moonshotai/kimi-k2.6',
      'moonshotai/kimi-k3',
    ])
    expect(filterVoices(roster, 'moonshot')).toHaveLength(3)
    expect(filterVoices(roster, 'deepseek/').map(model => model.id)).toEqual([
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
    ])
  })

  it('requires every token, in any order', () => {
    expect(filterVoices(roster, 'k2 kimi').map(model => model.id)).toEqual([
      'moonshotai/kimi-k2.5',
      'moonshotai/kimi-k2.6',
    ])
    expect(filterVoices(roster, 'kimi claude')).toEqual([])
  })

  it('is case-insensitive and treats an empty query as everything', () => {
    expect(filterVoices(roster, 'KIMI K3')).toHaveLength(1)
    expect(filterVoices(roster, '   ')).toHaveLength(roster.length)
  })

  it('puts the House default first when it matches, then names that start with the query', () => {
    const results = filterVoices(roster, 'gemini')
    expect(results[0].id).toBe(HOUSE_VOICE.id)
    expect(results.map(model => model.label)).toEqual([
      'Gemini 2.5 Flash',
      'Gemini 2.5 Pro',
      'Gemini 3 Pro',
    ])
    // a name that merely contains the query ranks after a name that starts with it
    const contained = filterVoices(
      [
        { id: 'a/xkimi', label: 'Xkimi' },
        { id: 'b/kimi', label: 'Kimi' },
      ],
      'kimi',
    )
    expect(contained.map(model => model.label)).toEqual(['Kimi', 'Xkimi'])
  })
})

describe('formatPricePerMillion', () => {
  it('shows dollars per million tokens without rounding a real price into a different one', () => {
    expect(formatPricePerMillion(3)).toBe('$3.00')
    expect(formatPricePerMillion(15)).toBe('$15.00')
    expect(formatPricePerMillion(2.5)).toBe('$2.50')
    expect(formatPricePerMillion(0.45)).toBe('$0.45')
    expect(formatPricePerMillion(0.3)).toBe('$0.30')
    expect(formatPricePerMillion(3.41)).toBe('$3.41')
    expect(formatPricePerMillion(0.075)).toBe('$0.075')
    expect(formatPricePerMillion(0.0375)).toBe('$0.0375')
    expect(formatPricePerMillion(120)).toBe('$120')
  })

  it('says free for zero and nothing for a price the catalogue did not give', () => {
    expect(formatPricePerMillion(0)).toBe('free')
    expect(formatPricePerMillion(null)).toBeNull()
    expect(formatPricePerMillion(undefined)).toBeNull()
    expect(formatPricePerMillion(Number.NaN)).toBeNull()
    expect(formatPricePerMillion(-1)).toBeNull()
  })
})

describe('formatContextLength', () => {
  it('quotes the window in decimal thousands and millions', () => {
    expect(formatContextLength(262_144)).toBe('262K')
    expect(formatContextLength(200_000)).toBe('200K')
    expect(formatContextLength(8_192)).toBe('8K')
    expect(formatContextLength(1_048_576)).toBe('1M')
    expect(formatContextLength(1_500_000)).toBe('1.5M')
    expect(formatContextLength(512)).toBe('512')
  })

  it('is silent when the length is unknown', () => {
    expect(formatContextLength(null)).toBeNull()
    expect(formatContextLength(undefined)).toBeNull()
    expect(formatContextLength(0)).toBeNull()
  })
})

describe('voicePriceSummary and voiceToolsBadge', () => {
  it('renders nothing for a legacy option that carries no price data at all', () => {
    expect(voicePriceSummary({})).toBeNull()
  })

  it('states both prices, in and out', () => {
    expect(voicePriceSummary({ priceInPerMTok: 0.65, priceOutPerMTok: 3.41 })).toEqual({
      text: '$0.65 in · $3.41 out',
      label: 'Input $0.65, output $3.41, US dollars per million tokens',
    })
  })

  it('admits an unpriced voice instead of guessing a price for it', () => {
    expect(voicePriceSummary({ priceInPerMTok: null, priceOutPerMTok: null })).toEqual({
      text: 'price not listed',
      label: 'Price not listed',
    })
    expect(voicePriceSummary({ priceInPerMTok: 1, priceOutPerMTok: null })?.text).toBe(
      '$1.00 in · not listed out',
    )
  })

  it('badges tool support only when the catalogue said so', () => {
    expect(voiceToolsBadge({ supportsTools: true })).toBe('tools')
    expect(voiceToolsBadge({ supportsTools: false })).toBe('no tools')
    expect(voiceToolsBadge({ supportsTools: null })).toBeNull()
    expect(voiceToolsBadge({})).toBeNull()
  })
})

describe('voice marks', () => {
  const roster: ChatModelOption[] = voiceRoster()

  it('words each basis the way the panel shows it', () => {
    expect(voiceMarkText(voiceMarkFromId('moonshotai/kimi-k2.6', 'live', roster))).toBe('voice: Kimi K2.6')
    expect(voiceMarkText(voiceMarkFromId('moonshotai/kimi-k2.5', 'source-recorded', roster))).toBe(
      'voice: Kimi K2.5 · source-recorded',
    )
    expect(voiceMarkText(unrecordedVoiceMark())).toBe('voice not recorded')
  })

  it('names a roster voice by its display name and an unknown id by its own tail, never an invented name', () => {
    expect(voiceMarkFromId('moonshotai/kimi-k2.6', 'live', roster).provider).toBe('Moonshot')
    const unknown = voiceMarkFromId('acme/quasar-9', 'source-recorded', roster)
    expect(unknown).toEqual({ id: 'acme/quasar-9', label: 'quasar-9', provider: 'Acme', basis: 'source-recorded' })
  })

  it('applies legacy display-name overrides to bare ids', () => {
    expect(voiceDisplayName({ id: 'kimi-k2.5', label: 'kimi-k2.5' })).toBe('Kimi K2.5 Thinking')
    expect(voiceMarkFor({ id: 'kimi-k2.5', label: 'kimi-k2.5' }, 'live').label).toBe('Kimi K2.5 Thinking')
  })

  it('cuts an id to its tail as-is', () => {
    expect(modelIdTail('moonshotai/kimi-k2.6')).toBe('kimi-k2.6')
    expect(modelIdTail('~anthropic/claude-latest')).toBe('claude-latest')
    expect(modelIdTail('kimi-k2.5')).toBe('kimi-k2.5')
  })
})
