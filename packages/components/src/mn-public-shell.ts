/**
 * mn-public-shell - controlled read-only public workspace shell.
 *
 * Garden's original public shell owns public-token routes, Yjs blob decoding,
 * filesystem/document stores, HTTP reads, URL updates, clipboard, and graph-panel
 * store subscriptions. This Shrubbery lift keeps the user-facing public wiki surface
 * backend-free: callers provide navigation, document, and wire data; the element
 * renders the read-only shell and emits navigation/view/copy intents. Its graph
 * view is a deterministic projection of those same controlled props, never a
 * second hidden read path.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import type { MnGraphEdge } from './mn-graph.js'
import type { MnGraphPanelNode, MnGraphPanelNodeOpenDetail } from './mn-graph-panel.js'
import './mn-empty-state.js'
import './mn-graph-panel.js'
import './mn-loading.js'

export type MnPublicShellStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnPublicShellView = 'document' | 'graph'
export type MnPublicBlockType =
  | 'paragraph'
  | 'heading'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'table'
  | 'divider'
  | 'image'

export type MnPublicMarkType = 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'wikilink' | 'fontSize'

export interface MnPublicFolder {
  readonly id: string
  readonly label: string
  readonly parentId?: string | null
  readonly order?: number | null
}

export interface MnPublicDocumentSummary {
  readonly id: string
  readonly title: string
  readonly parentId?: string | null
  readonly order?: number | null
  readonly updatedAt?: number | string | Date | null
}

export interface MnPublicNav {
  readonly graphId?: string | null
  readonly title?: string | null
  readonly folders?: readonly MnPublicFolder[]
  readonly documents?: readonly MnPublicDocumentSummary[]
}

export interface MnPublicInlineMark {
  readonly type: MnPublicMarkType
  readonly start: number
  readonly end: number
  readonly href?: string | null
  readonly targetDocumentId?: string | null
  readonly label?: string | null
  readonly size?: string | null
}

export interface MnPublicTableCell {
  readonly isHeader?: boolean
  readonly content: string
  readonly marks?: readonly MnPublicInlineMark[]
  readonly colspan?: number | null
  readonly rowspan?: number | null
}

export interface MnPublicTableRow {
  readonly cells: readonly MnPublicTableCell[]
}

export interface MnPublicBlock {
  readonly id: string
  readonly type: MnPublicBlockType
  readonly content?: string | null
  readonly marks?: readonly MnPublicInlineMark[]
  readonly order?: number | null
  readonly level?: number | null
  readonly checked?: boolean | null
  readonly language?: string | null
  readonly src?: string | null
  readonly alt?: string | null
  readonly size?: 'small' | 'medium' | 'large' | string | null
  readonly rows?: readonly MnPublicTableRow[]
}

export interface MnPublicDocument {
  readonly id: string
  readonly title: string
  readonly blocks?: readonly MnPublicBlock[]
  readonly updatedAt?: number | string | Date | null
}

export interface MnPublicWire {
  readonly id: string
  readonly predicateLabel: string
  readonly otherDocumentId: string
  readonly otherTitle?: string | null
  readonly otherBlockId?: string | null
  readonly otherSnippet?: string | null
  readonly localBlockId?: string | null
}

export interface MnPublicWires {
  readonly wiredBlockIds?: readonly string[]
  readonly outgoing?: readonly MnPublicWire[]
  readonly incoming?: readonly MnPublicWire[]
}

export interface MnPublicShellOpenDocumentDetail {
  readonly documentId: string
  readonly blockId: string | null
  readonly source: 'nav' | 'wire' | 'wikilink' | 'graph'
}

export interface MnPublicShellViewDetail {
  readonly view: MnPublicShellView
}

export interface MnPublicShellCopyCodeDetail {
  readonly blockId: string
  readonly content: string
}

/** The honest graph slice derivable from one public-shell snapshot. */
export interface MnPublicGraphProjection {
  readonly nodes: readonly MnGraphPanelNode[]
  readonly edges: readonly MnGraphEdge[]
  readonly documentCount: number
  readonly wireCount: number
}

