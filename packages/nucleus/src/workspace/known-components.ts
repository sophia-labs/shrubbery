/**
 * known-components.ts — the EXPLICIT, FROZEN component allowlist (the catalog).
 *
 * THE CATALOG GATE'S SOURCE OF TRUTH. `applyVerb` (apply-verb.ts) REJECTS any
 * structural verb that would introduce a component tag NOT in this set, BEFORE it
 * builds the candidate RegionConfig/PanelConfig. This is the ONLY real allowlist
 * enforcement on the grow path:
 *
 *   - `isRegisteredComponent` / `COMPONENT_LIBRARY` (component-library.ts) is NOT
 *     the catalog: COMPONENT_LIBRARY lists ONLY the engine-manifested tags
 *     (mn-document-editor Class B, mn-graph-panel Class C manifest). It returns FALSE
 *     for mn-card, mn-top-bar, and every other tag the seed + demo actually use —
 *     so gating on it would reject the seed itself.
 *   - `validateConfig` I5 (validate.ts) only checks that renderedByComponent is a
 *     truthy STRING, NOT that the string names a real, vetted component — an
 *     off-catalog tag PASSES validateConfig. The catalog check has to live here.
 *
 * So this hand-listed frozen set is the authoritative allowlist. Two distinct
 * gates run on the grow path: applyVerb = the CATALOG layer (this set), and
 * validateConfig = the SPINE layer (structural invariants). Neither subsumes the
 * other.
 *
 * PURE: this module is a frozen literal. The nucleus never scans the DOM or
 * `customElements` — it has no access to either. The set is hand-maintained to
 * MIRROR the actually-registered `@customElement(...)` tags across the shrubbery
 * packages. A TEST (in @shrubbery/atelier, where every package is a dependency)
 * cross-checks this list against the real registered registry at test time so
 * drift is caught loudly, WITHOUT making the nucleus impure.
 *
 * The roster (mirrors the real `@customElement` registrations, plus the
 * documented serialized anchors that the runtime substitutes/lifts):
 *   @shrubbery/components: mn-top-bar, mn-app-bar, mn-bottom-bar,
 *     mn-garden-home, mn-chip,
 *     mn-badge, mn-sparkline, mn-ribbon, mn-card, mn-relations, mn-graph,
 *     mn-graph-panel,
 *     mn-button, mn-icon-button, mn-input, mn-textarea, mn-search-input,
 *     mn-tooltip, mn-avatar, mn-panel-header, mn-dropdown-button,
 *     mn-inline-edit, mn-toast, mn-modal, mn-dialog, mn-toolbar, mn-toolbar-group,
 *     mn-toolbar-overflow, mn-tag-chip-specimen, mn-tag-autocomplete-popover,
 *     mn-calendar-event-specimen, mn-daily-note-header, mn-daily-note-row,
 *     mn-month-popover,
 *     mn-editor-toolbar, mn-spinner, mn-loading, mn-empty-state, mn-sidebar-panel, mn-tag-view,
 *     mn-artifact-view, mn-artifact-editor, mn-excalidraw-canvas, mn-artifact-history, mn-doc-history-panel, mn-original-viewer,
 *     wf-choreograph-view, wf-mission-control, wf-studio-shell, mn-snapshot-diff, mn-timeline-rail,
 *     mn-restore-overlay, mn-comments-panel, mn-comment-popover, mn-inspector, mn-document-switcher,
 *     mn-settings-page, mn-ops-health-page, mn-consent-banner, mn-upgrade-banner,
 *     mn-storage-banner, mn-lifetime-banner, mn-cloud-mode-pill, mn-cloud-mode-panel,
 *     mn-tts-player, mn-feedback-form, mn-export-dialog, mn-mobile-tabs,
 *     mn-mobile-file-list, mn-error-boundary, mn-context-menu, mn-input-dialog,
 *     mn-confirmation-dialog, mn-folder-picker-dialog, mn-shortcuts-dialog,
 *     mn-advanced-wire-menu, mn-wire-menu-dropdown, mn-auth-page,
 *     mn-sign-in-form, mn-sign-up-form, mn-verify-email-form, mn-public-shell, mn-wire-picker,
 *     mn-wikilink-picker, mn-node-link-picker, mn-citation-picker, mn-zotero-library-panel, mn-zotero-source-workbench, mn-wire-radial-overlay, garden-hero-canvas,
 *     sophia-hero-canvas, garden-landing, sophia-labs-landing.
 *   @shrubbery/organism trusted app extension (1):
 *     mn-phanes-control-editor — the graph-authored Phanes control workspace.
 *   @shrubbery/atelier-vtuber (1): mn-vtuber — the WebGL/VRM avatar puppet,
 *     carved out of @shrubbery/components into its own package for its heavier
 *     @pixiv/three-vrm dependency (depends ON @shrubbery/components for
 *     SkinAware, never the reverse).
 *   COMPONENT_LIBRARY external anchor (1): mn-document-editor (Class B) —
 *     registered by its owning host package, the persistence-class anchor the
 *     engine routes through the lift path.
 *   Runtime-substituted Garden surface anchors (2): mn-chat-panel,
 *     mn-wires-panel — serialized by the Garden default workspace and lifted to
 *     the Shrubbery hosts by @shrubbery/runtime when services are present.
 *   @shrubbery/runtime host-lift (4): sh-editor-host, sh-chat-host,
 *     sh-wire-pinned-layer, sh-wires-panel.
 *   Serialized dashboard center anchor (1): sh-layout-dashboard — a config's
 *     center region names it to declare a layout-document dashboard center;
 *     the runtime Surface path lifts it to the `layout.dashboard` face (its
 *     host element is lazily defined at surface render, like
 *     sh-workspace-surface, so it is deliberately unregistered at import time).
 *   @shrubbery/chat-kernel (1): sh-chat-panel.
 *   @shrubbery/hoja (1): hoja-editor — the backend-free, postured authoring
 *     surface nested by the chat kernel in composer posture.
 */

