/**
 * render-hypertext.ts — the `hypertext` face = BEAUTIFUL MARKDOWN + a Navigate
 * curl block + the AltLinks. This is the DEFAULT face (bare `curl`, no Accept) —
 * the whole point: a human or agent gets a readable page, and the page always
 * contains the next `curl`.
 *
 * The "Navigate" block is a fenced code block of copy-pasteable `curl`s built
 * from the SAME AltLink set every face carries (linksFor) — agents grep the
 * fence, machines use the HTTP Link headers the conneg server emits from the same
 * set. The markdown body itself is hand-shaped per resource kind (a real catalog
 * table, a real component page, a real workspace summary) — never mock content.
 *
 * Pure: no DOM, no network.
 */

import { epochMsToIso } from '@shrubbery/nucleus'
import { flowGraphSubject } from './context.js'
import { FLOW_TABLES } from './flow-vocab.js'
import { faceUrl, linksFor } from './links.js'
import {
  CONTENT_TYPE,
  type AltLink,
  type CatalogComponent,
  type FlowScalar,
  type KindedValueNode,
  type KnobResource,
  type RenderCtx,
  type RenderedResource,
  type Resource,
} from './target.js'

function assertNever(value: never): never {
  throw new Error(`Unhandled render resource kind: ${JSON.stringify(value)}`)
}

// ── Navigate block (shared shape across resource kinds) ──────────────────────

/**
 * The "Navigate" fenced curl block — copy-pasteable curls derived from the link
 * set. An agent greps this fence and follows the links; the curls are real and
 * runnable against the conneg server.
 */
function navigateBlock(links: readonly AltLink[], extras: readonly string[] = []): string {
  const rows: string[] = []
  // self first (the canonical URL), then up/collection, then items, then the
  // alternate faces of THIS resource (turtle/json/html).
  const self = links.find((l) => l.rel === 'self')
  if (self) rows.push(curlRow(`curl ${self.href}`, 'this page (markdown)'))

  for (const l of links.filter((l) => l.rel === 'up' || l.rel === 'collection')) {
    rows.push(curlRow(`curl ${l.href}`, `${l.rel}: ${l.title ?? ''}`.trim()))
  }
  for (const l of links.filter((l) => l.rel === 'item')) {
    rows.push(curlRow(`curl ${l.href}`, `open ${l.title ?? 'item'}`))
  }
  for (const l of links.filter((l) => l.rel === 'alternate' || l.rel === 'describedby')) {
    const accept = l.type.split(';')[0]
    rows.push(curlRow(`curl -H "Accept: ${accept}" ${stripExt(l.href)}`, `as ${l.title ?? accept}`))
  }
  // Kind-specific extra curls (e.g. the rhizome `?asof=` temporal lens).
  for (const e of extras) rows.push(e)
  return '```\n' + rows.join('\n') + '\n```'
}

/**
 * Extra Navigate curls for the rhizome temporal lens — a `?asof=` view of `self`.
 * The two pinned dates make the supersession visible from the page itself:
 * 2023-05-25 (before the update — old head) and 2023-06-01 (after — new head).
 */
function asofNavigate(resource: Resource, ctx: RenderCtx): string[] {
  const temporal =
    resource.kind === 'mem-plot' ||
    resource.kind === 'mem-subject' ||
    resource.kind === 'mem-bouquet' ||
    resource.kind === 'tn-knob' ||
    resource.kind === 'tn-greenhouse'
  if (!temporal) return []
  // A knob's as-of scrubs its PAST VALUE (the design's promise: the same playhead
  // that scrubs the beliefs scrubs the knob-history); the pinned dates bracket the A/B.
  const before = asofUrl(ctx, ctx.selfPath, '2023-05-25')
  const after = asofUrl(ctx, ctx.selfPath, '2023-06-01')
  const kind = resource.kind === 'tn-knob' || resource.kind === 'tn-greenhouse'
  return [
    curlRow(`curl '${before}'`, kind ? 'as-of 2023-05-25 (the dial BEFORE the A/B)' : 'as-of 2023-05-25 (before the update)'),
    curlRow(`curl '${after}'`, kind ? 'as-of 2023-06-01 (the dial AFTER the A/B)' : 'as-of 2023-06-01 (after the update)'),
  ]
}

function curlRow(cmd: string, comment: string): string {
  const pad = Math.max(2, 56 - cmd.length)
  return `${cmd}${' '.repeat(pad)}# ${comment}`
}

/** Drop the `.ext` from a pinned face URL so the Accept-header curl negotiates it. */
function stripExt(href: string): string {
  return href.replace(/\.(md|ttl|json|html)$/, '')
}

// ── Per-kind markdown bodies ─────────────────────────────────────────────────

