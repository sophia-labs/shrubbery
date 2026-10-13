import type { ChoreoToolDescriptor } from './choreo-modes-model.js'

/**
 * A deliberately rough, tokenizer-independent reading aid. MCP tool schemas,
 * transport framing, and provider-specific encoding are outside this estimate.
 */
export function estimatedDescriptionTokens(tool: Pick<ChoreoToolDescriptor, 'name' | 'description'>): number {
  return Math.ceil(new TextEncoder().encode(`${tool.name}\n${tool.description}`).length / 4)
}

export function descriptionWords(description: string): number {
  const trimmed = description.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

export type DescriptionLength = 'missing' | 'brief' | 'standard' | 'long'

/** Length bands are navigation aids, not quality or vividness scores. */
export function descriptionLength(description: string): DescriptionLength {
  const words = descriptionWords(description)
  if (words === 0) return 'missing'
  if (words < 12) return 'brief'
  if (words > 60) return 'long'
  return 'standard'
}
