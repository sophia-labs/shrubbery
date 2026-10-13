/**
 * THE DEBT REGISTER for the undefined-token lint (undefined-token-references.test.ts).
 *
 * Every entry is a `var(--mn-x …)` reference that was ALREADY undefined, in a
 * file outside the Files surface, on 2026-10-03 when the lint landed. It is a
 * ratchet, not an allowlist you may add to: a new undefined reference fails the
 * lint, and an entry that stops being a violation must be deleted (the lint
 * fails until it is). The Files surface has no entries and may never have any.
 *
 * Each entry carries one of four reasons, defined once below. To clear an
 * entry: define the token in the token layer (or read an existing role), or
 * declare the knob in the component that reads it. Do not argue with the lint
 * by widening a reason.
 */

/**
 * Layout or behaviour knob (a width, gap, position, inset). The fallback IS the
 * design value, so nothing paints wrongly; nothing in the repo sets the knob.
 * Declaring it in the component's own `:host` would retire the entry.
 */
const LAYOUT_KNOB = 'layout or behaviour knob: the fallback is the design value; nothing in the repo sets it'

/**
 * Typography knob or planned type role, read through a fallback chain that ends
 * in a real `--mn-text-*` / `--mn-font-*` token. Nothing sets the knob.
 */
const TYPOGRAPHY_KNOB = 'typography knob or planned type role: read through a fallback chain; nothing sets it'

/**
 * A colour or shape role that no token file defines. The literal fallback wins
 * in every skin and theme: the P0.1 defect class that painted Files green. The
 * cleanup is real and is outside the Files surface; the fix is to read an
 * existing role (as semantic.css did for the names it closed as aliases) or to
 * define the role per skin.
 */
const UNDEFINED_ROLE = 'colour or shape role no token file defines: the literal fallback wins in every skin (the P0.1 defect class)'

/**
 * Declared by another file for this one: a parent component or a controller
 * sets the knob for its child (mn-editor-toolbar for mn-button, mn-toolbar and
 * mn-icon-button; the viewport controller for the chat panel). The same-file
 * rule cannot see it; it is a real contract and an honest exception.
 */
const SET_BY_ANOTHER_FILE = 'declared by a parent component or controller for this child: a cross-file contract'

