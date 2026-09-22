/**
 * catalog-model.ts — the ONE catalog with two faces (iteration 3c).
 *
 * Load-bearing premise (per Vera): Storybook and the component-library MANIFEST
 * (`COMPONENT_LIBRARY` in @shrubbery/nucleus) are not two registries — they are
 * ONE catalog seen from two sides:
 *
 *   - the MANIFEST face: the engine's per-tag metadata (persistence class, the
 *     binding seam). This is the source of WHAT components exist and HOW the
 *     engine treats them. It is FIXED CODE, agent-unwritable.
 *   - the STORYBOOK face: the rendered, reviewable catalog. A component the
 *     manifest knows about MUST be visible here — built ones upgrade and render,
 *     unbuilt ones render as inert, clearly-labeled placeholders (never faked).
 *
 * This module is the seam that keeps the two faces coherent. It derives a single
 * `CATALOG_ENTRIES` list DIRECTLY from the manifest (`COMPONENT_LIBRARY`) plus
 * the set of chrome tags that shrubbery has actually BUILT (the @customElement
 * registrations exported by @shrubbery/components). Both:
 *   - `catalog.stories.ts` (the Storybook face — one story per entry), and
 *   - `catalog-coherence.test.ts` (the guard — every manifested tag is in the
 *     catalog, and every catalog entry yields a story)
 * read THIS list, so the two faces cannot drift: add a row to the manifest and
 * the catalog story + the coherence assertion both pick it up automatically.
 *
 * It plants the "Storybook-as-Emporium-catalog" seed (see STORYBOOK-CATALOG.md):
 * later, Emporium views will INCORPORATE + MUTATE these catalog components by
 * binding RDF (config / data / skin) to them. That binding flow is NOT built
 * here — this only guarantees the catalog itself is coherent and complete.
 *
 * Tooling-level (lives in the Storybook app), NOT inside the pure library. It
 * imports only TYPES + the frozen manifest from nucleus and the built-tag set
 * from components — no backend, no stores.
 */

import {
  COMPONENT_LIBRARY,
  persistenceOf,
  isRegisteredComponent,
  type Persistence,
} from '@shrubbery/nucleus'

/**
 * Whether shrubbery has actually BUILT (registered as a custom element) this tag.
 *
 * The chrome bars (`mn-top-bar` / `mn-bottom-bar`) and lifted manifest panels
 * such as `mn-graph-panel` are real @customElement definitions in
 * @shrubbery/components. `mn-document-editor` remains unbuilt here because the
 * real persistent editor lift is `sh-editor-host`. This reads the LIVE
 * custom-element registry (after the side-effect import of @shrubbery/components),
 * so it tells the truth at render time rather than from a hand-maintained list.
 */
export function isBuilt(tag: string): boolean {
  return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined
}

/**
 * The STATIC (DOM-free) "is this entry built?" signal — for tooling that has no
 * custom-element registry (the conneg server / static build run in plain node, no
 * browser, and must NOT side-effect-import the Lit components, whose decorators
 * need a browser/experimentalDecorators transform). An entry presented under the
 * `built-chrome` face is, by construction, a real built @customElement; a
 * `manifest-panel` entry may be lifted or inert. This agrees with the live
 * `isBuilt(tag)` in the browser for the known manifest-panel set — it is the same
 * truth read without a registry.
 */
export function isBuiltStatic(entry: CatalogEntry): boolean {
  // Both chrome bars and the general primitives are real, registered
  // @customElements (built); manifest-panel entries are per-tag.
  return entry.face === 'built-chrome' ||
    entry.face === 'general-primitive' ||
    entry.tag === 'mn-graph-panel' ||
    entry.tag === 'mn-vtuber'
}

/**
 * The faces a catalog entry can be observed from:
 *   - built-chrome      — a real, registered chrome bar (mn-top-bar/-bottom-bar).
 *   - general-primitive — a real, registered GENERAL skin-aware primitive
 *     (mn-chip/-badge/-sparkline/-ribbon/-card/-spinner/-loading/-empty-state),
 *     lifted + generalized from Garden/Emporium pure presentation surfaces.
 *     Like built-chrome these are real @customElements (not engine-classed panels)
 *     — part of the one catalog so they are catalogued + reviewable.
 *   - manifest-panel    — an engine-manifested panel (Class A/B/C), possibly
 *     not-yet-lifted (inert placeholder).
 */
export type CatalogFace = 'built-chrome' | 'general-primitive' | 'manifest-panel'

