/**
 * voice-roster.ts — the pure helpers behind the Voice picker.
 *
 * The picker used to be fed a one-entry list. It is now fed a live catalogue of
 * hundreds of priced, tool-capable models, so grouping, search and the honest
 * labels (price per million tokens, context length, tools) live here, apart from
 * the element, where they can be tested without a DOM.
 *
 * PURITY: no lit, no store, no fetch, no pricing table. The catalogue is the
 * host's business; this module only shapes and labels what the host hands over.
 *
 * LEGACY IDS: the local and desktop hosts still pass bare ids (`gpt-5.2`,
 * `kimi-k2.5`). Those keep their original provider patterns, group order and
 * display-name overrides, so a plain `{ id, label }` roster renders exactly as it
 * always did. OpenRouter ids (`moonshotai/kimi-k2.6`) group by their author slug.
 */

import type { ChatModelOption, ChatVoiceBasis, ChatVoiceMark } from './types.js'

// Provider detection for bare ids. Names are hints for grouping, never an
// authority decision.
const PROVIDER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^deepseek-/, 'DeepSeek'],
  [/^claude-/, 'Anthropic'],
  [/^gpt-|^o1-|^o3-/, 'OpenAI'],
  [/^gemini-|^alpha-/, 'Google'],
  [/^kimi-/, 'Moonshot'],
  [/^inkling/, 'Thinking Machines'],
]

/** Groups that sort first, in this order. Everything else follows alphabetically,
 * and `Other` (ids nothing recognises) is always last. */
export const TOP_PROVIDERS: readonly string[] = [
  'DeepSeek',
  'Anthropic',
  'OpenAI',
  'Google',
  'Moonshot',
  'Thinking Machines',
]

/** Display names for bare legacy ids. OpenRouter names come from the catalogue. */
const MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'kimi-k2.5': 'Kimi K2.5 Thinking',
  'kimi-k2-thinking': 'Kimi K2 Thinking',
  'kimi-k2': 'Kimi K2',
  inkling: 'Inkling',
}

/** OpenRouter author slugs, as the picker groups them. */
const SLUG_LABELS: Readonly<Record<string, string>> = {
  ai21: 'AI21',
  amazon: 'Amazon',
  anthropic: 'Anthropic',
  baidu: 'Baidu',
  bytedance: 'ByteDance',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  google: 'Google',
  'meta-llama': 'Meta',
  microsoft: 'Microsoft',
  minimax: 'MiniMax',
  mistralai: 'Mistral',
  moonshotai: 'Moonshot',
  nousresearch: 'Nous Research',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  tencent: 'Tencent',
  'thinking-machines': 'Thinking Machines',
  'x-ai': 'xAI',
  'z-ai': 'Z.ai',
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The label a voice groups under: the host's explicit `provider`, else the
 * author slug of an OpenRouter id, else the legacy bare-id patterns, else `Other`. */
export function voiceProviderLabel(model: Pick<ChatModelOption, 'id' | 'provider'>): string {
  const explicit = model.provider?.trim()
  if (explicit) return explicit
  const id = model.id.trim()
  const slash = id.indexOf('/')
  if (slash > 0) {
    const slug = id.slice(0, slash).replace(/^~/, '').toLowerCase()
    if (slug) return SLUG_LABELS[slug] ?? titleCaseSlug(slug)
  }
  const lower = id.toLowerCase()
  for (const [pattern, provider] of PROVIDER_PATTERNS) {
    if (pattern.test(lower)) return provider
  }
  return 'Other'
}

/** The name shown for a voice. Legacy bare ids keep their display overrides. */
export function voiceDisplayName(model: Pick<ChatModelOption, 'id' | 'label'>): string {
  return MODEL_DISPLAY_NAMES[model.id] ?? model.label
}

export interface VoiceGroup {
  readonly provider: string
  readonly models: ChatModelOption[]
}

/** Group by provider: the well-known makers first (in their fixed order), then
 * every other maker alphabetically, then `Other`. Models sort by display name. */
export function groupVoices(models: readonly ChatModelOption[]): VoiceGroup[] {
  const grouped = new Map<string, ChatModelOption[]>()
  for (const model of models) {
    const provider = voiceProviderLabel(model)
    const list = grouped.get(provider) ?? []
    list.push(model)
    grouped.set(provider, list)
  }
  const rank = (provider: string): number => {
    if (provider === 'Other') return Number.MAX_SAFE_INTEGER
    const top = TOP_PROVIDERS.indexOf(provider)
    return top === -1 ? TOP_PROVIDERS.length : top
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      const byRank = rank(left) - rank(right)
      return byRank !== 0 ? byRank : left.localeCompare(right)
    })
    .map(([provider, list]) => ({
      provider,
      models: list
        .slice()
        .sort((left, right) => voiceDisplayName(left).localeCompare(voiceDisplayName(right))),
    }))
}

/**
 * Filter the roster by a free-text query. Every whitespace-separated token must
 * appear in the display name, the id or the maker. House entries lead; then names
 * that start with the first token, then names that contain it, then the rest, each
 * in the roster's own order.
 */
export function filterVoices(models: readonly ChatModelOption[], query: string): ChatModelOption[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return models.slice()
  const matches: Array<{ model: ChatModelOption; score: number; index: number }> = []
  models.forEach((model, index) => {
    const name = voiceDisplayName(model).toLowerCase()
    const haystack = `${name} ${model.id.toLowerCase()} ${voiceProviderLabel(model).toLowerCase()}`
    if (!tokens.every(token => haystack.includes(token))) return
    const score = name.startsWith(tokens[0]) ? 0 : name.includes(tokens[0]) ? 1 : 2
    matches.push({ model, score, index })
  })
  matches.sort((left, right) =>
    (Number(Boolean(right.model.house)) - Number(Boolean(left.model.house)))
    || left.score - right.score
    || left.index - right.index)
  return matches.map(match => match.model)
}