function catalogMarkdown(
  resource: Extract<Resource, { kind: 'catalog' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  lines.push(`**${resource.components.length} components.**`)
  lines.push('')
  lines.push('## Components')
  lines.push('')
  lines.push('| Component | Class | Manifested | Built | Notes |')
  lines.push('| --- | --- | :-: | :-: | --- |')
  for (const c of resource.components) {
    const link = faceUrl(ctx, `${ctx.selfPath}/${c.tag}`)
    lines.push(
      `| [\`${c.tag}\`](${link}) | ${classShort(c.persistence)} | ${tick(c.manifested)} | ${tick(c.built)} | ${c.blurb} |`,
    )
  }
  return lines.join('\n')
}

function componentMarkdown(c: CatalogComponent): string {
  const lines: string[] = []
  lines.push(`# \`${c.tag}\``)
  lines.push('')
  lines.push(c.blurb)
  lines.push('')
  lines.push('## Facts')
  lines.push('')
  lines.push(`- **Persistence class:** ${c.persistence} (${classShort(c.persistence)})`)
  lines.push(`- **Manifested (engine knows it):** ${c.manifested ? 'yes' : 'no'}`)
  lines.push(`- **Built (registered custom element):** ${c.built ? 'yes' : 'no'}`)
  lines.push(`- **Catalog face:** ${c.face}`)
  return lines.join('\n')
}

function timeLabel(ms: number): string {
  return new Date(ms).toISOString()
}

function memoryObserverLine(observer?: string, observedAt?: string): string | null {
  if (!observer && !observedAt) return null
  return [observer, observedAt].filter(Boolean).join(', ')
}

function kindedInlineMarkdown(node: KindedValueNode): string {
  const value = node.label ?? node.value
  switch (node.kind) {
    case 'testimony': {
      const observer = node.attribution?.observer
      const observedAt = node.attribution?.observedAt
      const suffix = [observer, observedAt === undefined ? undefined : timeLabel(observedAt)]
        .filter((part): part is string => Boolean(part))
        .join(', ')
      return suffix ? `${value} — ${suffix}` : value
    }
    case 'metric':
      return node.unit ? `${node.value} (${node.unit})` : node.value
    case 'reference':
      return node.href ? `[${value}](${node.href})` : value
    case 'identity':
    case 'state':
    case 'prose':
    case 'affordance':
      return value
    default:
      return assertNever(node.kind)
  }
}

function kindedValueMarkdown(resource: Extract<Resource, { kind: 'kinded-value' }>): string {
  return [`# ${resource.title}`, '', kindedInlineMarkdown(resource.node)].join('\n')
}

function workspaceMarkdown(resource: Extract<Resource, { kind: 'workspace' }>): string {
  const cfg = resource.config
  const lines: string[] = []
  lines.push(`# Workspace — ${cfg.label}`)
  lines.push('')
  lines.push(`Rendered by \`${cfg.renderedByComponent}\`. id \`${cfg.id}\`.`)
  lines.push('')
  lines.push('## Regions')
  lines.push('')
  lines.push('| Region | Renders | Docks | Child |')
  lines.push('| --- | --- | --- | --- |')
  for (const id of Object.keys(cfg.regions).sort()) {
    const r = cfg.regions[id]
    const renders = r.renderedByComponent ? `\`${r.renderedByComponent}\`` : '—'
    const docks = r.docksPanel.length ? r.docksPanel.map((p) => `\`${p}\``).join(', ') : '—'
    lines.push(`| \`${r.id}\` | ${renders} | ${docks} | ${r.childRegion ? `\`${r.childRegion}\`` : '—'} |`)
  }
  lines.push('')
  lines.push('## Panels')
  lines.push('')
  for (const id of Object.keys(cfg.panels).sort()) {
    const p = cfg.panels[id]
    lines.push(`- \`${p.id}\` → \`${p.renderedByComponent}\` (${p.dockState}${p.defaultVisible ? ', visible' : ''})`)
  }
  lines.push('')
  lines.push('## Dimensions')
  lines.push('')
  for (const id of Object.keys(cfg.dimensions).sort()) {
    const d = cfg.dimensions[id]
    const vals = d.values.map((v) => v.literalValue).join(' · ')
    lines.push(`- **${d.label}** (\`${d.id}\`) = \`${d.defaultValue}\` — ${vals}`)
  }
  return lines.join('\n')
}