interface NavNode {
  readonly type: 'folder' | 'document'
  readonly id: string
  readonly label: string
  readonly order: number
  readonly children: NavNode[]
}

function text(value: string | null | undefined, fallback = ''): string {
  const trimmed = (value ?? '').trim()
  return trimmed || fallback
}

function orderOf(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function timestamp(value: number | string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatDate(value: number | string | Date | null | undefined): string {
  const ms = timestamp(value)
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function blockIdVariants(id: string | null | undefined): Set<string> {
  const raw = text(id)
  const variants = new Set<string>()
  if (!raw) return variants
  variants.add(raw)
  if (raw.startsWith('block-')) variants.add(raw.slice('block-'.length))
  else variants.add(`block-${raw}`)
  return variants
}

function safeHref(href: string | null | undefined): string | null {
  const raw = text(href)
  if (!raw) return null
  try {
    const parsed = new URL(raw, globalThis.location?.origin ?? 'https://example.invalid')
    const protocol = parsed.protocol.toLowerCase()
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? parsed.href : null
  } catch {
    return null
  }
}

function graphNodeId(kind: 'graph' | 'folder' | 'document', id: string): string {
  return `${kind}:${id}`
}

/**
 * Project the public navigation tree and the ACTIVE document's visible wire
 * bundle into the shared controlled graph vocabulary.
 *
 * The public API currently returns wires per document, not a workspace-wide
 * topology. Consequently this function deliberately draws every folder/document
 * containment edge from `nav`, but only wire edges present in `wires`. It never
 * implies that unloaded documents have no other connections.
 */
export function projectPublicShellGraph(
  nav: MnPublicNav | null | undefined,
  document: MnPublicDocument | null | undefined,
  wires: MnPublicWires | null | undefined,
): MnPublicGraphProjection {
  const folders = nav?.folders ?? []
  const documents = nav?.documents ?? []
  if (!nav && !document) return { nodes: [], edges: [], documentCount: 0, wireCount: 0 }

  const rootKey = text(nav?.graphId, text(nav?.title, 'public'))
  const rootId = graphNodeId('graph', rootKey)
  const nodes = new Map<string, MnGraphPanelNode>()
  const edges: MnGraphEdge[] = []
  const edgeKeys = new Set<string>()

  const addNode = (node: MnGraphPanelNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node)
  }
  const addEdge = (edge: MnGraphEdge): void => {
    const key = `${edge.kind ?? 'predicate'}\u0000${edge.from}\u0000${edge.predicate}\u0000${edge.to}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }
  const addDocument = (
    documentId: string,
    label?: string | null,
    note?: string,
  ): string | null => {
    const id = text(documentId)
    if (!id) return null
    const nodeId = graphNodeId('document', id)
    addNode({
      id: nodeId,
      label: text(label, id),
      note,
      kind: 'document',
      graphId: nav?.graphId ?? null,
      documentId: id,
      parentId: null,
      section: 'documents',
    })
    return nodeId
  }

  addNode({
    id: rootId,
    label: text(nav?.title, text(nav?.graphId, 'Public graph')),
    note: 'Published read-only graph',
    kind: 'graph',
    graphId: nav?.graphId ?? null,
  })

  const folderIds = new Set(folders.map((folder) => text(folder.id)).filter(Boolean))
  for (const folder of folders) {
    const id = text(folder.id)
    if (!id) continue
    addNode({
      id: graphNodeId('folder', id),
      label: text(folder.label, 'Untitled folder'),
      note: 'Public folder',
      kind: 'folder',
      graphId: nav?.graphId ?? null,
      folderId: id,
      parentId: text(folder.parentId) || null,
      section: 'documents',
    })
  }
  for (const folder of folders) {
    const id = text(folder.id)
    if (!id) continue
    const parentId = text(folder.parentId)
    addEdge({
      from: parentId && folderIds.has(parentId) ? graphNodeId('folder', parentId) : rootId,
      to: graphNodeId('folder', id),
      predicate: 'contains',
      kind: 'predicate',
    })
  }

  const navDocumentIds = new Set<string>()
  for (const summary of documents) {
    const id = text(summary.id)
    const nodeId = addDocument(id, summary.title, id === document?.id ? 'Current public document' : 'Public document')
    if (!nodeId) continue
    navDocumentIds.add(id)
    const parentId = text(summary.parentId)
    addEdge({
      from: parentId && folderIds.has(parentId) ? graphNodeId('folder', parentId) : rootId,
      to: nodeId,
      predicate: 'contains',
      kind: 'predicate',
    })
  }

  const activeDocumentId = text(document?.id)
  const activeNodeId = activeDocumentId
    ? addDocument(activeDocumentId, document?.title, 'Current public document')
    : null
  if (activeNodeId && !navDocumentIds.has(activeDocumentId)) {
    addEdge({ from: rootId, to: activeNodeId, predicate: 'contains', kind: 'predicate' })
  }

  if (activeNodeId) {
    for (const wire of wires?.outgoing ?? []) {
      const otherNodeId = addDocument(
        wire.otherDocumentId,
        wire.otherTitle,
        'Public document referenced by the current wire bundle',
      )
      if (!otherNodeId) continue
      addEdge({
        from: activeNodeId,
        to: otherNodeId,
        predicate: text(wire.predicateLabel, 'related'),
        kind: 'wire',
        note: wire.otherSnippet ?? undefined,
      })
    }
    for (const wire of wires?.incoming ?? []) {
      const otherNodeId = addDocument(
        wire.otherDocumentId,
        wire.otherTitle,
        'Public document referenced by the current wire bundle',
      )
      if (!otherNodeId) continue
      addEdge({
        from: otherNodeId,
        to: activeNodeId,
        predicate: text(wire.predicateLabel, 'related'),
        kind: 'wire',
        note: wire.otherSnippet ?? undefined,
      })
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    documentCount: [...nodes.values()].filter((node) => node.kind === 'document').length,
    wireCount: edges.filter((edge) => edge.kind === 'wire').length,
  }
}

@customElement('mn-public-shell')
export class MnPublicShell extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .shell {
      display: grid;
      grid-template-columns: 248px minmax(0, 1fr) minmax(240px, 300px);
      grid-template-rows: minmax(0, 1fr) 30px;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
    }

    .shell[data-wires='closed'] {
      grid-template-columns: 248px minmax(0, 1fr) 0;
    }

    .sidebar {
      grid-row: 1;
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f9fafb);
    }

    .sidebar-head {
      display: flex;
      min-height: 54px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-sizing: border-box;
    }

    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eef2ff);
      flex: 0 0 auto;
    }

    .workspace-title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .readonly {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border: 1px solid var(--mn-color-border-accent, #bfdbfe);
      border-radius: var(--mn-radius-sm, 4px);
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eff6ff);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .tree {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-2, 8px) 0;
    }

    .folder-button,
    .doc-button,
    .icon-button,
    .view-button,
    .wire-card,
    .copy-button {
      font: inherit;
    }

    .folder-button,
    .doc-button {
      display: flex;
      width: 100%;
      min-height: 30px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-3, 12px);
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
    }

    .folder-button:hover,
    .doc-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .doc-button[aria-current='page'] {
      background: var(--mn-color-surface-active, #e5e7eb);
      color: var(--mn-color-text-primary, #111827);
      font-weight: 700;
    }

    .chevron {
      display: inline-flex;
      color: var(--mn-color-text-tertiary, #6b7280);
      transition: transform 120ms ease;
    }

    .chevron[data-open='true'] {
      transform: rotate(90deg);
    }

    .children {
      padding-left: var(--mn-space-3, 12px);
    }

    .label {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .center {
      grid-row: 1;
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      overflow: hidden;
    }

    .center-bar {
      display: flex;
      min-height: 42px;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .view-button,
    .icon-button,
    .copy-button {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
    }

    .view-button,
    .copy-button {
      padding: 0 10px;
      font-size: var(--mn-text-xs, 12px);
    }

    .icon-button {
      width: 30px;
      padding: 0;
    }

    .view-button:hover,
    .icon-button:hover,
    .copy-button:hover {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .document-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .doc-head {
      display: flex;
      max-width: 860px;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--mn-space-4, 16px);
      padding: 46px 56px 24px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-sizing: border-box;
    }

    .doc-title {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: 32px;
      font-weight: 700;
      line-height: 1.15;
    }

    .updated {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .doc-body {
      max-width: 860px;
      padding: 30px 56px 68px;
      box-sizing: border-box;
    }

    .block {
      position: relative;
      margin: 0 -6px 2px;
      padding: 1px 6px;
      border-radius: var(--mn-radius-sm, 4px);
      box-sizing: border-box;
    }

    .block[data-wired='true']:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    p,
    blockquote,
    pre,
    .list-line {
      margin: 0 0 6px;
      line-height: 1.6;
    }

    .heading {
      margin: 22px 0 9px;
      font-family: var(--mn-font-serif, Georgia, serif);
      line-height: 1.2;
    }

    .heading[data-level='1'] { font-size: 26px; }
    .heading[data-level='2'] { font-size: 22px; }
    .heading[data-level='3'] { font-size: 18px; }

    .list-line {
      display: flex;
      gap: var(--mn-space-2, 8px);
      align-items: flex-start;
    }

    .marker {
      width: 22px;
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #6b7280);
      text-align: right;
    }

    .todo-box {
      display: inline-flex;
      width: 16px;
      height: 16px;
      align-items: center;
      justify-content: center;
      margin-top: 4px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: 4px;
      color: var(--mn-color-text-accent, #1d4ed8);
      flex: 0 0 auto;
    }

    .done {
      color: var(--mn-color-text-tertiary, #6b7280);
      text-decoration: line-through;
    }

    blockquote {
      padding-left: var(--mn-space-4, 16px);
      border-left: 3px solid var(--mn-color-border-default, #d1d5db);
      color: var(--mn-color-text-secondary, #374151);
      font-style: italic;
    }

    .code-wrap {
      position: relative;
      margin: var(--mn-space-3, 12px) 0;
    }

    pre {
      overflow: auto;
      padding: var(--mn-space-4, 16px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-sunken, #f9fafb);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      white-space: pre-wrap;
    }

    .copy-button {
      position: absolute;
      top: 8px;
      right: 8px;
      min-height: 26px;
      background: var(--mn-color-surface-raised, #fff);
    }

    .inline-code {
      padding: 1px 4px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.92em;
    }

    mark {
      border-radius: 3px;
      background: var(--mn-color-highlight, #fef3c7);
    }

    a {
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .wikilink {
      border: 0;
      background: transparent;
      color: var(--mn-color-text-accent, #1d4ed8);
      font: inherit;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
    }

    .table-wrap {
      overflow: auto;
      margin: var(--mn-space-3, 12px) 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mn-text-sm, 13px);
    }

    td,
    th {
      padding: 8px 10px;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      text-align: left;
      vertical-align: top;
    }

    th {
      background: var(--mn-color-surface-sunken, #f9fafb);
      font-weight: 700;
    }

    .divider {
      height: 1px;
      margin: var(--mn-space-4, 16px) 0;
      border: 0;
      background: var(--mn-color-border-subtle, #e5e7eb);
    }

    .image {
      margin: var(--mn-space-4, 16px) 0;
    }

    .image img {
      max-width: 100%;
      border-radius: var(--mn-radius-md, 8px);
    }

    .wire-dot {
      position: absolute;
      top: 7px;
      left: -22px;
      display: inline-flex;
      width: 17px;
      height: 17px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--mn-color-border-accent, #bfdbfe);
      border-radius: 999px;
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .graph-slot {
      display: grid;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }

    .wires {
      grid-row: 1;
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, #fff);
      overflow: hidden;
    }

    .wires[hidden] {
      display: none;
    }

    .wires-head {
      display: flex;
      min-height: 42px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-sizing: border-box;
      font-weight: 700;
    }

    .count {
      display: inline-flex;
      min-width: 20px;
      height: 20px;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #374151);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      font-size: var(--mn-text-2xs, 10px);
      box-sizing: border-box;
    }

    .wires-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-3, 12px);
    }

    .wire-section {
      margin: var(--mn-space-3, 12px) 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .wire-card {
      display: block;
      width: 100%;
      margin: 0 0 var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
    }

    .wire-card:hover {
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .predicate {
      color: var(--mn-color-text-accent, #1d4ed8);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 800;
      text-transform: uppercase;
    }

    .wire-title {
      margin-top: 3px;
      font-weight: 700;
    }

    .snippet {
      margin-top: 4px;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .footer {
      grid-column: 1 / -1;
      grid-row: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-tertiary, #6b7280);
      background: var(--mn-color-surface-sunken, #f9fafb);
      font-size: var(--mn-text-2xs, 10px);
    }

    .state {
      display: grid;
      min-height: 260px;
      place-items: center;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
    }

    @media (max-width: 760px) {
      .shell,
      .shell[data-wires='closed'] {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .sidebar {
        grid-row: 1;
        max-height: 34vh;
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }

      .center {
        grid-row: 2;
      }

      .wires {
        display: none;
      }

      .footer {
        grid-row: 3;
      }

      .doc-head {
        padding: 28px 24px 18px;
      }

      .doc-body {
        padding: 24px 24px 54px;
      }

      .doc-title {
        font-size: 26px;
      }

      .wire-dot {
        left: auto;
        right: -18px;
      }
    }
  `

  @property({ type: String }) status: MnPublicShellStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: String }) view: MnPublicShellView = 'document'
  @property({ attribute: false }) nav: MnPublicNav | null = null
  @property({ attribute: false }) document: MnPublicDocument | null = null
  @property({ attribute: false }) wires: MnPublicWires | null = null
  @state() private _expandedFolders = new Set<string>()
  @state() private _wiresOpen = true

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _graphTitle(): string {
    return text(this.nav?.title, text(this.nav?.graphId, 'Public graph'))
  }

  private _activeDocumentId(): string {
    return text(this.document?.id)
  }

  private _tree(): NavNode[] {
    const folders = this.nav?.folders ?? []
    const docs = this.nav?.documents ?? []
    const folderMap = new Map<string, NavNode>()
    const roots: NavNode[] = []

    for (const folder of folders) {
      folderMap.set(folder.id, {
        type: 'folder',
        id: folder.id,
        label: text(folder.label, 'Untitled folder'),
        order: orderOf(folder.order),
        children: [],
      })
    }

    for (const folder of folders) {
      const node = folderMap.get(folder.id)
      if (!node) continue
      const parent = text(folder.parentId)
      if (parent && folderMap.has(parent)) folderMap.get(parent)!.children.push(node)
      else roots.push(node)
    }

    for (const doc of docs) {
      const node: NavNode = {
        type: 'document',
        id: doc.id,
        label: text(doc.title, 'Untitled'),
        order: orderOf(doc.order),
        children: [],
      }
      const parent = text(doc.parentId)
      if (parent && folderMap.has(parent)) folderMap.get(parent)!.children.push(node)
      else roots.push(node)
    }

    const sort = (nodes: NavNode[]): void => {
      nodes.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      for (const node of nodes) sort(node.children)
    }
    sort(roots)
    return roots
  }

  private _toggleFolder(id: string): void {
    const next = new Set(this._expandedFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this._expandedFolders = next
  }

  private _openDocument(documentId: string, blockId: string | null, source: MnPublicShellOpenDocumentDetail['source']): void {
    this._emit<MnPublicShellOpenDocumentDetail>('mn-public-shell-open-document', {
      documentId,
      blockId,
      source,
    })
  }

  private _setView(view: MnPublicShellView): void {
    this.view = view
    this._emit<MnPublicShellViewDetail>('mn-public-shell-view-change', { view })
  }

  private _openGraphNode(event: CustomEvent<MnGraphPanelNodeOpenDetail>): void {
    const documentId = text(event.detail.node.documentId)
    if (!documentId) return
    this._setView('document')
    this._openDocument(documentId, null, 'graph')
  }

  private _renderGraph(): TemplateResult {
    const projection = projectPublicShellGraph(this.nav, this.document, this.wires)
    const documentLabel = projection.documentCount === 1 ? 'document' : 'documents'
    const wireLabel = projection.wireCount === 1 ? 'visible connection' : 'visible connections'
    return html`
      <slot
        name="graph"
        @mn-graph-panel-node-open=${this._openGraphNode}
        @mn-graph-panel-refresh=${() => this._emit('mn-public-shell-refresh', {})}
      >
        <mn-graph-panel
          title="Public Graph"
          subtitle=${`${projection.documentCount} ${documentLabel} · ${projection.wireCount} ${wireLabel}`}
          status="ready"
          .nodes=${projection.nodes}
          .edges=${projection.edges}
        ></mn-graph-panel>
      </slot>
    `
  }

  private _wiredBlockIds(): Set<string> {
    const wired = new Set<string>()
    const add = (id: string | null | undefined): void => {
      for (const variant of blockIdVariants(id)) wired.add(variant)
    }
    for (const id of this.wires?.wiredBlockIds ?? []) add(id)
    for (const wire of this.wires?.outgoing ?? []) add(wire.localBlockId)
    for (const wire of this.wires?.incoming ?? []) add(wire.localBlockId)
    return wired
  }

  private _markText(content: string, marks: readonly MnPublicInlineMark[] = []): unknown {
    if (!marks.length) return content
    const positions = new Set<number>([0, content.length])
    for (const mark of marks) {
      if (mark.start >= 0 && mark.end <= content.length && mark.start < mark.end) {
        positions.add(mark.start)
        positions.add(mark.end)
      }
    }
    const sorted = [...positions].sort((a, b) => a - b)
    const segments: unknown[] = []
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i]
      const end = sorted[i + 1]
      const piece = content.slice(start, end)
      if (!piece) continue
      const active = marks.filter((mark) => mark.start <= start && mark.end >= end)
      let rendered: unknown = piece
      for (const mark of active) {
        switch (mark.type) {
          case 'bold':
            rendered = html`<strong>${rendered}</strong>`
            break
          case 'italic':
            rendered = html`<em>${rendered}</em>`
            break
          case 'strike':
            rendered = html`<s>${rendered}</s>`
            break
          case 'code':
            rendered = html`<code class="inline-code">${rendered}</code>`
            break
          case 'highlight':
            rendered = html`<mark>${rendered}</mark>`
            break
          case 'link': {
            const href = safeHref(mark.href)
            if (href) rendered = html`<a href=${href} target="_blank" rel="noopener noreferrer">${rendered}</a>`
            break
          }
          case 'wikilink':
            if (mark.targetDocumentId) {
              const id = mark.targetDocumentId
              rendered = html`<button class="wikilink" type="button" @click=${() => this._openDocument(id, null, 'wikilink')}>${rendered}</button>`
            }
            break
          case 'fontSize':
            if (mark.size) rendered = html`<span style=${`font-size:${mark.size}`}>${rendered}</span>`
            break
        }
      }
      segments.push(rendered)
    }
    return segments
  }

  private _renderBlock(block: MnPublicBlock, index: number): TemplateResult {
    const content = text(block.content)
    const marked = this._markText(content, block.marks)
    switch (block.type) {
      case 'heading': {
        const level = Math.min(Math.max(block.level ?? 1, 1), 3)
        if (level === 1) return html`<h1 class="heading" data-level="1">${marked}</h1>`
        if (level === 2) return html`<h2 class="heading" data-level="2">${marked}</h2>`
        return html`<h3 class="heading" data-level="3">${marked}</h3>`
      }
      case 'bullet':
        return html`<div class="list-line"><span class="marker">•</span><span>${marked}</span></div>`
      case 'numbered':
        return html`<div class="list-line"><span class="marker">${index + 1}.</span><span>${marked}</span></div>`
      case 'todo':
        return html`<div class="list-line">
          <span class="todo-box">${block.checked ? icon('check', { size: 12 }) : nothing}</span>
          <span class=${block.checked ? 'done' : ''}>${marked}</span>
        </div>`
      case 'quote':
        return html`<blockquote>${marked}</blockquote>`
      case 'code':
        return html`<div class="code-wrap">
          <pre><code>${content}</code></pre>
          <button class="copy-button" type="button" @click=${() => this._emit<MnPublicShellCopyCodeDetail>('mn-public-shell-copy-code', { blockId: block.id, content })}>
            ${icon('copy', { size: 12 })} Copy
          </button>
        </div>`
      case 'table':
        return html`<div class="table-wrap"><table><tbody>
          ${(block.rows ?? []).map((row) => html`<tr>
            ${row.cells.map((cell) => {
              const cellText = this._markText(cell.content, cell.marks)
              return cell.isHeader
                ? html`<th colspan=${cell.colspan ?? 1} rowspan=${cell.rowspan ?? 1}>${cellText}</th>`
                : html`<td colspan=${cell.colspan ?? 1} rowspan=${cell.rowspan ?? 1}>${cellText}</td>`
            })}
          </tr>`)}
        </tbody></table></div>`
      case 'divider':
        return html`<hr class="divider">`
      case 'image':
        return html`<figure class="image" data-size=${block.size ?? 'large'}>
          ${block.src ? html`<img src=${block.src} alt=${block.alt ?? ''} loading="lazy">` : nothing}
        </figure>`
      case 'paragraph':
      default:
        return content ? html`<p>${marked}</p>` : html`<div style="height:12px"></div>`
    }
  }

  private _renderNavNode(node: NavNode): TemplateResult {
    if (node.type === 'folder') {
      const open = this._expandedFolders.has(node.id)
      return html`<div>
        <button class="folder-button" type="button" aria-expanded=${String(open)} @click=${() => this._toggleFolder(node.id)}>
          <span class="chevron" data-open=${String(open)}>${icon('chevron-right', { size: 13 })}</span>
          ${icon(open ? 'folder-open' : 'folder', { size: 14 })}
          <span class="label">${node.label}</span>
        </button>
        ${open ? html`<div class="children">${node.children.map((child) => this._renderNavNode(child))}</div>` : nothing}
      </div>`
    }
    return html`<button
      class="doc-button"
      type="button"
      aria-current=${this._activeDocumentId() === node.id ? 'page' : nothing}
      data-document-id=${node.id}
      @click=${() => this._openDocument(node.id, null, 'nav')}
    >
      ${icon('file-text', { size: 14 })}
      <span class="label">${node.label}</span>
    </button>`
  }

  private _renderDocument(): TemplateResult {
    if (!this.document) {
      return html`<div class="state">
        <mn-empty-state icon="file-text" title="Select a document" description="Choose a public document from the sidebar." variant="compact"></mn-empty-state>
      </div>`
    }
    const blocks = [...(this.document.blocks ?? [])].sort((a, b) => orderOf(a.order) - orderOf(b.order))
    const wired = this._wiredBlockIds()
    const updated = formatDate(this.document.updatedAt)
    return html`<div class="document-scroll">
      <header class="doc-head">
        <h1 class="doc-title">${this.document.title}</h1>
        ${updated ? html`<span class="updated">Last modified ${updated}</span>` : nothing}
      </header>
      <div class="doc-body">
        ${blocks.length
          ? repeat(blocks, (block) => block.id, (block, index) => {
              const isWired = blockIdVariants(block.id).size > 0 && [...blockIdVariants(block.id)].some((id) => wired.has(id))
              return html`<div
                class="block"
                data-block-id=${block.id}
                data-wired=${String(isWired)}
                style=${block.type !== 'heading' && block.level ? `padding-left:${block.level * 20}px` : ''}
              >
                ${isWired ? html`<span class="wire-dot" title="This block has connections">${icon('wire', { size: 10 })}</span>` : nothing}
                ${this._renderBlock(block, index)}
              </div>`
            })
          : html`<mn-empty-state icon="file-text" title="No content" description="This public document has no rendered blocks." variant="compact"></mn-empty-state>`}
      </div>
    </div>`
  }

  private _renderWire(wire: MnPublicWire, direction: 'out' | 'in'): TemplateResult {
    const title = text(wire.otherTitle, wire.otherDocumentId)
    return html`<button
      class="wire-card"
      type="button"
      data-wire-id=${wire.id}
      @click=${() => this._openDocument(wire.otherDocumentId, wire.otherBlockId ?? null, 'wire')}
    >
      <div class="predicate">${direction === 'out' ? 'Outgoing' : 'Incoming'} · ${wire.predicateLabel}</div>
      <div class="wire-title">${title}</div>
      ${wire.otherSnippet ? html`<div class="snippet">${wire.otherSnippet}</div>` : nothing}
    </button>`
  }

  private _renderWires(): TemplateResult {
    const outgoing = this.wires?.outgoing ?? []
    const incoming = this.wires?.incoming ?? []
    const total = outgoing.length + incoming.length
    return html`<aside class="wires" aria-label="Public connections" ?hidden=${!this._wiresOpen}>
      <header class="wires-head">
        ${icon('wire', { size: 15 })}
        <span style="flex:1">Connections</span>
        <span class="count">${total}</span>
        <button class="icon-button" type="button" aria-label="Hide connections" @click=${() => { this._wiresOpen = false }}>
          ${icon('x', { size: 14 })}
        </button>
      </header>
      <div class="wires-body">
        ${total === 0
          ? html`<mn-empty-state icon="wire" title="No connections" description="No public wires are available for this document." variant="compact"></mn-empty-state>`
          : [
              outgoing.length
                ? [html`<div class="wire-section">Outgoing</div>`, ...outgoing.map((wire) => this._renderWire(wire, 'out'))]
                : nothing,
              incoming.length
                ? [html`<div class="wire-section">Incoming</div>`, ...incoming.map((wire) => this._renderWire(wire, 'in'))]
                : nothing,
            ]}
      </div>
    </aside>`
  }

  private _renderReady(): TemplateResult {
    const tree = this._tree()
    return html`<div class="shell" data-wires=${this._wiresOpen ? 'open' : 'closed'}>
      <nav class="sidebar" aria-label="Public documents">
        <header class="sidebar-head">
          <span class="brand-mark">${icon('sprout', { size: 16 })}</span>
          <span class="workspace-title">${this._graphTitle()}</span>
          <span class="readonly">read-only</span>
        </header>
        <div class="tree">
          ${tree.length
            ? tree.map((node) => this._renderNavNode(node))
            : html`<mn-empty-state icon="folder" title="No documents" description="This public graph has no visible documents." variant="compact"></mn-empty-state>`}
        </div>
      </nav>
      <main class="center">
        <div class="center-bar">
          ${!this._wiresOpen ? html`<button class="view-button" type="button" @click=${() => { this._wiresOpen = true }}>
            ${icon('wire', { size: 13 })} Connections
          </button>` : nothing}
          <button
            class="view-button"
            type="button"
            data-view-toggle
            aria-label=${this.view === 'document' ? 'Show graph view' : 'Show document view'}
            aria-pressed=${String(this.view === 'graph')}
            @click=${() => this._setView(this.view === 'document' ? 'graph' : 'document')}
          >
            ${this.view === 'document' ? icon('network', { size: 13 }) : icon('file-text', { size: 13 })}
            ${this.view === 'document' ? 'Graph view' : 'Document view'}
          </button>
          <button class="icon-button" type="button" aria-label="Refresh public workspace" @click=${() => this._emit('mn-public-shell-refresh', {})}>
            ${icon('refresh-cw', { size: 14 })}
          </button>
        </div>
        ${this.view === 'graph'
          ? html`<div class="graph-slot" role="region" aria-label="Public graph">${this._renderGraph()}</div>`
          : this._renderDocument()}
      </main>
      ${this._renderWires()}
      <footer class="footer">Garden public graph view by Sophia Labs</footer>
    </div>`
  }

  render(): TemplateResult {
    if (this.status === 'loading' || this.status === 'idle') {
      return html`<div class="state"><mn-loading size="md" text="Loading public workspace"></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`<div class="state">
        <mn-empty-state icon="alert-circle" title="Public workspace unavailable" description=${this.error || 'The public workspace could not be loaded.'} mood="danger"></mn-empty-state>
      </div>`
    }
    return this._renderReady()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-public-shell': MnPublicShell
  }
}