/** file (repo-relative) → undefined name → why. */
export const UNDEFINED_TOKEN_DEBT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'apps/hoja/src/hoja-app.ts': {
    '--mn-color-surface-danger': UNDEFINED_ROLE,
  },
  'apps/organism/index.html': {
    '--mn-font-ui': TYPOGRAPHY_KNOB,
    '--mn-type-heading-size': TYPOGRAPHY_KNOB,
  },
  'apps/organism/src/cell/agent-studio-editor.ts': {
    '--mn-color-bg-default': UNDEFINED_ROLE,
  },
  'apps/organism/src/cell/flow-app-frame.ts': {
    '--mn-color-bg': UNDEFINED_ROLE,
  },
  'apps/organism/src/cell/grapevine-pane.ts': {
    '--mn-font-ui': TYPOGRAPHY_KNOB,
  },
  'apps/organism/src/cell/phanes-control-editor.ts': {
    '--mn-color-bg-default': UNDEFINED_ROLE,
  },
  'apps/organism/src/cell/resolution-flow.ts': {
    '--mn-font-size-sm': TYPOGRAPHY_KNOB,
  },
  'apps/organism/src/cell/room-mirror.ts': {
    '--mn-color-status-critical': UNDEFINED_ROLE,
    '--mn-color-status-good': UNDEFINED_ROLE,
    '--mn-color-status-warning': UNDEFINED_ROLE,
  },
  'apps/organism/src/cell/usage-explorer-view.ts': {
    '--mn-color-accent-primary': UNDEFINED_ROLE,
  },
  'packages/chat-kernel/src/chat-panel.ts': {
    '--mn-viewport-inset-bottom': SET_BY_ANOTHER_FILE,
  },
  'packages/components/src/choreo-agent-profile.ts': {
    '--mn-color-surface-warning': UNDEFINED_ROLE,
  },
  'packages/components/src/choreo-modes-surface.ts': {
    '--mn-color-surface': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-access-manager.ts': {
    '--mn-color-surface-danger': UNDEFINED_ROLE,
    '--mn-color-surface-success': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-advanced-wire-menu.ts': {
    '--mn-type-heading-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-app-bar.ts': {
    '--mn-app-bar-height': LAYOUT_KNOB,
  },
  'packages/components/src/mn-artifact-view.ts': {
    '--mn-color-surface-warning': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-auth-page.ts': {
    '--mn-auth-page-min-height': LAYOUT_KNOB,
    '--mn-color-success-text': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-badge.ts': {
    '--mn-badge-text-transform': TYPOGRAPHY_KNOB,
    '--mn-color-filetype-default': UNDEFINED_ROLE,
    '--mn-color-filetype-docx': UNDEFINED_ROLE,
    '--mn-color-filetype-epub': UNDEFINED_ROLE,
    '--mn-color-filetype-html': UNDEFINED_ROLE,
    '--mn-color-filetype-md': UNDEFINED_ROLE,
    '--mn-color-filetype-pdf': UNDEFINED_ROLE,
    '--mn-color-filetype-text': UNDEFINED_ROLE,
    '--mn-color-filetype-txt': UNDEFINED_ROLE,
    '--mn-type-label-family': TYPOGRAPHY_KNOB,
    '--mn-type-label-leading': TYPOGRAPHY_KNOB,
    '--mn-type-label-size': TYPOGRAPHY_KNOB,
    '--mn-type-label-tracking': TYPOGRAPHY_KNOB,
    '--mn-type-label-weight': TYPOGRAPHY_KNOB,
    '--mn-type-micro-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-button.ts': {
    '--mn-button-hit-size': SET_BY_ANOTHER_FILE,
  },
  'packages/components/src/mn-cloud-mode-panel.ts': {
    '--mn-color-text-disabled': UNDEFINED_ROLE,
    '--mn-type-label-tracking': TYPOGRAPHY_KNOB,
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-cloud-mode-pill.ts': {
    '--mn-color-text-disabled': UNDEFINED_ROLE,
    '--mn-type-label-tracking': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-comment-popover.ts': {
    '--mn-comment-popover-position': LAYOUT_KNOB,
  },
  'packages/components/src/mn-comments-panel.ts': {
    '--mn-panel-header-rule': LAYOUT_KNOB,
  },
  'packages/components/src/mn-context-menu.ts': {
    '--mn-context-menu-max-width': LAYOUT_KNOB,
    '--mn-context-menu-min-width': LAYOUT_KNOB,
  },
  'packages/components/src/mn-dialog.ts': {
    '--mn-type-heading-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-dropdown-button.ts': {
    '--mn-dropdown-max-width': LAYOUT_KNOB,
    '--mn-dropdown-min-width': LAYOUT_KNOB,
  },
  'packages/components/src/mn-editor-toolbar.ts': {
    '--mn-color-surface-danger-subtle': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-excalidraw-canvas.ts': {
    '--mn-color-accent-border': UNDEFINED_ROLE,
    '--mn-color-accent-surface': UNDEFINED_ROLE,
    '--mn-color-accent-text': UNDEFINED_ROLE,
    '--mn-color-canvas-bg': UNDEFINED_ROLE,
    '--mn-color-success-text': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-feedback-form.ts': {
    '--mn-feedback-form-modal-inset': LAYOUT_KNOB,
    '--mn-feedback-form-modal-position': LAYOUT_KNOB,
    '--mn-feedback-form-modal-z-index': LAYOUT_KNOB,
  },
  'packages/components/src/mn-folder-picker-dialog.ts': {
    '--mn-color-on-primary': UNDEFINED_ROLE,
    '--mn-color-overlay': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-icon-button.ts': {
    '--mn-icon-button-hit-size': SET_BY_ANOTHER_FILE,
  },
  'packages/components/src/mn-input-dialog.ts': {
    '--mn-control-height-lg': LAYOUT_KNOB,
  },
  'packages/components/src/mn-input.ts': {
    '--mn-color-surface-muted': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-inspector.ts': {
    '--mn-panel-header-rule': LAYOUT_KNOB,
  },
  'packages/components/src/mn-lifetime-banner.ts': {
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-sm-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-mobile-file-list.ts': {
    '--mn-type-heading-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-md-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-sm-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-panel-header.ts': {
    '--mn-panel-header-rule': LAYOUT_KNOB,
  },
  'packages/components/src/mn-public-shell.ts': {
    '--mn-color-highlight': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-research-workspace.ts': {
    '--mn-research-header-height': LAYOUT_KNOB,
    '--mn-research-trace-height': LAYOUT_KNOB,
  },
  'packages/components/src/mn-shortcuts-dialog.ts': {
    '--mn-type-heading-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-storage-banner.ts': {
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-sm-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-tag-autocomplete-popover.ts': {
    '--mn-tag-autocomplete-max-height': LAYOUT_KNOB,
    '--mn-tag-autocomplete-max-width': LAYOUT_KNOB,
    '--mn-tag-autocomplete-min-width': LAYOUT_KNOB,
  },
  'packages/components/src/mn-tag-chip-specimen.ts': {
    '--mn-font-editor': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-textarea.ts': {
    '--mn-color-surface-muted': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-timeline-rail.ts': {
    '--mn-color-secondary-strong': UNDEFINED_ROLE,
    '--mn-color-secondary-surface': UNDEFINED_ROLE,
  },
  'packages/components/src/mn-toolbar.ts': {
    '--mn-toolbar-gap': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-group-label-display': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-group-label-width': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-group-rule': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-group-width': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-group-wrap': SET_BY_ANOTHER_FILE,
    '--mn-toolbar-overflow-min-width': LAYOUT_KNOB,
  },
  'packages/components/src/mn-top-bar.ts': {
    '--mn-app-tile-flow': UNDEFINED_ROLE,
    '--mn-app-tile-grapevine': UNDEFINED_ROLE,
    '--mn-top-bar-compact-padding': LAYOUT_KNOB,
  },
  'packages/components/src/mn-tts-player.ts': {
    '--mn-tts-player-position': LAYOUT_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-upgrade-banner.ts': {
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-sm-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-wikilink-picker.ts': {
    '--mn-type-ui-md-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/components/src/mn-wire-menu-dropdown.ts': {
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
    '--mn-wire-menu-max-width': LAYOUT_KNOB,
    '--mn-wire-menu-min-width': LAYOUT_KNOB,
  },
  'packages/components/src/mn-wire-radial-overlay.ts': {
    '--mn-color-wire-200': UNDEFINED_ROLE,
    '--mn-color-wire-300': UNDEFINED_ROLE,
    '--mn-color-wire-400': UNDEFINED_ROLE,
    '--mn-color-wire-50': UNDEFINED_ROLE,
    '--mn-color-wire-500': UNDEFINED_ROLE,
    '--mn-color-wire-600': UNDEFINED_ROLE,
  },
  'packages/editor-kernel/src/extensions/comment-mark.ts': {
    '--mn-color-comment-bg': UNDEFINED_ROLE,
    '--mn-color-comment-bg-active': UNDEFINED_ROLE,
    '--mn-color-comment-bg-hover': UNDEFINED_ROLE,
    '--mn-color-comment-border': UNDEFINED_ROLE,
    '--mn-color-comment-border-active': UNDEFINED_ROLE,
  },
  'packages/editor-kernel/src/extensions/math.ts': {
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
  },
  'packages/hoja/src/hoja-editor.ts': {
    '--mn-color-text-disabled': UNDEFINED_ROLE,
    '--mn-focus-ring-color-soft': UNDEFINED_ROLE,
    '--mn-font-size-base': TYPOGRAPHY_KNOB,
    '--mn-font-ui': TYPOGRAPHY_KNOB,
    '--mn-radius-xs': UNDEFINED_ROLE,
  },
  'packages/runtime/src/center-panes-host.ts': {
    '--mn-font-ui': TYPOGRAPHY_KNOB,
  },
  'packages/runtime/src/editor-host.ts': {
    '--mn-color-marginalia-ink': UNDEFINED_ROLE,
    '--mn-margin-col': LAYOUT_KNOB,
    '--mn-text-marginalia': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/runtime/src/editor-services/value-face-view.ts': {
    '--mn-text-marginalia': TYPOGRAPHY_KNOB,
  },
  'packages/runtime/src/layout/faces/agent-entry-view-element.ts': {
    '--mn-kind-identity-text': UNDEFINED_ROLE,
    '--mn-kind-prose-text': UNDEFINED_ROLE,
  },
  'packages/runtime/src/layout/faces/filmstrip-face.ts': {
    '--mn-border': UNDEFINED_ROLE,
    '--mn-danger': UNDEFINED_ROLE,
    '--mn-surface-1': UNDEFINED_ROLE,
    '--mn-surface-2': UNDEFINED_ROLE,
    '--mn-text': UNDEFINED_ROLE,
  },
  'packages/runtime/src/layout/faces/inbox-room-view-element.ts': {
    '--mn-color-status-danger': UNDEFINED_ROLE,
    '--mn-color-status-good': UNDEFINED_ROLE,
    '--mn-kind-state-good': UNDEFINED_ROLE,
  },
  'packages/runtime/src/layout/faces/my-work-view-element.ts': {
    '--mn-color-status-danger': UNDEFINED_ROLE,
  },
  'packages/runtime/src/picker/install-glue.ts': {
    '--mn-type-ui-size': TYPOGRAPHY_KNOB,
    '--mn-type-ui-xs-size': TYPOGRAPHY_KNOB,
  },
  'packages/runtime/src/render-workspace.ts': {
    '--mn-radius-pill': UNDEFINED_ROLE,
  },
  'packages/runtime/src/wire-mode/wire-mode-overlays.ts': {
    '--mn-color-wire-target': UNDEFINED_ROLE,
  },
  'packages/runtime/src/wire-pinned-layer/wire-pinned-layer.ts': {
    '--mn-color-wire-200': UNDEFINED_ROLE,
    '--mn-color-wire-400': UNDEFINED_ROLE,
  },
}
