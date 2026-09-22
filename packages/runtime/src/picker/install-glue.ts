/**
 * picker/install-glue.ts — installWikiLinkPickerGlue: the SHIPPED shell-side listener
 * that closes the wikilink picker causal chain in running code.
 *
 * THE CHAIN this glue completes (keystroke → graph → node + wire), all through SHIPPED
 * surfaces, no mock on the axis that matters:
 *
 *   1. The kernel dispatches `open-wikilink-picker` from the owning EditorView's
 *      document. Autocomplete opens carry the query/range; toolbar opens may not. Scope
 *      still comes from `getScope()` (the SAME closure assembleEditorServices used),
 *      while viewport geometry comes through the public editor handle's caret anchor.
 *   2. onOpen: honest no-op when nothing is open (no graphId / no documentId — a wire has
 *      nothing to source from, and wikiLinkSearch returns [] for a null graphId anyway).
 *   3. `services.wikiLinkSearch.suggest(query)` over the REAL store (rest.query →
 *      GRAPH-scoped SELECT against the cell's :projection:workspace — the real
 *      makeWikiLinkSearchService).
 *   4. The shared candidate picker supports document, block, and predicate phases. Every
 *      editor-anchored surface (wikilink, tag, slash, block/document wire, existing-wire
 *      menu) is positioned BEFORE render by one caret/pointer-aware clamp/flip policy.
 *      Happy DOM proves the pure geometry; real Chromium proves the rendered contract.
 *   5. On select (WIRE-FIRST ORDER, matching garden document-editor.ts): the WireService
 *      MINTS the id and RETURNS it — `const { wireId } = await services.wire.create({
 *      sourceDocumentId, targetDocumentId })` (the real LoopbackWireWriter → create_wires
 *      MCP, cell-faithful) — THEN insert the node carrying the SAME id through the SHIPPED
 *      public host handle: `getEditor()?.insertWikiLink({ targetDocId, label,
 *      targetGraphId, wireId })`. So node.wireId === the wire's id and onWikiLinkDelete
 *      can clean up.
 *
 * WHY THIS FILE LIVES IN A SUBDIR (picker/), NOT top-level src/:
 * the island guard (render-workspace-island.test.ts) scans ONLY the TOP-LEVEL
 * runtime/src/*.ts files (non-recursive readdirSync) and forbids non-(lit|nucleus|
 * sibling.js) imports + backend-coupling tokens there. The picker glue needs the
 * EditorServices types (@shrubbery/nucleus is allowed) + the live-editor handle alias
 * (a sibling collab/ re-export) — both island-legal — but it is quarantined to this
 * subdir exactly like collab/ and editor-services/ so the top-level island stays intact.
 * It is re-exported from index.ts and the SHELL (apps/organism/src/main.ts) calls it.
 *
 * NEVER in the kernel (purity grep stays exit-1) and NEVER in a top-level runtime/src/
 * *.ts file (island guard).
 */

import { html, render, nothing } from 'lit'
import {
  DEFAULT_WIRE_PREDICATE_URI,
  PREDICATE_GROUPS,
  getAllWirePredicates,
  getWirePredicateCategory,
  type EditorScope,
} from '@shrubbery/nucleus'
import {
  CLOSE_TAG_PICKER_EVENT,
  CLOSE_SLASH_COMMAND_EVENT,
  CLOSE_WIKILINK_PICKER_EVENT,
  EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
  OPEN_CITATION_PICKER_EVENT,
  OPEN_SLASH_COMMAND_EVENT,
  OPEN_TAG_PICKER_EVENT,
  OPEN_WIKILINK_PICKER_EVENT,
  SCHEDULED_TAGS,
  filterSlashCommands,
  todayKey,
  type EditorKeyboardWireRequestDetail,
  type OpenTagPickerDetail,
  type OpenSlashCommandDetail,
  type OpenWikiLinkPickerDetail,
  type SlashCommandItem,
  type TagSuggestion,
} from '@shrubbery/editor-kernel'
import type { EditorServices } from '../editor-services/index.js'
import type { WikiLinkSuggestionItem } from '../editor-services/index.js'
// The OPAQUE live-editor handle the host exposes (getText/destroy/insertWikiLink), via
// the sibling collab module's alias — never an @shrubbery/editor-kernel import here.
import type {
  LiveCitationAttrs,
  LiveSlashCommandId,
  LiveTagChipAttrs,
  LiveWikiLinkAttrs,
} from '../collab/live-editor.js'
import type { BlockWireMenuRequestDetail, BlockWireRequestDetail } from '../editor-host.js'
import type { WireSummary } from '../editor-services/index.js'
import {
  WIRE_DOCUMENT_REQUEST_EVENT,
  type DocumentWireRequestDetail,
} from '../wire-events.js'

/** The minimal structural live-editor handle the glue needs (the host's liveEditor). */
export interface PickerEditorHandle {
  getActiveBlockId?(): string | null
  insertWikiLink(attrs: LiveWikiLinkAttrs): boolean
  insertCitation?(attrs: LiveCitationAttrs): boolean
  insertWikiLinkAt?(range: { from: number; to: number }, attrs: LiveWikiLinkAttrs): boolean
  insertTagChipAt?(range: { from: number; to: number }, attrs: LiveTagChipAttrs): boolean
  insertTagTextAt?(range: { from: number; to: number }, name: string): boolean
  runSlashCommandAt?(range: { from: number; to: number }, commandId: LiveSlashCommandId): Promise<boolean>
}

export interface CitationPickerItem {
  readonly key: string
  readonly title: string
  readonly citation?: string | null
  readonly itemType?: string | null
  readonly creatorSummary?: string | null
  readonly year?: string | null
}

export interface CitationMaterializedSource {
  readonly artifactId: string
}

export interface CitationGroundingRequest {
  readonly graphId: string
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string | null
  readonly targetArtifactId: string
}

export interface CitationPickerService {
  search(query: string): Promise<readonly CitationPickerItem[]>
  materialize(item: CitationPickerItem): Promise<CitationMaterializedSource>
  ground(request: CitationGroundingRequest): Promise<void>
}

/** What installWikiLinkPickerGlue needs to wire the full causal chain. */
export interface InstallPickerGlueOptions {
  /** Returns the live editor handle (host.liveEditor) at call time, or null if none. */
  readonly getEditor: () => PickerEditorHandle | null
  /** The assembled EditorServices (real wikiLinkSearch over the store + real wire). */
  readonly services: EditorServices
  /** Optional shell-owned Zotero citation service. When absent, citation picker is disabled. */
  readonly citation?: CitationPickerService
  /** The scope getter (same closure assembleEditorServices was built with). */
  readonly getScope: () => EditorScope
  /**
   * Current editor caret/selection anchor in viewport coordinates. Anchored
   * popovers use this when the invoking event has no pointer coordinates.
   */
  readonly getAnchorRect?: () => EditorOverlayAnchorRect | null
  /** The document the listener attaches to (default globalThis.document). */
  readonly document?: Document
  /**
   * Where the candidate dropdown mounts (default: a div appended to document.body).
   * Injectable so a test can drive the dropdown in a known container.
   */
  readonly mountInto?: HTMLElement
  /**
   * The query to seed the search with (default ''). The kernel event carries no query;
   * a richer shell can override per-open. Phase-1 fetches the full list then re-filters
   * locally as the user types into the dropdown's input.
   */
  readonly initialQuery?: string
  /**
   * Host-local signal for transient picker/menus. The shell can feed this into the
   * editor kernel's pure Escape gate without coupling this glue to editor-kernel.
   */
  readonly onOverlayOpenChange?: (open: boolean) => void
}

