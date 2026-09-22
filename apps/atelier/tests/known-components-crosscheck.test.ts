/**
 * KNOWN_COMPONENTS drift cross-check — TEST-ONLY, never gate-time.
 *
 * The nucleus is PURE: KNOWN_COMPONENTS (known-components.ts) is a hand-listed
 * frozen set, because the nucleus has no DOM and cannot scan `customElements`.
 * This test — which lives in @shrubbery/atelier, the one place EVERY shrubbery
 * package is a dependency — imports the real registration entrypoints and
 * cross-checks the hand-list against the ACTUALLY-registered `@customElement` set,
 * so drift (a new component nobody added to the allowlist, or an allowlist entry
 * that no longer exists) is caught LOUDLY.
 *
 * Two directions:
 *   1. NO UNKNOWN REGISTRATIONS: every tag registered by the shrubbery packages
 *      MUST be in KNOWN_COMPONENTS (a registered component the gate would reject
 *      = a real bug — the demo could not grow it).
 *   2. NO STALE ANCHORS: the only KNOWN_COMPONENTS entries that are NOT registered
 *      by these packages are documented external anchor tags or runtime-
 *      substituted serialized anchors. We assert EXACTLY that documented set is
 *      the unregistered remainder, so a typo'd or removed allowlist tag is caught.
 *
 * NO MOCKS: real Lit elements, real customElements registry (happy-dom), the real
 * @customElement side-effect imports.
 */

import { describe, it, expect } from 'vitest'
import { KNOWN_COMPONENTS } from '@shrubbery/nucleus'

// Side-effect imports that REGISTER the real custom elements:
//   - @shrubbery/components registers the mn-* chrome + primitive/panel tags.
//   - @shrubbery/atelier-vtuber registers mn-vtuber (split out of components —
//     see that package's carve-out note — for its heavier three-vrm footprint).
//   - @shrubbery/runtime's host elements register sh-* host tags; chat-host
//     transitively imports @shrubbery/chat-kernel which registers sh-chat-panel
//     and its nested @shrubbery/hoja composer registration.
import '@shrubbery/components'
import '@shrubbery/atelier-vtuber'
import { ShEditorHost, ShChatHost, ShWirePinnedLayer, ShWiresPanel } from '@shrubbery/runtime'

/** Allowlisted tags that are intentionally NOT shrubbery @customElements here:
 *  - mn-document-editor: persistence-class anchor owned by the editor host path.
 *  - mn-chat-panel/mn-wires-panel: serialized Garden surface anchors that
 *    renderWorkspace substitutes with sh-* hosts when services are present.
 *  - sh-layout-dashboard: serialized dashboard center anchor; its host element
 *    is LAZILY defined by the runtime at surface render time (exactly like
 *    sh-workspace-surface, which is likewise unregistered at import time), so
 *    at this import-only crosscheck it is deliberately not registered. */
const UNREGISTERED_ALLOWLIST_TAGS = [
  'mn-document-editor',
  'mn-chat-panel',
  'mn-wires-panel',
  'sh-layout-dashboard',
] as const