/**
 * The hand-listed roster (mirrors the real `@customElement` registrations). The
 * frozen array is the immutable backing store; KNOWN_COMPONENTS below is the
 * TRULY-immutable ReadonlySet projection of it.
 */
const KNOWN_COMPONENT_TAGS: readonly string[] = Object.freeze([
  // @shrubbery/components — registered backend-free chrome, primitives, and controlled panels.
  'mn-top-bar',
  'mn-app-bar',
  'mn-bottom-bar',
  'mn-garden-home',
  'mn-chip',
  'mn-badge',
  'mn-sparkline',
  'mn-ribbon',
  'mn-card',
  'mn-relations',
  'mn-graph',
  'mn-graph-panel',
  'mn-button',
  'mn-icon-button',
  'mn-input',
  'mn-textarea',
  'mn-search-input',
  'mn-tooltip',
  'mn-avatar',
  'mn-panel-header',
  'mn-dropdown-button',
  'mn-inline-edit',
  'mn-toast',
  'mn-modal',
  'mn-dialog',
  'mn-toolbar',
  'mn-toolbar-group',
  'mn-toolbar-overflow',
  'mn-tag-chip-specimen',
  'mn-tag-autocomplete-popover',
  'mn-calendar-event-specimen',
  'mn-daily-note-header',
  'mn-daily-note-row',
  'mn-month-popover',
  'mn-editor-toolbar',
  'mn-spinner',
  'mn-loading',
  'mn-empty-state',
  'mn-sidebar-panel',
  'mn-tag-view',
  'mn-artifact-view',
  'mn-artifact-editor',
  'mn-excalidraw-canvas',
  'mn-artifact-history',
  'mn-doc-history-panel',
  'mn-original-viewer',
  'wf-choreograph-view',
  'wf-mission-control',
  'wf-studio-shell',
  'mn-snapshot-diff',
  'mn-timeline-rail',
  'mn-restore-overlay',
  'mn-comments-panel',
  'mn-comment-popover',
  'mn-inspector',
  'mn-document-switcher',
  'mn-settings-page',
  'mn-ops-health-page',
  'mn-consent-banner',
  'mn-upgrade-banner',
  'mn-storage-banner',
  'mn-lifetime-banner',
  'mn-cloud-mode-pill',
  'mn-cloud-mode-panel',
  'mn-tts-player',
  'mn-feedback-form',
  'mn-export-dialog',
  'mn-mobile-tabs',
  'mn-mobile-file-list',
  'mn-error-boundary',
  'mn-context-menu',
  'mn-input-dialog',
  'mn-confirmation-dialog',
  'mn-folder-picker-dialog',
  'mn-shortcuts-dialog',
  'mn-advanced-wire-menu',
  'mn-wire-menu-dropdown',
  'mn-auth-page',
  'mn-sign-in-form',
  'mn-sign-up-form',
  'mn-verify-email-form',
  'mn-public-shell',
  'mn-wire-picker',
  'mn-wikilink-picker',
  'mn-node-link-picker',
  'mn-citation-picker',
  'mn-zotero-library-panel',
  'mn-zotero-source-workbench',
  'mn-wire-radial-overlay',
  'garden-hero-canvas',
  'sophia-hero-canvas',
  'garden-landing',
  'sophia-labs-landing',
  // @shrubbery/organism — graph-authored Phanes control workspace body.
  'mn-phanes-control-editor',
  // @shrubbery/organism — graph-authored Sophia Agent Studio workspace body.
  'mn-agent-studio-editor',
  // @shrubbery/atelier-vtuber — the WebGL/VRM avatar puppet (carved out of
  // @shrubbery/components; depends ON components for SkinAware, never reverse).
  'mn-vtuber',
  // COMPONENT_LIBRARY persistence-class anchor tag (Class B).
  'mn-document-editor',
  // Serialized Garden surface anchors; runtime substitutes these with sh-* hosts.
  'mn-chat-panel',
  'mn-wires-panel',
  // @shrubbery/runtime host-lift tags (the persistent panel hosts).
  'sh-editor-host',
  'sh-chat-host',
  'sh-wire-pinned-layer',
  'sh-wires-panel',
  // Serialized CENTER-REGION dashboard anchor: a region whose
  // renderedByComponent names this tag declares "this workspace's center pane
  // is a layout-document dashboard". The Surface path (@shrubbery/runtime
  // render-workspace) lifts it to the `layout.dashboard` face, whose host
  // element (same tag, lazily defined by the runtime like sh-workspace-surface)
  // invokes the shell-supplied dashboard mount. The observatory graph is the
  // first tenant; the mechanism is generic.
  'sh-layout-dashboard',
  // @shrubbery/chat-kernel — the pure chat render element.
  'sh-chat-panel',
  // @shrubbery/hoja — the pure, postured text authoring surface.
  'hoja-editor',
])

