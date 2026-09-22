/**
 * source-page.ts — GET /source: the APP-LEVEL self-description route (design
 * §3.1), NOT a render-kind. Not a member of @shrubbery/render's `Resource`
 * union (it renders the HOST's binding, not a graph reading), so it builds its
 * own JSON / markdown / html bodies here rather than going through
 * renderResource.
 *
 *   - json  face: the `TripleSourceDescription` (whatever the bound adapter
 *     discloses — e.g. hosted-gateway's `readPath` rides along structurally,
 *     "incl. readPath for hosted") + the latest read testimony, honestly
 *     reporting failure when the last read did not succeed (never a fallback).
 *   - markdown/html faces: a readable capability card, PLUS an inline turtle
 *     block of `site:ContentSource` triples — the registered shrubbery-site
 *     (docs/planter/DESIGN-20260711.md Appendix A) FIRST LIVING INSTANCE. Only
 *     the fields this layer can state HONESTLY are emitted (`site:authMode`
 *     is caller-supplied, since a bare TripleSource carries no auth-mode
 *     testimony of its own — omitted, never fabricated, when the caller
 *     doesn't know it either).
 */

import type { TripleSourceDescription } from '@shrubbery/nucleus'
import type { ReadStatus } from './read-status.js'
import { type Testimony, testimonyFooter, testimonyFor } from './testimony.js'

export interface SourcePageOptions {
  readonly graphId: string
  readonly graphIri: string
  readonly description: TripleSourceDescription
  readonly readStatus: ReadStatus
  /** Host auth testimony (`dev` | `cognito` | `none` | delegated `service`),
   *  when the caller knows it — a bare TripleSource carries no auth-mode
   *  testimony of its own. Omitted (never guessed) when absent. */
  readonly authMode?: string
}

/** The read-testimony section of the capability card — honest on failure too. */
function readSummary(status: ReadStatus): Record<string, unknown> {
  switch (status.kind) {
    case 'ok':
    case 'malformed':
      return {
        ok: true,
        status: status.kind,
        readAt: status.read.readAt,
        readAtIso: new Date(status.read.readAt).toISOString(),
        graphIri: status.read.graphIri,
        tripleCount: status.read.tripleCount,
      }
    case 'empty':
      return {
        ok: true,
        status: 'empty',
        readAt: status.read.readAt,
        readAtIso: new Date(status.read.readAt).toISOString(),
        graphIri: status.read.graphIri,
        tripleCount: 0,
      }
    default:
      return { ok: false, status: status.kind, message: status.error.message, detail: status.error.detail }
  }
}

/** The JSON capability card (design §3.1's `/source` JSON face). */
export function sourceCapabilityCard(opts: SourcePageOptions): Record<string, unknown> {
  return {
    graphId: opts.graphId,
    graphIri: opts.graphIri,
    description: opts.description,
    read: readSummary(opts.readStatus),
  }
}

/** Testimony to report on the markdown/html capability card, when the last
 *  read succeeded (empty/ok/malformed all had a real TripleRead). `null` on a
 *  failed read — the card still shows the description; it just cannot state a
 *  testimony line for a read that never completed. */
function testimonyIfAvailable(opts: SourcePageOptions): Testimony | null {
  const s = opts.readStatus
  if (s.kind === 'ok' || s.kind === 'empty' || s.kind === 'malformed') {
    return testimonyFor(s.read, opts.description)
  }
  return null
}

/**
 * The `site:ContentSource` inline turtle block. Subject rule (Appendix A):
 * `{graph_subject}:projection:site:content-source:{localId}` — `graph_subject`
 * is the `:ux:config` graph IRI with its suffix stripped (the same
 * `GRAPH_ROOT` convention `uxConfigGraphIri`/`uxControlGraphIri` already share
 * in this tree — see packages/source's gardend-conformance test's
 * `NEVER_WRITTEN_IRI`).
 */
export function contentSourceTurtle(opts: SourcePageOptions): string {
  const root = opts.graphIri.replace(/:ux:config$/, '')
  const subject = `${root}:projection:site:content-source:default`
  const t = testimonyIfAvailable(opts)

  const preds: string[] = []
  if (opts.description.endpoint !== undefined) {
    preds.push(`site:endpoint <${opts.description.endpoint}>`)
  }
  preds.push(`site:graphId "${opts.graphId}"`)
  preds.push(`site:graphIri <${opts.graphIri}>`)
  if (opts.authMode !== undefined) preds.push(`site:authMode "${opts.authMode}"`)
  preds.push(`site:liveness "${opts.description.liveness}"`)
  if (t) {
    preds.push(`site:readAt "${t.readAtIso}"^^xsd:dateTime`)
    preds.push(`site:tripleCount ${t.tripleCount}`)
  }

  const lines = [
    '@prefix site: <http://sophia.ai/site#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
    `<${subject}> a site:ContentSource ;`,
    preds.map((p, i) => `  ${p}${i === preds.length - 1 ? ' .' : ' ;'}`).join('\n'),
  ]
  return lines.join('\n')
}

/** The markdown face: a readable capability card + the inline turtle block. */
export function sourcePageMarkdown(opts: SourcePageOptions): string {
  const d = opts.description
  const t = testimonyIfAvailable(opts)
  const lines: string[] = []
  lines.push('# Source')
  lines.push('')
  lines.push(`This host reads graph \`${opts.graphId}\` (\`<${opts.graphIri}>\`) from a **${d.kind}** adapter.`)
  lines.push('')
  lines.push('## Description')
  lines.push('')
  lines.push(`- **kind**: \`${d.kind}\``)
  lines.push(`- **liveness**: \`${d.liveness}\``)
  lines.push(`- **sparql**: ${d.sparql ? 'yes' : 'no'}`)
  if (d.endpoint !== undefined) lines.push(`- **endpoint**: \`${d.endpoint}\``)
  if (d.suggestedPollMs !== undefined) lines.push(`- **suggestedPollMs**: ${d.suggestedPollMs}`)
  const readPath = (d as { readonly readPath?: string }).readPath
  if (readPath !== undefined) lines.push(`- **readPath**: \`${readPath}\` (hosted-gateway trust path)`)
  lines.push('')
  lines.push('## Last read')
  lines.push('')
  if (t) {
    lines.push(testimonyFooter(t))
  } else {
    const s = opts.readStatus as { kind: string; error?: { message: string } }
    lines.push(`last read attempt failed: **${s.kind}** — ${s.error?.message ?? 'no detail'}`)
  }
  lines.push('')
  lines.push('## RDF — `site:ContentSource` (registered host testimony)')
  lines.push('')
  lines.push('```turtle')
  lines.push(contentSourceTurtle(opts))
  lines.push('```')
  return lines.join('\n')
}