export interface EditorOverlayAnchorRect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface EditorOverlayViewport {
  readonly width: number
  readonly height: number
  /** Visual-viewport origin in layout-viewport coordinates (mobile keyboard/pan). */
  readonly left?: number
  readonly top?: number
}

export interface EditorOverlaySize {
  readonly width: number
  readonly height: number
}

export interface EditorOverlayPlacement {
  readonly left: number
  readonly top: number
  readonly side: 'below' | 'above' | 'fallback'
}

const OVERLAY_MARGIN = 12
const OVERLAY_GAP = 8
const PICKER_SIZE: EditorOverlaySize = { width: 360, height: 420 }
const COMPACT_POPOVER_SIZE: EditorOverlaySize = { width: 320, height: 320 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * One viewport-coordinate policy for every editor-anchored transient surface.
 * It prefers below the caret/pointer, flips above when necessary, and clamps
 * both axes. Missing geometry falls back to an intentional upper-center
 * position rather than the accidental viewport origin.
 */
export function placeEditorOverlay(
  anchor: EditorOverlayAnchorRect | null,
  viewport: EditorOverlayViewport,
  size: EditorOverlaySize,
): EditorOverlayPlacement {
  const viewportLeft = Number.isFinite(viewport.left) ? viewport.left! : 0
  const viewportTop = Number.isFinite(viewport.top) ? viewport.top! : 0
  const width = Math.max(1, Math.min(size.width, viewport.width - OVERLAY_MARGIN * 2))
  const height = Math.max(1, Math.min(size.height, viewport.height - OVERLAY_MARGIN * 2))
  const minLeft = viewportLeft + OVERLAY_MARGIN
  const minTop = viewportTop + OVERLAY_MARGIN
  const maxLeft = viewportLeft + viewport.width - width - OVERLAY_MARGIN
  const maxTop = viewportTop + viewport.height - height - OVERLAY_MARGIN

  if (!anchor) {
    return {
      left: clamp(viewportLeft + (viewport.width - width) / 2, minLeft, maxLeft),
      top: clamp(viewportTop + viewport.height * 0.18, minTop, maxTop),
      side: 'fallback',
    }
  }

  const below = anchor.bottom + OVERLAY_GAP
  const above = anchor.top - height - OVERLAY_GAP
  const fitsBelow = below + height <= viewportTop + viewport.height - OVERLAY_MARGIN
  const fitsAbove = above >= minTop
  return {
    left: clamp(anchor.left, minLeft, maxLeft),
    top: fitsBelow
      ? below
      : fitsAbove
        ? above
        : clamp(below, minTop, maxTop),
    side: fitsBelow ? 'below' : fitsAbove ? 'above' : 'below',
  }
}

function pointAnchor(clientX: number | undefined, clientY: number | undefined): EditorOverlayAnchorRect | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  // 0/0 is the explicit sentinel used by keyboard-originated wire requests.
  if (clientX === 0 && clientY === 0) return null
  const x = clientX as number
  const y = clientY as number
  return { left: x, right: x, top: y, bottom: y }
}

function currentAnchor(
  opts: InstallPickerGlueOptions,
  point?: { readonly clientX?: number; readonly clientY?: number },
): EditorOverlayAnchorRect | null {
  const pointer = pointAnchor(point?.clientX, point?.clientY)
  if (pointer) return pointer
  try {
    return opts.getAnchorRect?.() ?? null
  } catch {
    return null
  }
}

function viewportFor(mount: HTMLElement): EditorOverlayViewport {
  const win = mount.ownerDocument.defaultView
  const visual = win?.visualViewport
  if (visual) {
    return {
      width: Math.max(1, visual.width),
      height: Math.max(1, visual.height),
      left: Number.isFinite(visual.offsetLeft) ? visual.offsetLeft : 0,
      top: Number.isFinite(visual.offsetTop) ? visual.offsetTop : 0,
    }
  }
  return {
    width: Math.max(1, win?.innerWidth ?? 1280),
    height: Math.max(1, win?.innerHeight ?? 720),
  }
}

function positionMount(
  mount: HTMLElement,
  anchor: EditorOverlayAnchorRect | null,
  size: EditorOverlaySize,
): EditorOverlayPlacement {
  const placement = placeEditorOverlay(anchor, viewportFor(mount), size)
  mount.style.left = `${placement.left}px`
  mount.style.top = `${placement.top}px`
  mount.dataset.overlaySide = placement.side
  return placement
}

export type WireDirection = 'forward' | 'reverse' | 'bidirectional'

export interface WireCreateOptions {
  readonly predicate: string
  readonly direction: WireDirection
}

export type BlockWireCreateOptions = WireCreateOptions

export interface WireCreatedDetail {
  readonly wireId: string
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string
  readonly targetDocumentId: string
  readonly targetBlockId?: string
  readonly predicate: string
  readonly direction: WireDirection
  readonly bidirectional: boolean
}

export interface BlockWireCreatedDetail extends WireCreatedDetail {
  readonly sourceBlockId: string
}

export interface BlockWireDeletedDetail {
  readonly wireId: string
}

type PickerPhase = 'document' | 'block' | 'predicate'

interface PickerPredicateItem {
  readonly uri: string
  readonly label: string
  readonly category?: string
  readonly icon?: string
}

interface PickerBlockItem {
  readonly id: string
  readonly type: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly level?: number
  readonly text: string
  readonly preview?: string
}

interface CandidateSelection {
  readonly document: WikiLinkSuggestionItem
  readonly block?: PickerBlockItem
  readonly predicate?: PickerPredicateItem
}

function allPickerPredicates(): PickerPredicateItem[] {
  return getAllWirePredicates().map((predicate) => {
    const category = getWirePredicateCategory(predicate.uri) ?? 'Default'
    return {
      uri: predicate.uri,
      label: predicate.label,
      category,
      icon: category === 'Default' ? 'git-branch' : PREDICATE_GROUPS[category]?.icon,
    }
  })
}

function filterPickerPredicates(query: string): PickerPredicateItem[] {
  const q = query.toLowerCase().trim()
  const predicates = allPickerPredicates()
  if (!q) return predicates
  return predicates.filter((predicate) => {
    const category = predicate.category ?? ''
    return predicate.label.toLowerCase().includes(q) || category.toLowerCase().includes(q)
  })
}

function selectionWireOptions(
  createOptions: WireCreateOptions | undefined,
  predicate: PickerPredicateItem | undefined,
): WireCreateOptions | undefined {
  if (!predicate) return createOptions
  return {
    predicate: predicate.uri,
    direction: createOptions?.direction ?? 'forward',
  }
}

/**
 * Install the shipped wikilink-picker listener. Returns an unsubscribe that removes the
 * listener and tears down any open dropdown.
 */