/**
 * Build a TRULY-immutable ReadonlySet.
 *
 * GOTCHA: `Object.freeze(new Set(...))` is NOT immutable — `Object.freeze` only
 * freezes own properties, leaving the Set's internal `[[SetData]]` writable, so
 * `.add()` / `.delete()` / `.clear()` still mutate it (a frozen-set illusion that
 * would let a caller poison the module-global allowlist at runtime). We therefore
 * override the three mutators to throw and freeze the wrapper, yielding a set that
 * genuinely cannot be modified.
 */
function frozenSet(tags: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>(tags)
  const reject = (op: string) => (): never => {
    throw new TypeError(`KNOWN_COMPONENTS is immutable: ${op} is not permitted`)
  }
  Object.defineProperties(set, {
    add: { value: reject('add'), configurable: false, writable: false },
    delete: { value: reject('delete'), configurable: false, writable: false },
    clear: { value: reject('clear'), configurable: false, writable: false },
  })
  return Object.freeze(set)
}

/**
 * The FROZEN catalog of vetted component tags a grow verb may introduce.
 *
 * A truly-immutable `ReadonlySet<string>`: membership is an O(1) `.has()`, and
 * `.add` / `.delete` / `.clear` THROW (see `frozenSet`) — the module-global
 * allowlist cannot be poisoned at runtime.
 */
export const KNOWN_COMPONENTS: ReadonlySet<string> = frozenSet(KNOWN_COMPONENT_TAGS)

/**
 * Whether `tag` is an allowlisted, vetted component a grow verb may introduce.
 *
 * Pure; no DOM, no customElements. The single membership predicate the catalog
 * gate (applyVerb) calls — distinct from `isRegisteredComponent` (which keys on
 * the 2-entry persistence library, NOT the catalog).
 */
export function isKnownComponent(tag: string): boolean {
  return KNOWN_COMPONENTS.has(tag)
}