function vocabCatalogMarkdown(
  resource: Extract<Resource, { kind: 'vocab-catalog' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  lines.push(`**${resource.vocabs.length} vocabularies.** The pack IS the catalog.`)
  lines.push('')
  lines.push('## Vocabularies')
  lines.push('')
  lines.push('| Vocabulary | Version | Namespace | sha (8) |')
  lines.push('| --- | --- | --- | --- |')
  for (const v of resource.vocabs) {
    const link = faceUrl(ctx, `${ctx.selfPath}/${v.name}`)
    lines.push(
      `| [\`${v.name}\`](${link}) — ${v.title} | ${v.version} | \`${v.namespace}\` | \`${v.sha.slice(0, 8)}\` |`,
    )
  }
  return lines.join('\n')
}

/**
 * A GitHub-style heading anchor for a class section, so a relationship's "Navigate
 * to related class" curl-link is followable (the pack page is one document; the
 * class is a `###` heading within it). e.g. `AgentNode` → `#agentnode`.
 */
function classAnchor(className: string): string {
  return (
    '#' +
    className
      .toLowerCase()
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
  )
}

/** The pack-detail markdown — the FULL golden-contract anatomy (iter-5b deepening). */
function vocabPackMarkdown(
  p: Extract<Resource, { kind: 'vocab-pack' }>['pack'],
  ctx: RenderCtx,
): string {
  const selfUrl = faceUrl(ctx, ctx.selfPath)
  const classNames = new Set(p.classes.map((c) => c.name))
  /** A linked class reference: real followable anchor when the class is in THIS pack. */
  const classRef = (name: string): string =>
    classNames.has(name) ? `[\`${name}\`](${selfUrl}${classAnchor(name)})` : `\`${name}\``

  const predicateCount =
    p.predicateCount ?? p.classes.reduce((n, c) => n + c.predicates.length, 0)
  const relationshipCount = p.relationshipCount ?? p.relationships?.length ?? 0

  const lines: string[] = []
  lines.push(`# \`${p.name}\` — ${p.title}`)
  lines.push('')
  if (p.description) lines.push(p.description), lines.push('')

  // ── Facts + STATS ────────────────────────────────────────────────────────────
  lines.push('## Facts')
  lines.push('')
  lines.push(`- **Version:** ${p.version}`)
  lines.push(`- **Namespace:** \`${p.namespace}\``)
  if (p.sha) lines.push(`- **sha256:** \`${p.sha}\``)
  lines.push('')
  lines.push('**Stats** — '
    + `${p.classes.length} ${p.classes.length === 1 ? 'class' : 'classes'} · `
    + `${predicateCount} ${predicateCount === 1 ? 'predicate' : 'predicates'} · `
    + `${relationshipCount} ${relationshipCount === 1 ? 'relationship' : 'relationships'}`)
  lines.push('')

  // ── Namespaces (prefix → URI) ─────────────────────────────────────────────────
  if (p.namespaces && Object.keys(p.namespaces).length > 0) {
    lines.push('## Namespaces')
    lines.push('')
    lines.push('| Prefix | Namespace |')
    lines.push('| --- | --- |')
    for (const [prefix, ns] of Object.entries(p.namespaces).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| \`${prefix || '(base)'}\` | \`${ns}\` |`)
    }
    lines.push('')
  }

  // ── Minting (slug rule + per-template uri / doc-id rules) ──────────────────────
  const m = p.minting
  if (m) {
    const hasSlug =
      m.slugPattern !== undefined || m.slugReplacement !== undefined || m.slugLowercase !== undefined
    const uriRules = m.uriRules ? Object.entries(m.uriRules) : []
    const docIdRules = m.docIdRules ? Object.entries(m.docIdRules) : []
    if (hasSlug || uriRules.length > 0 || docIdRules.length > 0) {
      lines.push('## Minting')
      lines.push('')
      if (hasSlug) {
        const bits: string[] = []
        if (m.slugPattern !== undefined) bits.push(`pattern \`${m.slugPattern}\``)
        if (m.slugReplacement !== undefined) bits.push(`replacement \`${m.slugReplacement || '∅'}\``)
        if (m.slugLowercase !== undefined) bits.push(m.slugLowercase ? 'lowercase' : 'preserve case')
        lines.push(`- **Slug rule:** ${bits.join(' · ')}`)
        lines.push('')
      }
      if (uriRules.length > 0) {
        lines.push('**Subject URI rules**')
        lines.push('')
        lines.push('| Template | Rule |')
        lines.push('| --- | --- |')
        for (const [tpl, rule] of uriRules.sort(([a], [b]) => a.localeCompare(b))) {
          lines.push(`| \`${tpl}\` | ${rule} |`)
        }
        lines.push('')
      }
      if (docIdRules.length > 0) {
        lines.push('**Doc-id rules**')
        lines.push('')
        lines.push('| Template | Rule |')
        lines.push('| --- | --- |')
        for (const [tpl, rule] of docIdRules.sort(([a], [b]) => a.localeCompare(b))) {
          lines.push(`| \`${tpl}\` | ${rule} |`)
        }
        lines.push('')
      }
    }
  }

  // ── Relationships (class→class predicate ranges + CRDT wire rules) ─────────────
  const rels = p.relationships ?? []
  if (rels.length > 0) {
    const predicateEdges = rels.filter((r) => r.kind === 'predicate')
    const wireEdges = rels.filter((r) => r.kind === 'wire')
    lines.push('## Relationships')
    lines.push('')
    lines.push(`${rels.length} class→class ${rels.length === 1 ? 'link' : 'links'}. Each \`to\` is a [Navigate]-able class anchor when it lives in this pack.`)
    lines.push('')
    if (predicateEdges.length > 0) {
      lines.push('**Predicate ranges** (object-property → class)')
      lines.push('')
      lines.push('| From | Predicate | → To | Note |')
      lines.push('| --- | --- | --- | --- |')
      for (const r of predicateEdges) {
        lines.push(`| ${classRef(r.from)} | \`${r.predicate}\` | → ${classRef(r.to)} | ${r.note ?? ''} |`)
      }
      lines.push('')
    }
    if (wireEdges.length > 0) {
      lines.push('**CRDT wires** (doc-connection rules)')
      lines.push('')
      lines.push('| From | Wire | → To | Note |')
      lines.push('| --- | --- | --- | --- |')
      for (const r of wireEdges) {
        lines.push(`| ${classRef(r.from)} | \`${r.predicate}\` | → ${classRef(r.to)} | ${r.note ?? ''} |`)
      }
      lines.push('')
    }
  }

  // ── Classes — required-vs-optional grouping, datatype/multi, enums, subject ────
  lines.push('## Classes')
  lines.push('')
  for (const cls of p.classes) {
    lines.push(`### \`${cls.name}\``)
    lines.push('')
    if (cls.subjectRule) {
      lines.push(`**Subject rule:** ${cls.subjectRule}`)
      lines.push('')
    }
    if (cls.predicates.length === 0) {
      lines.push('_(no predicates)_')
      lines.push('')
      continue
    }
    const required = cls.predicates.filter((pr) => pr.required)
    const optional = cls.predicates.filter((pr) => !pr.required)
    const renderGroup = (label: string, preds: typeof cls.predicates): void => {
      if (preds.length === 0) return
      lines.push(`**${label}** (${preds.length})`)
      lines.push('')
      lines.push('| Predicate | Datatype | Multi | Range / Enum |')
      lines.push('| --- | --- | :-: | --- |')
      for (const pred of preds) {
        const rangeOrEnum = pred.relatesTo
          ? `→ ${classRef(pred.relatesTo)}`
          : pred.enumValues && pred.enumValues.length > 0
            ? `enum: ${pred.enumValues.map((v) => `\`${v}\``).join(' \\| ')}`
            : ''
        lines.push(
          `| \`${pred.name}\` | ${pred.datatype ?? '—'} | ${pred.multi ? 'yes' : '—'} | ${rangeOrEnum} |`,
        )
      }
      lines.push('')
    }
    renderGroup('Required', required)
    renderGroup('Optional', optional)
  }
  return lines.join('\n').trimEnd()
}

// ── Rhizome — the memory observatory faces ───────────────────────────────────

/** A `?asof=` curl helper: append the as-of query to a path's negotiated URL. */
function asofUrl(ctx: RenderCtx, path: string, asof: string): string {
  return `${faceUrl(ctx, path)}?asof=${encodeURIComponent(asof)}`
}