export function installWikiLinkPickerGlue(opts: InstallPickerGlueOptions): () => void {
  const doc = opts.document ?? globalThis.document
  const mount = opts.mountInto ?? makeDefaultMount(doc)
  const ownsMount = opts.mountInto == null
  const dropdown = new CandidateDropdown(mount, opts.onOverlayOpenChange)
  const tagDropdown = new TagCandidateDropdown(mount, opts.onOverlayOpenChange)
  const wireMenu = new ExistingWireMenu(mount, opts.onOverlayOpenChange)
  const advancedMenu = new AdvancedWireMenu(mount, opts.onOverlayOpenChange)
  const citationPicker = new CitationPickerController(mount, opts.onOverlayOpenChange)
  const slashDropdown = new SlashCommandDropdown(mount, opts.onOverlayOpenChange)
  let tagRequestId = 0

  const onOpen = (event: Event): void => {
    citationPicker.close()
    tagDropdown.close()
    wireMenu.close()
    advancedMenu.close()
    slashDropdown.close()
    void openPicker(opts, dropdown, (event as CustomEvent<OpenWikiLinkPickerDetail>).detail)
  }
  const onCloseWikiLinkPicker = (): void => {
    dropdown.close()
  }
  const onOpenTagPicker = (event: Event): void => {
    citationPicker.close()
    dropdown.close()
    wireMenu.close()
    advancedMenu.close()
    slashDropdown.close()
    const requestId = ++tagRequestId
    void openTagPicker(
      opts,
      tagDropdown,
      (event as CustomEvent<OpenTagPickerDetail>).detail,
      () => requestId === tagRequestId,
    )
  }
  const onCloseTagPicker = (): void => {
    tagRequestId++
    tagDropdown.close()
  }
  const onOpenCitationPicker = (): void => {
    dropdown.close()
    tagDropdown.close()
    wireMenu.close()
    advancedMenu.close()
    slashDropdown.close()
    openCitationPicker(opts, citationPicker)
  }
  const onOpenSlashCommand = (event: Event): void => {
    citationPicker.close()
    dropdown.close()
    tagDropdown.close()
    wireMenu.close()
    advancedMenu.close()
    openSlashCommand(opts, slashDropdown, (event as CustomEvent<OpenSlashCommandDetail>).detail)
  }
  const onCloseSlashCommand = (): void => {
    slashDropdown.close()
  }
  const onDocumentWireRequest = (event: Event): void => {
    citationPicker.close()
    slashDropdown.close()
    const detail = (event as CustomEvent<DocumentWireRequestDetail>).detail
    tagDropdown.close()
    wireMenu.close()
    if (detail?.shiftKey) {
      dropdown.close()
      advancedMenu.open((createOptions) => {
        void openDocumentWirePicker(opts, dropdown, createOptions)
      })
      return
    }
    advancedMenu.close()
    void openDocumentWirePicker(opts, dropdown)
  }
  const onBlockWireRequest = (event: Event): void => {
    citationPicker.close()
    slashDropdown.close()
    const detail = (event as CustomEvent<BlockWireRequestDetail>).detail
    tagDropdown.close()
    wireMenu.close()
    if (detail?.shiftKey) {
      dropdown.close()
      advancedMenu.open((createOptions) => {
        void openBlockWirePicker(opts, dropdown, detail, createOptions)
      })
      return
    }
    advancedMenu.close()
    void openBlockWirePicker(opts, dropdown, detail)
  }
  const onBlockWireMenuRequest = (event: Event): void => {
    citationPicker.close()
    tagDropdown.close()
    dropdown.close()
    advancedMenu.close()
    slashDropdown.close()
    openExistingWireMenu(opts, wireMenu, (event as CustomEvent<BlockWireMenuRequestDetail>).detail)
  }
  // Bridge the kernel's Mod-; keyboard event into the existing mouse-driven
  // mn-block-wire-request flow. The kernel knows only the cursor's block id and
  // the shiftKey state (no host-side graphId/documentId — that's host context
  // the kernel deliberately stays free of). Translate by pulling
  // graphId/documentId from the current scope and synthesizing a
  // BlockWireRequestDetail. Re-dispatching as `mn-block-wire-request` lets the
  // existing onBlockWireRequest handler do all the picker-vs-advanced-menu
  // routing, dropdown-management cleanup, and wire-creation work — keyboard
  // parity with the bubble click path falls out for free.
  //
  // clientX/clientY are 0 here by contract: the shared placement policy treats
  // 0/0 as a keyboard sentinel and asks the active editor for caret geometry.
  // Pointer-originated block-wire requests instead anchor at the actual click.
  //
  // Future debt — multi-pane: today the organism installs picker glue exactly
  // once per claim, so this listener fires for one shell. If split-view ever
  // installs glue per pane, this listener has no notion of focus and would
  // re-dispatch from every glue install for a single Mod-; press. The fix is
  // an opts.getIsFocused() (parallel to opts.getEditor()) that the bridge
  // honors — not needed yet.
  //
  // Future debt — opts.document: installWikiLinkPickerGlue accepts an injected
  // `document` (default globalThis.document); the kernel always fires on
  // `editor.view.dom.ownerDocument`. If a caller ever installs the glue with a
  // custom document (e.g. an iframe embed), the keyboard bridge will silently
  // miss because the targets diverge. Mouse-driven mn-block-wire-request is
  // not affected; it fires through whichever element is clicked.
  const onKeyboardWireRequest = (event: Event): void => {
    const kbDetail = (event as CustomEvent<EditorKeyboardWireRequestDetail>).detail
    if (!kbDetail?.blockId) return
    const scope = opts.getScope()
    if (!scope.graphId || !scope.documentId) return
    const blockDetail: BlockWireRequestDetail = {
      graphId: scope.graphId,
      documentId: scope.documentId,
      blockId: kbDetail.blockId,
      clientX: 0,
      clientY: 0,
      shiftKey: kbDetail.shiftKey,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
    }
    doc.dispatchEvent(
      new CustomEvent<BlockWireRequestDetail>('mn-block-wire-request', {
        detail: blockDetail,
        bubbles: true,
        composed: true,
      }),
    )
  }

  doc.addEventListener(OPEN_WIKILINK_PICKER_EVENT, onOpen)
  doc.addEventListener(CLOSE_WIKILINK_PICKER_EVENT, onCloseWikiLinkPicker)
  doc.addEventListener(OPEN_TAG_PICKER_EVENT, onOpenTagPicker)
  doc.addEventListener(CLOSE_TAG_PICKER_EVENT, onCloseTagPicker)
  doc.addEventListener(OPEN_CITATION_PICKER_EVENT, onOpenCitationPicker)
  doc.addEventListener(OPEN_SLASH_COMMAND_EVENT, onOpenSlashCommand)
  doc.addEventListener(CLOSE_SLASH_COMMAND_EVENT, onCloseSlashCommand)
  doc.addEventListener(WIRE_DOCUMENT_REQUEST_EVENT, onDocumentWireRequest)
  doc.addEventListener('mn-block-wire-request', onBlockWireRequest)
  doc.addEventListener('mn-block-wire-menu-request', onBlockWireMenuRequest)
  doc.addEventListener(EDITOR_KEYBOARD_WIRE_REQUEST_EVENT, onKeyboardWireRequest)
  return () => {
    doc.removeEventListener(OPEN_WIKILINK_PICKER_EVENT, onOpen)
    doc.removeEventListener(CLOSE_WIKILINK_PICKER_EVENT, onCloseWikiLinkPicker)
    doc.removeEventListener(OPEN_TAG_PICKER_EVENT, onOpenTagPicker)
    doc.removeEventListener(CLOSE_TAG_PICKER_EVENT, onCloseTagPicker)
    doc.removeEventListener(OPEN_CITATION_PICKER_EVENT, onOpenCitationPicker)
    doc.removeEventListener(OPEN_SLASH_COMMAND_EVENT, onOpenSlashCommand)
    doc.removeEventListener(CLOSE_SLASH_COMMAND_EVENT, onCloseSlashCommand)
    doc.removeEventListener(WIRE_DOCUMENT_REQUEST_EVENT, onDocumentWireRequest)
    doc.removeEventListener('mn-block-wire-request', onBlockWireRequest)
    doc.removeEventListener('mn-block-wire-menu-request', onBlockWireMenuRequest)
    doc.removeEventListener(EDITOR_KEYBOARD_WIRE_REQUEST_EVENT, onKeyboardWireRequest)
    advancedMenu.destroy()
    wireMenu.destroy()
    citationPicker.destroy()
    slashDropdown.destroy()
    tagDropdown.destroy()
    dropdown.destroy()
    if (ownsMount) mount.remove()
  }
}