/**
 * One coherent catalog entry — a single component seen from both faces.
 *
 *   - tag         — the custom-element tag (the join key across both faces).
 *   - persistence — the manifest's engine persistence class (Class A/B/C). For a
 *                   tag absent from the manifest this is the defaulted 'stamp'.
 *   - manifested  — whether the MANIFEST explicitly KNOWS this tag
 *                   (isRegisteredComponent). The coherence test requires every
 *                   manifested tag to appear as a catalog entry.
 *   - face        — which face this entry is primarily presented under.
 *   - blurb       — a short human note for the catalog card (NOT mock data — a
 *                   description of the real component / placeholder).
 */
export interface CatalogEntry {
  readonly tag: string
  readonly persistence: Persistence
  readonly manifested: boolean
  readonly face: CatalogFace
  readonly blurb: string
}

/**
 * The BUILT chrome tags shrubbery ships today (the @customElement registrations
 * in @shrubbery/components). These are real, rendering catalog members — they are
 * NOT in the engine persistence manifest (chrome is Class-A 'stamp' by default
 * and needs no special engine treatment), but they ARE part of the one catalog,
 * so the catalog face lists them too. Keeping this list here (rather than reading
 * the registry at module-eval) lets the catalog be enumerated before the
 * side-effect import runs (e.g. in a pure unit test); `isBuilt` is the live check.
 */
const BUILT_CHROME: ReadonlyArray<{ tag: string; blurb: string }> = [
  { tag: 'mn-top-bar', blurb: 'Chrome top bar — masthead, app-switcher, inert breadcrumb slot, action buttons.' },
  { tag: 'mn-bottom-bar', blurb: 'Chrome bottom bar — panel toggles + three inert status slots.' },
]

/**
 * The GENERAL, skin-aware PRIMITIVES shrubbery ships (iter-4a). Real, registered
 * @customElements like the chrome — token-driven + props/slots-driven so they
 * work in BOTH skins. The first four are LIFTED + GENERALIZED from garden's PURE
 * presentation primitives (emporium-port wf-primitives.ts); mn-card generalizes
 * the catalogue card surface. They are NOT engine-classed panels, but they ARE
 * part of the one catalog — catalogued + reviewable here.
 */
