/**
 * The being's face, the pure part (world-UX slice A, "the cast", `plans/2026-10-20-choreograph-world-ux/README.md` §6;
 * typed objects D9, beings ride the same faces). A workflow's post (a plan step: "the Clerk") casts ONE stable being
 * (`agt:Agent`, `agent-<16 hex>`, IRI `urn:sophia:agent:agent-…`) who sits once per item: twenty-six sittings of one
 * someone, not twenty-six agents. This module folds a run's sittings into one face per being, and names the doors
 * between a being's IRI and its post.
 *
 * Honesty rules (Vera's doctrine, the recognition card's): a card says only what a run observed. Name = the label of
 * the post that cast the being (nothing writes an agent label yet); kind = the events' `agentType`; model = the models
 * the events name. No level, mood, count of runs or mode that no data carries. The mark is `agentMark(agentId)`.
 *
 * Pure: no DOM, no network.
 */

import { type AgentMark, agentMark } from '../kinds/card.js'

export const AGENT_IRI_PREFIX = 'urn:sophia:agent:'

/** `urn:sophia:agent:agent-62517a586738e5e9` -> `agent-62517a586738e5e9`; a bare id is itself. */
export function agentIdOfIri(iri: string): string {
  return iri.startsWith(AGENT_IRI_PREFIX) ? iri.slice(AGENT_IRI_PREFIX.length) : iri.slice(iri.lastIndexOf(':') + 1)
}

export function agentIriOfId(agentId: string): string {
  return agentId.startsWith('urn:') ? agentId : `${AGENT_IRI_PREFIX}${agentId}`
}

/**
 * Where a being sits, from the step it was cast for: a step IRI is `urn:sophia:wf:<documentId>#<stepId>`, so the
 * workflow document and the post's id are in the IRI. Null for any other shape.
 */
export function postOfStepIri(stepIri: string): { readonly documentId: string; readonly stepId: string } | null {
  const match = /^urn:sophia:wf:([^:#]+)#(.+)$/.exec(stepIri)
  return match ? { documentId: match[1]!, stepId: match[2]! } : null
}

/** The run graph IRI `urn:sophia:wf:<documentId>:run:<runId>` names its workflow document. */
export function documentOfRunGraph(runGraph: string): string | null {
  return /^urn:sophia:wf:([^:#]+):run:/.exec(runGraph)?.[1] ?? null
}

/** One sitting, as a run's events tell it: the minimum a face needs. */
export interface BeingSitting {
  readonly agentId?: string | null
  readonly agentType?: string | null
  /** The post's label (the run names its agents `<post label> #<n>`). */
  readonly step: string
  readonly state: 'queued' | 'running' | 'done' | 'failed'
  readonly model?: string | null
  readonly attempts?: number
}

export interface BeingPost {
  readonly id: string
  readonly label: string
  readonly checks?: string | null
}

export interface BeingFace {
  readonly agentId: string
  /** `urn:sophia:agent:<agentId>`. */
  readonly iri: string
  readonly mark: AgentMark
  /** The label of the post that cast it. */
  readonly name: string
  /** The post's id, for the door back to its page; null when no post of the plan matches. */
  readonly stepId: string | null
  /** A checking post's being checks; the rest do. */
  readonly checks: boolean
  /** `agentType` from the events (`extractor`, `quote checker`); null when none said. */
  readonly kind: string | null
  /** The models the events name, in the order met. */
  readonly models: readonly string[]
  readonly sittings: number
  readonly done: number
  readonly failed: number
  /** Queued or running. */
  readonly working: number
  /** Sittings asked again after a first answer that did not fit. */
  readonly askedAgain: number
}

/**
 * The beings of one run: one face per `agentId`, in the order of the plan's posts. A post whose being the run's graph
 * names (`wf:castAgent`, `cast` by step id) but whose sittings were not recorded still gets its face, with no sittings.
 * Sittings are keyed by `agentId`, never by label.
 */
export function beingFaces(input: {
  readonly posts: readonly BeingPost[]
  readonly sittings: readonly BeingSitting[]
  /** step id -> the being's IRI, from the run graph's `wf:castAgent`. */
  readonly cast?: Readonly<Record<string, string>>
}): BeingFace[] {
  const byAgent = new Map<string, { name: string; post: BeingPost | null; sittings: BeingSitting[] }>()
  const postOf = (label: string): BeingPost | null => input.posts.find((p) => p.label === label) ?? null
  for (const sitting of input.sittings) {
    if (!sitting.agentId) continue
    const entry = byAgent.get(sitting.agentId) ?? { name: sitting.step, post: postOf(sitting.step), sittings: [] }
    entry.sittings.push(sitting)
    byAgent.set(sitting.agentId, entry)
  }
  for (const [stepId, iri] of Object.entries(input.cast ?? {})) {
    const agentId = agentIdOfIri(iri)
    const post = input.posts.find((p) => p.id === stepId) ?? null
    const entry = byAgent.get(agentId)
    if (entry) entry.post ??= post
    else byAgent.set(agentId, { name: post?.label ?? stepId, post, sittings: [] })
  }
  const order = (post: BeingPost | null): number => (post ? input.posts.indexOf(post) : Number.MAX_SAFE_INTEGER)
  return [...byAgent.entries()]
    .sort((a, b) => order(a[1].post) - order(b[1].post))
    .map(([agentId, { name, post, sittings }]) => ({
      agentId,
      iri: agentIriOfId(agentId),
      mark: agentMark(agentId),
      name: post?.label ?? name,
      stepId: post?.id ?? null,
      checks: Boolean(post?.checks),
      kind: sittings.map((s) => s.agentType).find((k): k is string => Boolean(k)) ?? null,
      models: [...new Set(sittings.map((s) => s.model).filter((m): m is string => Boolean(m)))],
      sittings: sittings.length,
      done: sittings.filter((s) => s.state === 'done').length,
      failed: sittings.filter((s) => s.state === 'failed').length,
      working: sittings.filter((s) => s.state === 'running' || s.state === 'queued').length,
      askedAgain: sittings.filter((s) => (s.attempts ?? 1) > 1).length,
    }))
}

/** "1 sitting", "26 sittings". */
export function sittingsWords(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'sitting' : 'sittings'}`
}

/** "Experiment clerk, 26 sittings": who, and how many times they sat (the face's headline in a sentence). */
export function beingHeadline(face: Pick<BeingFace, 'name' | 'sittings'>): string {
  return face.sittings > 0 ? `${face.name}, ${sittingsWords(face.sittings)}` : face.name
}

/** The facts a face states, each only when observed: kind, models, then the tally. */
export function beingFacts(face: BeingFace): string[] {
  return [
    face.kind ?? '',
    face.models.join(', '),
    face.sittings > 0 ? sittingsWords(face.sittings) : '',
    face.failed > 0 ? `${face.failed} failed` : '',
    face.askedAgain > 0 ? `${face.askedAgain} asked again` : '',
  ].filter(Boolean)
}