/** The PLOT collection — the index of subject-beds in :projection:memory. */
function plotMarkdown(
  resource: Extract<Resource, { kind: 'mem-plot' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  if (resource.asOf) {
    lines.push(`**Viewing as-of \`${resource.asOf}\`** — heads recomputed from \`mem:createdAt\` + lineage (NOT the live \`mem:status\` flag).`)
  } else {
    lines.push('**Viewing _now_** — current heads are the `mem:status="active"` records.')
  }
  lines.push('')
  lines.push(`**${resource.subjects.length} subject-${resource.subjects.length === 1 ? 'bed' : 'beds'}.**`)
  lines.push('')
  lines.push('## Subjects')
  lines.push('')
  lines.push('| Subject | Current head | Records | Active | Superseded |')
  lines.push('| --- | --- | :-: | :-: | :-: |')
  for (const s of resource.subjects) {
    // Preserve the as-of stamp on the per-subject link, so drilling in keeps the lens.
    const path = `${ctx.selfPath}/${s.rootId}`
    const link = resource.asOf ? asofUrl(ctx, path, resource.asOf) : faceUrl(ctx, path)
    lines.push(
      `| [\`${s.topic}\`](${link}) | ${s.headContent} | ${s.recordTotal} | ${s.activeCount} | ${s.supersededCount} |`,
    )
  }
  return lines.join('\n')
}

/** One SUBJECT bed — the lineage chain (current head + superseded predecessors). */
function subjectMarkdown(
  resource: Extract<Resource, { kind: 'mem-subject' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(`Subject bed \`${resource.rootId}\` — topic _${resource.topic}_.`)
  lines.push('')
  // THE REVERSE CROSS-LINK — when an agentic run minted this bed's head, link back
  // to that run's Walk (the host supplies walkRunPath from the trace files). Mirrors
  // the run's "→ the Plot beds" section; absent for a read-only bed, never faked.
  if (ctx.walkRunPath) {
    lines.push(`> ⟲ **Minted by run** — [\`${ctx.walkRunPath}\`](${faceUrl(ctx, ctx.walkRunPath)}) wrote this bed's current head ("met its past self"). Open the Walk to see the turn-by-turn session.`)
    lines.push('')
  }
  if (resource.asOf) {
    lines.push(`**As-of \`${resource.asOf}\`** — the current head is RECOMPUTED from \`mem:createdAt\` (the record with the greatest createdAt ≤ T), ignoring the global \`mem:status\` flag.`)
  } else {
    lines.push('**Now** — the current head is the `mem:status="active"` record.')
  }
  lines.push('')

  const head = resource.records.find((r) => r.localId === resource.head)
  if (head) {
    lines.push('## Current')
    lines.push('')
    lines.push(`> ${head.content}`)
    lines.push('')
    lines.push(`- **record:** \`${head.localId}\``)
    if (head.kind) lines.push(`- **kind:** ${head.kind}`)
    if (head.createdAt) lines.push(`- **createdAt:** \`${head.createdAt}\``)
    const observed = memoryObserverLine(head.observer, head.observedAt)
    if (observed) lines.push(`- **observed:** ${observed}`)
    lines.push(`- **mem:status (global flag):** \`${head.status}\``)
    lines.push('')
  }

  const predecessors = resource.records.filter((r) => r.localId !== resource.head)
  if (predecessors.length > 0) {
    lines.push('## Superseded predecessors')
    lines.push('')
    lines.push('| record | content | createdAt | observed | mem:status | supersedes |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const r of predecessors) {
      const sup = r.supersedes ? `\`${shortId(r.supersedes)}\`` : '—'
      const observed = memoryObserverLine(r.observer, r.observedAt) ?? '—'
      lines.push(
        `| \`${r.localId}\` | ${r.content} | \`${r.createdAt ?? '—'}\` | ${observed} | \`${r.status}\` | ${sup} |`,
      )
    }
    lines.push('')
  }

  // The lineage chain (newest→oldest), explicit so the supersession is legible.
  lines.push('## Lineage')
  lines.push('')
  lines.push(
    resource.records
      .map((r) => `\`${r.localId}\`${r.localId === resource.head ? ' (head)' : ''}`)
      .join(' → '),
  )
  return lines.join('\n')
}

/** Short id from a full record IRI (last `:record:` sha, first 12). */
function shortId(iri: string): string {
  const m = iri.split(':record:')
  return (m[m.length - 1] || iri).slice(0, 12)
}

/** A glyph for a star's WHY (legible in plain markdown — never an emoji-only cue). */
function whyGlyph(why: string): string {
  switch (why) {
    case 'current': return '★'
    case 'resolved-conflict': return '☆'
    case 'standing': return '◆'
    case 'entity-link': return '→'
    case 'gotcha': return '⚠'
    case 'evidence': return '¶'
    default: return '·'
  }
}

/**
 * ONE BOUQUET — the READ-side constellation reader. Markdown bloom: the bright
 * CURRENT head (the answer) WITH its why, the dimmed dated STRUCK predecessors
 * (resolved conflicts), the standing dispositions, the entity links to sibling
 * beds, the gotchas (do-not-strike markers), the minimal verbatim EVIDENCE, and
 * the surfaced RETRIEVAL reasoning (ClassifyQueryShape verdict, gate→fuse) — the
 * read-side analog of the Walk surfacing write reasoning. Every section is honest:
 * an empty arm renders an explicit absence, never a faked star.
 */
function bouquetMarkdown(
  resource: Extract<Resource, { kind: 'mem-bouquet' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(`The constellation that blooms when belief \`${resource.rootId}\` is opened — topic _${resource.topic}_. Meaning is a configuration of fragments, never one row.`)
  lines.push('')
  if (resource.asOf) {
    lines.push(`**As-of \`${resource.asOf}\`** — the bright head is RECOMPUTED from \`mem:createdAt\` (the record with the greatest createdAt ≤ T), not the global \`mem:status\` flag.`)
  } else {
    lines.push('**Now** — the bright head is the `mem:status="active"` record.')
  }
  lines.push('')

  // THE ANSWER — the bright current head.
  const head = resource.currentHead
  lines.push('## ★ The answer (current head)')
  lines.push('')
  lines.push(`> ${head.content}`)
  lines.push('')
  lines.push(`- **record:** \`${head.localId}\``)
  if (head.kind) lines.push(`- **kind:** ${head.kind}`)
  if (head.createdAt) lines.push(`- **createdAt:** \`${head.createdAt}\``)
  const observed = memoryObserverLine(head.observer, head.observedAt)
  if (observed) lines.push(`- **observed:** ${observed}`)
  lines.push(`- **why:** chosen as the current head (the answer)`)
  lines.push('')

  // RESOLVED CONFLICTS — the dimmed dated struck predecessors.
  lines.push('## ☆ Resolved conflicts (struck predecessors)')
  lines.push('')
  if (resource.predecessors.length === 0) {
    lines.push('_None — this belief has no superseded predecessors._')
  } else {
    lines.push('Each was the head once, then struck — what the current head superseded.')
    lines.push('')
    lines.push('| record | ~~content~~ | createdAt | observed | why |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const r of resource.predecessors) {
      lines.push(`| \`${r.localId}\` | ~~${escapeCell(r.content)}~~ | \`${r.createdAt ?? '—'}\` | ${memoryObserverLine(r.observer, r.observedAt) ?? '—'} | superseded by the head (resolved conflict) |`)
    }
  }
  lines.push('')

  // STANDING DISPOSITIONS — durable traits about the same subject.
  lines.push('## ◆ Standing dispositions')
  lines.push('')
  if (resource.dispositions.length === 0) {
    lines.push('_None — no standing disposition about this subject in the floor._')
  } else {
    for (const r of resource.dispositions) {
      lines.push(`- ${escapeCell(r.content)} _(\`${r.localId}\`)_`)
    }
  }
  lines.push('')

  // ENTITY LINKS — sibling beds about the same subject.
  lines.push('## → Entity links (sibling beds about the same subject)')
  lines.push('')
  if (resource.entityLinks.length === 0) {
    lines.push('_None — no sibling bed shares a salient term with this belief._')
  } else {
    for (const star of resource.entityLinks) {
      const rootId = bedRootId(star.record.id)
      const link = rootId ? `[\`${rootId}\`](${faceUrl(ctx, `/bouquet/${rootId}`)})` : `\`${star.record.localId}\``
      const note = star.note ? ` — ${star.note}` : ''
      lines.push(`- ${link}: ${escapeCell(star.record.content)}${note}`)
    }
  }
  lines.push('')

  // GOTCHAS — do-not-strike markers.
  if (resource.gotchas.length > 0) {
    lines.push('## ⚠ Gotchas (read with care)')
    lines.push('')
    for (const star of resource.gotchas) {
      const note = star.note ? ` — ${star.note}` : ''
      lines.push(`- ⚠ \`${star.record.localId}\`: ${escapeCell(star.record.content)}${note}`)
    }
    lines.push('')
  }

  // EVIDENCE — the minimal verbatim episodic floor grounding the head.
  lines.push('## ¶ Evidence (the verbatim floor)')
  lines.push('')
  if (resource.evidence.length === 0) {
    lines.push('_No episodic fragment in this cell grounds the head with its key terms (the floor is empty here — surfaced honestly, never faked)._')
  } else {
    for (const r of resource.evidence) {
      lines.push(`> ${escapeCell(r.content)}`)
      lines.push('>')
      const observer = memoryObserverLine(r.observer, r.observedAt)
      lines.push(`> — \`${r.localId}\`${r.kind ? ` (${r.kind})` : ''}${observer ? `, ${observer}` : ''}`)
      lines.push('')
    }
  }
  lines.push('')

  // RETRIEVAL — the read reasoning (the analog of the Walk's write reasoning).
  const rv = resource.retrieval
  lines.push('## Retrieval reasoning')
  lines.push('')
  if (rv.queryShape) lines.push(`- **ClassifyQueryShape:** \`${rv.queryShape}\``)
  if (rv.question) lines.push(`- **question:** ${escapeCell(rv.question)}`)
  if (rv.gate) lines.push(`- **gate:** ${escapeCell(rv.gate)}`)
  if (rv.fuse) lines.push(`- **fuse:** ${escapeCell(rv.fuse)}`)
  if (!rv.queryShape && !rv.question && !rv.gate && !rv.fuse) {
    lines.push('_Deterministic read — no question-driven gate/fuse trace._')
  }
  lines.push('')

  // The whole bloom, as a flat legend (every star + its why glyph).
  lines.push('## The bloom (every star)')
  lines.push('')
  lines.push('| | why | record | content |')
  lines.push('| :-: | --- | --- | --- |')
  for (const star of resource.stars) {
    lines.push(`| ${whyGlyph(star.why)} | \`${star.why}\` | \`${star.record.localId}\` | ${escapeCell(truncate(star.record.content, 90))} |`)
  }
  return lines.join('\n').trimEnd()
}

/** The bed root short-id of a record IRI (the bouquet/plot URL key), or null. */
function bedRootId(iri: string): string | null {
  const parts = iri.split(':record:')
  const sha = parts[parts.length - 1]
  return sha ? sha.slice(0, 12) : null
}

// ── WALK — the agentic-run trace as turn-by-turn markdown ─────────────────────

/** A `?turn=N` curl helper: append the turn lens to a run's negotiated URL. */
function turnUrl(ctx: RenderCtx, path: string, turn: number): string {
  return `${faceUrl(ctx, path)}?turn=${turn}`
}

/** Extra Navigate curls for the WALK turn lens — `?turn=N` views of a run. */
function turnNavigate(resource: Resource, ctx: RenderCtx): string[] {
  if (resource.kind !== 'walk-run' || resource.turns.length === 0) return []
  const first = resource.turns[0].turn
  const supersede = resource.turns.find((t) => t.supersedes)
  const rows = [curlRow(`curl '${turnUrl(ctx, ctx.selfPath, first)}'`, `lens turn ${first}`)]
  if (supersede) {
    rows.push(
      curlRow(
        `curl '${turnUrl(ctx, ctx.selfPath, supersede.turn)}'`,
        `the supersede turn (met its past self)`,
      ),
    )
  }
  return rows
}

/** The WALK INDEX — the list of agentic runs (one per trace file). */
function walkIndexMarkdown(
  resource: Extract<Resource, { kind: 'walk-index' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  lines.push(`**${resource.runs.length} ${resource.runs.length === 1 ? 'run' : 'runs'}.** Each is one agentic session absorbed into durable memory.`)
  lines.push('')
  lines.push('## Runs')
  lines.push('')
  lines.push('| Run | Question | Turns | Minted Plot beds | Final answer |')
  lines.push('| --- | --- | :-: | --- | --- |')
  // The Plot lives one level up from the Walk index (both are roots under the host);
  // each minted bed links straight into it (the reverse cross-surface join).
  const plotBase = ctx.selfPath.replace(/\/walk$/, '') + '/plot'
  for (const r of resource.runs) {
    const link = faceUrl(ctx, `${ctx.selfPath}/${r.id}`)
    const beds =
      r.supersededRoots.length > 0
        ? r.supersededRoots.map((root) => `[\`${root}\`](${faceUrl(ctx, `${plotBase}/${root}`)})`).join(', ')
        : '—'
    lines.push(
      `| [\`${r.id}\`](${link}) | ${escapeCell(r.question)} | ${r.turnCount} | ${beds} | ${escapeCell(r.finalAnswer)} |`,
    )
  }
  return lines.join('\n')
}

/** ONE run's WALK — the ribbon of turns (observe→think→act + cost), supersede highlighted. */
function walkRunMarkdown(
  resource: Extract<Resource, { kind: 'walk-run' }>,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(`**Question** — ${resource.question}`)
  lines.push('')
  lines.push(`**Gold** — ${resource.gold}`)
  lines.push('')
  lines.push(`**Final answer** — ${resource.finalAnswer}`)
  lines.push('')
  const totalCost = resource.turns.reduce((n, t) => n + (t.usage?.costUsd ?? 0), 0)
  const totalTokens = resource.turns.reduce((n, t) => n + (t.usage?.totalTokens ?? 0), 0)
  lines.push(
    `**${resource.turns.length} turns** · ${totalTokens.toLocaleString()} tokens · $${totalCost.toFixed(5)} · `
      + `${resource.supersessionEdges.length} confirmed ${resource.supersessionEdges.length === 1 ? 'supersession' : 'supersessions'}`,
  )
  if (resource.turnCursor != null) {
    lines.push('')
    lines.push(`**Lens: turn ${resource.turnCursor}** — the ribbon below is positioned at this turn.`)
  }
  lines.push('')

  // The supersession edges (run_end) — the cross-surface join back to the Plot beds.
  if (resource.supersessionEdges.length > 0) {
    lines.push('## Supersessions (→ the Plot beds)')
    lines.push('')
    lines.push('Each WRITE that met its past self — the new record supersedes the old (the same lineage the Plot renders as a bed).')
    lines.push('')
    lines.push('| New record | supersedes | Old record |')
    lines.push('| --- | :-: | --- |')
    for (const e of resource.supersessionEdges) {
      lines.push(`| \`${shortId(e.newUrn)}\` | → | \`${shortId(e.oldUrn)}\` |`)
    }
    lines.push('')
  }

  lines.push('## Turns')
  lines.push('')
  for (const t of resource.turns) {
    const focus = resource.turnCursor != null && resource.turnCursor !== t.turn
    if (focus) continue // the ?turn lens limits to the cursor's turn.
    lines.push(`### ${t.label} · turn ${t.turn}${t.supersedes ? ' — ⟲ met its past self' : ''}`)
    lines.push('')
    // observe→think→act.
    if (t.reasoning) {
      lines.push('**Think** — ' + escapeCell(t.reasoning))
      lines.push('')
    }
    for (const c of t.toolCalls) {
      const r = t.toolResults.find((x) => x.toolCallId === c.id)
      const sup = c.supersedesRef ? ` — ⟲ supersedes \`${shortId(c.supersedesRef)}\`` : ''
      lines.push(`**Act** — \`${c.name}\`${sup}`)
      lines.push('')
      lines.push('```json')
      lines.push(prettyArgs(c.arguments))
      lines.push('```')
      if (r) {
        lines.push('')
        lines.push(`**Observe** — ${r.isError ? '⚠ error' : 'ok'}`)
        lines.push('')
        lines.push('```json')
        lines.push(truncate(r.result, 1200))
        lines.push('```')
      }
      lines.push('')
    }
    if (t.usage) {
      const u = t.usage
      lines.push(
        `_usage: ${u.inputTokens ?? '?'} in · ${u.outputTokens ?? '?'} out · `
          + `${u.totalTokens ?? '?'} total · $${(u.costUsd ?? 0).toFixed(6)}_`,
      )
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd()
}

// ── GREENHOUSE — the cultivation knobs (the markdown face IS the docs) ─────────

/** A token-free VU bar of `n` filled / `max` total cells (markdown-legible). */
function vuBar(value: number, target: number, max = 8): string {
  // The bar fills toward the PROBLEM: more filled = more misses (a clean meter is
  // mostly empty). We scale value against max(target+something, value) so a clean
  // meter reads near-empty and a flagging one reads near-full.
  const span = Math.max(max, value, target + 1)
  const filled = Math.max(0, Math.min(max, Math.round((value / span) * max)))
  return '▮'.repeat(filled) + '░'.repeat(max - filled)
}

/**
 * ONE KNOB — the GET face. The markdown face IS the docs: it shows the current value,
 * the LIVE-EFFECT METER (the consequence, with the verbatim offenders a RED meter
 * names), the per-axis settings, the LAWS legend, and the provenance — plus the
 * §5 PATCH worked-example so the page is self-documenting. The Navigate block (added
 * by the dispatcher) carries the .ttl/.json faces + the `?asof` knob-history scrub.
 */
function knobMarkdown(
  resource: Extract<Resource, { kind: 'tn-knob' }>,
  ctx: RenderCtx,
): string {
  const m = resource.meter
  const lines: string[] = []
  lines.push(`# ${resource.title}   ⚙ ${resource.family} family   graph: \`:tune:\``)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  if (resource.asOf) {
    lines.push(`**As-of \`${resource.asOf}\`** — the dial's value + meter RECOMPUTED as the climate was then.`)
    lines.push('')
  }

  // THE LIVE EFFECT — the focal datum (the consequence of the setting).
  lines.push('## LIVE EFFECT')
  lines.push('')
  const verdict = m.green ? '✓ clean' : '✗ FLAGGING'
  lines.push('```')
  lines.push(`LIVE EFFECT  ${vuBar(m.value, m.target)}  ${verdict}`)
  lines.push(`             ${m.label}: ${m.value}${m.unit ?? ''}  (target: ${m.target}${m.unit ?? ''})`)
  for (const off of m.offenders) lines.push(`             ${off}`)
  lines.push('```')
  lines.push('')

  // THE SETTING — scalar value or the multi-axis strip.
  if (resource.axes.length > 0) {
    lines.push('## Axes (PATCH any one)')
    lines.push('')
    lines.push('| Axis | Value | Choices | Note |')
    lines.push('| --- | --- | --- | --- |')
    for (const a of resource.axes) {
      const choices = a.choices.map((c) => (c === a.value ? `**${c}**` : c)).join(' \\| ')
      const lock = a.locked ? ' 🔒(locked)' : ''
      lines.push(`| \`${a.key}\` | ${a.value}${lock} | ${choices} | ${a.note ? escapeCell(a.note) : ''} |`)
    }
    lines.push('')
  } else {
    lines.push(`## Value`)
    lines.push('')
    lines.push(`- **current:** \`${resource.value}\``)
    if (resource.choices.length > 0) {
      lines.push(`- **choices:** ${resource.choices.map((c) => (c === resource.value ? `**${c}**` : `\`${c}\``)).join(' · ')}`)
    }
    lines.push('')
  }

  // THE LAWS legend (read-mostly) — the world-model lifecycle taxonomy-as-code.
  if (resource.laws.length > 0) {
    lines.push('## Laws (read-mostly)')
    lines.push('')
    lines.push('| Kind | Rule | Detail |')
    lines.push('| --- | --- | --- |')
    for (const law of resource.laws) {
      lines.push(`| \`${law.kind}\` | ${law.rule} | ${escapeCell(law.detail)} |`)
    }
    lines.push('')
  }

  // PROVENANCE — the quiet "why" layer (P4): the bench:Run + who/when.
  lines.push('## Why (provenance)')
  lines.push('')
  if (resource.justifiedBy) lines.push(`- **justifiedBy:** \`${resource.justifiedBy}\` (the bench:Run that earned the change)`)
  if (resource.createdBy) lines.push(`- **createdBy:** ${resource.createdBy}`)
  if (resource.createdAt != null) lines.push(`- **createdAt:** \`${epochMsToIso(resource.createdAt)}\``)
  if (!resource.justifiedBy && !resource.createdBy && resource.createdAt == null) {
    lines.push('- _default value — no PATCH has set this dial yet (the `:tune:` graph holds none)._')
  }
  lines.push('')

  // THE WRITE CONTRACT — honest about the WP5.2 cliff (read-first; PATCH staged).
  lines.push('## Write')
  lines.push('')
  if (resource.writeMode === 'live') {
    lines.push('**WRITES FOR REAL.** This dial mutates the graph now (the entity-resolution merge/collapse layer): turning it changes the meter live (e.g. distinct-subjects 3→1 after a merge).')
  } else if (resource.writeMode === 'read-only') {
    lines.push('**Read-only by design** — the world-model laws are a legend, not a rewrite path (editing the agent\'s ontology is the dangerous direction).')
  } else {
    lines.push('**Read-first (staged — WP5.2).** A PATCH lands in `:tune:` (dated, audited) but is honestly badged *not yet applied to the runtime* until `ux_seed` is wired — the meter measures the CURRENT consequence; it does not yet change agent behaviour.')
    lines.push('')
    lines.push('```bash')
    lines.push(`$ curl -X PATCH ${faceUrl(ctx, ctx.selfPath)} \\`)
    lines.push(`    -H 'Content-Type: application/json' \\`)
    if (resource.axes.length > 0) {
      lines.push(`    -d '{"${resource.axes[0].key}": "${resource.axes[0].choices.find((c) => c !== resource.axes[0].value) ?? resource.axes[0].value}", "justifiedBy": "run/T-042"}'`)
    } else {
      lines.push(`    -d '{"value": "${resource.choices.find((c) => c !== resource.value) ?? resource.value}", "justifiedBy": "run/T-042"}'`)
    }
    lines.push('# → staged (WP5.2): accepted into :tune:, dated; not yet applied to the runtime.')
    lines.push('```')
  }
  return lines.join('\n').trimEnd()
}

/** A short [meter] glyph for the greenhouse index rows. */
function meterGlyph(green: boolean): string {
  return green ? '✓' : '✗'
}

/** THE GREENHOUSE — the index of knobs, grouped by family (the markdown face). */
function greenhouseMarkdown(
  resource: Extract<Resource, { kind: 'tn-greenhouse' }>,
  ctx: RenderCtx,
): string {
  const lines: string[] = []
  lines.push(`# ${resource.title}`)
  lines.push('')
  lines.push(resource.summary)
  lines.push('')
  if (resource.asOf) {
    lines.push(`**As-of \`${resource.asOf}\`** — every dial + meter recomputed as the climate was then.`)
    lines.push('')
  }

  // THE MARQUEE — the focal knob's miss-meter first (P0), in its own band.
  const focal = resource.knobs.find((k) => k.focal)
  if (focal) {
    const m = focal.meter
    lines.push('## ★ The marquee miss-meter (the focal dial)')
    lines.push('')
    lines.push('```')
    lines.push(`${focal.title}   ${vuBar(m.value, m.target)}  ${m.green ? '✓ clean' : '✗ UNDER-SUPERSEDING'}`)
    for (const off of m.offenders) lines.push(`  ${off}`)
    lines.push(`  → ${m.label}: ${m.value} (target: ${m.target})`)
    lines.push('```')
    lines.push('')
    lines.push(`[open the dial →](${faceUrl(ctx, `${ctx.selfPath}/${focal.id}`)})`)
    lines.push('')
  }

  // THE FAMILIES — the common-region zones (P1), in the stable §2 order.
  const families: KnobResource['family'][] = ['CLIMATE', 'JUDGMENT', 'REACH', 'LAWS', 'METER & SPEND']
  for (const fam of families) {
    const ks = resource.knobs.filter((k) => k.family === fam)
    if (ks.length === 0) continue
    lines.push(`## ${fam}`)
    lines.push('')
    lines.push('| Knob | Value | Live effect | Write |')
    lines.push('| --- | --- | --- | --- |')
    for (const k of ks) {
      const link = faceUrl(ctx, `${ctx.selfPath}/${k.id}`)
      const val = k.axes.length > 0 ? k.axes.map((a) => `${a.key}=${a.value}`).join(', ') : `\`${k.value}\``
      const eff = `${meterGlyph(k.meter.green)} ${k.meter.value}/${k.meter.target}`
      const write = k.writeMode === 'live' ? 'LIVE' : k.writeMode === 'read-only' ? 'read-only' : 'staged (WP5.2)'
      lines.push(`| [\`${k.title}\`](${link}) | ${escapeCell(val)} | ${eff} | ${write} |`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Pretty-print tool-call arguments as JSON (truncated long values). */
function prettyArgs(args: Readonly<Record<string, unknown>>): string {
  return truncate(JSON.stringify(args, null, 2), 1600)
}

/** Truncate a long string with an explicit elision marker (no silent drop). */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `\n… (${s.length - max} more chars)`
}

/** Escape a value for a markdown TABLE cell (newlines + pipes break the row). */
function escapeCell(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
}

// ── MITHRAS FLOW — the board's markdown face (unit S5, FLOW-SHRUB-1a) ────────

/** One row scalar for the markdown face ('' shown honestly as `""`). */
function flowValue(v: FlowScalar): string {
  if (typeof v === 'string') return v === '' ? '""' : v.replace(/\s*\n\s*/g, ' ')
  return String(v)
}

/**
 * The board as "the beautiful navigable page a bare curl gets": one section
 * per table (ALL 13 — an empty table shows its honest zero, never vanishes),
 * rows as lists, each field in the vocabulary map's predicate order (nulls
 * skipped — SQL NULL is absence, not a value). Geometry is not shown: it is
 * scene, not resource, and this face renders the RESOURCE half only.
 */
function flowBoardMarkdown(resource: Extract<Resource, { kind: 'flow-board' }>): string {
  const total = FLOW_TABLES.reduce((n, spec) => n + resource.board[spec.ddl].length, 0)
  const lines: string[] = []
  lines.push(`# Flow board — ${resource.graphId}`)
  lines.push('')
  lines.push(
    `The Mithras Flow board of graph \`${resource.graphId}\`: ${total} rows across ` +
      `${FLOW_TABLES.length} tables. Subjects are minted under ` +
      `\`${flowGraphSubject(resource.graphId)}:projection:flow:\` (the same subjects the ` +
      `cell's \`:projection:flow\` lane holds). Geometry (x/y/width/height/waypoints) ` +
      `lives in the board's scene, never here.`,
  )
  lines.push('')
  lines.push(FLOW_TABLES.map((spec) => `[${spec.ddl}](#${spec.ddl})`).join(' · '))
  for (const spec of FLOW_TABLES) {
    const rows = resource.board[spec.ddl]
    lines.push('')
    lines.push(`## ${spec.ddl}`)
    lines.push('')
    lines.push(`**${rows.length} row${rows.length === 1 ? '' : 's'}** · class \`flow:${spec.pascal}\``)
    if (rows.length > 0) lines.push('')
    for (const row of rows) {
      const fields: string[] = []
      for (const pred of spec.predicates) {
        const v = row[pred.column]
        if (v === null || v === undefined) continue
        fields.push(
          pred.datatype === 'uri' ? `${pred.local}: \`${flowValue(v)}\`` : `${pred.local}: ${flowValue(v)}`,
        )
      }
      lines.push(`- \`${String(row.id)}\`${fields.length > 0 ? ` — ${fields.join(' · ')}` : ''}`)
    }
  }
  return lines.join('\n')
}

function classShort(persistence: string): string {
  switch (persistence) {
    case 'stamp': return 'A'
    case 'persistent-relocatable': return 'B'
    case 'persistent-non-relocatable': return 'C'
    default: return persistence
  }
}

function tick(b: boolean): string {
  return b ? 'yes' : 'no'
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export function renderHypertext(resource: Resource, ctx: RenderCtx): RenderedResource {
  const links = linksFor(resource, 'hypertext', ctx)

  let body: string
  switch (resource.kind) {
    case 'catalog':
      body = catalogMarkdown(resource, ctx)
      break
    case 'component':
      body = componentMarkdown(resource.component)
      break
    case 'workspace':
      body = workspaceMarkdown(resource)
      break
    case 'vocab-catalog':
      body = vocabCatalogMarkdown(resource, ctx)
      break
    case 'vocab-pack':
      body = vocabPackMarkdown(resource.pack, ctx)
      break
    case 'mem-plot':
      body = plotMarkdown(resource, ctx)
      break
    case 'mem-subject':
      body = subjectMarkdown(resource, ctx)
      break
    case 'mem-bouquet':
      body = bouquetMarkdown(resource, ctx)
      break
    case 'walk-index':
      body = walkIndexMarkdown(resource, ctx)
      break
    case 'walk-run':
      body = walkRunMarkdown(resource)
      break
    case 'tn-knob':
      body = knobMarkdown(resource, ctx)
      break
    case 'tn-greenhouse':
      body = greenhouseMarkdown(resource, ctx)
      break
    case 'kinded-value':
      body = kindedValueMarkdown(resource)
      break
    case 'flow-board':
      body = flowBoardMarkdown(resource)
      break
    default:
      assertNever(resource)
  }

  // Memory resources get an extra `?asof=` curl in the Navigate block — the whole
  // design point (the temporal lens); a WALK run gets the analogous `?turn=N` lens.
  // Both are query-param VIEWs of `self` (not new link-set members), so they do not
  // perturb the Link-set parity invariant.
  const extras = [...asofNavigate(resource, ctx), ...turnNavigate(resource, ctx)]
  const navigate = navigateBlock(links, extras)
  const full = `${body}\n\n## Navigate\n\n${navigate}\n`
  return { body: full, contentType: CONTENT_TYPE.hypertext, links }
}
