/**
 * Executable Garden component-surface census.
 *
 * Oracle: /Users/vera/dev/sophia/garden @ cf0cb9600ba25ee49f7268301bcf3d949ed48f3b
 * (production @customElement declarations; tests excluded). Shrubbery keeps
 * four stateful hosts under explicit sh-* names and implements chat-debug-page
 * as a top-level routed surface. Every other Garden tag must register verbatim.
 */

import { describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '@shrubbery/runtime'
import { detectOrganismAppRoute } from '../app-routes.js'

export const GARDEN_FRONTEND_ORACLE_SHA = 'cf0cb9600ba25ee49f7268301bcf3d949ed48f3b'

const GARDEN_PRODUCTION_TAGS = [
  'chat-debug-page',
  'garden-hero-canvas',
  'garden-landing',
  'mn-advanced-wire-menu',
  'mn-artifact-editor',
  'mn-artifact-history',
  'mn-artifact-view',
  'mn-auth-page',
  'mn-avatar',
  'mn-badge',
  'mn-bottom-bar',
  'mn-button',
  'mn-calendar-event-specimen',
  'mn-card',
  'mn-chat-panel',
  'mn-cloud-mode-panel',
  'mn-cloud-mode-pill',
  'mn-comment-popover',
  'mn-comments-panel',
  'mn-confirmation-dialog',
  'mn-consent-banner',
  'mn-context-menu',
  'mn-daily-note-header',
  'mn-daily-note-row',
  'mn-dialog',
  'mn-doc-history-panel',
  'mn-document-editor',
  'mn-document-switcher',
  'mn-dropdown-button',
  'mn-editor-toolbar',
  'mn-empty-state',
  'mn-error-boundary',
  'mn-excalidraw-canvas',
  'mn-export-dialog',
  'mn-feedback-form',
  'mn-folder-picker-dialog',
  'mn-graph-panel',
  'mn-icon-button',
  'mn-inline-edit',
  'mn-input',
  'mn-input-dialog',
  'mn-inspector',
  'mn-loading',
  'mn-mobile-file-list',
  'mn-mobile-tabs',
  'mn-modal',
  'mn-month-popover',
  'mn-node-link-picker',
  'mn-ops-health-page',
  'mn-original-viewer',
  'mn-panel-header',
  'mn-public-shell',
  'mn-restore-overlay',
  'mn-search-input',
  'mn-settings-page',
  'mn-shortcuts-dialog',
  'mn-sidebar-panel',
  'mn-sign-in-form',
  'mn-sign-up-form',
  'mn-snapshot-diff',
  'mn-spinner',
  'mn-storage-banner',
  'mn-tag-autocomplete-popover',
  'mn-tag-chip-specimen',
  'mn-tag-view',
  'mn-textarea',
  'mn-timeline-rail',
  'mn-toast',
  'mn-toolbar',
  'mn-toolbar-group',
  'mn-toolbar-overflow',
  'mn-tooltip',
  'mn-top-bar',
  'mn-tts-player',
  'mn-upgrade-banner',
  'mn-verify-email-form',
  'mn-wikilink-picker',
  'mn-wire-menu-dropdown',
  'mn-wire-picker',
  'mn-wire-pinned-layer',
  'mn-wire-radial-overlay',
  'mn-wires-panel',
  'sophia-hero-canvas',
  'sophia-labs-landing',
  'wf-choreograph-view',
  'wf-mission-control',
  'wf-studio-shell',
] as const

const HOST_ALIASES: Readonly<Record<string, string>> = {
  'mn-chat-panel': 'sh-chat-panel',
  'mn-document-editor': 'sh-editor-host',
  'mn-wire-pinned-layer': 'sh-wire-pinned-layer',
  'mn-wires-panel': 'sh-wires-panel',
}

describe('Garden frontend production component census', () => {
  it(`registers every component from Garden ${GARDEN_FRONTEND_ORACLE_SHA} or its explicit host alias`, () => {
    const missing = GARDEN_PRODUCTION_TAGS
      .filter((tag) => tag !== 'chat-debug-page')
      .filter((tag) => !customElements.get(HOST_ALIASES[tag] ?? tag))
    expect(missing).toEqual([])
  })

  it('replaces Garden chat-debug-page with the real Organism debug route', () => {
    expect(detectOrganismAppRoute(new URL('https://example.test/chat-debug.html'))).toEqual({
      kind: 'chat-debug',
    })
  })

  it('keeps the stateful host aliases explicit and one-to-one', () => {
    expect(Object.keys(HOST_ALIASES).sort()).toEqual([
      'mn-chat-panel',
      'mn-document-editor',
      'mn-wire-pinned-layer',
      'mn-wires-panel',
    ])
    expect(new Set(Object.values(HOST_ALIASES)).size).toBe(4)
  })
})
