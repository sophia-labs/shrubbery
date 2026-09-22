/**
 * mn-sidebar-panel — Garden's left-rail document/tag shell, made controlled.
 *
 * The compact posture is a hierarchical outline. The expanded pane posture is
 * a Finder-style Miller-column browser, and a non-empty search query becomes a
 * third results topology. This preserves Garden's rich information architecture
 * while keeping data, preferences, persistence, and mutations host-owned.
 *
 * Data and behavior are host-owned. The component accepts section/node props and
 * emits composed intents; it never fetches, persists, opens files, or subscribes
 * to application state.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'
import type {
  FilePaneAction,
  FilePaneActionDetail,
  FilePaneCapabilities,
  FilePaneColumnPathChangeDetail,
  FilePaneDropPosition,
  FilePaneGroupingChangeDetail,
  FilePaneNodeDetail,
  FilePaneNodeDropDetail,
  FilePaneSelectionDetail,
  FilePaneSortChangeDetail,
  FilePaneStorage,
} from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, type IconName } from './icons.js'
import './mn-badge.js'
import {
  DEFAULT_FILE_PANE_GROUPING,
  DEFAULT_FILE_PANE_SORT,
  deriveFilePaneColumns,
  filterFilePaneNodes,
  findFilePaneNode,
  groupFilePaneSections,
  sortFilePaneNodes,
  validFilePanePath,
  type FilePaneGrouping,
  type FilePaneNode,
  type FilePaneNodeKind,
  type FilePanePresentation,
  type FilePaneResolvedPresentation,
  type FilePaneSection,
  type FilePaneSort,
  type FilePaneSortCriterion,
  type FilePaneStatus,
} from './file-pane-model.js'

export type MnSidebarNodeKind = FilePaneNodeKind
export type MnSidebarNode = FilePaneNode
export type MnSidebarSection = FilePaneSection
export type MnSidebarPresentation = FilePanePresentation
export type MnSidebarResolvedPresentation = FilePaneResolvedPresentation
export type MnSidebarSort = FilePaneSort
export type MnSidebarSortCriterion = FilePaneSortCriterion
export type MnSidebarGrouping = FilePaneGrouping
export type MnSidebarStatus = FilePaneStatus
export type MnSidebarAction = FilePaneAction
export type MnSidebarCapabilities = FilePaneCapabilities
export type MnSidebarStorage = FilePaneStorage
export type MnSidebarNodeDetail = FilePaneNodeDetail
export type MnSidebarDropPosition = FilePaneDropPosition
export type MnSidebarNodeDropDetail = FilePaneNodeDropDetail
export type MnSidebarActionDetail = FilePaneActionDetail
export type MnSidebarSelectionDetail = FilePaneSelectionDetail
export type MnSidebarSortChangeDetail = FilePaneSortChangeDetail
export type MnSidebarGroupingChangeDetail = FilePaneGroupingChangeDetail
export type MnSidebarColumnPathChangeDetail = FilePaneColumnPathChangeDetail

interface VisibleSidebarNode {
  readonly node: MnSidebarNode
  readonly level: number
  readonly siblingIndex: number
  readonly siblingCount: number
}

const DEFAULT_SECTIONS: readonly MnSidebarSection[] = [
  { id: 'documents', label: 'Documents', icon: 'file-text', emptyLabel: 'No documents' },
  { id: 'tags', label: 'Tags', icon: 'hash', emptyLabel: 'No tags' },
]

function defaultIcon(kind: MnSidebarNodeKind | undefined): IconName {
  switch (kind) {
    case 'folder':
      return 'folder'
    case 'tag':
      return 'hash'
    case 'artifact':
      return 'diamond'
    case 'document':
    default:
      return 'file-text'
  }
}

@customElement('mn-sidebar-panel')
export class MnSidebarPanel extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-panel-bg, var(--mn-color-surface-panel, #fff));
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: var(--mn-y-slice-1-height, 44px);
      padding: 0 var(--mn-space-3, 12px);
      border-bottom: var(--mn-panel-header-rule, 1px solid var(--mn-color-rule, #e5e7eb));
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 46%, transparent);
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .search-wrap {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 0;
    }

    .search-icon {
      position: absolute;
      left: 8px;
      display: inline-flex;
      color: var(--mn-color-text-tertiary, #9ca3af);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      min-width: 0;
      height: var(--mn-control-height, 28px);
      padding: 0 8px 0 30px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      box-sizing: border-box;
      box-shadow: var(--mn-shadow-xs, none);
      transition:
        border-color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease);
    }

    .search-input:focus {
      border-color: var(--mn-color-border-focus, #2563eb);
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: 0 0 auto;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mn-control-height, 28px);
      height: var(--mn-control-height, 28px);
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .icon-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .sidebar-controls {
      display: flex;
      min-height: 34px;
      align-items: center;
      gap: 4px;
      padding: 3px var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 24%, transparent);
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .sort-select {
      min-width: 0;
      height: 26px;
      flex: 1 1 130px;
      padding: 0 24px 0 7px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    .control-toggle[aria-pressed='true'] {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      color: var(--mn-color-text-accent, #3730a3);
      box-shadow: inset 0 0 0 1px var(--mn-color-border-accent, #2563eb);
    }

    .operational-banner {
      display: flex;
      min-height: 30px;
      align-items: center;
      gap: 7px;
      padding: 5px var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .operational-banner[data-status='error'] {
      background: color-mix(in srgb, var(--mn-color-danger, #dc2626) 8%, var(--mn-color-surface-raised, #fff));
      color: var(--mn-color-danger, #b91c1c);
    }

    .operational-banner[data-status='reconnecting'],
    .operational-banner[data-status='disconnected'] {
      background: color-mix(in srgb, var(--mn-color-warning, #b45309) 8%, var(--mn-color-surface-raised, #fff));
      color: var(--mn-color-warning-text, #92400e);
    }

    .operational-copy {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .storage {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 3px 8px;
      padding: 6px var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      flex: 0 0 auto;
    }

    .storage-track {
      grid-column: 1 / -1;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--mn-color-surface-sunken, #e5e7eb);
    }

    .storage-fill {
      height: 100%;
      border-radius: inherit;
      background: var(--mn-color-border-accent, #587451);
    }

    .selection-bar {
      display: flex;
      min-height: 32px;
      align-items: center;
      gap: 8px;
      padding: 3px var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-accent, #94a3b8);
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      color: var(--mn-color-text-accent, #3730a3);
      font-size: var(--mn-text-xs, 12px);
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .selection-copy {
      flex: 1 1 auto;
      font-weight: 650;
    }

    .sidebar-content {
      position: relative;
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      overflow: hidden;
    }

    .file-drop-overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 6px);
      background: var(--mn-color-surface-accent, rgba(61, 127, 95, 0.08));
      border: 2px dashed var(--mn-color-border-accent, #3d7f5f);
      border-radius: var(--mn-radius-md, 6px);
      color: var(--mn-color-text-accent, #3d7f5f);
      pointer-events: none;
    }

    .file-drop-icon {
      display: inline-flex;
    }

    .file-drop-label {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
    }

    .sections {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-3, 12px) 0 var(--mn-space-5, 20px);
    }

    .state-surface {
      display: grid;
      min-height: 150px;
      flex: 1 1 auto;
      place-items: center;
      padding: 24px;
      color: var(--mn-color-text-tertiary, #6b7280);
      text-align: center;
      box-sizing: border-box;
    }

    .state-card {
      display: grid;
      max-width: 30ch;
      gap: 7px;
      justify-items: center;
    }

    .state-title {
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-prose, Georgia, serif);
      font-weight: 650;
    }

    .columns-sections {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      overflow: auto;
      padding: 8px 0 12px;
    }

    .columns-section {
      display: flex;
      min-height: 152px;
      flex: 1 1 0;
      flex-direction: column;
      margin-bottom: 8px;
    }

    .columns-section-heading {
      display: flex;
      min-height: 28px;
      align-items: center;
      gap: 7px;
      padding: 0 12px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.055em;
      text-transform: uppercase;
      flex: 0 0 auto;
    }

    .columns {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      overflow-x: auto;
      overflow-y: hidden;
      border-block: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
      scroll-snap-type: x proximity;
    }

    .column {
      width: clamp(190px, 28vw, 280px);
      min-width: 190px;
      min-height: 0;
      overflow: auto;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      scroll-snap-align: end;
    }

    .column:last-child {
      flex: 1 0 190px;
    }

    .column-header {
      position: sticky;
      z-index: 1;
      top: 0;
      display: flex;
      min-height: 26px;
      align-items: center;
      padding: 0 10px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 88%, transparent);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .column-list {
      padding: 4px;
    }

    .column-row {
      display: flex;
      width: 100%;
      min-height: 30px;
      align-items: center;
      gap: 7px;
      padding: 0 7px;
      border: 0;
      border-radius: var(--mn-radius-control, 5px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .column-row:hover,
    .column-row.path-selected {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .column-row.selected,
    .column-row.active {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      color: var(--mn-color-text-accent, #3730a3);
    }

    .column-row:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }

    .column-label {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-prose, Georgia, serif);
    }

    .column-chevron {
      display: inline-flex;
      color: var(--mn-color-text-tertiary, #9ca3af);
      flex: 0 0 auto;
    }

    .section {
      margin-bottom: var(--mn-section-gap, 16px);
    }

    .section-header {
      display: flex;
      align-items: center;
      width: calc(100% - var(--mn-space-2, 8px));
      min-height: var(--mn-row-height, 28px);
      margin: 0 var(--mn-space-1, 4px) var(--mn-space-1, 4px);
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      box-sizing: border-box;
      text-align: left;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .section-header:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .section-heading {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      flex: 1 1 auto;
      min-width: 0;
      font-size: var(--mn-text-xs, 12px);
      font-weight: var(--mn-font-weight-semibold, 600);
      letter-spacing: 0.065em;
      text-transform: uppercase;
    }

    .section-count,
    .node-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      box-sizing: border-box;
    }

    .section-body[hidden] {
      display: none;
    }

    .tree {
      display: flex;
      flex-direction: column;
    }

    .tree-row {
      display: flex;
      align-items: center;
      width: calc(100% - var(--mn-space-2, 8px));
      min-height: var(--mn-row-height, 28px);
      margin: 0 var(--mn-space-1, 4px);
      padding: 0 var(--mn-space-2, 8px) 0 var(--mn-space-3, 12px);
      border: 0;
      border-left: 2px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease);
    }

    .tree-row:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .tree-row.focused:not(.selected):not(.active) {
      background: color-mix(in srgb, var(--mn-color-surface-hover, #f3f4f6) 72%, transparent);
      box-shadow: inset 0 0 0 1px var(--mn-color-border-focus, #2563eb);
    }

    .tree-row.selected,
    .tree-row.active {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      border-left-color: var(--mn-color-border-accent, #2563eb);
      font-weight: var(--mn-font-weight-medium, 500);
    }

    .tree-row.disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .tree-row[draggable='true'] {
      cursor: grab;
    }

    .tree-row[draggable='true']:active {
      cursor: grabbing;
    }

    .tree-row.dragging {
      opacity: 0.45;
    }

    .tree-row.drop-inside {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      box-shadow: inset 0 0 0 2px var(--mn-color-border-accent, #2563eb);
    }

    .tree-row.drop-before::before,
    .tree-row.drop-after::after {
      position: absolute;
      right: var(--mn-space-2, 8px);
      left: calc(var(--mn-space-3, 12px) + (var(--mn-tree-indent, 14px) * var(--level)));
      height: 2px;
      border-radius: 999px;
      background: var(--mn-color-border-accent, #2563eb);
      content: '';
      pointer-events: none;
    }

    .tree-row.drop-before::before {
      top: -1px;
    }

    .tree-row.drop-after::after {
      bottom: -1px;
    }

    .tree-row.drop-before,
    .tree-row.drop-after {
      position: relative;
    }

    .indent {
      flex: 0 0 auto;
      width: calc(var(--mn-tree-indent, 14px) * var(--level));
      min-width: 0;
    }

    .expand {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-right: 2px;
      color: var(--mn-color-text-tertiary, #9ca3af);
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      cursor: pointer;
      transition: transform var(--mn-transition-fast, 120ms ease);
    }

    .expand.expanded {
      transform: rotate(90deg);
    }

    .expand.empty {
      visibility: hidden;
      pointer-events: none;
    }

    .node-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-right: var(--mn-space-2, 8px);
      color: var(--mn-color-text-secondary, #4b5563);
      flex: 0 0 auto;
    }

    .tree-row[data-kind='folder'] .node-icon {
      color: var(--mn-color-text-warning, #b45309);
    }

    .tree-row[data-kind='artifact'] .node-icon {
      color: var(--mn-color-info, #2563eb);
    }

    .tree-row[data-status='uploading'] .node-icon,
    .tree-row[data-status='processing'] .node-icon {
      animation: sidebarNodePulse 1.2s ease-in-out infinite;
    }

    .tree-row[data-status='error'] .node-icon {
      color: var(--mn-color-danger, #dc2626);
    }

    @keyframes sidebarNodePulse {
      50% { opacity: 0.45; }
    }

    .label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-prose, Georgia, serif);
      letter-spacing: -0.005em;
    }

    /* mn-badge (master §3 Slice 4) owns its own look (pill, tone colors,
       sizing) via its shadow DOM; this host-level rule is spacing only. */
    .badge {
      margin-left: var(--mn-space-2, 8px);
      flex-shrink: 0;
    }

    .node-menu {
      margin-left: 2px;
      opacity: 0;
      transition: opacity var(--mn-transition-fast, 120ms ease);
    }

    .tree-row:hover .node-menu,
    .tree-row:focus-within .node-menu {
      opacity: 1;
    }

    .empty {
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
    }

    :host([data-skin='emporium']) {
      border-right: var(--mn-rule-line, 1px solid var(--mn-color-border-default, #d1d5db));
    }

    :host([data-skin='emporium']) .search-input,
    :host([data-skin='emporium']) .sort-select,
    :host([data-skin='emporium']) .icon-button,
    :host([data-skin='emporium']) .section-header,
    :host([data-skin='emporium']) .column-row {
      border-radius: var(--mn-radius-control, 0);
    }

    :host([data-skin='98']) {
      border-right: 2px groove var(--mn-98-face);
      background: var(--mn-98-face);
    }
    :host([data-skin='98']) :is(.search-input, .sort-select) {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) :is(.icon-button, .section-header, .node-menu, .column-row) {
      border-radius: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) :is(.tree-row, .column-row):is(:hover, [data-selected='true'], [aria-pressed='true']) {
      border-radius: 0;
      background: var(--mn-98-selection);
      color: #fff;
    }
    :host([data-skin='glass']) {
      border-right: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-panel);
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.4);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) :is(.search-input, .sort-select) {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
    }
    :host([data-skin='glass']) :is(.icon-button, .section-header, .node-menu, .column-row) {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) :is(.tree-row, .column-row):is(:hover, [data-selected='true'], [aria-pressed='true']) {
      background: var(--mn-color-interactive-selected);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
    }

    .icon-button:focus-visible,
    .section-header:focus-visible,
    .tree-row:focus-visible,
    .sort-select:focus-visible,
    .column-row:focus-visible,
    .node-menu:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }

    @media (prefers-reduced-motion: reduce) {
      .tree-row[data-status='uploading'] .node-icon,
      .tree-row[data-status='processing'] .node-icon {
        animation: none;
      }
    }
  `

  @property({ attribute: false }) sections: readonly MnSidebarSection[] = DEFAULT_SECTIONS
  @property({ type: String }) searchQuery = ''
  @property({ type: String }) selectedId: string | null = null
  @property({ type: String }) activeId: string | null = null
  @property({ type: Boolean }) showHeaderActions = true
  @property({ type: String }) searchPlaceholder = 'Search'
  @property({ type: String, reflect: true }) presentation: MnSidebarPresentation = 'tree'
  @property({ attribute: false }) sort: MnSidebarSort = DEFAULT_FILE_PANE_SORT
  @property({ attribute: false }) grouping: MnSidebarGrouping = DEFAULT_FILE_PANE_GROUPING
  @property({ attribute: false }) selectedIds: readonly string[] | null = null
  @property({ attribute: false }) columnPaths: Readonly<Record<string, readonly string[]>> | null = null
  @property({ type: String }) status: MnSidebarStatus = 'ready'
  @property({ type: String }) error = ''
  @property({ attribute: false }) storage: MnSidebarStorage | null = null
  @property({ attribute: false }) capabilities: MnSidebarCapabilities | null = null

  @state() private locallyCollapsed = new Set<string>()
  @state() private focusedNodeId: string | null = null
  @state() private draggedNodeId: string | null = null
  @state() private fileDropActive = false
  @state() private dropTargetId: string | null = null
  @state() private dropPosition: MnSidebarDropPosition | null = null
  @state() private localSelectedIds = new Set<string>()
  @state() private localColumnPaths = new Map<string, readonly string[]>()
  private selectionAnchorId: string | null = null

  private _hasCapability(capability: keyof MnSidebarCapabilities): boolean {
    // Null preserves the legacy fully-interactive component contract. Once a
    // host supplies a capability object it is strict: omitted permissions are
    // unavailable, never optimistically exposed.
    return this.capabilities === null ? true : this.capabilities[capability] === true
  }

  private _resolvedPresentation(): MnSidebarResolvedPresentation {
    return this.searchQuery.trim() ? 'search-results' : this.presentation
  }

  private _displaySections(): MnSidebarSection[] {
    return groupFilePaneSections(
      this.sections.length > 0 ? this.sections : DEFAULT_SECTIONS,
      this.grouping,
    ).map(section => ({
      ...section,
      nodes: sortFilePaneNodes(section.nodes ?? [], this.sort),
    }))
  }

  private _selectedIdSet(): ReadonlySet<string> {
    if (this.selectedIds !== null) return new Set(this.selectedIds)
    if (this.localSelectedIds.size > 0) return this.localSelectedIds
    return new Set([this.selectedId, this.activeId].filter((id): id is string => Boolean(id)))
  }

  private _columnPath(sectionId: string): readonly string[] {
    return validFilePanePath(
      this._displaySections().find(section => section.id === sectionId)
        ?? { id: sectionId, label: sectionId, nodes: [] },
      this.columnPaths?.[sectionId] ?? this.localColumnPaths.get(sectionId) ?? [],
    )
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value
    this._emit('mn-sidebar-search-change', { query })
  }

  private _toggleSection(section: MnSidebarSection): void {
    const collapsed = this._sectionCollapsed(section)
    const nextCollapsed = !collapsed
    if (section.collapsed === undefined) {
      const next = new Set(this.locallyCollapsed)
      if (nextCollapsed) next.add(section.id)
      else next.delete(section.id)
      this.locallyCollapsed = next
    }
    this._emit('mn-sidebar-section-toggle', { id: section.id, collapsed: nextCollapsed, section })
  }

  private _sectionCollapsed(section: MnSidebarSection): boolean {
    return section.collapsed ?? this.locallyCollapsed.has(section.id)
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed)
    const changedKeys = changed as ReadonlyMap<PropertyKey, unknown>
    if (
      changedKeys.has('sections')
      || changedKeys.has('searchQuery')
      || changedKeys.has('selectedId')
      || changedKeys.has('selectedIds')
      || changedKeys.has('activeId')
      || changedKeys.has('locallyCollapsed')
      || changedKeys.has('presentation')
      || changedKeys.has('sort')
      || changedKeys.has('grouping')
      || changedKeys.has('columnPaths')
    ) {
      const visible = this._visibleNodes()
      if (!visible.some(({ node }) => node.id === this.focusedNodeId && !node.disabled)) {
        const preferred = visible.find(({ node }) =>
          !node.disabled && (node.id === this.selectedId || node.id === this.activeId),
        ) ?? visible.find(({ node }) => !node.disabled)
        this.focusedNodeId = preferred?.node.id ?? null
      }
    }
    if (
      changedKeys.has('capabilities')
      && this.fileDropActive
      && !this._hasCapability('upload')
    ) {
      this.fileDropActive = false
    }
  }

  private _visibleNodes(): VisibleSidebarNode[] {
    const query = this.searchQuery.trim().toLocaleLowerCase()
    const visible: VisibleSidebarNode[] = []
    const sections = this._displaySections()
    if (this._resolvedPresentation() === 'columns') {
      for (const section of sections.filter(candidate => candidate.id === 'documents' || candidate.id === 'artifacts')) {
        for (const [level, column] of deriveFilePaneColumns(section, this._columnPath(section.id), this.sort).entries()) {
          column.nodes.forEach((node, siblingIndex) => {
            visible.push({ node, level, siblingIndex, siblingCount: column.nodes.length })
          })
        }
      }
      return visible
    }
    const visit = (nodes: readonly MnSidebarNode[], level: number): void => {
      nodes.forEach((node, siblingIndex) => {
        visible.push({ node, level, siblingIndex, siblingCount: nodes.length })
        if (node.expanded && node.children?.length) visit(node.children, level + 1)
      })
    }
    for (const section of sections) {
      if (this._sectionCollapsed(section)) continue
      visit(filterFilePaneNodes(section.nodes ?? [], query), 0)
    }
    return visible
  }

  private _nodeById(id: string | null): MnSidebarNode | null {
    if (!id) return null
    const visit = (nodes: readonly MnSidebarNode[]): MnSidebarNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node
        const child = node.children?.length ? visit(node.children) : null
        if (child) return child
      }
      return null
    }
    for (const section of this.sections) {
      const node = visit(section.nodes ?? [])
      if (node) return node
    }
    return findFilePaneNode(this.sections.flatMap(section => section.nodes ?? []), id)
  }

  private _parentOf(id: string): MnSidebarNode | null {
    const visit = (nodes: readonly MnSidebarNode[], parent: MnSidebarNode | null): MnSidebarNode | null => {
      for (const node of nodes) {
        if (node.id === id) return parent
        const nested = node.children?.length ? visit(node.children, node) : null
        if (nested) return nested
      }
      return null
    }
    for (const section of this.sections) {
      const parent = visit(section.nodes ?? [], null)
      if (parent) return parent
    }
    return null
  }

  private _containsNode(ancestor: MnSidebarNode, candidateId: string): boolean {
    return (ancestor.children ?? []).some((child) =>
      child.id === candidateId || this._containsNode(child, candidateId),
    )
  }

  private _setFocus(id: string): void {
    const node = this._nodeById(id)
    if (!node || node.disabled) return
    this.focusedNodeId = id
    void this.updateComplete.then(() => {
      const row = Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])
        .find(candidate => candidate.dataset.nodeId === id)
      row?.focus()
      row?.scrollIntoView?.({ block: 'nearest' })
    })
  }

  private _moveFocus(delta: -1 | 1): void {
    const visible = this._visibleNodes().filter(({ node }) => !node.disabled)
    if (visible.length === 0) return
    const current = visible.findIndex(({ node }) => node.id === this.focusedNodeId)
    const next = current < 0
      ? 0
      : Math.max(0, Math.min(visible.length - 1, current + delta))
    this._setFocus(visible[next].node.id)
  }

  private _openNode(node: MnSidebarNode): void {
    if (node.disabled) return
    this.focusedNodeId = node.id
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-open', { id: node.id, node })
  }

  private _intentNode(node: MnSidebarNode): void {
    // master §3 Slice 8 (WS3 §5.3 REPAIR, C-D26): hover/focus prefetch of a
    // read-only row (e.g. a parked-work row naming a document that no
    // longer exists) is a guaranteed failed fetch. The general rule for
    // every read-only row, not a parked-work special case.
    if (node.disabled || node.readOnly || (node.kind ?? 'document') !== 'document') return
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-intent', { id: node.id, node })
  }

  private _endIntentNode(node: MnSidebarNode): void {
    if (node.disabled || node.readOnly || (node.kind ?? 'document') !== 'document') return
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-intent-end', { id: node.id, node })
  }

  private _selectionNodes(ids: ReadonlySet<string>): MnSidebarNode[] {
    return [...ids]
      .map(id => this._nodeById(id))
      .filter((node): node is MnSidebarNode => node !== null && !node.disabled)
  }

  private _commitSelection(ids: ReadonlySet<string>, anchorId: string | null): void {
    const nodes = this._selectionNodes(ids)
    const normalized = new Set(nodes.map(node => node.id))
    if (this.selectedIds === null) this.localSelectedIds = normalized
    this.selectionAnchorId = anchorId
    this._emit<MnSidebarSelectionDetail>('mn-sidebar-selection-change', {
      ids: [...normalized],
      nodes,
      anchorId,
    })
  }

  private _selectFromPointer(event: MouseEvent, node: MnSidebarNode): boolean {
    const multi = this._hasCapability('multiSelect')
    const additive = multi && (event.metaKey || event.ctrlKey)
    const ranged = multi && event.shiftKey
    const current = new Set(this._selectedIdSet())
    if (ranged) {
      const visible = this._visibleNodes().map(candidate => candidate.node).filter(candidate => !candidate.disabled)
      const anchor = this.selectionAnchorId ?? [...current].at(-1) ?? node.id
      const anchorIndex = visible.findIndex(candidate => candidate.id === anchor)
      const targetIndex = visible.findIndex(candidate => candidate.id === node.id)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex]
        const next = additive ? current : new Set<string>()
        for (const candidate of visible.slice(start, end + 1)) next.add(candidate.id)
        this._commitSelection(next, anchor)
        return true
      }
    }
    if (additive) {
      if (current.has(node.id)) current.delete(node.id)
      else current.add(node.id)
      this._commitSelection(current, node.id)
      return true
    }
    this._commitSelection(new Set([node.id]), node.id)
    return false
  }

  private _onNodeKeyDown(event: KeyboardEvent, node: MnSidebarNode): void {
    if (event.target !== event.currentTarget) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        this._moveFocus(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        this._moveFocus(-1)
        return
      case 'Home': {
        event.preventDefault()
        const first = this._visibleNodes().find(({ node: candidate }) => !candidate.disabled)
        if (first) this._setFocus(first.node.id)
        return
      }
      case 'End': {
        event.preventDefault()
        const enabled = this._visibleNodes().filter(({ node: candidate }) => !candidate.disabled)
        const last = enabled.at(-1)
        if (last) this._setFocus(last.node.id)
        return
      }
      case 'ArrowRight':
        if (node.kind !== 'folder' || !node.children?.length) return
        event.preventDefault()
        if (!node.expanded) {
          this._emit<MnSidebarNodeDetail>('mn-sidebar-node-toggle', { id: node.id, node })
        } else {
          const child = node.children?.find(candidate => !candidate.disabled)
          if (child) this._setFocus(child.id)
        }
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (node.kind === 'folder' && node.expanded) {
          this._emit<MnSidebarNodeDetail>('mn-sidebar-node-toggle', { id: node.id, node })
          return
        }
        {
          const parent = this._parentOf(node.id)
          if (parent) this._setFocus(parent.id)
        }
        return
      case 'Enter':
        event.preventDefault()
        this._openNode(node)
        return
      case ' ':
        event.preventDefault()
        if (node.kind === 'folder') {
          this._emit<MnSidebarNodeDetail>('mn-sidebar-node-toggle', { id: node.id, node })
        } else {
          this._openNode(node)
        }
        return
      case 'F2': {
        event.preventDefault()
        const active = this._nodeById(this.activeId) ?? node
        if (active.kind !== 'tag') this._nodeAction('rename', active)
        return
      }
      case 'Delete':
        event.preventDefault()
        if (node.kind !== 'tag') this._nodeAction('delete', node)
        return
      default:
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const query = event.key.toLocaleLowerCase()
        const visible = this._visibleNodes().filter(({ node: candidate }) => !candidate.disabled)
        const current = visible.findIndex(({ node: candidate }) => candidate.id === node.id)
        for (let offset = 1; offset <= visible.length; offset += 1) {
          const candidate = visible[(Math.max(current, 0) + offset) % visible.length]?.node
          if (candidate?.label.toLocaleLowerCase().startsWith(query)) {
            event.preventDefault()
            this._setFocus(candidate.id)
            return
          }
        }
    }
  }

  private _onNodeClick(event: MouseEvent, node: MnSidebarNode): void {
    if (node.disabled) return
    this.focusedNodeId = node.id
    const selectionOnly = this._selectFromPointer(event, node)
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-select', { id: node.id, node })
    if (!selectionOnly) this._openNode(node)
    ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  }

  private _toggleNode(event: MouseEvent, node: MnSidebarNode): void {
    event.stopPropagation()
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-toggle', { id: node.id, node })
  }

  private _nodeMenu(event: MouseEvent, node: MnSidebarNode): void {
    event.stopPropagation()
    const selected = this._selectedIdSet()
    const nodes = selected.has(node.id) && selected.size > 1
      ? this._selectionNodes(selected)
      : [node]
    this._emit<MnSidebarActionDetail>('mn-sidebar-action', {
      action: 'node-menu',
      nodeId: node.id,
      node,
      nodeIds: nodes.map(candidate => candidate.id),
      nodes,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }

  private _nodeAction(action: 'rename' | 'delete', node: MnSidebarNode): void {
    const selected = this._selectedIdSet()
    const nodes = action === 'delete' && selected.has(node.id) && selected.size > 1
      ? this._selectionNodes(selected)
      : [node]
    this._emit<MnSidebarActionDetail>('mn-sidebar-action', {
      action,
      nodeId: node.id,
      node,
      nodeIds: nodes.map(candidate => candidate.id),
      nodes,
    })
  }

  private _onNodeContextMenu(event: MouseEvent, node: MnSidebarNode): void {
    if (node.disabled) return
    event.preventDefault()
    this.focusedNodeId = node.id
    if (!this._selectedIdSet().has(node.id)) this._commitSelection(new Set([node.id]), node.id)
    this._nodeMenu(event, node)
  }

  /**
   * OS-file drops (real Files, not our own internal node-reorder drag —
   * see _onDragStart's setData calls, which never use the 'Files' type) land
   * here regardless of which specific tree node the pointer happens to be
   * over, matching Garden's "drop anywhere in the sidebar" upload zone.
   */
  private _isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
  }

  private _onSidebarDragOver(event: DragEvent): void {
    if (!this._isFileDrag(event)) return
    // preventDefault unconditionally so the browser never navigates away to
    // open the dropped file — capability only gates whether we advertise/
    // accept the drop as an upload, not whether we swallow the OS default.
    event.preventDefault()
    if (!this._hasCapability('upload')) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      return
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    if (!this.fileDropActive) this.fileDropActive = true
  }

  private _onSidebarDragLeave(event: DragEvent): void {
    // dragleave fires for every child boundary crossing too — only clear
    // the active state once the pointer has actually left the container.
    const next = event.relatedTarget as Node | null
    if (next && (event.currentTarget as HTMLElement).contains(next)) return
    this.fileDropActive = false
  }

  private _onSidebarDrop(event: DragEvent): void {
    if (!this._isFileDrag(event)) return
    event.preventDefault()
    this.fileDropActive = false
    if (!this._hasCapability('upload')) return
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return
    this.dispatchEvent(new CustomEvent<FileList>('mn-sidebar-file-drop', {
      detail: files,
      bubbles: true,
      composed: true,
    }))
  }

  private _canDrag(node: MnSidebarNode): boolean {
    // master §3 Slice 8 (WS3 §5.3 REPAIR, C-D26): a read-only row is not a
    // movable one — this is the honest general rule, not a parked-work
    // special case. Without it a parked row (a record about a previous
    // life) could be dropped into a folder and issue a real move.
    return this._hasCapability('dragDrop')
      && !node.disabled
      && !node.readOnly
      && (node.kind === 'document' || node.kind === 'folder')
  }

  private _onDragStart(event: DragEvent, node: MnSidebarNode): void {
    if (!this._canDrag(node) || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    this.draggedNodeId = node.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', node.id)
    event.dataTransfer.setData('application/x-shrubbery-sidebar-node', JSON.stringify({
      id: node.id,
      kind: node.kind,
      parentId: node.parentId ?? null,
      section: node.section ?? null,
    }))
  }

  private _dropAllowed(source: MnSidebarNode, target: MnSidebarNode): boolean {
    if (source.id === target.id || target.disabled || target.kind === 'tag') return false
    if (source.section && target.section && source.section !== target.section) return false
    if (source.kind === 'folder' && this._containsNode(source, target.id)) return false
    return true
  }

  private _onDragOver(event: DragEvent, target: MnSidebarNode): void {
    const source = this._nodeById(this.draggedNodeId)
    if (!source || !event.dataTransfer || !this._dropAllowed(source, target)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const height = rect.height || 28
    const offset = Math.max(0, Math.min(height, event.clientY - rect.top))
    let position: MnSidebarDropPosition
    if (target.kind === 'folder') {
      position = offset < height * 0.25 ? 'before' : offset > height * 0.75 ? 'after' : 'inside'
    } else {
      position = offset < height * 0.5 ? 'before' : 'after'
    }
    this.dropTargetId = target.id
    this.dropPosition = position
  }

  private _onDragLeave(event: DragEvent, target: MnSidebarNode): void {
    if (target.id !== this.dropTargetId) return
    const related = event.relatedTarget
    if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return
    this.dropTargetId = null
    this.dropPosition = null
  }

  private _onDrop(event: DragEvent, target: MnSidebarNode): void {
    // OS file drops must bubble past row targets to the container-level
    // _onSidebarDrop handler — only intercept our own internal reorder drags.
    if (this._isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    const source = this._nodeById(this.draggedNodeId)
    const position = this.dropTargetId === target.id ? this.dropPosition : null
    this._clearDragState()
    if (!source || !position || !this._dropAllowed(source, target)) return
    this._emit<MnSidebarNodeDropDetail>('mn-sidebar-node-drop', {
      sourceId: source.id,
      source,
      targetId: target.id,
      target,
      position,
    })
  }

  private _clearDragState(): void {
    this.draggedNodeId = null
    this.dropTargetId = null
    this.dropPosition = null
  }

  private _action(action: MnSidebarAction): void {
    this._emit<MnSidebarActionDetail>('mn-sidebar-action', { action })
  }

  private _changeSort(criterion: MnSidebarSortCriterion): void {
    const direction = criterion === this.sort.criterion
      ? this.sort.direction
      : criterion === 'alphabetical' || criterion === 'manual' ? 'asc' : 'desc'
    this._emit<MnSidebarSortChangeDetail>('mn-sidebar-sort-change', {
      sort: { ...this.sort, criterion, direction },
    })
  }

  private _reverseSort(): void {
    this._emit<MnSidebarSortChangeDetail>('mn-sidebar-sort-change', {
      sort: { ...this.sort, direction: this.sort.direction === 'asc' ? 'desc' : 'asc' },
    })
  }

  private _toggleGrouping(key: keyof MnSidebarGrouping): void {
    this._emit<MnSidebarGroupingChangeDetail>('mn-sidebar-grouping-change', {
      grouping: { ...this.grouping, [key]: !this.grouping[key] },
    })
  }

  private _commitColumnPath(sectionId: string, folderIds: readonly string[]): void {
    if (this.columnPaths === null) {
      const next = new Map(this.localColumnPaths)
      next.set(sectionId, [...folderIds])
      this.localColumnPaths = next
    }
    this._emit<MnSidebarColumnPathChangeDetail>('mn-sidebar-column-path-change', {
      sectionId,
      folderIds: [...folderIds],
    })
    void this.updateComplete.then(() => {
      const section = Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>('[data-columns-section]') ?? [])
        .find(candidate => candidate.dataset.columnsSection === sectionId)
      const columns = section?.querySelector<HTMLElement>('.columns')
      if (columns) columns.scrollLeft = columns.scrollWidth
    })
  }

  private _onColumnNodeClick(
    event: MouseEvent,
    section: MnSidebarSection,
    node: MnSidebarNode,
    columnIndex: number,
  ): void {
    if (node.disabled) return
    this.focusedNodeId = node.id
    const selectionOnly = this._selectFromPointer(event, node)
    this._emit<MnSidebarNodeDetail>('mn-sidebar-node-select', { id: node.id, node })
    if (!selectionOnly && node.kind === 'folder') {
      const next = [...this._columnPath(section.id).slice(0, columnIndex), node.id]
      this._commitColumnPath(section.id, next)
    } else if (!selectionOnly) {
      this._openNode(node)
    }
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.focus({ preventScroll: true })
    }
  }

  private _onColumnNodeKeyDown(
    event: KeyboardEvent,
    section: MnSidebarSection,
    node: MnSidebarNode,
    columnIndex: number,
  ): void {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || (event.key === 'ArrowRight' && node.kind === 'folder')) {
      event.preventDefault()
      this._onColumnNodeClick(new MouseEvent('click'), section, node, columnIndex)
      return
    }
    if (event.key === 'ArrowLeft' && columnIndex > 0) {
      event.preventDefault()
      const next = this._columnPath(section.id).slice(0, Math.max(0, columnIndex - 1))
      this._commitColumnPath(section.id, next)
      const parentId = this._columnPath(section.id)[columnIndex - 1]
      if (parentId) this._setFocus(parentId)
    }
  }

  private _renderColumnNode(
    section: MnSidebarSection,
    node: MnSidebarNode,
    columnIndex: number,
  ): TemplateResult {
    const selected = node.selected || this._selectedIdSet().has(node.id)
    const active = node.active || node.id === this.activeId
    const pathSelected = this._columnPath(section.id)[columnIndex] === node.id
    const kind = node.kind ?? 'document'
    const nodeIcon = node.status === 'uploading' || node.status === 'processing'
      ? 'loader'
      : node.status === 'error'
        ? 'alert-circle'
        : node.icon ?? defaultIcon(kind)
    return html`
      <button
        type="button"
        class=${classMap({
          'column-row': true,
          selected,
          active,
          'path-selected': pathSelected,
        })}
        data-column-node
        data-node-id=${node.id}
        data-kind=${kind}
        data-status=${node.status ?? nothing}
        aria-pressed=${selected ? 'true' : 'false'}
        aria-current=${active ? 'page' : nothing}
        ?disabled=${node.disabled}
        draggable=${this._canDrag(node) ? 'true' : 'false'}
        @click=${(event: MouseEvent) => this._onColumnNodeClick(event, section, node, columnIndex)}
        @keydown=${(event: KeyboardEvent) => this._onColumnNodeKeyDown(event, section, node, columnIndex)}
        @contextmenu=${(event: MouseEvent) => this._onNodeContextMenu(event, node)}
        @dragstart=${(event: DragEvent) => this._onDragStart(event, node)}
        @dragend=${() => this._clearDragState()}
        @dragover=${(event: DragEvent) => this._onDragOver(event, node)}
        @dragleave=${(event: DragEvent) => this._onDragLeave(event, node)}
        @drop=${(event: DragEvent) => this._onDrop(event, node)}
      >
        <span class="node-icon" aria-hidden="true">${icon(nodeIcon as IconName, { size: 15 })}</span>
        <span class="column-label">${node.label}</span>
        ${node.badge || node.status
          ? html`<mn-badge
              class="badge"
              part="badge"
              size="sm"
              state=${node.badgeTone ?? 'neutral'}
              label=${node.badge ?? node.status ?? ''}
              data-source-state=${node.sourceState ?? nothing}
            ></mn-badge>`
          : nothing}
        ${node.kind === 'folder'
          ? html`<span class="column-chevron" aria-hidden="true">${icon('chevron-right', { size: 14 })}</span>`
          : nothing}
      </button>
    `
  }

  private _renderColumnsSection(section: MnSidebarSection): TemplateResult {
    const columns = deriveFilePaneColumns(section, this._columnPath(section.id), this.sort)
    const count = this._sectionCount(section, section.nodes ?? [])
    return html`
      <section class="columns-section" data-columns-section=${section.id}>
        <div class="columns-section-heading">
          ${icon((section.icon ?? 'file-text') as IconName, { size: 14 })}
          <span>${section.label}</span>
          ${count === null ? nothing : html`<span class="section-count">${count}</span>`}
        </div>
        <div class="columns" role="group" aria-label=${`${section.label} columns`}>
          ${columns.map((column, columnIndex) => html`
            <div class="column" data-column-index=${columnIndex} data-parent-id=${column.parentId ?? ''}>
              <div class="column-header">${column.parentLabel}</div>
              <div class="column-list">
                ${column.nodes.length > 0
                  ? column.nodes.map(node => this._renderColumnNode(section, node, columnIndex))
                  : html`<div class="empty">Empty folder</div>`}
              </div>
            </div>
          `)}
        </div>
      </section>
    `
  }

  private _renderControls(): TemplateResult | typeof nothing {
    if (!this._hasCapability('sort') && !this._hasCapability('group')) return nothing
    return html`
      <div class="sidebar-controls" aria-label="File organization controls">
        ${this._hasCapability('sort')
          ? html`
              <select
                class="sort-select"
                aria-label="Sort files"
                .value=${this.sort.criterion}
                @change=${(event: Event) => this._changeSort(
                  (event.target as HTMLSelectElement).value as MnSidebarSortCriterion,
                )}
              >
                <option value="manual">Manual order</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="created">Date created</option>
                <option value="last-accessed">Last accessed</option>
                <option value="connectivity">Most connected</option>
              </select>
              <button
                type="button"
                class="icon-button"
                aria-label=${this.sort.direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
                title=${this.sort.direction === 'asc' ? 'Ascending' : 'Descending'}
                @click=${this._reverseSort}
              >${icon(this.sort.direction === 'asc' ? 'arrow-up' : 'arrow-down', { size: 15 })}</button>
            `
          : nothing}
        ${this._hasCapability('group')
          ? html`
              <button
                type="button"
                class="icon-button control-toggle"
                aria-label="Separate artifacts"
                title="Separate artifacts"
                aria-pressed=${String(this.grouping.separateArtifacts)}
                @click=${() => this._toggleGrouping('separateArtifacts')}
              >${icon('layers', { size: 15 })}</button>
              <button
                type="button"
                class="icon-button control-toggle"
                aria-label="Show folders"
                title="Show folders"
                aria-pressed=${String(this.grouping.showFolders)}
                @click=${() => this._toggleGrouping('showFolders')}
              >${icon('folder', { size: 15 })}</button>
            `
          : nothing}
      </div>
    `
  }

  private _renderOperationalBanner(): TemplateResult | typeof nothing {
    if (this.status === 'ready' || this.status === 'idle' || this.status === 'loading') return nothing
    const copy = this.status === 'error'
      ? this.error.trim() || 'Could not load files.'
      : this.status === 'reconnecting'
        ? 'Reconnecting… showing the last synchronized file tree.'
        : 'Disconnected — showing the last synchronized file tree.'
    return html`
      <div class="operational-banner" data-status=${this.status} role=${this.status === 'error' ? 'alert' : 'status'}>
        ${icon(this.status === 'error' ? 'alert-circle' : 'wifi-off', { size: 14 })}
        <span class="operational-copy">${copy}</span>
        ${this._hasCapability('refresh')
          ? html`<button type="button" class="icon-button" aria-label="Refresh files" @click=${() => this._action('refresh')}>
              ${icon('refresh', { size: 14 })}
            </button>`
          : nothing}
      </div>
    `
  }

  private _renderStorage(): TemplateResult | typeof nothing {
    const storage = this.storage
    if (!storage || !Number.isFinite(storage.limitBytes) || storage.limitBytes <= 0) return nothing
    const used = Math.max(0, Number.isFinite(storage.usedBytes) ? storage.usedBytes : 0)
    const percent = Math.max(0, Math.min(100, (used / storage.limitBytes) * 100))
    const format = (bytes: number): string => {
      if (bytes < 1024) return `${Math.round(bytes)} B`
      if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
      if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
      return `${(bytes / 1024 ** 3).toFixed(1)} GB`
    }
    return html`
      <div class="storage" data-storage-percent=${Math.round(percent)}>
        <span>${storage.label?.trim() || 'Graph storage'}</span>
        <span>${format(used)} / ${format(storage.limitBytes)}</span>
        <div class="storage-track" role="progressbar" aria-label="Graph storage" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(percent)}>
          <div class="storage-fill" style=${`width:${percent}%`}></div>
        </div>
      </div>
    `
  }

  private _renderSelectionBar(): TemplateResult | typeof nothing {
    const selected = this._selectedIdSet()
    if (!this._hasCapability('multiSelect') || selected.size <= 1) return nothing
    const nodes = this._selectionNodes(selected)
    return html`
      <div class="selection-bar" role="status">
        <span class="selection-copy">${nodes.length} items selected</span>
        ${this._hasCapability('contextMenu')
          ? html`<button
              type="button"
              class="icon-button"
              aria-label="Selected item actions"
              @click=${(event: MouseEvent) => this._nodeMenu(event, nodes[0])}
            >${icon('more-horizontal', { size: 15 })}</button>`
          : nothing}
        <button
          type="button"
          class="icon-button"
          aria-label="Clear selection"
          @click=${() => this._commitSelection(new Set(), null)}
        >${icon('close', { size: 14 })}</button>
      </div>
    `
  }

  private _renderUnavailableState(): TemplateResult | typeof nothing {
    const hasItems = this._displaySections().some(section => (section.nodes?.length ?? 0) > 0)
    if (hasItems || this.status === 'ready' || this.status === 'reconnecting' || this.status === 'disconnected') return nothing
    const title = this.status === 'error'
      ? 'Could not load files'
      : this.status === 'idle'
        ? 'Files not loaded'
        : 'Loading files…'
    const copy = this.status === 'error'
      ? this.error.trim() || 'The workspace file projection is unavailable.'
      : this.status === 'idle'
        ? 'Open a workspace to browse its documents and artifacts.'
        : 'Reading the workspace projection.'
    return html`
      <div class="state-surface" data-sidebar-state=${this.status} role=${this.status === 'error' ? 'alert' : 'status'}>
        <div class="state-card">
          ${icon(this.status === 'error' ? 'alert-circle' : this.status === 'idle' ? 'folder' : 'loader', { size: 22 })}
          <div class="state-title">${title}</div>
          <div>${copy}</div>
          ${this.status === 'error' && this._hasCapability('refresh')
            ? html`<button type="button" class="icon-button" aria-label="Retry files" @click=${() => this._action('refresh')}>
                ${icon('refresh', { size: 15 })}
              </button>`
            : nothing}
        </div>
      </div>
    `
  }

  private _sectionCount(section: MnSidebarSection, visibleNodes: readonly MnSidebarNode[]): number | null {
    if (typeof section.count === 'number') return section.count
    return visibleNodes.length > 0 ? visibleNodes.length : null
  }

  private _renderNode(
    node: MnSidebarNode,
    level: number,
    siblingIndex = 0,
    siblingCount = 1,
  ): TemplateResult[] {
    const children = node.children ?? []
    const expanded = node.expanded === true
    const hasChildren = children.length > 0
    const selected = node.selected || this._selectedIdSet().has(node.id)
    const active = node.active || node.id === this.activeId
    const kind = node.kind ?? 'document'
    const fallbackFocusId = this.selectedId
      ?? this.activeId
      ?? this._visibleNodes().find(({ node: candidate }) => !candidate.disabled)?.node.id
      ?? null
    const focused = node.id === (this.focusedNodeId ?? fallbackFocusId)
    const dragging = node.id === this.draggedNodeId
    const dropBefore = node.id === this.dropTargetId && this.dropPosition === 'before'
    const dropInside = node.id === this.dropTargetId && this.dropPosition === 'inside'
    const dropAfter = node.id === this.dropTargetId && this.dropPosition === 'after'
    const nodeIcon = node.status === 'uploading' || node.status === 'processing'
      ? 'loader'
      : node.status === 'error'
        ? 'alert-circle'
        : node.icon ?? defaultIcon(kind)
    const row = html`
      <div
        class=${classMap({
          'tree-row': true,
          selected,
          active,
          focused,
          disabled: node.disabled === true,
          dragging,
          'drop-before': dropBefore,
          'drop-inside': dropInside,
          'drop-after': dropAfter,
        })}
        style="--level:${level}"
        data-node-id=${node.id}
        data-kind=${kind}
        data-status=${node.status ?? nothing}
        data-selected=${selected || active ? 'true' : 'false'}
        role="treeitem"
        tabindex=${node.disabled ? '-1' : focused ? '0' : '-1'}
        aria-disabled=${node.disabled ? 'true' : 'false'}
        aria-selected=${selected || active ? 'true' : 'false'}
        aria-expanded=${hasChildren ? (expanded ? 'true' : 'false') : nothing}
        aria-level=${level + 1}
        aria-posinset=${siblingIndex + 1}
        aria-setsize=${siblingCount}
        draggable=${this._canDrag(node) ? 'true' : 'false'}
        @click=${(event: MouseEvent) => this._onNodeClick(event, node)}
        @keydown=${(event: KeyboardEvent) => this._onNodeKeyDown(event, node)}
        @focus=${() => {
          this.focusedNodeId = node.id
          this._intentNode(node)
        }}
        @blur=${() => this._endIntentNode(node)}
        @pointerenter=${() => this._intentNode(node)}
        @pointerleave=${(event: PointerEvent) => {
          if (this.shadowRoot?.activeElement !== event.currentTarget) this._endIntentNode(node)
        }}
        @contextmenu=${(event: MouseEvent) => this._onNodeContextMenu(event, node)}
        @dragstart=${(event: DragEvent) => this._onDragStart(event, node)}
        @dragend=${() => this._clearDragState()}
        @dragover=${(event: DragEvent) => this._onDragOver(event, node)}
        @dragleave=${(event: DragEvent) => this._onDragLeave(event, node)}
        @drop=${(event: DragEvent) => this._onDrop(event, node)}
      >
        <span class="indent" aria-hidden="true"></span>
        <button
          type="button"
          class=${classMap({ expand: true, expanded, empty: !hasChildren })}
          tabindex="-1"
          aria-hidden=${hasChildren ? 'false' : 'true'}
          aria-label=${expanded ? 'Collapse' : 'Expand'}
          @click=${(event: MouseEvent) => this._toggleNode(event, node)}
        >
          ${icon('chevron-right', { size: 14 })}
        </button>
        <span class="node-icon" aria-hidden="true">
          ${icon(nodeIcon as IconName, { size: 16 })}
        </span>
        <span class="label">${node.label}</span>
        ${node.badge || node.status
          ? html`<mn-badge
              class="badge"
              part="badge"
              size="sm"
              state=${node.badgeTone ?? 'neutral'}
              label=${node.badge ?? node.status ?? ''}
              data-source-state=${node.sourceState ?? nothing}
            ></mn-badge>`
          : nothing}
        ${typeof node.count === 'number' ? html`<span class="node-count">${node.count}</span>` : nothing}
        ${this._hasCapability('contextMenu')
          ? html`<button
              type="button"
              class="node-menu icon-button"
              aria-label="Node actions"
              @click=${(event: MouseEvent) => this._nodeMenu(event, node)}
            >
              ${icon('more-horizontal', { size: 15 })}
            </button>`
          : nothing}
      </div>
    `
    return [
      row,
      ...(expanded
        ? children.flatMap((child, index) => this._renderNode(child, level + 1, index, children.length))
        : []),
    ]
  }

  private _renderSection(section: MnSidebarSection): TemplateResult {
    const query = this.searchQuery.trim().toLocaleLowerCase()
    const nodes = filterFilePaneNodes(section.nodes ?? [], query)
    const collapsed = this._sectionCollapsed(section)
    const count = this._sectionCount(section, nodes)
    return html`
      <section class="section" data-section-id=${section.id}>
        <button
          type="button"
          class="section-header"
          aria-expanded=${collapsed ? 'false' : 'true'}
          @click=${() => this._toggleSection(section)}
        >
          <span class="section-heading">
            ${icon((section.icon ?? 'file-text') as IconName, { size: 14 })}
            <span>${section.label}</span>
          </span>
          ${count === null ? nothing : html`<span class="section-count">${count}</span>`}
        </button>
        <div class="section-body" ?hidden=${collapsed}>
          ${nodes.length > 0
            ? html`<div class="tree" role="tree">
                ${repeat(
                  nodes.flatMap((node, index) => this._renderNode(node, 0, index, nodes.length)),
                  (_, index) => index,
                  (part) => part,
                )}
              </div>`
            : html`<div class="empty">${section.emptyLabel ?? 'No items'}</div>`}
        </div>
      </section>
    `
  }

  render(): TemplateResult {
    const sections = this._displaySections()
    const resolvedPresentation = this._resolvedPresentation()
    const unavailable = this._renderUnavailableState()
    const columnSections = sections.filter(section =>
      section.id === 'documents' || (section.id === 'artifacts' && this.grouping.separateArtifacts),
    )
    const controls = this._renderControls()
    const operationalBanner = this._renderOperationalBanner()
    const storage = this._renderStorage()
    const selectionBar = this._renderSelectionBar()
    const body = unavailable !== nothing
      ? unavailable
      : resolvedPresentation === 'columns'
        ? html`<div class="columns-sections" data-file-pane-body="columns">
            ${columnSections.length > 0
              ? columnSections.map(section => this._renderColumnsSection(section))
              : html`<div class="empty">No file sections</div>`}
          </div>`
        : html`<div class="sections" data-file-pane-body=${resolvedPresentation}>
            ${sections.map((section) => this._renderSection(section))}
          </div>`
    return html`
      <div class="sidebar-header" data-file-pane-presentation=${resolvedPresentation}>
        <label class="search-wrap">
          <span class="search-icon">${icon('search', { size: 15 })}</span>
          <input
            class="search-input"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder=${this.searchPlaceholder}
            .value=${this.searchQuery}
            @input=${this._onSearchInput}
            aria-label=${this.searchPlaceholder}
          />
        </label>
        ${this.showHeaderActions
          ? html`
              <div class="header-actions">
                ${this._hasCapability('createDocument')
                  ? html`<button
                      type="button"
                      class="icon-button"
                      aria-label="New document"
                      title="New document"
                      @click=${() => this._action('new-document')}
                    >${icon('plus', { size: 16 })}</button>`
                  : nothing}
                ${this._hasCapability('upload')
                  ? html`<button
                      type="button"
                      class="icon-button"
                      aria-label="Upload"
                      title="Upload files or folders"
                      @click=${() => this._action('upload')}
                    >${icon('upload', { size: 16 })}</button>`
                  : nothing}
                ${this._hasCapability('createFolder')
                  ? html`<button
                      type="button"
                      class="icon-button"
                      aria-label="New folder"
                      title="New folder"
                      @click=${() => this._action('new-folder')}
                    >${icon('folder', { size: 16 })}</button>`
                  : nothing}
              </div>
            `
          : nothing}
      </div>
      <div
        class="sidebar-content ${this.fileDropActive ? 'file-drop-active' : ''}"
        @dragover=${this._onSidebarDragOver}
        @dragleave=${this._onSidebarDragLeave}
        @drop=${this._onSidebarDrop}
      >
        ${controls}
        ${operationalBanner}
        ${storage}
        ${selectionBar}
        ${body}
        ${this.fileDropActive
          ? html`<div class="file-drop-overlay" aria-hidden="true">
              <span class="file-drop-icon">${icon('upload', { size: 22 })}</span>
              <span class="file-drop-label">Drop to upload</span>
            </div>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-sidebar-panel': MnSidebarPanel
  }
}