const BUILT_PRIMITIVES: ReadonlyArray<{ tag: string; blurb: string }> = [
  { tag: 'mn-chip', blurb: 'General chip — leading glyph + label, tone routes to skin role tokens, dashed variant. Lifted from wf-chip.' },
  { tag: 'mn-badge', blurb: 'General badge — Garden variant/size/pill/filetype API plus state tone, optional spin/settle motion, and mn-badge-action.' },
  { tag: 'mn-sparkline', blurb: 'General number-series sparkline — accent-toned stroke routed to skin role tokens. Lifted from wf-sparkline.' },
  { tag: 'mn-ribbon', blurb: 'General segmented ribbon — accent-ramp tints, active highlight, optional labels (emits mn-ribbon-select). Lifted from wf-phase-ribbon.' },
  { tag: 'mn-card', blurb: 'General catalogue card — header/body/footer slots, interactive surface; the container the primitives sit in.' },
  { tag: 'mn-relations', blurb: 'General relations view — directed FROM→pred→TO edge list (socket-style class-link), predicate/wire kinds; earned by the Emporium pack RELATIONSHIPS section. Generalized, not a port of garden wf viz.' },
  { tag: 'mn-graph', blurb: 'General layered DAG / class-graph — classes as nodes, predicate-range + CRDT-wire edges, longest-path layout, fed by the SAME relationship read-model as mn-relations. Generalized, not a port of garden wf-anatomy-view.' },
  { tag: 'mn-graph-three', blurb: 'General Garden-derived Three/WebGL flat graph — same MnGraphNode/MnGraphEdge substrate as mn-graph, force layout, raycast selection, and wire particles for network views.' },
  { tag: 'mn-spinner', blurb: 'General CSS spinner — Garden loading primitive, role-tokenized and skin-aware.' },
  { tag: 'mn-loading', blurb: 'General loading state — spinner/dots/pulse/skeleton variants with optional text.' },
  { tag: 'mn-empty-state', blurb: 'General empty/error/placeholder state — caller-provided icon, copy, and actions.' },
  { tag: 'mn-continuity-status', blurb: 'Controlled continuity feedback — quiet ready state plus honest loading, saving, offline, reconnecting, and actionable error states.' },
  { tag: 'mn-artifact-view', blurb: 'Controlled artifact center view — shell-owned preview state and artifact intents, no download or revision side effects.' },
  { tag: 'mn-artifact-editor', blurb: 'Controlled artifact image editor — local Fabric canvas pan/zoom/draw/filter/crop/export with host-owned save and generation intents.' },
  { tag: 'mn-excalidraw-canvas', blurb: 'Controlled scene canvas workbench — shell-owned drawing runtime, projection summaries, node-link picker, and wire/save intents.' },
  { tag: 'mn-doc-history-panel', blurb: 'Controlled document history panel — shell-owned snapshot data, markdown diff text, restore/save/bookmark/delete intents.' },
  { tag: 'mn-original-viewer', blurb: 'Controlled original-file viewer — shell-owned URL/srcdoc/text/PDF/EPUB previews plus annotation, reload, download, and external-open intents.' },
  { tag: 'mn-comment-popover', blurb: 'Controlled floating comment popover — shell-owned comment data with peek/pinned modes, edit, resolve, delete, focus, and drag move intents.' },
  { tag: 'wf-choreograph-view', blurb: 'Controlled Choreograph run history and monitor surface — shell-owned run snapshots with refresh, replay, connect, and node-toggle intents.' },
  { tag: 'wf-mission-control', blurb: 'Garden compatibility alias for the controlled Choreograph run history and monitor surface.' },
  { tag: 'wf-studio-shell', blurb: 'Controlled Choreograph Studio app shell — screen routing over run history, monitor, and host-owned workflow subviews.' },
  { tag: 'mn-input', blurb: 'General input primitive — Garden text input with label/helper/error state, clearable/password controls, and mn-input/mn-change intents.' },
  { tag: 'mn-textarea', blurb: 'General textarea primitive — Garden multiline input with label/helper/error state, resize modes, char count, and mn-input/mn-change intents.' },
  { tag: 'mn-search-input', blurb: 'General search input — Garden search affordance with leading icon, shortcut chip, clear action, and mn-input/mn-clear intents.' },
  { tag: 'mn-tooltip', blurb: 'General tooltip — Garden delayed tooltip with shortcut chip, wrapped or external anchoring, native popover plus deterministic fallback.' },
  { tag: 'mn-avatar', blurb: 'General avatar — Garden image/initials/icon avatar with presence, group/ring affordances, and optional mn-click intent.' },
  { tag: 'mn-panel-header', blurb: 'General panel header — Garden title/icon/actions row with count badge and mn-collapse/mn-expand intents.' },
  { tag: 'mn-dropdown-button', blurb: 'General dropdown button — Garden anchored menu trigger over Shrubbery MenuEntry data, keyboard navigable and viewport-aware.' },
  { tag: 'mn-inline-edit', blurb: 'General inline edit — Garden rename primitive with label-to-input transition, validation, and mn-save/mn-cancel intents.' },
  { tag: 'mn-toast', blurb: 'General toast — Garden floating notification with type glyphs, action, close, progress, and mn-show/mn-dismiss intents.' },
  { tag: 'mn-modal', blurb: 'General modal shell — Garden overlay dialog with header/body/footer slots, size variants, focus restore, and mn-open/mn-close intents.' },
  { tag: 'mn-dialog', blurb: 'General native dialog — Garden <dialog> primitive with header/body/footer slots, focus restore, mn-close, and confirm/prompt helpers.' },
  { tag: 'mn-toolbar-overflow', blurb: 'General toolbar overflow — Garden toolbar overflow controller that collapses low-priority slotted controls into a menu.' },
  { tag: 'mn-tag-chip-specimen', blurb: 'General tag-chip specimen — Garden inline tag atom visual with core-tag tones and optional date suffix.' },
  { tag: 'mn-tag-autocomplete-popover', blurb: 'General tag autocomplete popover — Garden filtered-tag suggestion list with selected row and select/hover intents.' },
  { tag: 'mn-calendar-event-specimen', blurb: 'General calendar event specimen — Garden pinned event block visual with inline text fields, time editor, and source badge.' },
  { tag: 'mn-daily-note-header', blurb: 'General daily-note header — Garden editor date banner with prev/next and calendar-anchor intents.' },
  { tag: 'mn-daily-note-row', blurb: 'General daily-note row — Garden home daily-note affordance with relative update text and date navigation intents.' },
  { tag: 'mn-month-popover', blurb: 'General daily-note month popover — Garden calendar jump grid with note dots, date selection, and close intent.' },
  { tag: 'mn-context-menu', blurb: 'General command menu — Garden context-menu affordance over Shrubbery MenuEntry data, viewport-aware and keyboard navigable.' },
  { tag: 'mn-input-dialog', blurb: 'General input dialog — Garden prompt replacement with themed text entry and mn-confirm/mn-cancel intents.' },
  { tag: 'mn-confirmation-dialog', blurb: 'General confirmation dialog — default/warning/danger modal with confirm, secondary-confirm, and cancel intents.' },
  { tag: 'mn-shortcuts-dialog', blurb: 'General shortcuts dialog — Garden keyboard help surface over shell-provided command data, with search and execute intents.' },
  { tag: 'mn-advanced-wire-menu', blurb: 'General advanced wire menu — Garden predicate taxonomy chooser with direction controls and shell-owned confirm intent.' },
  { tag: 'mn-wire-menu-dropdown', blurb: 'General wire menu dropdown — Garden existing-wire surface over shell-provided wire rows, emitting navigate/delete/add intents.' },
  { tag: 'mn-wire-picker', blurb: 'General wire picker — Garden three-phase predicate/direction/document/block flow with shell-owned wire creation.' },
  { tag: 'mn-wikilink-picker', blurb: 'General wikilink picker — Garden quick-picker shell for document/block/predicate selection over shell-provided data.' },
  { tag: 'mn-node-link-picker', blurb: 'General node-link picker — Garden whiteboard modal for linking selected scene elements to document/artifact candidates.' },
  { tag: 'mn-citation-picker', blurb: 'General citation picker — Garden /cite modal over shell-owned Zotero search results with pick and close intents.' },
  { tag: 'mn-zotero-library-panel', blurb: 'Controlled Zotero library panel — Garden sidebar source browser over shell-owned library, collection, and search state.' },
  { tag: 'mn-zotero-source-workbench', blurb: 'Controlled Zotero source workbench — Garden main-pane source view over shell-owned item, annotation, incoming-wire, and promotion state.' },
  { tag: 'mn-wire-radial-overlay', blurb: 'General wire radial overlay — Garden hover fan for wire connections and suggestions, data-driven with shell-owned intents.' },
  { tag: 'mn-research-source-chip', blurb: 'Research atom — compact paper/source adapter status chip with host-owned source selection intent.' },
  { tag: 'mn-research-source-card', blurb: 'Research molecule — paper/source candidate card over host-owned search results, provenance, tags, and open/promote intents.' },
  { tag: 'mn-research-run-trace', blurb: 'Research molecule — run-step/provenance trace over shell-owned tool/search/synthesis state.' },
  { tag: 'mn-research-workspace', blurb: 'Research organism — slotted SRS workspace layout composing sidebar, chat, source, workflow, and trace panes without owning data effects.' },
  { tag: 'mn-document-switcher', blurb: 'Controlled global document switcher and command palette — shell-owned search/action rows with open, wire, split, query, and command intents.' },
  { tag: 'mn-settings-page', blurb: 'Controlled Garden settings and local runtime page — shell-owned rows for account, billing, imports, API/MCP, local AI jobs, and privacy controls.' },
  { tag: 'mn-ops-health-page', blurb: 'Controlled ops health triage page — host-owned runtime snapshot with refresh, back, and copy-json intents.' },
  { tag: 'mn-consent-banner', blurb: 'Controlled analytics consent banner — host-owned consent persistence with accept/decline intents.' },
  { tag: 'mn-upgrade-banner', blurb: 'Controlled free-tier upgrade banner — host-owned visibility/dismissal with upgrade and dismiss intents.' },
  { tag: 'mn-storage-banner', blurb: 'Controlled graph storage warning banner — host-resolved threshold state with upgrade and dismiss intents.' },
  { tag: 'mn-cloud-mode-pill', blurb: 'Controlled Sophia Cloud mode pill — host-owned local/cloud status with open-panel intent.' },
  { tag: 'mn-cloud-mode-panel', blurb: 'Controlled Sophia Cloud panel — host-owned account/mode state with connect, switch-local, sign-out, and close intents.' },
  { tag: 'mn-tts-player', blurb: 'Controlled desktop TTS playback bar — host-owned playback state with play/pause/stop/skip/speed/tier intents.' },
  { tag: 'mn-feedback-form', blurb: 'Controlled feedback modal — local form editing with host-owned submit and close effects.' },
  { tag: 'mn-export-dialog', blurb: 'Controlled export preview dialog — host-owned HTML/Markdown rendering with theme/action intents.' },
  { tag: 'mn-mobile-tabs', blurb: 'Controlled compact primary navigation — stable Home, Browse, and Sophia roots with a navigation-change intent.' },
  { tag: 'mn-mobile-file-list', blurb: 'Controlled mobile file browser — Garden folders/recents/workspace sheet UI with host-owned document, workspace, rename, and delete intents.' },
  { tag: 'mn-error-boundary', blurb: 'Controlled error boundary surface — Garden error/warning/not-found/network states with recovery and diagnostic-detail intents.' },
  { tag: 'mn-public-shell', blurb: 'Controlled public graph shell — read-only nav, document blocks, wires, and an accessible graph projection from the loaded public snapshot.' },
  { tag: 'mn-auth-page', blurb: 'Controlled Sophia Labs auth page — host-owned auth effects with sign-in, sign-up, and email verification form intents.' },
  { tag: 'mn-sign-in-form', blurb: 'Controlled auth sign-in form — local input state with shell-owned credential submission.' },
  { tag: 'mn-sign-up-form', blurb: 'Controlled auth sign-up form — local validation for username, email, password, and terms before shell-owned submission.' },
  { tag: 'mn-verify-email-form', blurb: 'Controlled email verification form — masked destination display plus verify and resend intents.' },
  { tag: 'garden-hero-canvas', blurb: 'Pure Garden landing hero canvas — local 2D organic background animation with no stores, network, or host coupling.' },
  { tag: 'sophia-hero-canvas', blurb: 'Pure Sophia landing hero canvas — local Three.js/WebGL visual background with guarded fallback and no app state.' },
  { tag: 'garden-landing', blurb: 'Pure Garden landing page — brochure surface over the hero canvas with shell-owned CTA analytics and consent effects.' },
  { tag: 'sophia-labs-landing', blurb: 'Pure Sophia Labs landing page — research-studio landing surface with shell-owned CTA analytics and consent effects.' },
]