function trimmedFixed(value: number, maxDecimals: number, minDecimals = 2): string {
  const text = value.toFixed(maxDecimals)
  const dot = text.indexOf('.')
  if (dot < 0) return text
  let fraction = text.slice(dot + 1).replace(/0+$/, '')
  while (fraction.length < minDecimals) fraction += '0'
  return `${text.slice(0, dot)}.${fraction}`
}

/** USD per million tokens as the picker shows it: `$3.00`, `$0.45`, `$0.075`,
 * `free`. `null` when the catalogue did not price it. */
export function formatPricePerMillion(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  if (value === 0) return 'free'
  if (value >= 100) return `$${Math.round(value)}`
  if (value >= 1) return `$${trimmedFixed(value, 2)}`
  if (value >= 0.1) return `$${trimmedFixed(value, 3)}`
  return `$${trimmedFixed(value, 4)}`
}

/**
 * How many times the House default a short reply costs in this voice, as the picker
 * words it: `1.8× House`, `12× House`, `<0.1× House`. The host works the number out (it
 * knows what a short reply is and what House charges); this only words it, and says
 * nothing where there is no number, never "1×" for a missing one.
 */
export function formatVoiceMultiple(multiple: number | null | undefined): string | null {
  if (multiple === null || multiple === undefined || !Number.isFinite(multiple) || multiple <= 0) return null
  if (multiple < 0.05) return '<0.1× House'
  // What the number prints as, not what it is: 9.96 prints as "10.0" and belongs with the whole
  // numbers (a decimal past ten means nothing), and 999.6 prints as "1000" and belongs to the cap
  // ("1000×+"), one character short of which it would otherwise sit.
  const whole = Math.round(multiple)
  if (whole >= 1000) return '1000×+ House'
  if (multiple >= 10 || Number(multiple.toFixed(1)) >= 10) return `${whole}× House`
  return `${multiple.toFixed(1)}× House`
}

/** "262K", "1M", "1.5M": decimal thousands, as the catalogue quotes them. */
export function formatContextLength(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(Math.round(value))
}

export interface VoicePriceSummary {
  /** Visible text: `$0.65 in · $3.41 out`. */
  readonly text: string
  /** The same for assistive technology, with the unit spelled out. */
  readonly label: string
}

/** The price line for a voice, or null when the host supplied no price data at
 * all (a legacy roster). A catalogue that names no price says so plainly: an
 * unpriced voice is never dressed up with a guess. */
export function voicePriceSummary(
  model: Pick<ChatModelOption, 'priceInPerMTok' | 'priceOutPerMTok'>,
): VoicePriceSummary | null {
  if (model.priceInPerMTok === undefined && model.priceOutPerMTok === undefined) return null
  const input = formatPricePerMillion(model.priceInPerMTok)
  const output = formatPricePerMillion(model.priceOutPerMTok)
  if (input === null && output === null) {
    return { text: 'price not listed', label: 'Price not listed' }
  }
  const inText = input ?? 'not listed'
  const outText = output ?? 'not listed'
  return {
    text: `${inText} in · ${outText} out`,
    label: `Input ${inText}, output ${outText}, US dollars per million tokens`,
  }
}

/** `tools` / `no tools`, or null when the catalogue did not say. */
export function voiceToolsBadge(model: Pick<ChatModelOption, 'supportsTools'>): 'tools' | 'no tools' | null {
  if (model.supportsTools === true) return 'tools'
  if (model.supportsTools === false) return 'no tools'
  return null
}

/** The tail of an id, as-is: `moonshotai/kimi-k2.6` becomes `kimi-k2.6`. Used only
 * when nothing better is known; a name is never invented for an unknown id. */
export function modelIdTail(id: string): string {
  const trimmed = id.trim().replace(/^~/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

/** A voice mark for a roster entry. */
export function voiceMarkFor(model: ChatModelOption, basis: ChatVoiceBasis): ChatVoiceMark {
  return {
    id: model.id,
    label: voiceDisplayName(model),
    provider: voiceProviderLabel(model),
    basis,
  }
}

/** A voice mark for an id, named from the roster when the roster knows it and by
 * the raw id tail when it does not. */
export function voiceMarkFromId(
  id: string,
  basis: ChatVoiceBasis,
  roster: readonly ChatModelOption[] = [],
): ChatVoiceMark {
  const known = roster.find(model => model.id === id)
  if (known) return voiceMarkFor(known, basis)
  return { id, label: modelIdTail(id), provider: voiceProviderLabel({ id }), basis }
}

/** A voice mark for a conversation whose source recorded no model. */
export function unrecordedVoiceMark(): ChatVoiceMark {
  return { id: null, label: 'voice not recorded', provider: null, basis: 'unrecorded' }
}

/** The mark as the panel words it: `voice: Kimi K2.5 · source-recorded`,
 * `voice: Kimi K2.6`, or `voice not recorded`. */
export function voiceMarkText(mark: ChatVoiceMark): string {
  if (mark.basis === 'unrecorded') return 'voice not recorded'
  if (mark.basis === 'source-recorded') return `voice: ${mark.label} · source-recorded`
  return `voice: ${mark.label}`
}