/** Run one picker open: scope-guard → real search → dropdown → wire-first insert. */
async function openPicker(
  opts: InstallPickerGlueOptions,
  dropdown: CandidateDropdown,
  detail?: OpenWikiLinkPickerDetail,
): Promise<void> {
  const scope = opts.getScope()
  // Honest no-op: no open document/graph → nothing to source a wire from, and
  // wikiLinkSearch returns [] for a null graphId. (graphId AND documentId both
  // required: the wire's sourceDocumentId is scope.documentId.)
  if (!scope.graphId || !scope.documentId) return

  const query = detail?.query ?? opts.initialQuery ?? ''
  const candidates = await opts.services.wikiLinkSearch.suggest(query)
  // No candidates → show nothing (honest: the picker is empty, not faked).
  if (candidates.length === 0) {
    dropdown.close()
    return
  }

  dropdown.open(
    candidates,
    query,
    (selection) => {
      void onSelect(opts, scope, selection, detail?.range)
    },
    (nextQuery) => opts.services.wikiLinkSearch.suggest(nextQuery),
    (documentId, nextQuery) => opts.services.wikiLinkBlocks.suggest(documentId, nextQuery),
    currentAnchor(opts),
  )
}

async function openTagPicker(
  opts: InstallPickerGlueOptions,
  dropdown: TagCandidateDropdown,
  detail: OpenTagPickerDetail | undefined,
  isCurrent: () => boolean,
): Promise<void> {
  const scope = opts.getScope()
  if (!detail || !scope.documentId) {
    dropdown.close()
    return
  }

  const candidates = await opts.services.tagSearch.suggest(detail.query)
  if (!isCurrent()) return
  if (candidates.length === 0) {
    dropdown.close()
    return
  }

  dropdown.open(
    candidates,
    detail.range,
    (pick, range, commit) => {
      if (commit === 'text') onTagTextSelect(opts, range, pick)
      else onTagSelect(opts, range, pick)
    },
    currentAnchor(opts),
  )
}

function openCitationPicker(
  opts: InstallPickerGlueOptions,
  picker: CitationPickerController,
): void {
  const citation = opts.citation
  const scope = opts.getScope()
  if (!citation || !scope.graphId || !scope.documentId) {
    picker.close()
    return
  }
  const sourceBlockId = opts.getEditor()?.getActiveBlockId?.() ?? null
  picker.open(citation, (item) => {
    void onCitationSelect(opts, scope, sourceBlockId, item)
  })
}

function openSlashCommand(
  opts: InstallPickerGlueOptions,
  dropdown: SlashCommandDropdown,
  detail: OpenSlashCommandDetail | undefined,
): void {
  if (!detail || !opts.getEditor()?.runSlashCommandAt) {
    dropdown.close()
    return
  }
  dropdown.open(
    detail,
    (item, range) => {
      if (item.unavailable) return
      void opts.getEditor()?.runSlashCommandAt?.(range, item.id)
    },
    currentAnchor(opts),
  )
}

async function openDocumentWirePicker(
  opts: InstallPickerGlueOptions,
  dropdown: CandidateDropdown,
  createOptions?: WireCreateOptions,
): Promise<void> {
  const scope = opts.getScope()
  const sourceDocumentId = scope.documentId
  if (!scope.graphId || !sourceDocumentId) return

  const query = opts.initialQuery ?? ''
  const candidates = await opts.services.wikiLinkSearch.suggest(query)
  if (candidates.length === 0) {
    dropdown.close()
    return
  }

  dropdown.open(
    candidates,
    query,
    (selection) => {
      void onDocumentWireSelect(
        opts,
        sourceDocumentId,
        selection.document,
        selectionWireOptions(createOptions, selection.predicate),
      )
    },
    (nextQuery) => opts.services.wikiLinkSearch.suggest(nextQuery),
    (documentId, nextQuery) => opts.services.wikiLinkBlocks.suggest(documentId, nextQuery),
    currentAnchor(opts),
  )
}

async function openBlockWirePicker(
  opts: InstallPickerGlueOptions,
  dropdown: CandidateDropdown,
  detail: BlockWireRequestDetail | undefined,
  createOptions?: WireCreateOptions,
): Promise<void> {
  const scope = opts.getScope()
  const sourceDocumentId = detail?.documentId ?? scope.documentId
  const sourceBlockId = detail?.blockId
  if (!scope.graphId || !sourceDocumentId || !sourceBlockId) return

  const query = opts.initialQuery ?? ''
  const candidates = await opts.services.wikiLinkSearch.suggest(query)
  if (candidates.length === 0) {
    dropdown.close()
    return
  }

  dropdown.open(
    candidates,
    query,
    (selection) => {
      void onBlockWireSelect(
        opts,
        sourceDocumentId,
        sourceBlockId,
        selection.document,
        selectionWireOptions(createOptions, selection.predicate),
      )
    },
    (nextQuery) => opts.services.wikiLinkSearch.suggest(nextQuery),
    (documentId, nextQuery) => opts.services.wikiLinkBlocks.suggest(documentId, nextQuery),
    currentAnchor(opts, detail),
  )
}

function openExistingWireMenu(
  opts: InstallPickerGlueOptions,
  wireMenu: ExistingWireMenu,
  detail: BlockWireMenuRequestDetail | undefined,
): void {
  const wires = detail?.wires ?? []
  if (wires.length === 0) {
    wireMenu.close()
    return
  }
  wireMenu.open(
    wires,
    {
      navigate: (wire) => {
        opts.services.navigation.openDocument(wire.otherGraphId, wire.otherDocumentId, wire.otherBlockId)
      },
      delete: (wire) => {
        void deleteExistingWire(opts, wire)
      },
    },
    currentAnchor(opts, detail),
  )
}