describe('KNOWN_COMPONENTS drift cross-check (test-only, not gate-time)', () => {
  it('touches the host classes so their @customElement side effects run', () => {
    // Reference the imported classes so tree-shaking / unused-import elision can't
    // drop the registering modules.
    expect(ShEditorHost).toBeTypeOf('function')
    expect(ShChatHost).toBeTypeOf('function')
    expect(ShWirePinnedLayer).toBeTypeOf('function')
    expect(ShWiresPanel).toBeTypeOf('function')
  })

  it('every tag in KNOWN_COMPONENTS is EITHER registered here OR a documented unregistered tag', () => {
    const unaccounted: string[] = []
    for (const tag of KNOWN_COMPONENTS) {
      const registered = customElements.get(tag) !== undefined
      const isAnchor = (UNREGISTERED_ALLOWLIST_TAGS as readonly string[]).includes(tag)
      if (!registered && !isAnchor) unaccounted.push(tag)
    }
    // Every allowlist entry is either a real registration in scope or one of the
    // documented unregistered tags — nothing else (catches stale/typo'd tags).
    expect(unaccounted).toEqual([])
  })

  it('the EXACT unregistered remainder is the documented unregistered allowlist set', () => {
    const unregistered = [...KNOWN_COMPONENTS]
      .filter((tag) => customElements.get(tag) === undefined)
      .sort()
    expect(unregistered).toEqual([...UNREGISTERED_ALLOWLIST_TAGS].sort())
  })

  it('every @shrubbery/components-registered tag is in KNOWN_COMPONENTS (no gate-rejecting drift)', () => {
    const componentTags = [
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
      'mn-wire-picker',
      'mn-wikilink-picker',
      'mn-node-link-picker',
      'mn-citation-picker',
      'mn-zotero-library-panel',
      'mn-zotero-source-workbench',
      'mn-wire-radial-overlay',
      'mn-auth-page',
      'mn-sign-in-form',
      'mn-sign-up-form',
      'mn-verify-email-form',
      'mn-public-shell',
      'garden-hero-canvas',
      'sophia-hero-canvas',
      'garden-landing',
      'sophia-labs-landing',
    ]
    for (const tag of componentTags) {
      // It really IS registered (the import side effect ran)...
      expect(customElements.get(tag), `${tag} should be registered`).toBeDefined()
      // ...and the catalog allowlists it (else the gate would reject growing it).
      expect(KNOWN_COMPONENTS.has(tag), `${tag} missing from KNOWN_COMPONENTS`).toBe(true)
    }
  })

  it('the @shrubbery/atelier-vtuber-registered tag is registered AND allowlisted', () => {
    // mn-vtuber lives in its own package now (carved out of @shrubbery/components
    // for its heavier @pixiv/three-vrm dependency) — checked separately from the
    // componentTags list above, which only asserts what @shrubbery/components
    // itself registers.
    expect(customElements.get('mn-vtuber'), 'mn-vtuber should be registered').toBeDefined()
    expect(KNOWN_COMPONENTS.has('mn-vtuber'), 'mn-vtuber missing from KNOWN_COMPONENTS').toBe(true)
  })

  it('the host-lift tags are registered AND allowlisted', () => {
    for (const tag of [
      'sh-editor-host',
      'sh-chat-host',
      'sh-wire-pinned-layer',
      'sh-wires-panel',
      'sh-chat-panel',
      'hoja-editor',
    ]) {
      expect(customElements.get(tag), `${tag} should be registered`).toBeDefined()
      expect(KNOWN_COMPONENTS.has(tag), `${tag} missing from KNOWN_COMPONENTS`).toBe(true)
    }
  })

  it('the runtime-substituted serialized anchors are unregistered but allowlisted', () => {
    for (const tag of ['mn-chat-panel', 'mn-wires-panel']) {
      expect(customElements.get(tag), `${tag} should stay a serialized anchor, not a registered host`).toBeUndefined()
      expect(KNOWN_COMPONENTS.has(tag), `${tag} missing from KNOWN_COMPONENTS`).toBe(true)
    }
  })

  // MO object-face integration spec (WS1 D-6, master §3 Slice 2). Face VIEW
  // elements (sh-subject-card-view, sh-sparql-table-view, sh-stat-scalar-view,
  // sh-vega-chart-view, sh-media-view, sh-home-view, and now sh-object-card-
  // view) are absent from KNOWN_COMPONENTS by convention — that allowlist is
  // the grow-verb catalog for `renderedByComponent` tags, not a global
  // element registry, and this test's own import scope (above) never loads
  // `@shrubbery/runtime/layout` faces modules. Adding `sh-object-card-view`
  // here would break this file's "exact unregistered remainder" assertion —
  // a future contributor cannot "helpfully" add it.
  it('sh-object-card-view stays OUT of KNOWN_COMPONENTS (face view elements are not global-registry members)', () => {
    expect(KNOWN_COMPONENTS.has('sh-object-card-view')).toBe(false)
  })
})