/** Per-persistence-class one-liners for the catalog card (matches the taxonomy). */
const CLASS_BLURB: Record<Persistence, string> = {
  stamp: 'Class A (stamp) — stateless, re-stampable in place.',
  'persistent-relocatable': 'Class B (persistent-relocatable) — DOM-bound state, CSS-reposition only.',
  'persistent-non-relocatable': 'Class C (persistent-non-relocatable) — GPU/WebGL bound, float-only, never re-parent.',
}

/**
 * The single derived catalog — built chrome first, then every manifested panel
 * component (sorted by tag for a stable order). Both the catalog STORY and the
 * coherence TEST consume this, so adding a manifest row updates both faces.
 */
export const CATALOG_ENTRIES: ReadonlyArray<CatalogEntry> = [
  // Face 1 — the built chrome members (real, registered custom elements).
  ...BUILT_CHROME.map(({ tag, blurb }): CatalogEntry => ({
    tag,
    persistence: persistenceOf(tag), // 'stamp' (chrome is not in the manifest)
    manifested: isRegisteredComponent(tag), // false — chrome isn't engine-classed
    face: 'built-chrome',
    blurb,
  })),
  // Face 2 — the GENERAL primitives (real, registered custom elements; iter-4a).
  ...BUILT_PRIMITIVES.map(({ tag, blurb }): CatalogEntry => ({
    tag,
    persistence: persistenceOf(tag), // 'stamp' (primitives aren't engine-classed)
    manifested: isRegisteredComponent(tag), // false — not engine panels
    face: 'general-primitive',
    blurb,
  })),
  // Face 3 — EVERY manifested panel component, derived straight from the manifest.
  ...Object.keys(COMPONENT_LIBRARY)
    .sort()
    .map((tag): CatalogEntry => ({
      tag,
      persistence: persistenceOf(tag),
      manifested: true,
      face: 'manifest-panel',
      blurb: CLASS_BLURB[persistenceOf(tag)],
    })),
]

/** The manifested tags (the engine's known components) — the coherence target. */
export const MANIFESTED_TAGS: ReadonlyArray<string> = Object.keys(COMPONENT_LIBRARY).sort()

/** Look up a catalog entry by tag (pure). */
export function catalogEntryFor(tag: string): CatalogEntry | undefined {
  return CATALOG_ENTRIES.find(e => e.tag === tag)
}

/**
 * The static CSF export name a per-entry story uses for a tag, e.g.
 * 'mn-top-bar' -> 'MnTopBar'. The catalog story file declares one
 * `export const <storyExportName(tag)>` per entry; the coherence test re-derives
 * these names from the model and asserts they are actually exported (so a manifest
 * row added without its matching CSF export is caught). Kept HERE (not in the
 * story file) so it is not itself mistaken for a CSF story export.
 */
export function storyExportName(tag: string): string {
  return tag
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}