async function onCitationSelect(
  opts: InstallPickerGlueOptions,
  scope: EditorScope,
  sourceBlockId: string | null,
  item: CitationPickerItem,
): Promise<void> {
  const citation = opts.citation
  const sourceDocumentId = scope.documentId
  const graphId = scope.graphId
  if (!citation || !sourceDocumentId || !graphId || !item.key) return

  const source = await citation.materialize(item)
  const artifactId = source.artifactId || `zot-${item.key}`
  await citation.ground({
    graphId,
    sourceDocumentId,
    sourceBlockId,
    targetArtifactId: artifactId,
  })
  opts.getEditor()?.insertCitation?.({
    artifactId,
    zoteroKey: item.key,
    citation: item.citation?.trim() || item.title || item.key,
  })
}

/**
 * Selection handler (WIRE-FIRST shared-id order, matching garden document-editor.ts):
 * the WireService MINTS the id and returns it; the inserted node carries the SAME id.
 */
async function onSelect(
  opts: InstallPickerGlueOptions,
  scope: EditorScope,
  selection: CandidateSelection,
  range?: { from: number; to: number },
): Promise<void> {
  // documentId/graphId are non-null here (openPicker guarded before opening).
  const sourceDocumentId = scope.documentId!
  const targetGraphId = scope.graphId!
  const pick = selection.document
  const block = selection.block
  const predicate = selection.predicate
  // 1) Create the wire FIRST — the service mints + returns the wireId (the cell honors
  //    the caller-minted id; the node + wire then share it).
  const { wireId } = await opts.services.wire.create({
    sourceDocumentId,
    targetDocumentId: pick.id,
    ...(block ? { targetBlockId: block.id } : {}),
    ...(predicate ? { predicate: predicate.uri } : {}),
  })
  // 2) Insert the node carrying the SAME wireId, through the SHIPPED public host handle.
  const attrs: LiveWikiLinkAttrs = {
    targetDocId: pick.id,
    ...(block ? { targetBlockId: block.id, blockPreview: block.preview ?? block.text } : {}),
    label: pick.label,
    targetGraphId,
    wireId,
  }
  const editor = opts.getEditor()
  if (range && editor?.insertWikiLinkAt) editor.insertWikiLinkAt(range, attrs)
  else editor?.insertWikiLink(attrs)
}

function implicitDateForTag(name: string): string | null {
  return SCHEDULED_TAGS.has(name) ? todayKey() : null
}

function onTagSelect(
  opts: InstallPickerGlueOptions,
  range: { from: number; to: number },
  pick: TagSuggestion,
): void {
  opts.getEditor()?.insertTagChipAt?.(range, {
    name: pick.name,
    date: implicitDateForTag(pick.name),
  })
}

function onTagTextSelect(
  opts: InstallPickerGlueOptions,
  range: { from: number; to: number },
  pick: TagSuggestion,
): void {
  opts.getEditor()?.insertTagTextAt?.(range, pick.name)
}

async function onDocumentWireSelect(
  opts: InstallPickerGlueOptions,
  sourceDocumentId: string,
  pick: WikiLinkSuggestionItem,
  createOptions?: WireCreateOptions,
): Promise<void> {
  const direction = createOptions?.direction ?? 'forward'
  const predicate = createOptions?.predicate ?? DEFAULT_WIRE_PREDICATE_URI
  const bidirectional = direction === 'bidirectional'
  const reverse = direction === 'reverse'
  const { wireId } = await opts.services.wire.create({
    sourceDocumentId: reverse ? pick.id : sourceDocumentId,
    targetDocumentId: reverse ? sourceDocumentId : pick.id,
    ...(createOptions ? { predicate } : {}),
    ...(bidirectional ? { bidirectional } : {}),
  })
  const doc = opts.document ?? globalThis.document
  doc.dispatchEvent(
    new CustomEvent<WireCreatedDetail>('mn-wire-created', {
      detail: {
        wireId,
        sourceDocumentId,
        targetDocumentId: pick.id,
        predicate,
        direction,
        bidirectional,
      },
    }),
  )
}

async function onBlockWireSelect(
  opts: InstallPickerGlueOptions,
  sourceDocumentId: string,
  sourceBlockId: string,
  pick: WikiLinkSuggestionItem,
  createOptions?: WireCreateOptions,
): Promise<void> {
  const direction = createOptions?.direction ?? 'forward'
  const predicate = createOptions?.predicate ?? DEFAULT_WIRE_PREDICATE_URI
  const bidirectional = direction === 'bidirectional'
  const reverse = direction === 'reverse'
  const { wireId } = await opts.services.wire.create({
    sourceDocumentId: reverse ? pick.id : sourceDocumentId,
    ...(reverse ? {} : { sourceBlockId }),
    targetDocumentId: reverse ? sourceDocumentId : pick.id,
    ...(reverse ? { targetBlockId: sourceBlockId } : {}),
    ...(createOptions ? { predicate } : {}),
    ...(bidirectional ? { bidirectional } : {}),
  })
  const doc = opts.document ?? globalThis.document
  doc.dispatchEvent(
    new CustomEvent<BlockWireCreatedDetail>('mn-wire-created', {
      detail: {
        wireId,
        sourceDocumentId,
        sourceBlockId,
        targetDocumentId: pick.id,
        predicate,
        direction,
        bidirectional,
      },
    }),
  )
}

async function deleteExistingWire(opts: InstallPickerGlueOptions, wire: WireSummary): Promise<void> {
  await opts.services.wire.delete(wire.id)
  const doc = opts.document ?? globalThis.document
  doc.dispatchEvent(
    new CustomEvent<BlockWireDeletedDetail>('mn-wire-deleted', {
      detail: { wireId: wire.id },
    }),
  )
}

/** A div appended to document.body to mount the dropdown into (default mount). */
function makeDefaultMount(doc: Document): HTMLElement {
  const el = doc.createElement('div')
  el.className = 'sh-wikilink-picker-mount'
  // Controllers move this viewport-coordinate anchor before rendering. It starts
  // intentionally offscreen so async open work can never flash at 0,0.
  el.style.position = 'fixed'
  el.style.left = '-10000px'
  el.style.top = '-10000px'
  el.style.zIndex = '10000'
  doc.body.appendChild(el)
  return el
}

type CitationPickerElement = HTMLElement & {
  open: boolean
  query: string
  loading: boolean
  error: string
  selectedIndex: number
  results: readonly CitationPickerItem[]
  show?: () => void
  hide?: () => void
  updateComplete?: Promise<unknown>
}

class CitationPickerController {
  private picker: CitationPickerElement | null = null
  private service: CitationPickerService | null = null
  private onPick: ((item: CitationPickerItem) => void) | null = null
  private requestId = 0
  private isOpen = false
  private readonly onSearch = (event: Event): void => {
    const query = (event as CustomEvent<{ query: string }>).detail?.query ?? ''
    void this.search(query)
  }
  private readonly onPickEvent = (event: Event): void => {
    const item = (event as CustomEvent<{ item: CitationPickerItem }>).detail?.item
    if (!item) return
    const onPick = this.onPick
    this.close()
    onPick?.(item)
  }
  private readonly onClose = (): void => {
    this.close()
  }

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {}