/**
 * Strict custom-element name grammar — the SYNTACTIC half of the render gate.
 *
 * A valid custom-element tag is lowercase, starts with a letter, contains at
 * least one hyphen, and is made only of `[a-z0-9-]`. This rejects, BY SHAPE,
 * anything that could carry markup into a static template: no `>`, no `<`, no
 * whitespace, no attributes, no uppercase — so an injected fragment like
 * `div><img src=x onerror=…>` fails the grammar before membership is even asked.
 *
 * NB: every KNOWN_COMPONENT_TAG already satisfies this (all are `mn-*` / `wf-*`
 * / `sh-*` / `garden-*` / `sophia-*`), so the grammar never narrows the catalog.
 */
const CUSTOM_ELEMENT_TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/

/**
 * Whether `tag` is a syntactically valid custom-element name (grammar only).
 * Pure; no DOM. Does NOT assert catalog membership — see `isRenderableComponentTag`.
 */
export function isValidCustomElementTag(tag: string): boolean {
  return CUSTOM_ELEMENT_TAG.test(tag)
}

/**
 * The APP-EXTENSION allowlist — downstream-app tags the render gate also admits.
 *
 * KNOWN_COMPONENTS is the FROZEN garden-demo catalog, and the nucleus is UPSTREAM
 * of the app packages: it cannot enumerate a downstream app's private components
 * (e.g. `@shrubbery/rhizome`'s `rz-shell` / `rz-rail` observatory shell, which
 * `renderWorkspace` stamps from RHIZOME's own trusted static WorkspaceConfig). So
 * an app REGISTERS its own vetted, `@customElement`-registered tags here at import
 * time, and the render gate admits catalog ∪ app-extension.
 *
 * SECURITY — why a MUTABLE set does not weaken the unsafeStatic boundary:
 *   - It is populated ONLY by trusted app *code* running at module init (an
 *     `@customElement` side-effect module calling `registerRenderableComponentTags`).
 *     Untrusted cell/RDF config arrives as DATA that flows through parsers — it
 *     never calls a function, so it can never register a tag.
 *   - Every registered tag is grammar-checked first (`registerRenderableComponentTags`
 *     rejects anything that is not a bare custom-element name), so even a buggy app
 *     cannot smuggle an injection fragment past the gate.
 * An off-catalog tag delivered from a cell therefore still fails the gate and
 * resolves to an inert placeholder — the catalog policy on the untrusted read path
 * is fully intact. This set only lets an app opt its OWN registered elements in.
 */
const APP_RENDERABLE_TAGS = new Set<string>()

/**
 * Register downstream-app custom-element tags as renderable by the graph→DOM gate
 * (interpreter.stampPanelBody / validateConfig I7). Call at app import time, before
 * `renderWorkspace`, from the module that owns the app's WorkspaceConfig.
 *
 * Each tag MUST satisfy the custom-element grammar; a non-grammar tag THROWS
 * loudly rather than being silently admitted, keeping the unsafeStatic boundary
 * safe even against a buggy registration. Idempotent (backed by a Set).
 */
export function registerRenderableComponentTags(tags: readonly string[]): void {
  for (const tag of tags) {
    if (!isValidCustomElementTag(tag)) {
      throw new TypeError(
        `registerRenderableComponentTags: ${JSON.stringify(tag)} is not a valid custom-element tag`,
      )
    }
    APP_RENDERABLE_TAGS.add(tag)
  }
}

/**
 * Whether `tag` may be stamped verbatim into the DOM — the FULL render gate:
 * valid custom-element grammar AND membership in the vetted set (the frozen
 * garden catalog OR an app-registered extension tag). This is the single
 * predicate the graph→DOM boundary (interpreter.stampPanelBody) and the commit
 * gate (validateConfig I7) both consult, so a tag reaches `unsafeStatic` on
 * exactly one condition: it is a real, vetted, well-formed component. Any tag
 * that fails EITHER half must resolve to an inert placeholder, never a raw stamp.
 *
 * Pure; no DOM, no customElements.
 */
export function isRenderableComponentTag(tag: string): boolean {
  return isValidCustomElementTag(tag) && (isKnownComponent(tag) || APP_RENDERABLE_TAGS.has(tag))
}
