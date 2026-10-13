/**
 * A roster shaped like the live catalogue the Voice picker is fed: OpenRouter
 * ids (`author/model`), prices in US dollars per million tokens, context windows,
 * and tool support. It is real data structure, not a stub: tests and the
 * screenshot harness mount the real panel with it.
 *
 * The prices and windows are illustrative. The three Moonshot prices are the ones
 * the round's Kimi report read from the live catalogue on 2026-09-28
 * (K2.5 $0.45 / $2.25, K2.6 $0.65 / $3.41, K3 $3.00 / $15.00); every other row is
 * synthetic and says nothing about what any provider charges.
 */

import type { ChatModelOption } from '../../types.js'

function voice(
  id: string,
  label: string,
  priceIn: number | null,
  priceOut: number | null,
  contextLength: number | null,
  extra: Partial<ChatModelOption> = {},
): ChatModelOption {
  return {
    id,
    label,
    priceInPerMTok: priceIn,
    priceOutPerMTok: priceOut,
    contextLength,
    supportsTools: true,
    ...extra,
  }
}

/** The House default, pinned first and named for what it is. */
export const HOUSE_VOICE: ChatModelOption = voice(
  'google/gemini-2.5-flash',
  'Gemini 2.5 Flash',
  0.3,
  2.5,
  1_048_576,
  { house: true, note: 'House default · via OpenRouter' },
)

/** A long, mixed roster: 25 voices from 17 makers, the House default among them. */
export function voiceRoster(): ChatModelOption[] {
  return [
    HOUSE_VOICE,
    voice('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 1.25, 10, 1_048_576),
    voice('google/gemini-3-pro', 'Gemini 3 Pro', 2, 12, 1_048_576),
    voice('moonshotai/kimi-k2.5', 'Kimi K2.5', 0.45, 2.25, 262_144),
    voice('moonshotai/kimi-k2.6', 'Kimi K2.6', 0.65, 3.41, 262_144),
    voice('moonshotai/kimi-k3', 'Kimi K3', 3, 15, 262_144),
    voice('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5', 3, 15, 200_000),
    voice('anthropic/claude-haiku-4.5', 'Claude Haiku 4.5', 1, 5, 200_000),
    voice('openai/gpt-5.2', 'GPT-5.2', 1.75, 14, 400_000),
    voice('openai/gpt-5-mini', 'GPT-5 Mini', 0.25, 2, 400_000),
    voice('deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash', 0.14, 0.28, 131_072),
    voice('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 0.55, 2.19, 131_072),
    voice('qwen/qwen3-coder', 'Qwen3 Coder', 0.22, 0.95, 262_144),
    voice('qwen/qwen3-max', 'Qwen3 Max', 1.2, 6, 262_144),
    voice('meta-llama/llama-4-maverick', 'Llama 4 Maverick', 0.15, 0.6, 1_048_576),
    voice('mistralai/mistral-large', 'Mistral Large', 2, 6, 128_000),
    voice('x-ai/grok-4', 'Grok 4', 3, 15, 256_000),
    voice('z-ai/glm-4.6', 'GLM 4.6', 0.4, 1.75, 202_752),
    voice('minimax/minimax-m2', 'MiniMax M2', 0.255, 1, 204_800),
    voice('nvidia/nemotron-ultra', 'Nemotron Ultra', 0.6, 1.8, 131_072),
    voice('cohere/command-a', 'Command A', 2.5, 10, 256_000),
    voice('amazon/nova-pro', 'Nova Pro', 0.8, 3.2, 300_000),
    voice('thinking-machines/inkling', 'Inkling', 1.5, 6, 200_000),
    voice('perplexity/sonar-pro', 'Sonar Pro', 3, 15, 200_000, { supportsTools: false }),
    voice('nousresearch/hermes-4-405b', 'Hermes 4 405B', 1, 3, 131_072),
  ]
}

/** A short legacy roster, as the local and desktop hosts pass it (bare ids). */
export function legacyRoster(): ChatModelOption[] {
  return [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { id: 'kimi-k2.5', label: 'kimi-k2.5' },
    { id: 'qwen3-coder', label: 'Qwen3 Coder' },
  ]
}