  open(service: CitationPickerService, onPick: (item: CitationPickerItem) => void): void {
    this.service = service
    this.onPick = onPick
    const picker = this.ensurePicker()
    picker.query = ''
    picker.loading = false
    picker.error = ''
    picker.selectedIndex = 0
    picker.results = []
    if (picker.show) picker.show()
    else picker.open = true
    if (!this.isOpen) {
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    void picker.updateComplete?.then(() => {
      picker.shadowRoot?.querySelector<HTMLElement>('[data-citation-search]')?.focus()
    })
  }

  close(): void {
    this.requestId++
    if (this.isOpen) {
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.service = null
    this.onPick = null
    if (this.picker) {
      if (this.picker.hide) this.picker.hide()
      else this.picker.open = false
      this.picker.loading = false
      this.picker.error = ''
    }
  }

  destroy(): void {
    this.close()
    if (!this.picker) return
    this.picker.removeEventListener('mn-citation-search', this.onSearch)
    this.picker.removeEventListener('mn-citation-pick', this.onPickEvent)
    this.picker.removeEventListener('mn-close', this.onClose)
    this.picker.removeEventListener('close', this.onClose)
    this.picker.remove()
    this.picker = null
  }

  private ensurePicker(): CitationPickerElement {
    if (this.picker) return this.picker
    const picker = this.mount.ownerDocument.createElement('mn-citation-picker') as CitationPickerElement
    picker.addEventListener('mn-citation-search', this.onSearch)
    picker.addEventListener('mn-citation-pick', this.onPickEvent)
    picker.addEventListener('mn-close', this.onClose)
    picker.addEventListener('close', this.onClose)
    this.mount.ownerDocument.body.appendChild(picker)
    this.picker = picker
    return picker
  }

  private async search(query: string): Promise<void> {
    const picker = this.ensurePicker()
    const service = this.service
    const requestId = ++this.requestId
    picker.query = query
    picker.selectedIndex = 0
    picker.error = ''
    if (!service || !query.trim()) {
      picker.loading = false
      picker.results = []
      return
    }
    picker.loading = true
    try {
      const results = await service.search(query)
      if (requestId !== this.requestId) return
      picker.results = results
      picker.error = ''
    } catch (e) {
      if (requestId !== this.requestId) return
      picker.results = []
      picker.error = e instanceof Error ? e.message : String(e)
    } finally {
      if (requestId === this.requestId) picker.loading = false
    }
  }
}

class AdvancedWireMenu {
  private onConfirm: ((options: WireCreateOptions) => void) | null = null
  private isOpen = false

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {}

  open(onConfirm: (options: WireCreateOptions) => void): void {
    this.onConfirm = onConfirm
    if (!this.isOpen) {
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    this.renderMenu()
    const menu = this.mount.querySelector('mn-advanced-wire-menu') as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null
    void menu?.updateComplete?.then(() => {
      menu.shadowRoot?.querySelector<HTMLElement>('[data-wire-advanced-predicate]')?.focus()
    })
  }

  close(): void {
    const wasOpen = this.isOpen
    if (this.isOpen) {
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.onConfirm = null
    if (wasOpen) render(nothing, this.mount)
  }

  destroy(): void {
    this.close()
  }

  private confirm(options: WireCreateOptions): void {
    const onConfirm = this.onConfirm
    this.close()
    onConfirm?.({
      predicate: options.predicate,
      direction: options.direction,
    })
  }

  private renderMenu(): void {
    render(html`
      <mn-advanced-wire-menu
        open
        .selectedPredicate=${DEFAULT_WIRE_PREDICATE_URI}
        .direction=${'forward'}
        @mn-wire-options-confirm=${(event: CustomEvent<WireCreateOptions>) => this.confirm(event.detail)}
        @mn-close=${() => this.close()}
      ></mn-advanced-wire-menu>
    `, this.mount)
  }
}

/**
 * Shared document/block/predicate candidate controller. It renders the pure component,
 * owns async query phase changes, and applies the same viewport placement contract as
 * the other editor popovers. It is intentionally not a custom element.
 */
class CandidateDropdown {
  private items: WikiLinkSuggestionItem[] = []
  private blocks: PickerBlockItem[] = []
  private predicates: PickerPredicateItem[] = []
  private phase: PickerPhase = 'document'
  private query = ''
  private selectedIndex = 0
  private selectedDocument: WikiLinkSuggestionItem | null = null
  private selectedBlock: PickerBlockItem | null = null
  private selectedPredicate: PickerPredicateItem | null = null
  private loading = false
  private onPick: ((pick: CandidateSelection) => void) | null = null
  private onSearch: ((query: string) => Promise<WikiLinkSuggestionItem[]>) | null = null
  private onBlockSearch: ((documentId: string, query: string) => Promise<PickerBlockItem[]>) | null = null
  private isOpen = false
  private searchToken = 0
  private placement: EditorOverlayPlacement = { left: OVERLAY_MARGIN, top: OVERLAY_MARGIN, side: 'fallback' }

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {}

  open(
    items: WikiLinkSuggestionItem[],
    query: string,
    onPick: (pick: CandidateSelection) => void,
    onSearch?: (query: string) => Promise<WikiLinkSuggestionItem[]>,
    onBlockSearch?: (documentId: string, query: string) => Promise<PickerBlockItem[]>,
    anchor: EditorOverlayAnchorRect | null = null,
  ): void {
    this.items = items
    this.blocks = []
    this.predicates = filterPickerPredicates('')
    this.phase = 'document'
    this.query = query
    this.selectedIndex = 0
    this.selectedDocument = null
    this.selectedBlock = null
    this.selectedPredicate = null
    this.loading = false
    this.onPick = onPick
    this.onSearch = onSearch ?? null
    this.onBlockSearch = onBlockSearch ?? null
    this.placement = positionMount(this.mount, anchor, PICKER_SIZE)
    this.searchToken++
    if (!this.isOpen) {
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    this.renderDropdown()
  }

  close(): void {
    const wasOpen = this.isOpen
    if (this.isOpen) {
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.items = []
    this.blocks = []
    this.predicates = []
    this.phase = 'document'
    this.query = ''
    this.selectedDocument = null
    this.selectedBlock = null
    this.selectedPredicate = null
    this.loading = false
    this.onPick = null
    this.onSearch = null
    this.onBlockSearch = null
    this.searchToken++
    if (wasOpen) render(nothing, this.mount)
  }

  destroy(): void {
    this.close()
    this.mount.remove()
  }

  /** The currently-selected candidate (for tests / programmatic select). */
  get selected(): WikiLinkSuggestionItem | null {
    if (this.phase !== 'document') return null
    return this.items[this.selectedIndex] ?? null
  }

  /** Resolve a candidate by index (Enter / click). */
  private pick(selection: CandidateSelection): void {
    const onPick = this.onPick
    this.close()
    onPick?.(selection)
  }

  private pickSelection(selection: CandidateSelection): void {
    const index = this.items.findIndex(item => item.id === selection.document.id)
    if (index === -1) return
    this.selectedIndex = index
    this.pick(selection)
  }

  private queryPicker(detail: { readonly query: string; readonly phase: string }): void {
    this.query = detail.query
    this.selectedIndex = 0
    if (detail.phase === 'predicate') {
      this.predicates = filterPickerPredicates(detail.query)
      this.renderDropdown()
      return
    }
    if (detail.phase === 'block') {
      if (this.selectedDocument) this.loadBlocks(this.selectedDocument, detail.query)
      else this.renderDropdown()
      return
    }
    if (detail.phase !== 'document') return
    const onSearch = this.onSearch
    if (!onSearch) {
      this.renderDropdown()
      return
    }

    const token = ++this.searchToken
    this.renderDropdown()
    void onSearch(detail.query)
      .then((items) => {
        if (!this.isOpen || token !== this.searchToken) return
        this.items = items
        this.selectedIndex = 0
        this.renderDropdown()
      })
      .catch(() => {
        if (!this.isOpen || token !== this.searchToken) return
        this.items = []
        this.selectedIndex = 0
        this.renderDropdown()
      })
  }

  private requestPhase(detail: {
    readonly phase: string
    readonly document?: WikiLinkSuggestionItem
    readonly block?: PickerBlockItem
  }): void {
    if (detail.phase === 'predicate') {
      this.phase = 'predicate'
      this.query = ''
      this.selectedIndex = 0
      this.selectedDocument = detail.document ?? this.selectedDocument ?? this.items[this.selectedIndex] ?? null
      this.selectedBlock = detail.block ?? this.selectedBlock
      this.predicates = filterPickerPredicates('')
      this.renderDropdown()
      return
    }

    if (detail.phase === 'block') {
      const document = detail.document ?? this.selectedDocument ?? this.items[this.selectedIndex] ?? null
      this.selectedDocument = document
      this.selectedBlock = null
      if (document) this.loadBlocks(document, '')
      else this.renderDropdown()
      return
    }

    if (detail.phase === 'document') {
      this.phase = 'document'
      this.query = ''
      this.selectedIndex = 0
      this.selectedDocument = null
      this.selectedBlock = null
      this.loading = false
      this.searchToken++
      this.renderDropdown()
    }
  }

  private loadBlocks(document: WikiLinkSuggestionItem, query: string): void {
    this.phase = 'block'
    this.query = query
    this.selectedIndex = 0
    this.selectedDocument = document
    this.blocks = []
    const onBlockSearch = this.onBlockSearch
    if (!onBlockSearch) {
      this.loading = false
      this.renderDropdown()
      return
    }

    this.loading = true
    const token = ++this.searchToken
    this.renderDropdown()
    void onBlockSearch(document.id, query)
      .then((items) => {
        if (!this.isOpen || token !== this.searchToken) return
        this.blocks = items
        this.selectedIndex = 0
        this.loading = false
        this.renderDropdown()
      })
      .catch(() => {
        if (!this.isOpen || token !== this.searchToken) return
        this.blocks = []
        this.selectedIndex = 0
        this.loading = false
        this.renderDropdown()
      })
  }

  private renderDropdown(): void {
    render(html`
      <mn-wikilink-picker
        open
        .x=${this.placement.left}
        .y=${this.placement.top}
        .phase=${this.phase}
        .documents=${this.items}
        .blocks=${this.blocks}
        .predicates=${this.predicates}
        .query=${this.query}
        .selectedIndex=${this.selectedIndex}
        .loading=${this.loading}
        .selectedDocument=${this.selectedDocument}
        .selectedBlock=${this.selectedBlock}
        .selectedPredicate=${this.selectedPredicate}
        @mn-wikilink-select=${(event: CustomEvent<CandidateSelection>) => this.pickSelection(event.detail)}
        @mn-wikilink-query=${(event: CustomEvent<{ readonly query: string; readonly phase: string }>) => this.queryPicker(event.detail)}
        @mn-wikilink-phase-request=${(event: CustomEvent<{ readonly phase: string; readonly document?: WikiLinkSuggestionItem; readonly block?: PickerBlockItem }>) => this.requestPhase(event.detail)}
        @mn-close=${() => this.close()}
      ></mn-wikilink-picker>
    `, this.mount)
  }
}

function slashCommandGlyph(item: SlashCommandItem): string {
  if (item.id === 'heading1') return 'H1'
  if (item.id === 'heading2') return 'H2'
  if (item.id === 'heading3') return 'H3'
  if (item.id === 'bulletList') return 'UL'
  if (item.id === 'orderedList') return 'OL'
  if (item.id === 'taskList') return '[]'
  if (item.id === 'blockquote') return '>'
  if (item.id === 'codeBlock') return '</>'
  if (item.id === 'table') return 'T'
  if (item.id === 'image') return 'IMG'
  if (item.id === 'queryBlock') return 'DB'
  if (item.id === 'math') return 'fx'
  return '--'
}

class SlashCommandDropdown {
  private items: readonly SlashCommandItem[] = []
  private selectedIndex = 0
  private range: { from: number; to: number } | null = null
  private query = ''
  private onPick: ((
    item: SlashCommandItem,
    range: { from: number; to: number },
  ) => void) | null = null
  private isOpen = false
  private readonly keydownHandler: (e: KeyboardEvent) => void

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {
    this.keydownHandler = (e) => this.handleKeyDown(e)
  }

  open(
    detail: OpenSlashCommandDetail,
    onPick: (item: SlashCommandItem, range: { from: number; to: number }) => void,
    anchor: EditorOverlayAnchorRect | null = null,
  ): void {
    const items = filterSlashCommands(detail.query)
    if (items.length === 0) {
      this.close()
      return
    }
    this.items = items
    this.selectedIndex = this.firstSelectableIndex(items)
    this.range = detail.range
    this.query = detail.query
    this.onPick = onPick
    positionMount(this.mount, anchor, COMPACT_POPOVER_SIZE)
    if (!this.isOpen) {
      this.mount.ownerDocument?.addEventListener('keydown', this.keydownHandler, true)
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    this.renderDropdown()
  }

  close(): void {
    const wasOpen = this.isOpen
    if (this.isOpen) {
      this.mount.ownerDocument?.removeEventListener('keydown', this.keydownHandler, true)
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.items = []
    this.selectedIndex = 0
    this.range = null
    this.query = ''
    this.onPick = null
    if (wasOpen) render(nothing, this.mount)
  }

  destroy(): void {
    this.close()
  }

  private firstSelectableIndex(items: readonly SlashCommandItem[]): number {
    const index = items.findIndex(item => !item.unavailable)
    return index === -1 ? 0 : index
  }

  private move(delta: number): void {
    if (this.items.length === 0) return
    let next = this.selectedIndex
    for (let i = 0; i < this.items.length; i++) {
      next = (next + delta + this.items.length) % this.items.length
      if (!this.items[next]?.unavailable) break
    }
    this.selectedIndex = next
    this.renderDropdown()
  }

  private pick(index: number): void {
    const item = this.items[index]
    const range = this.range
    const onPick = this.onPick
    if (!item || item.unavailable || !range) return
    this.close()
    onPick?.(item, range)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen || this.items.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        this.move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        this.move(-1)
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        this.pick(this.selectedIndex)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        this.close()
        break
      default:
        break
    }
  }

  private renderDropdown(): void {
    render(html`
      <style>
        .slash-command-popup {
          min-width: 230px;
          max-width: 300px;
          max-height: 320px;
          overflow-y: auto;
          padding: 4px;
          border: 1px solid var(--mn-color-border-default, rgba(15, 23, 42, 0.14));
          border-radius: var(--mn-radius-md, 6px);
          background: var(--mn-color-surface-raised, #fff);
          box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(15, 23, 42, 0.18));
          color: var(--mn-color-text-primary, #1f2933);
          font: 500 var(--mn-type-ui-size, 0.875rem)/1.25 var(--mn-font-sans, system-ui, sans-serif);
        }
        .slash-command-item {
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: center;
          gap: 9px;
          width: 100%;
          min-height: 42px;
          padding: 6px 8px;
          border: 0;
          border-radius: var(--mn-radius-sm, 4px);
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .slash-command-item[data-selected='true'] {
          background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
        }
        .slash-command-item:disabled {
          cursor: default;
          opacity: 0.48;
        }
        .slash-command-item:focus-visible {
          outline: 2px solid var(--mn-color-border-focus, #3d7f5f);
          outline-offset: 2px;
        }
        .slash-command-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: var(--mn-radius-sm, 4px);
          background: var(--mn-color-surface-sunken, rgba(15, 23, 42, 0.05));
          color: var(--mn-color-text-secondary, #475467);
          font: 700 0.68rem/1 var(--mn-font-sans, system-ui, sans-serif);
          letter-spacing: 0;
        }
        .slash-command-copy {
          min-width: 0;
        }
        .slash-command-label,
        .slash-command-description {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .slash-command-label {
          font-weight: 650;
        }
        .slash-command-description {
          margin-top: 1px;
          color: var(--mn-color-text-tertiary, #697386);
          font-size: var(--mn-type-ui-xs-size, 0.75rem);
          font-weight: 500;
        }
      </style>
      <div
        class="slash-command-popup"
        data-slash-command-menu
        role="listbox"
        aria-label="Slash commands"
        data-query=${this.query}
      >
        ${this.items.map((item, index) => html`
          <button
            class="slash-command-item"
            type="button"
            role="option"
            data-slash-command
            data-command-id=${item.id}
            data-selected=${index === this.selectedIndex ? 'true' : 'false'}
            aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
            ?disabled=${item.unavailable}
            @mousedown=${(event: MouseEvent) => {
              event.preventDefault()
              this.pick(index)
            }}
            @mouseenter=${() => {
              if (item.unavailable) return
              this.selectedIndex = index
              this.renderDropdown()
            }}
          >
            <span class="slash-command-icon" aria-hidden="true">${slashCommandGlyph(item)}</span>
            <span class="slash-command-copy">
              <span class="slash-command-label">${item.label}</span>
              <span class="slash-command-description">${item.description}</span>
            </span>
          </button>
        `)}
      </div>
    `, this.mount)
  }
}

class TagCandidateDropdown {
  private items: TagSuggestion[] = []
  private selectedIndex = 0
  private range: { from: number; to: number } | null = null
  private onPick: ((
    pick: TagSuggestion,
    range: { from: number; to: number },
    commit: 'chip' | 'text',
  ) => void) | null = null
  private isOpen = false
  private readonly keydownHandler: (e: KeyboardEvent) => void

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {
    this.keydownHandler = (e) => this.handleKeyDown(e)
  }

  open(
    items: TagSuggestion[],
    range: { from: number; to: number },
    onPick: (
      pick: TagSuggestion,
      range: { from: number; to: number },
      commit: 'chip' | 'text',
    ) => void,
    anchor: EditorOverlayAnchorRect | null = null,
  ): void {
    this.items = items
    this.selectedIndex = 0
    this.range = range
    this.onPick = onPick
    positionMount(this.mount, anchor, COMPACT_POPOVER_SIZE)
    if (!this.isOpen) {
      this.mount.ownerDocument?.addEventListener('keydown', this.keydownHandler, true)
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    this.renderDropdown()
  }

  close(): void {
    const wasOpen = this.isOpen
    if (this.isOpen) {
      this.mount.ownerDocument?.removeEventListener('keydown', this.keydownHandler, true)
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.items = []
    this.range = null
    this.onPick = null
    if (wasOpen) render(nothing, this.mount)
  }

  destroy(): void {
    this.close()
  }

  private pick(index: number, commit: 'chip' | 'text' = 'chip'): void {
    const item = this.items[index]
    const range = this.range
    const onPick = this.onPick
    if (!item || !range) return
    this.close()
    onPick?.(item, range, commit)
  }

  private pickSuggestion(detail: { readonly index: number; readonly item: TagSuggestion }): void {
    const index = this.items.findIndex(item => item.name === detail.item.name)
    this.selectedIndex = index === -1 ? detail.index : index
    this.pick(this.selectedIndex)
  }

  private hoverSuggestion(detail: { readonly index: number }): void {
    this.selectedIndex = Math.max(0, Math.min(detail.index, this.items.length - 1))
    this.renderDropdown()
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen || this.items.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1)
        this.renderDropdown()
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.renderDropdown()
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        this.pick(this.selectedIndex)
        break
      case 'Tab':
        e.preventDefault()
        e.stopPropagation()
        this.pick(this.selectedIndex, 'text')
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        this.close()
        break
      default:
        break
    }
  }

  private renderDropdown(): void {
    render(html`
      <mn-tag-autocomplete-popover
        .items=${this.items}
        .selectedIndex=${this.selectedIndex}
        @mn-tag-autocomplete-select=${(event: CustomEvent<{ readonly index: number; readonly item: TagSuggestion }>) => this.pickSuggestion(event.detail)}
        @mn-tag-autocomplete-hover=${(event: CustomEvent<{ readonly index: number }>) => this.hoverSuggestion(event.detail)}
      ></mn-tag-autocomplete-popover>
    `, this.mount)
  }
}

interface ExistingWireActions {
  readonly navigate: (wire: WireSummary) => void
  readonly delete: (wire: WireSummary) => void
}

interface ExistingWireMenuActionDetail {
  readonly wire: WireSummary
}

class ExistingWireMenu {
  private wires: readonly WireSummary[] = []
  private actions: ExistingWireActions | null = null
  private isOpen = false

  constructor(
    private readonly mount: HTMLElement,
    private readonly onOverlayOpenChange?: (open: boolean) => void,
  ) {}

  open(
    wires: readonly WireSummary[],
    actions: ExistingWireActions,
    anchor: EditorOverlayAnchorRect | null = null,
  ): void {
    this.wires = wires
    this.actions = actions
    positionMount(this.mount, anchor, COMPACT_POPOVER_SIZE)
    if (!this.isOpen) {
      this.isOpen = true
      this.onOverlayOpenChange?.(true)
    }
    this.renderMenu()
  }

  close(): void {
    const wasOpen = this.isOpen
    if (this.isOpen) {
      this.isOpen = false
      this.onOverlayOpenChange?.(false)
    }
    this.wires = []
    this.actions = null
    if (wasOpen) render(nothing, this.mount)
  }

  destroy(): void {
    this.close()
  }

  private navigate(wire: WireSummary): void {
    const navigate = this.actions?.navigate
    this.close()
    navigate?.(wire)
  }

  private delete(wire: WireSummary): void {
    const deleteWire = this.actions?.delete
    this.close()
    deleteWire?.(wire)
  }

  private renderMenu(): void {
    render(html`
      <mn-wire-menu-dropdown
        open
        .wires=${this.wires}
        @mn-wire-menu-navigate=${(event: CustomEvent<ExistingWireMenuActionDetail>) => this.navigate(event.detail.wire)}
        @mn-wire-menu-delete=${(event: CustomEvent<ExistingWireMenuActionDetail>) => this.delete(event.detail.wire)}
        @mn-close=${() => this.close()}
      ></mn-wire-menu-dropdown>
    `, this.mount)
  }
}
