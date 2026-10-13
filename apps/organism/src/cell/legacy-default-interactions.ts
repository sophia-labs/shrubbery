import { parseNT, triplesToNT, type Triple, type WorkspaceConfig } from '@shrubbery/nucleus'
import LEGACY_DEFAULT_NT from './fixtures/garden-default-before-interaction-edges.ux.nt?raw'

// Match the ENTIRE raw RDF body, not a decoder projection which could discard
// custom/unknown facts. Order is immaterial; missing, duplicate and extra facts
// all refuse compatibility. This snapshot must not follow future default edits.
const canonical = (triples: readonly Triple[]): string => triplesToNT(triples).split('\n').sort().join('\n')
const legacyKey = canonical(parseNT(LEGACY_DEFAULT_NT))
const legacyEdges = [
  { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
  { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
  { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
  { from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' },
  { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
  { from: 'face:sidebar', to: 'face:inspector', predicate: 'drivesSelection' },
] as const

/** Read-only compatibility for the exact pre-edge default. No graph writes,
 * no direct navigation bypass, and no claim about the author's historic intent.
 * New explicit edges:[] configs have an RDF marker and never match this key. */
export function withLegacyDefaultInteractionEdges(config: WorkspaceConfig, triples: readonly Triple[]) {
  if (config.edges !== undefined || triples.length !== 239 || canonical(triples) !== legacyKey) return null
  return {
    config: { ...config, edges: legacyEdges.map(edge => ({ ...edge })) },
    interactionCompatibility: 'legacy-default-v1' as const,
  }
}
