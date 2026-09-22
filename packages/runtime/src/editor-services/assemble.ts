/**
 * assemble.ts — the EditorServices BUNDLE + the boundary adapter to the pure kernel.
 *
 * EditorServices is a host-side PROJECTION over the contract (the `asReactiveStore` move,
 * but at the editor-seam boundary): it takes the broad ShrubberyContract surface (here:
 * `rest` for reads + `wire` for the cell-faithful wire-write seam) + a scope getter and
 * hands the host a small, editor-shaped set of services (navigation / wikilink-search /
 * wire). Each service is STATELESS over its (contract-slice, getScope) and reads
 * getScope().graphId AT CALL TIME — so a single assembled bundle stays correct as the open
 * document changes underneath it. wikiLinkSearch reads via rest.query (pure projection
 * reads pass the authority gate); wire writes go via contract.wire (workspace-CRDT, NOT
 * rest.update raw projection SPARQL which a real cell rejects).
 *
 *   assembleEditorServices(rest, wire, getScope, navigation?) → EditorServices
 *   buildKernelOptions(services, scope)                       → Pick<KernelOptions, navigation callbacks>
 *
 * buildKernelOptions is the boundary adapter (the asReactiveStore analogue for the kernel
 * seam): it turns the EditorServices into the pure navigation callbacks the kernel
 * accepts as plain KernelOptions. The kernel imports ONLY @tiptap/*; these adapters
 * are injected as callbacks, never imported by the kernel. CRITICALLY, buildKernelOptions
 * NEVER sets `collaborative` (or any other kernel mode) — the history-ownership / collab
 * decision is the host's, made elsewhere (the live-editor plane), not smuggled in through
 * this boundary.
 *
 * NO ADAPTERS YET beyond these interfaces + the boundary: this rung defines the ontology
 * (interfaces + the assemble/build functions). The shell wiring (a real NavigationService
 * listener, mounting buildKernelOptions into a live editor) is a LATER rung.
 *
 * ISLAND NOTE: editor-services/ subdir — outside the non-recursive island scan (like
 * collab/). Imports @shrubbery/nucleus + @shrubbery/editor-kernel (types) + sibling .js.
 */

import type { RestClient, EditorScope, WireWriter } from '@shrubbery/nucleus'
import type {
  CitationAttrs,
  KernelOptions,
  MarginGlossOpenTarget,
  QueryBlockRenderer,
  WikiLinkAttrs,
} from '@shrubbery/editor-kernel'
import {
  type NavigationService,
  eventNavigationService,
} from './navigation-service.js'
import {
  type WikiLinkSearchService,
  makeWikiLinkSearchService,
} from './wikilink-search-service.js'
import {
  type WikiLinkBlockSearchService,
  makeWikiLinkBlockSearchService,
} from './wikilink-block-search-service.js'
import {
  type TagSearchService,
  makeTagSearchService,
} from './tag-search-service.js'
import { type WireService, makeWireService } from './wire-service.js'
import {
  makeQueryBlockRenderer,
  makeQueryBlockService,
  type QueryBlockService,
} from './query-block-service.js'
import { defaultMermaidRenderHost } from './mermaid-renderer.js'

/** The editor-shaped service bundle the host consumes (the projection over the contract). */
export interface EditorServices {
  readonly navigation: NavigationService
  readonly wikiLinkSearch: WikiLinkSearchService
  readonly wikiLinkBlocks: WikiLinkBlockSearchService
  readonly tagSearch: TagSearchService
  readonly wire: WireService
  readonly queryBlocks: QueryBlockService
}

/**
 * Assemble the EditorServices over the contract's RestClient (reads) + WireWriter (the
 * cell-faithful wire-write seam) + a scope getter. The NavigationService defaults to
 * eventNavigationService (CustomEvent dispatch; real shell wiring deferred). Search is
 * built over (rest, getScope); wire over (wire, getScope) — both stateless, scope read
 * at call time.
 */
export function assembleEditorServices(
  rest: RestClient,
  wire: WireWriter,
  getScope: () => EditorScope,
  navigation: NavigationService = eventNavigationService(),
): EditorServices {
  return {
    navigation,
    wikiLinkSearch: makeWikiLinkSearchService(rest, getScope),
    wikiLinkBlocks: makeWikiLinkBlockSearchService(rest, getScope),
    tagSearch: makeTagSearchService(rest, getScope),
    wire: makeWireService(wire, getScope),
    queryBlocks: makeQueryBlockService(rest),
  }
}

/**
 * The BOUNDARY ADAPTER: project EditorServices (+ the scope at build time) into the pure
 * kernel's navigation callbacks. Returns ONLY editor navigation callbacks — NEVER
 * `collaborative` or any other kernel mode (that decision is the host's, made elsewhere).
 *
 *   - onWikiLinkClick(attrs): navigate to the link target. graphId from the attrs' own
 *     targetGraphId when present, else the build-time scope's graphId (same-graph links).
 *   - onWikiLinkDelete(attrs): if the deleted node carried a wireId, delete that wire
 *     (the cleanup garden did via wireStore.deleteWire). No wireId ⇒ nothing to clean up.
 *
 * Fire-and-forget on the async wire delete (the kernel callback is sync) — a delete
 * failure surfaces through the RestClient, it never blocks the editor edit.
 */
export function buildKernelOptions(
  services: EditorServices,
  scope: EditorScope,
): Pick<
  KernelOptions,
  | 'onWikiLinkClick'
  | 'onWikiLinkDelete'
  | 'onCitationClick'
  | 'onMarginGlossOpen'
  | 'renderQueryBlock'
  | 'getGraphId'
  | 'mermaid'
> {
  return {
    onWikiLinkClick: (attrs: WikiLinkAttrs): void => {
      const graphId = attrs.targetGraphId ?? scope.graphId
      if (!graphId) return // no target graph resolvable — honest no-op
      services.navigation.openDocument(graphId, attrs.targetDocId, attrs.targetBlockId ?? undefined)
    },
    onWikiLinkDelete: (attrs: WikiLinkAttrs): void => {
      if (!attrs.wireId) return // no wire recorded ⇒ nothing to clean up
      void services.wire.delete(attrs.wireId)
    },
    onCitationClick: (attrs: CitationAttrs): void => {
      if (!attrs.artifactId || !attrs.zoteroKey) return
      services.navigation.openZoteroSource(attrs.artifactId, attrs.zoteroKey)
    },
    onMarginGlossOpen: (target: MarginGlossOpenTarget): void => {
      services.navigation.openDocument(target.graphId, target.documentId, target.blockId)
    },
    renderQueryBlock: makeQueryBlockRenderer(services.queryBlocks) as QueryBlockRenderer,
    getGraphId: () => scope.graphId,
    mermaid: defaultMermaidRenderHost,
  }
}
