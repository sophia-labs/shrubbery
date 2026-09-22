/**
 * mn-settings-page - controlled Garden settings / local runtime surface.
 *
 * Garden's settings page owns auth, billing, imports, native runtime jobs,
 * semantic model state, analytics, and persistence. This Shrubbery lift keeps
 * the settings workbench UI contract: callers provide section rows and receive
 * intents for navigation, setting changes, secret management, jobs, refresh, and
 * close.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type MnSettingsSectionId =
  | 'account'
  | 'appearance'
  | 'interface'
  | 'billing'
  | 'usage'
  | 'history'
  | 'graph-ops'
  | 'imports'
  | 'api-keys'
  | 'api-mcp'
  | 'local-ai'
  | 'experimental'
  | 'privacy'
  | string

export type MnSettingsStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnSettingsTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
export type MnSettingsJobStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string

export interface MnSettingsNavItem {
  readonly id: MnSettingsSectionId
  readonly label: string
  readonly icon?: string | null
  readonly badge?: string | null
  readonly disabled?: boolean
  readonly hidden?: boolean
}

export interface MnSettingsNavGroup {
  readonly label: string
  readonly items: readonly MnSettingsNavItem[]
}

export interface MnSettingsMetric {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly detail?: string | null
  readonly tone?: MnSettingsTone
}

export interface MnSettingsToggle {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly checked: boolean
  readonly disabled?: boolean
}

export interface MnSettingsOption {
  readonly value: string
  readonly label: string
}

export interface MnSettingsSelect {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly value: string
  readonly options: readonly MnSettingsOption[]
  readonly disabled?: boolean
}

export interface MnSettingsSecret {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly configured: boolean
  readonly provider?: string | null
  readonly disabled?: boolean
}

export interface MnSettingsJob {
  readonly id: string
  readonly label: string
  readonly status: MnSettingsJobStatus
  readonly detail?: string | null
  readonly progress?: number | null
  readonly actionLabel?: string | null
  readonly disabled?: boolean
}

export interface MnSettingsAction {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly icon?: string | null
  readonly variant?: 'default' | 'danger'
  readonly disabled?: boolean
}

export interface MnSettingsSection {
  readonly id: MnSettingsSectionId
  readonly title: string
  readonly description?: string | null
  readonly wide?: boolean
  readonly metrics?: readonly MnSettingsMetric[]
  readonly toggles?: readonly MnSettingsToggle[]
  readonly selects?: readonly MnSettingsSelect[]
  readonly secrets?: readonly MnSettingsSecret[]
  readonly jobs?: readonly MnSettingsJob[]
  readonly actions?: readonly MnSettingsAction[]
  readonly notes?: readonly string[]
  /** Shell-owned content projected into the section without teaching this
   * backend-free settings workbench about a graph or transport. */
  readonly contentSlot?: string | null
}

export interface MnSettingsSectionChangeDetail {
  readonly sectionId: MnSettingsSectionId
}

export interface MnSettingsToggleChangeDetail {
  readonly sectionId: MnSettingsSectionId
  readonly settingId: string
  readonly checked: boolean
}

export interface MnSettingsSelectChangeDetail {
  readonly sectionId: MnSettingsSectionId
  readonly settingId: string
  readonly value: string
}

export interface MnSettingsActionDetail {
  readonly sectionId: MnSettingsSectionId
  readonly actionId: string
}

export interface MnSettingsSecretActionDetail {
  readonly sectionId: MnSettingsSectionId
  readonly secretId: string
  readonly action: 'configure' | 'delete'
}

export interface MnSettingsJobActionDetail {
  readonly sectionId: MnSettingsSectionId
  readonly jobId: string
}

const DEFAULT_NAV: readonly MnSettingsNavGroup[] = [
  {
    label: 'Personal',
    items: [
      { id: 'account', label: 'Account', icon: 'user' },
      { id: 'appearance', label: 'Appearance', icon: 'eye' },
      { id: 'interface', label: 'Interface', icon: 'panel-left' },
    ],
  },
  {
    label: 'Plan',
    items: [
      { id: 'billing', label: 'Billing', icon: 'wallet' },
      { id: 'usage', label: 'Usage', icon: 'gauge' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'history', label: 'Version History', icon: 'history' },
      { id: 'graph-ops', label: 'Graph Ops', icon: 'graph' },
      { id: 'imports', label: 'Imports', icon: 'upload' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'api-keys', label: 'AI Provider Keys', icon: 'hash' },
      { id: 'api-mcp', label: 'API & MCP', icon: 'link' },
      { id: 'local-ai', label: 'Local AI', icon: 'bot' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { id: 'phanes', label: 'Phanes', icon: 'bot' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { id: 'experimental', label: 'Experimental', icon: 'package' },
      { id: 'privacy', label: 'Privacy', icon: 'settings' },
    ],
  },
]

const SECTION_COPY: Record<string, { readonly title: string; readonly description: string }> = {
  account: {
    title: 'Account',
    description: 'Profile, authentication, and account state.',
  },
  appearance: {
    title: 'Appearance',
    description: 'Skin, theme, and reading posture preferences.',
  },
  interface: {
    title: 'Interface',
    description: 'Native window and local chrome behavior.',
  },
  billing: {
    title: 'Billing',
    description: 'Plan, subscription, and credit controls.',
  },
  usage: {
    title: 'Usage',
    description: 'Token, storage, and activity summaries.',
  },
  history: {
    title: 'History',
    description: 'Restore points, snapshots, and time travel controls.',
  },
  'graph-ops': {
    title: 'Graph Ops',
    description: 'Duplicate, export, import, and maintenance jobs.',
  },
  imports: {
    title: 'Imports',
    description: 'Obsidian, Notion, Roam, and media import workflows.',
  },
  'api-keys': {
    title: 'AI Provider Keys',
    description: 'Provider keys and hosted gateway credentials.',
  },
  'api-mcp': {
    title: 'API & MCP',
    description: 'Loopback API, MCP clients, and local access tokens.',
  },
  'local-ai': {
    title: 'Local AI',
    description: 'Semantic model, embedding index, Docling, and PDF pipeline runtime.',
  },
  experimental: {
    title: 'Experimental',
    description: 'Opt-in features and beta settings.',
  },
  privacy: {
    title: 'Privacy',
    description: 'Local data, retention, and telemetry controls.',
  },
  phanes: {
    title: 'Phanes',
    description: 'Agent presentation, top-level flows, and Discord ingestion policy.',
  },
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function jobTone(status: string): MnSettingsTone {
  const normalized = status.toLowerCase()
  if (normalized === 'succeeded' || normalized === 'ready') return 'success'
  if (normalized === 'failed' || normalized === 'error') return 'danger'
  if (normalized === 'running' || normalized === 'queued') return 'accent'
  if (normalized === 'cancelled') return 'warning'
  return 'neutral'
}

function jobStatusLabel(status: string): string {
  switch (status.trim().toLowerCase()) {
    case 'queued': return 'Queued'
    case 'running': return 'In progress'
    case 'succeeded': return 'Complete'
    case 'failed': return 'Failed'
    case 'cancelled':
    case 'canceled': return 'Cancelled'
    case 'ready': return 'Ready'
    case 'idle': return 'Idle'
    default: return status || 'Unknown'
  }
}

function noteTone(note: string): 'neutral' | 'warning' | 'danger' {
  const normalized = note.trim().toLowerCase()
  if (normalized.includes('failed') || normalized.includes('error')) return 'danger'
  if (normalized.includes('unavailable') || normalized.includes(' require')) return 'warning'
  return 'neutral'
}

@customElement('mn-settings-page')
export class MnSettingsPage extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #25231f);
      background: var(--mn-color-surface-canvas, #f5f3ed);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .root {
      display: flex;
      width: 100%;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      background-color: var(--mn-color-surface-canvas, #f5f3ed);
      background-image: var(--mn-atmosphere, none);
    }

    .header {
      display: flex;
      height: var(--mn-top-bar-height, 40px);
      min-height: var(--mn-top-bar-height, 40px);
      flex: 0 0 var(--mn-top-bar-height, 40px);
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-top-bar-border, #cbd8c3);
      background: var(--mn-top-bar-bg, #eef3e9);
      box-shadow: var(--mn-shadow-chrome, none);
      box-sizing: border-box;
    }

    .brand {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-top-bar-text, #31472d);
    }

    .brand-title {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-md, 15px);
      font-weight: 600;
    }

    .close {
      display: inline-flex;
      width: 32px;
      height: 32px;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #587451);
      cursor: pointer;
    }

    .close:hover {
      background: var(--mn-color-surface-hover, #dce7d5);
      color: var(--mn-top-bar-text, #31472d);
    }

    .layout {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }

    .sidebar {
      display: flex;
      width: 220px;
      flex: 0 0 220px;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-panel, #f7f5ef);
      box-sizing: border-box;
    }

    .nav {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-4, 16px) var(--mn-space-3, 12px);
      box-sizing: border-box;
    }

    .nav-group {
      margin: 0 0 var(--mn-space-4, 16px);
    }

    .nav-label {
      margin: 0 0 var(--mn-space-1, 4px);
      padding: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .nav-item {
      display: flex;
      width: 100%;
      min-height: 33px;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      text-align: left;
      box-sizing: border-box;
      transition:
        color var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
    }

    .nav-item:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #eef3e9);
      color: var(--mn-color-text-primary, #31472d);
    }

    .nav-item[data-active='true'] {
      background: var(--mn-color-surface-accent-strong, #eef3e9);
      color: var(--mn-color-text-accent-strong, #31472d);
      font-weight: 600;
      box-shadow: inset 2px 0 0 var(--mn-color-border-accent, #587451);
    }

    .nav-item .mn-icon {
      opacity: 0.62;
    }

    .nav-item[data-active='true'] .mn-icon {
      color: var(--mn-color-text-accent, #587451);
      opacity: 1;
    }

    .nav-item:disabled {
      cursor: default;
      opacity: 0.5;
    }

    .nav-badge {
      margin-left: auto;
      padding: 1px 6px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: 999px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 700;
    }

    .sidebar-footer {
      flex: 0 0 auto;
      padding: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .back-button {
      display: flex;
      width: 100%;
      min-height: 34px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-accent, #587451);
      cursor: pointer;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      text-align: left;
    }

    .back-button:hover {
      background: var(--mn-color-surface-hover, #eef3e9);
      color: var(--mn-color-text-accent-strong, #31472d);
    }

    .main {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-8, 32px) var(--mn-space-12, 48px);
      background: color-mix(in srgb, var(--mn-color-surface-canvas, #f5f3ed) 84%, transparent);
      box-sizing: border-box;
    }

    .content {
      max-width: 760px;
      margin: 0 auto;
    }

    .content[data-wide='true'] {
      max-width: 1200px;
    }

    .custom-content {
      display: block;
      min-width: 0;
    }

    .section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-8, 32px);
      padding-bottom: var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .section-heading {
      min-width: 0;
    }

    .section-kicker {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-accent, #587451);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 700;
      letter-spacing: 0.09em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .section-title {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-title, var(--mn-color-text-primary, #25231f));
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-3xl, 28px);
      font-weight: 650;
      letter-spacing: -0.035em;
      line-height: var(--mn-leading-tight, 1.2);
    }

    .section-description {
      max-width: 60ch;
      margin: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.6;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-6, 24px);
    }

    .metric {
      min-width: 0;
      padding: var(--mn-space-5, 20px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-shadow-card, none);
      box-sizing: border-box;
    }

    .metric-label {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .metric-value {
      margin-top: var(--mn-space-2, 8px);
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-xl, 20px);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metric-detail {
      margin-top: 4px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .metric[data-tone='success'] { border-color: var(--mn-color-success, #16a34a); }
    .metric[data-tone='warning'] { border-color: var(--mn-color-warning, #d97706); }
    .metric[data-tone='danger'] { border-color: var(--mn-color-danger, #dc2626); }
    .metric[data-tone='accent'] { border-color: var(--mn-color-border-accent, #93c5fd); }

    .panel {
      margin-bottom: var(--mn-space-6, 24px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 10px);
      overflow: hidden;
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-shadow-card, none);
    }

    .panel-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-4, 16px);
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: color-mix(in srgb, var(--mn-color-surface-panel, #f7f5ef) 76%, transparent);
    }

    .panel-title {
      margin: 0;
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
      line-height: 1.3;
    }

    .panel-caption {
      margin: 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      text-align: right;
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-4, 16px);
      align-items: center;
      min-height: 64px;
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-rule, #e5e7eb);
      box-sizing: border-box;
    }

    .row:last-child {
      border-bottom: 0;
    }

    .row-main {
      min-width: 0;
    }

    .row-title {
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-base, 15px);
      font-weight: 600;
    }

    .row-description {
      margin-top: 3px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .toggle {
      position: relative;
      width: 42px;
      height: 24px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: 999px;
      background: var(--mn-color-surface-sunken, #f3f4f6);
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease);
    }

    .toggle::after {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.16));
      content: '';
      transition: transform var(--mn-transition-fast, 120ms ease);
    }

    .toggle[aria-pressed='true'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-accent, #2563eb);
    }

    .toggle[aria-pressed='true']::after {
      transform: translateX(18px);
    }

    .toggle:disabled {
      cursor: default;
      opacity: 0.45;
    }

    select {
      min-width: 180px;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .button {
      display: inline-flex;
      min-height: 32px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 11px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      box-shadow: var(--mn-shadow-xs, none);
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
    }

    .button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .button[data-variant='danger'] {
      border-color: var(--mn-color-danger, #dc2626);
      color: var(--mn-color-danger, #dc2626);
    }

    .button:disabled {
      cursor: default;
      opacity: 0.48;
    }

    .secret-state,
    .job-state {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 22px;
      padding: 0 8px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .secret-state[data-tone='success'],
    .job-state[data-tone='success'] {
      border-color: var(--mn-color-success, #16a34a);
      color: var(--mn-color-success, #16a34a);
    }

    .job-state[data-tone='warning'] {
      border-color: var(--mn-color-warning, #d97706);
      color: var(--mn-color-warning, #d97706);
    }

    .job-state[data-tone='danger'] {
      border-color: var(--mn-color-danger, #dc2626);
      color: var(--mn-color-danger, #dc2626);
    }

    .job-state[data-tone='accent'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .job-state[data-tone='accent'] .mn-icon {
      animation: settings-pulse 1.8s ease-in-out infinite;
    }

    @keyframes settings-pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }

    .row-actions {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
    }

    .progress {
      width: 150px;
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--mn-color-surface-sunken, #f3f4f6);
    }

    .progress-bar {
      height: 100%;
      border-radius: inherit;
      background: var(--mn-color-accent, #2563eb);
    }

    .notes {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-6, 24px);
    }

    .note {
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-left: 2px solid var(--mn-color-border-accent, #b7c9ad);
      background: var(--mn-color-surface-accent-subtle, #f8faf6);
      color: var(--mn-color-text-secondary, #4b5563);
      line-height: 1.45;
    }

    .note[data-tone='warning'] {
      border-left-color: var(--mn-color-warning, #a16207);
      background: color-mix(in srgb, var(--mn-color-warning, #a16207) 8%, var(--mn-color-surface-raised, #fffefa));
    }

    .note[data-tone='danger'] {
      border-left-color: var(--mn-color-danger, #b91c1c);
      background: color-mix(in srgb, var(--mn-color-danger, #b91c1c) 7%, var(--mn-color-surface-raised, #fffefa));
      color: var(--mn-color-danger, #991b1b);
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-6, 24px);
    }

    .card-grid[data-columns='3'] {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .feature-card {
      display: flex;
      min-width: 0;
      min-height: 150px;
      flex-direction: column;
      padding: var(--mn-space-5, 20px);
      border: 1px solid var(--mn-color-border-default, #d7d7d2);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-shadow-card, none);
      box-sizing: border-box;
    }

    .feature-card[data-muted='true'] {
      opacity: 0.62;
    }

    .card-heading {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 17px);
      font-weight: 600;
      line-height: 1.25;
    }

    .card-icon {
      display: inline-flex;
      color: var(--mn-color-text-accent, #587451);
    }

    .card-eyebrow,
    .field-label {
      margin-bottom: var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .card-copy {
      flex: 1 1 auto;
      margin: 0 0 var(--mn-space-4, 16px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .card-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-top: auto;
    }

    .identity-card {
      max-width: 540px;
      margin-bottom: var(--mn-space-6, 24px);
      padding: var(--mn-space-6, 24px);
      border: 1px solid var(--mn-color-border-default, #d7d7d2);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-shadow-card, none);
    }

    .identity-heading {
      display: flex;
      align-items: center;
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-3, 12px);
      padding-bottom: var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .identity-mark {
      display: grid;
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      place-items: center;
      border: 1px solid var(--mn-color-border-accent, #b7c9ad);
      border-radius: 50%;
      background: var(--mn-color-surface-accent-subtle, #eef3e9);
      color: var(--mn-color-text-accent-strong, #31472d);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 17px);
      font-weight: 700;
      text-transform: uppercase;
    }

    .identity-kind {
      margin-top: 2px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .identity-row {
      display: grid;
      grid-template-columns: 140px minmax(0, 1fr);
      gap: var(--mn-space-4, 16px);
      padding: var(--mn-space-3, 12px) 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .identity-row:last-child {
      border-bottom: 0;
    }

    .identity-value {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--mn-color-text-primary, #25231f);
      font-size: var(--mn-text-base, 15px);
    }

    .inline-job {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-4, 16px);
      align-items: center;
      margin-bottom: var(--mn-space-4, 16px);
      padding: var(--mn-space-4, 16px);
      border: 1px solid var(--mn-color-border-accent, #cbd8c3);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-accent-subtle, #f8faf6);
    }

    .inline-job .row-description {
      margin-top: var(--mn-space-1, 4px);
    }

    .endpoint-list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-6, 24px);
    }

    .endpoint-card {
      padding: var(--mn-space-5, 20px);
      border: 1px solid var(--mn-color-border-default, #d7d7d2);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-shadow-card, none);
    }

    .endpoint-value {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-3, 12px);
    }

    .endpoint-value code {
      display: block;
      min-width: 0;
      flex: 1 1 auto;
      overflow-x: auto;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f4f4f1);
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .provider-grid .feature-card,
    .runtime-grid .feature-card {
      min-height: 132px;
    }

    /* Local AI is an instrument ledger, not a dashboard of nested cards. */
    .local-ai-stack {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-8, 32px);
    }

    .local-ai-group {
      min-width: 0;
    }

    .local-ai-group-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-4, 16px);
      margin-bottom: var(--mn-space-3, 12px);
    }

    .local-ai-group-title {
      margin: 0;
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 17px);
      font-weight: 600;
      line-height: 1.3;
    }

    .local-ai-group-caption {
      margin: 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .local-ai-ledger,
    .local-ai-list {
      border-top: 1px solid var(--mn-color-border-default, #d7d7d2);
      border-bottom: 1px solid var(--mn-color-border-default, #d7d7d2);
    }

    .local-ai-status-row,
    .local-ai-row {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr) auto;
      gap: var(--mn-space-4, 16px);
      align-items: center;
      min-height: 60px;
      padding: var(--mn-space-3, 12px) 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-sizing: border-box;
    }

    .local-ai-status-row:last-child,
    .local-ai-row:last-child {
      border-bottom: 0;
    }

    .local-ai-status-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
    }

    .local-ai-status-main,
    .local-ai-row-main {
      min-width: 0;
    }

    .local-ai-status-value,
    .local-ai-row-title {
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-base, 15px);
      font-weight: 600;
      line-height: 1.35;
    }

    .local-ai-status-detail,
    .local-ai-row-copy {
      margin-top: 2px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .local-ai-status-mark {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--mn-color-text-muted, #9ca3af);
    }

    .local-ai-status-mark[data-tone='success'] { background: var(--mn-color-success, #376d57); }
    .local-ai-status-mark[data-tone='warning'] { background: var(--mn-color-warning, #a16207); }
    .local-ai-status-mark[data-tone='danger'] { background: var(--mn-color-danger, #b91c1c); }
    .local-ai-status-mark[data-tone='accent'] { background: var(--mn-color-accent, #376d57); }

    .local-ai-row-control {
      display: flex;
      min-width: 180px;
      align-items: center;
      justify-content: flex-end;
    }

    .local-ai-row-control select {
      width: min(260px, 100%);
    }

    .local-ai-row[data-muted='true'] {
      opacity: 0.58;
    }

    .local-ai-diagnostics {
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .local-ai-diagnostics summary {
      display: flex;
      min-height: 44px;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
      list-style: none;
    }

    .local-ai-diagnostics summary::-webkit-details-marker {
      display: none;
    }

    .local-ai-diagnostics-count {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-weight: 400;
    }

    .local-ai-diagnostics-list {
      display: grid;
      gap: var(--mn-space-3, 12px);
      margin: 0;
      padding: 0 0 var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .local-ai-diagnostics .note {
      padding: 0;
      border: 0;
      background: transparent;
    }

    .feature-toggle-card {
      min-height: 132px;
    }

    .feature-toggle-card .card-heading {
      justify-content: space-between;
    }

    .history-summary {
      margin-bottom: var(--mn-space-5, 20px);
    }

    .history-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-5, 20px);
    }

    .timeline {
      position: relative;
      margin: 0 0 var(--mn-space-6, 24px);
      padding-left: 25px;
    }

    .timeline::before {
      position: absolute;
      top: 10px;
      bottom: 10px;
      left: 6px;
      width: 1px;
      background: var(--mn-color-border-default, #d7d7d2);
      content: '';
    }

    .timeline-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-4, 16px);
      align-items: center;
      padding: var(--mn-space-4, 16px) 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .timeline-row::before {
      position: absolute;
      top: 23px;
      left: -23px;
      width: 9px;
      height: 9px;
      border: 2px solid var(--mn-color-primary-500, #6f8e67);
      border-radius: 999px;
      background: var(--mn-color-surface-base, #fff);
      content: '';
      box-sizing: border-box;
    }

    .timeline-row:last-child {
      border-bottom: 0;
    }

    .context-card {
      margin-bottom: var(--mn-space-5, 20px);
      padding: var(--mn-space-5, 20px);
      border: 1px solid var(--mn-color-border-accent, #cbd8c3);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-accent-subtle, #f8faf6);
    }

    .context-card .metric-grid,
    .context-card .notes {
      margin-bottom: 0;
    }

    .context-card .metric {
      padding: var(--mn-space-3, 12px);
      border: 0;
    }

    .state {
      display: grid;
      min-height: 260px;
      align-content: center;
    }

    .capability-state {
      display: grid;
      min-height: 128px;
      place-items: center;
      margin-bottom: var(--mn-space-6, 24px);
      padding: var(--mn-space-6, 24px);
      border: 1px dashed var(--mn-color-border-default, #d7d7d2);
      border-radius: var(--mn-radius-surface, 10px);
      background: color-mix(in srgb, var(--mn-color-surface-raised, #fffefa) 68%, transparent);
      color: var(--mn-color-text-secondary, #4b5563);
      text-align: center;
      box-sizing: border-box;
    }

    .capability-state-icon {
      display: grid;
      width: 34px;
      height: 34px;
      margin-bottom: var(--mn-space-2, 8px);
      place-items: center;
      border-radius: 50%;
      background: var(--mn-color-surface-accent-subtle, #eef3e9);
      color: var(--mn-color-text-accent, #587451);
    }

    .capability-state-title {
      margin: 0;
      color: var(--mn-color-text-primary, #25231f);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-base, 15px);
      font-weight: 650;
    }

    .capability-state-copy {
      max-width: 48ch;
      margin: var(--mn-space-1, 4px) 0 0;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .state-action {
      margin-top: var(--mn-space-3, 12px);
    }

    .status-banner {
      display: flex;
      max-width: 760px;
      min-height: 38px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin: 0 auto var(--mn-space-4, 16px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-accent, #b7c9ad);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-accent-subtle, #f8faf6);
      color: var(--mn-color-text-secondary, #4b5563);
      box-sizing: border-box;
    }

    .status-banner[data-tone='loading'] .mn-icon {
      animation: status-spin 1.1s linear infinite;
    }

    .status-banner[data-tone='danger'] {
      border-color: var(--mn-color-danger, #b91c1c);
      background: color-mix(in srgb, var(--mn-color-danger, #b91c1c) 7%, var(--mn-color-surface-raised, #fffefa));
      color: var(--mn-color-danger, #991b1b);
    }

    .status-banner .button {
      margin-left: auto;
    }

    @keyframes status-spin {
      to { transform: rotate(360deg); }
    }

    button:focus-visible,
    select:focus-visible,
    summary:focus-visible,
    input:focus-visible,
    textarea:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }

    /* 98 treats Settings as a real control-panel window: the chrome and
       grouped regions are raised, form wells are sunken, and the selected
       navigation row uses the system selection color. */
    :host([data-skin='98']) .header {
      border: 2px solid var(--mn-98-face, #c0c0c0);
      border-bottom-color: var(--mn-98-dark, #000);
      background: var(--mn-top-bar-bg);
      background-color: var(--mn-98-caption, #000080);
      color: var(--mn-top-bar-text, #fff);
      box-shadow: none;
    }
    :host([data-skin='98']) .root,
    :host([data-skin='98']) .main,
    :host([data-skin='98']) .content {
      background: var(--mn-98-settings-bg, var(--mn-98-face, #c0c0c0));
    }
    :host([data-skin='98']) .brand-title,
    :host([data-skin='98']) .brand-subtitle {
      color: var(--mn-top-bar-text, #fff);
    }
    :host([data-skin='98']) .close {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .close:active {
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='98']) .sidebar {
      background: var(--mn-98-face, #c0c0c0);
      border-right: 2px groove var(--mn-98-face, #c0c0c0);
    }
    :host([data-skin='98']) .nav-item,
    :host([data-skin='98']) .back-button,
    :host([data-skin='98']) .button,
    :host([data-skin='98']) select {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .nav-item[data-active='true'] {
      background: var(--mn-98-selection, #000080);
      color: #fff;
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .button:active:not(:disabled),
    :host([data-skin='98']) .back-button:active {
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='98']) select {
      background-color: var(--mn-color-surface-sunken, #fff);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) :is(
      .panel,
      .metric,
      .feature-card,
      .identity-card,
      .inline-job,
      .endpoint-card,
      .context-card,
      .local-ai-ledger,
      .local-ai-list,
      .local-ai-diagnostics,
      .capability-state,
      .status-banner
    ) {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) :is(.panel-heading, .note, .identity-mark, .capability-state-icon) {
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
    }
    :host([data-skin='98']) .toggle,
    :host([data-skin='98']) .progress {
      border-radius: 0;
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .toggle::after {
      border-radius: 0;
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .toggle[aria-pressed='true'] {
      background: var(--mn-98-selection, #000080);
    }
    :host([data-skin='98']) :is(.secret-state, .job-state, .nav-badge) {
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) :is(.section-header, .row, .panel-heading, .identity-row, .timeline-row) {
      border-color: var(--mn-98-shadow, #808080);
    }
    :host([data-skin='98']) button:focus-visible,
    :host([data-skin='98']) select:focus-visible,
    :host([data-skin='98']) input:focus-visible,
    :host([data-skin='98']) textarea:focus-visible {
      outline: 1px dotted currentColor;
      outline-offset: -4px;
      box-shadow: var(--mn-focus-ring), var(--mn-98-raised);
    }
    :host([data-skin='98']) :is(input, textarea) {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken);
      color: var(--mn-color-text-primary);
      box-shadow: var(--mn-98-sunken);
    }

    :host([data-skin='glass']) .header {
      border: 1px solid var(--mn-top-bar-border);
      border-top-color: rgba(255, 255, 255, 0.82);
      background: var(--mn-top-bar-bg);
      color: var(--mn-top-bar-text);
      box-shadow: var(--mn-shadow-chrome);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .root,
    :host([data-skin='glass']) .layout,
    :host([data-skin='glass']) .main,
    :host([data-skin='glass']) .content,
    :host([data-skin='glass']) .sidebar {
      background: var(--mn-color-surface-panel);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .brand-title,
    :host([data-skin='glass']) .brand-subtitle {
      color: var(--mn-top-bar-text);
    }
    :host([data-skin='glass']) .sidebar {
      border-right-color: var(--mn-color-border-default);
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.42);
    }
    :host([data-skin='glass']) .nav-item,
    :host([data-skin='glass']) .back-button,
    :host([data-skin='glass']) .button,
    :host([data-skin='glass']) select,
    :host([data-skin='glass']) .close {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      color: var(--mn-color-text-primary);
      box-shadow: var(--mn-control-shadow);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .nav-item[data-active='true'],
    :host([data-skin='glass']) .button:active:not(:disabled),
    :host([data-skin='glass']) .back-button:active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }
    :host([data-skin='glass']) :is(
      .panel,
      .metric,
      .feature-card,
      .identity-card,
      .inline-job,
      .endpoint-card,
      .context-card,
      .local-ai-ledger,
      .local-ai-list,
      .local-ai-diagnostics,
      .capability-state,
      .status-banner
    ) {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-raised);
      box-shadow: var(--mn-shadow-card);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) :is(input, textarea, select, .toggle, .progress) {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      color: var(--mn-color-text-primary);
      box-shadow: var(--mn-control-shadow-active);
    }
    :host([data-skin='glass']) :is(.panel-heading, .note, .identity-mark, .capability-state-icon) {
      background: color-mix(in srgb, var(--mn-color-surface-raised) 68%, transparent);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) :is(.secret-state, .job-state, .nav-badge) {
      border: var(--mn-control-border);
      background: color-mix(in srgb, var(--mn-color-surface-raised) 72%, transparent);
      box-shadow: var(--mn-control-shadow);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }

    @media (max-width: 760px) {
      .layout {
        flex-direction: column;
      }

      .sidebar {
        width: 100%;
        flex: 0 0 auto;
        max-height: none;
        flex-direction: row;
        align-items: stretch;
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }

      :host([data-skin='98']) .sidebar,
      :host([data-skin='glass']) .sidebar {
        border-right: 0;
      }

      .nav {
        display: flex;
        gap: var(--mn-space-2, 8px);
        overflow-x: auto;
        overflow-y: hidden;
        padding: var(--mn-space-2, 8px);
        scrollbar-width: thin;
      }

      .nav-group {
        display: flex;
        flex: 0 0 auto;
        gap: var(--mn-space-1, 4px);
        margin: 0;
      }

      .nav-group + .nav-group {
        padding-left: var(--mn-space-2, 8px);
        border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }

      .nav-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .nav-item {
        width: auto;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .sidebar-footer {
        display: flex;
        align-items: center;
        padding: var(--mn-space-2, 8px);
        border-top: 0;
        border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }

      .back-button {
        width: 34px;
        min-height: 34px;
        justify-content: center;
        padding: 0;
      }

      .back-button span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .main {
        padding: var(--mn-space-5, 20px);
      }

      .row,
      .inline-job,
      .timeline-row,
      .local-ai-status-row,
      .local-ai-row {
        grid-template-columns: minmax(0, 1fr);
      }

      .local-ai-row-control {
        min-width: 0;
        justify-content: flex-start;
      }

      .local-ai-status-mark {
        display: none;
      }

      .card-grid,
      .card-grid[data-columns='3'] {
        grid-template-columns: minmax(0, 1fr);
      }

      .identity-row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--mn-space-1, 4px);
      }

      .endpoint-value {
        align-items: stretch;
        flex-direction: column;
      }

      .row-actions {
        justify-content: flex-start;
      }

      .panel-heading,
      .section-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .panel-caption {
        text-align: left;
      }

      select,
      .progress {
        width: 100%;
        min-width: 0;
      }
    }

    @media (max-width: 480px) {
      .header {
        padding: 0 var(--mn-space-3, 12px);
      }

      .main {
        padding: var(--mn-space-4, 16px);
      }

      .section-title {
        font-size: var(--mn-text-2xl, 24px);
      }

      .metric-grid {
        grid-template-columns: minmax(0, 1fr);
      }

      .row,
      .panel-heading {
        padding-inline: var(--mn-space-4, 16px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .job-state[data-tone='accent'] .mn-icon,
      .status-banner[data-tone='loading'] .mn-icon {
        animation: none;
      }
    }
  `

  @property({ type: String }) status: MnSettingsStatus = 'ready'
  @property({ type: String }) error = ''
  @property({ type: String }) activeSection: MnSettingsSectionId = 'account'
  @property({ type: String }) userName = ''
  @property({ type: String }) userEmail = ''
  @property({ attribute: false }) navGroups: readonly MnSettingsNavGroup[] = DEFAULT_NAV
  @property({ attribute: false }) sections: readonly MnSettingsSection[] = []
  /**
   * Additive, opt-in — mirrors `mn-doc-history-panel`'s own `showClose`
   * (wave1 review r1 WRONG fix: `layout/faces/settings-page-face.ts` used to
   * leave BOTH close controls (`.close` header button, `.back-button`
   * sidebar footer) visibly rendered while treating `mn-settings-close` as a
   * permanent no-op — a leaf has no "close the leaf" channel to request
   * (chrome owns that), so a control that does nothing when clicked is a
   * dead affordance, not an honest scope boundary. Default `true` preserves
   * the full-page route's own real "back to workspace" behavior unchanged;
   * the leaf face sets this `false`.
   */
  @property({ type: Boolean, attribute: 'show-close' }) showClose = true

  private _retainedSection: MnSettingsSection | undefined

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('sections') || changed.has('navGroups') || changed.has('activeSection')) {
      const items = this._navItems()
      if (items.length && !items.some((item) => item.id === this.activeSection)) {
        this.activeSection = items[0]!.id
      }
    }
  }

  protected updated(): void {
    if (this.status !== 'ready') return
    const section = this._section()
    if (section) this._retainedSection = section
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _availableNavGroups(): MnSettingsNavGroup[] {
    const available = new Map(this.sections.map((section) => [section.id, section]))
    if (!available.size) return []

    const configured = new Map<string, MnSettingsNavItem>()
    const customGroupById = new Map<string, string>()
    for (const group of this.navGroups) {
      for (const item of group.items) {
        configured.set(item.id, item)
        customGroupById.set(item.id, group.label)
      }
    }

    const used = new Set<string>()
    const groups: MnSettingsNavGroup[] = DEFAULT_NAV.map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => available.has(item.id))
        .map((item) => {
          used.add(item.id)
          return { ...item, ...configured.get(item.id), id: item.id }
        })
        .filter((item) => !item.hidden),
    })).filter((group) => group.items.length)

    const customOrder: string[] = []
    for (const section of this.sections) {
      if (used.has(section.id)) continue
      const label = customGroupById.get(section.id) ?? 'Other'
      if (!customOrder.includes(label)) customOrder.push(label)
    }
    for (const label of customOrder) {
      const items = this.sections
        .filter((section) => !used.has(section.id) && (customGroupById.get(section.id) ?? 'Other') === label)
        .map((section) => configured.get(section.id) ?? {
          id: section.id,
          label: section.title || SECTION_COPY[section.id]?.title || String(section.id),
          icon: 'settings',
        })
        .filter((item) => !item.hidden)
      if (items.length) groups.push({ label, items })
    }
    return groups
  }

  private _navItems(): MnSettingsNavItem[] {
    return this._availableNavGroups().flatMap((group) => group.items)
  }

  private _section(): MnSettingsSection | undefined {
    const items = this._navItems()
    const sectionId = items.some((item) => item.id === this.activeSection)
      ? this.activeSection
      : items[0]?.id
    return sectionId == null ? undefined : this.sections.find((section) => section.id === sectionId)
  }

  private _changeSection(sectionId: MnSettingsSectionId): void {
    if (this.activeSection === sectionId) return
    this.activeSection = sectionId
    this._emit<MnSettingsSectionChangeDetail>('mn-settings-section-change', { sectionId })
  }

  private _toggle(setting: MnSettingsToggle): void {
    if (setting.disabled) return
    this._emit<MnSettingsToggleChangeDetail>('mn-settings-toggle-change', {
      sectionId: this.activeSection,
      settingId: setting.id,
      checked: !setting.checked,
    })
  }

  private _select(setting: MnSettingsSelect, value: string): void {
    if (setting.disabled) return
    this._emit<MnSettingsSelectChangeDetail>('mn-settings-select-change', {
      sectionId: this.activeSection,
      settingId: setting.id,
      value,
    })
  }

  private _action(action: MnSettingsAction): void {
    if (action.disabled) return
    this._emit<MnSettingsActionDetail>('mn-settings-action', {
      sectionId: this.activeSection,
      actionId: action.id,
    })
  }

  private _secret(secret: MnSettingsSecret, action: 'configure' | 'delete'): void {
    if (secret.disabled) return
    this._emit<MnSettingsSecretActionDetail>('mn-settings-secret-action', {
      sectionId: this.activeSection,
      secretId: secret.id,
      action,
    })
  }

  private _job(job: MnSettingsJob): void {
    if (job.disabled) return
    this._emit<MnSettingsJobActionDetail>('mn-settings-job-action', {
      sectionId: this.activeSection,
      jobId: job.id,
    })
  }

  private _close(): void {
    this._emit('mn-settings-close', {})
  }

  private _refresh(): void {
    this._emit('mn-settings-refresh', { sectionId: this.activeSection })
  }

  private _renderNav(): TemplateResult {
    const groups = this._availableNavGroups()
    return html`
      <aside class="sidebar">
        <nav class="nav" aria-label="Settings navigation">
          ${groups.map((group) => html`
              <section class="nav-group">
                <p class="nav-label">${group.label}</p>
                ${group.items.map((item) => html`
                  <button
                    type="button"
                    class="nav-item"
                    data-section-id=${item.id}
                    data-active=${item.id === this.activeSection ? 'true' : 'false'}
                    aria-current=${item.id === this.activeSection ? 'page' : nothing}
                    ?disabled=${item.disabled}
                    @click=${() => this._changeSection(item.id)}
                  >
                    ${icon(item.icon || 'settings', { size: 15 })}
                    <span>${item.label}</span>
                    ${trimmed(item.badge) ? html`<span class="nav-badge">${item.badge}</span>` : nothing}
                  </button>
                `)}
              </section>
          `)}
        </nav>
        ${this.showClose ? html`<footer class="sidebar-footer">
          <button type="button" class="back-button" @click=${() => this._close()}>
            ${icon('chevron-left', { size: 16 })}
            <span>Back to workspace</span>
          </button>
        </footer>` : nothing}
      </aside>
    `
  }

  private _renderMetrics(metrics: readonly MnSettingsMetric[] = []): TemplateResult | typeof nothing {
    if (!metrics.length) return nothing
    return html`
      <div class="metric-grid">
        ${metrics.map((metric) => html`
          <div class="metric" data-metric-id=${metric.id} data-tone=${metric.tone ?? 'neutral'}>
            <div class="metric-label">${metric.label}</div>
            <div class="metric-value">${metric.value}</div>
            ${trimmed(metric.detail) ? html`<div class="metric-detail">${metric.detail}</div>` : nothing}
          </div>
        `)}
      </div>
    `
  }

  private _renderPanelHeading(title: string, caption = ''): TemplateResult {
    return html`
      <header class="panel-heading">
        <h3 class="panel-title">${title}</h3>
        ${trimmed(caption) ? html`<p class="panel-caption">${caption}</p>` : nothing}
      </header>
    `
  }

  private _renderToggles(
    toggles: readonly MnSettingsToggle[] = [],
    title = 'Preferences',
    caption = 'Changes apply as soon as they are saved.',
  ): TemplateResult | typeof nothing {
    if (!toggles.length) return nothing
    return html`
      <section class="panel" aria-label="Toggle settings">
        ${this._renderPanelHeading(title, caption)}
        ${toggles.map((setting) => html`
          <div class="row" data-setting-id=${setting.id}>
            <div class="row-main">
              <div class="row-title">${setting.label}</div>
              ${trimmed(setting.description) ? html`<div class="row-description">${setting.description}</div>` : nothing}
            </div>
            <button
              type="button"
              class="toggle"
              aria-label=${setting.label}
              aria-pressed=${setting.checked ? 'true' : 'false'}
              ?disabled=${setting.disabled}
              @click=${() => this._toggle(setting)}
            ></button>
          </div>
        `)}
      </section>
    `
  }

  private _renderSelects(
    selects: readonly MnSettingsSelect[] = [],
    title = 'Options',
    caption = 'Choose how this part of Garden behaves.',
  ): TemplateResult | typeof nothing {
    if (!selects.length) return nothing
    return html`
      <section class="panel" aria-label="Option settings">
        ${this._renderPanelHeading(title, caption)}
        ${selects.map((setting) => html`
          <div class="row" data-setting-id=${setting.id}>
            <div class="row-main">
              <div class="row-title">${setting.label}</div>
              ${trimmed(setting.description) ? html`<div class="row-description">${setting.description}</div>` : nothing}
            </div>
            <select
              aria-label=${setting.label}
              .value=${setting.value}
              ?disabled=${setting.disabled}
              @change=${(event: Event) => this._select(setting, (event.target as HTMLSelectElement).value)}
            >
              ${setting.options.map((option) => html`
                <option value=${option.value} ?selected=${option.value === setting.value}>${option.label}</option>
              `)}
            </select>
          </div>
        `)}
      </section>
    `
  }

  private _renderSecrets(
    secrets: readonly MnSettingsSecret[] = [],
    title = 'Credentials',
    caption = 'Secret values are write-only.',
  ): TemplateResult | typeof nothing {
    if (!secrets.length) return nothing
    return html`
      <section class="panel" aria-label="Secrets">
        ${this._renderPanelHeading(title, caption)}
        ${secrets.map((secret) => html`
          <div class="row" data-secret-id=${secret.id}>
            <div class="row-main">
              <div class="row-title">${secret.label}</div>
              ${trimmed(secret.description) ? html`<div class="row-description">${secret.description}</div>` : nothing}
            </div>
            <div class="row-actions">
              <span class="secret-state" data-tone=${secret.configured ? 'success' : 'neutral'}>
                ${icon(secret.configured ? 'check' : 'circle', { size: 12 })}
                ${secret.configured ? 'Configured' : 'Not configured'}
              </span>
              <button type="button" class="button" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'configure')}>
                ${secret.configured ? 'Replace' : 'Configure'}
              </button>
              ${secret.configured
                ? html`<button type="button" class="button" data-variant="danger" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'delete')}>Delete</button>`
                : nothing}
            </div>
          </div>
        `)}
      </section>
    `
  }

  private _renderJobs(
    jobs: readonly MnSettingsJob[] = [],
    title = 'Activity',
    caption = 'Live work reported by the runtime.',
  ): TemplateResult | typeof nothing {
    if (!jobs.length) return nothing
    return html`
      <section class="panel" aria-label="Runtime jobs">
        ${this._renderPanelHeading(title, caption)}
        ${jobs.map((job) => {
          const progress = clampPercent(job.progress)
          const tone = jobTone(job.status)
          return html`
            <div class="row" data-job-id=${job.id} data-status=${job.status}>
              <div class="row-main">
                <div class="row-title">${job.label}</div>
                ${trimmed(job.detail) ? html`<div class="row-description">${job.detail}</div>` : nothing}
              </div>
              <div class="row-actions">
                ${progress == null
                  ? nothing
                  : html`<span
                      class="progress"
                      role="progressbar"
                      aria-label=${`${job.label} progress`}
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow=${progress}
                    ><span class="progress-bar" style=${`width:${progress}%`}></span></span>`}
                <span class="job-state" data-tone=${tone} aria-live="polite">
                  ${icon(tone === 'success' ? 'check' : tone === 'danger' ? 'alert-circle' : tone === 'accent' ? 'zap' : 'circle', { size: 12 })}
                  ${jobStatusLabel(job.status)}
                </span>
                ${trimmed(job.actionLabel)
                  ? html`<button type="button" class="button" ?disabled=${job.disabled} @click=${() => this._job(job)}>${job.actionLabel}</button>`
                  : nothing}
              </div>
            </div>
          `
        })}
      </section>
    `
  }

  private _renderActions(
    actions: readonly MnSettingsAction[] = [],
    title = 'Actions',
    caption = 'Commands available in this runtime.',
  ): TemplateResult | typeof nothing {
    if (!actions.length) return nothing
    return html`
      <section class="panel" aria-label="Actions">
        ${this._renderPanelHeading(title, caption)}
        ${actions.map((action) => html`
          <div class="row" data-action-id=${action.id}>
            <div class="row-main">
              <div class="row-title">${action.label}</div>
              ${trimmed(action.description) ? html`<div class="row-description">${action.description}</div>` : nothing}
            </div>
            <button
              type="button"
              class="button"
              data-variant=${action.variant ?? 'default'}
              ?disabled=${action.disabled}
              @click=${() => this._action(action)}
            >
              ${icon(action.icon || 'settings', { size: 13 })}
              ${action.label}
            </button>
          </div>
        `)}
      </section>
    `
  }

  private _renderNotes(notes: readonly string[] = []): TemplateResult | typeof nothing {
    if (!notes.length) return nothing
    return html`<div class="notes">${notes.map((note) => html`<div class="note" data-tone=${noteTone(note)}>${note}</div>`)}</div>`
  }

  private _sectionTitle(section: MnSettingsSection): string {
    if (section.id === 'api-keys') return 'AI Provider Keys'
    if (section.id === 'history' && section.title === 'History') return 'Version History'
    return section.title
  }

  private _sectionGroupLabel(sectionId: MnSettingsSectionId): string {
    return this._availableNavGroups().find((group) => group.items.some((item) => item.id === sectionId))?.label
      ?? 'Settings'
  }

  private _renderCapabilityState(
    id: string,
    stateIcon: string,
    title: string,
    description: string,
  ): TemplateResult {
    return html`
      <section class="capability-state" data-empty-state=${id} aria-label=${title}>
        <div>
          <span class="capability-state-icon">${icon(stateIcon, { size: 17 })}</span>
          <h3 class="capability-state-title">${title}</h3>
          <p class="capability-state-copy">${description}</p>
        </div>
      </section>
    `
  }

  private _renderSectionFrame(
    section: MnSettingsSection,
    body: unknown,
    headerAction: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    return html`
      <div class="content" data-wide=${section.wide ? 'true' : 'false'}>
        <header class="section-header">
          <div class="section-heading">
            <p class="section-kicker">${this._sectionGroupLabel(section.id)}</p>
            <h2 class="section-title" id="settings-section-title">${this._sectionTitle(section)}</h2>
            ${trimmed(section.description) ? html`<p class="section-description">${section.description}</p>` : nothing}
          </div>
          ${headerAction}
        </header>
        ${body}
      </div>
    `
  }

  private _renderJobControls(job: MnSettingsJob): TemplateResult {
    const progress = clampPercent(job.progress)
    const tone = jobTone(job.status)
    return html`
      <div class="row-actions">
        ${progress == null
          ? nothing
          : html`<span
              class="progress"
              role="progressbar"
              aria-label=${`${job.label} progress`}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow=${progress}
            ><span class="progress-bar" style=${`width:${progress}%`}></span></span>`}
        <span class="job-state" data-tone=${tone} aria-live="polite">
          ${icon(tone === 'success' ? 'check' : tone === 'danger' ? 'alert-circle' : tone === 'accent' ? 'zap' : 'circle', { size: 12 })}
          ${jobStatusLabel(job.status)}
        </span>
        ${trimmed(job.actionLabel)
          ? html`<button type="button" class="button" ?disabled=${job.disabled} @click=${() => this._job(job)}>${job.actionLabel}</button>`
          : nothing}
      </div>
    `
  }

  private _renderInlineJobs(jobs: readonly MnSettingsJob[] = []): readonly TemplateResult[] | typeof nothing {
    if (!jobs.length) return nothing
    return jobs.map((job) => html`
      <div class="inline-job" data-job-id=${job.id} data-status=${job.status}>
        <div class="row-main">
          <div class="row-title">${job.label}</div>
          ${trimmed(job.detail) ? html`<div class="row-description">${job.detail}</div>` : nothing}
        </div>
        ${this._renderJobControls(job)}
      </div>
    `)
  }

  private _renderActionButton(action: MnSettingsAction): TemplateResult {
    return html`
      <button
        type="button"
        class="button"
        data-variant=${action.variant ?? 'default'}
        ?disabled=${action.disabled}
        @click=${() => this._action(action)}
      >
        ${trimmed(action.icon) ? icon(action.icon!, { size: 13 }) : nothing}
        ${action.label}
      </button>
    `
  }

  private _renderAccount(section: MnSettingsSection): TemplateResult {
    const nonIdentityMetrics = (section.metrics ?? []).filter((metric) => metric.id !== 'identity')
    const actions = (section.actions ?? []).filter((action) => !(action.id === 'sign-out' && action.disabled))
    const hasEmail = Boolean(trimmed(this.userEmail))
    const displayName = trimmed(this.userName) || (hasEmail ? this.userEmail : 'Local Garden profile')
    const initial = displayName.slice(0, 1) || 'G'
    return this._renderSectionFrame(section, [
      html`<section class="identity-card" aria-label="Account identity">
        <header class="identity-heading">
          <span class="identity-mark" aria-hidden="true">${initial}</span>
          <div>
            <div class="row-title">${displayName}</div>
            <div class="identity-kind">${hasEmail ? 'Hosted account' : 'On-device identity'}</div>
          </div>
        </header>
        <div class="identity-row">
          <div class="field-label">${hasEmail ? 'Display name' : 'Local profile'}</div>
          <div class="identity-value" data-identity="name">${displayName}</div>
        </div>
        ${hasEmail ? html`
          <div class="identity-row">
            <div class="field-label">Email</div>
            <div class="identity-value" data-identity="email">${this.userEmail}</div>
          </div>
        ` : nothing}
      </section>`,
      this._renderMetrics(nonIdentityMetrics),
      this._renderNotes(section.notes),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderJobs(section.jobs),
      this._renderActions(actions),
    ])
  }

  private _importCardMeta(actionId: string): { readonly eyebrow: string; readonly icon: string } {
    if (actionId === 'import-files') return { eyebrow: 'Documents', icon: 'file-text' }
    if (actionId === 'import-obsidian') return { eyebrow: 'Vault archive', icon: 'folder' }
    if (actionId === 'import-notion') return { eyebrow: 'Workspace archive', icon: 'package' }
    if (actionId === 'import-roam') return { eyebrow: 'Graph archive', icon: 'graph' }
    return { eyebrow: 'Importer', icon: actionId.includes('file') ? 'file-text' : 'upload' }
  }

  private _renderImports(section: MnSettingsSection): TemplateResult {
    const actions = section.actions ?? []
    return this._renderSectionFrame(section, [
      this._renderInlineJobs(section.jobs),
      actions.length ? html`<div class="card-grid import-grid" aria-label="Supported importers">
        ${actions.map((action) => {
          const meta = this._importCardMeta(action.id)
          return html`
            <article class="feature-card importer-card" data-action-id=${action.id} data-muted=${action.disabled ? 'true' : 'false'}>
              <div class="card-eyebrow">${meta.eyebrow}</div>
              <h3 class="card-heading"><span class="card-icon">${icon(meta.icon, { size: 18 })}</span>${action.label}</h3>
              <p class="card-copy">${trimmed(action.description) || 'Choose an export and bring its documents into the active graph.'}</p>
              <div class="card-footer">${this._renderActionButton(action)}</div>
            </article>
          `
        })}
      </div>` : this._renderCapabilityState(
        'imports',
        'upload',
        'No importers are available',
        'This runtime did not expose a document or archive import contract.',
      ),
      this._renderNotes(section.notes),
      this._renderMetrics(section.metrics),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderSecrets(section.secrets),
    ])
  }

  private _graphActionMeta(actionId: string): { readonly eyebrow: string; readonly icon: string } {
    if (actionId === 'duplicate-graph') return { eyebrow: 'Copy', icon: 'copy' }
    if (actionId === 'export-graph') return { eyebrow: 'Portable archive', icon: 'download' }
    if (actionId === 'import-graph') return { eyebrow: 'Restore elsewhere', icon: 'upload' }
    return { eyebrow: 'Graph operation', icon: 'database' }
  }

  private _renderGraphOps(section: MnSettingsSection): TemplateResult {
    const actions = section.actions ?? []
    return this._renderSectionFrame(section, [
      html`<section class="context-card" aria-label="Graph context">
        <div class="card-eyebrow">Current graph</div>
        <h3 class="card-heading"><span class="card-icon">${icon('database', { size: 18 })}</span>Graph context</h3>
        ${trimmed(section.description) ? html`<p class="card-copy">${section.description}</p>` : nothing}
        ${[this._renderMetrics(section.metrics), this._renderInlineJobs(section.jobs)]}
      </section>`,
      actions.length ? html`<div class="card-grid" data-columns="3" aria-label="Graph operations">
        ${actions.map((action) => {
          const meta = this._graphActionMeta(action.id)
          return html`
            <article class="feature-card graph-operation-card" data-action-id=${action.id} data-muted=${action.disabled ? 'true' : 'false'}>
              <div class="card-eyebrow">${meta.eyebrow}</div>
              <h3 class="card-heading"><span class="card-icon">${icon(meta.icon, { size: 18 })}</span>${action.label}</h3>
              <p class="card-copy">${trimmed(action.description) || 'Run this operation against the active graph.'}</p>
              <div class="card-footer">${this._renderActionButton(action)}</div>
            </article>
          `
        })}
      </div>` : this._renderCapabilityState(
        'graph-ops',
        'database',
        'No graph operations are available',
        'The active runtime did not provide a duplicate, export, or import operation.',
      ),
      this._renderNotes(section.notes),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderSecrets(section.secrets),
    ])
  }

  private _renderHistory(section: MnSettingsSection): TemplateResult {
    const actions = section.actions ?? []
    const refresh = actions.find((action) => action.id === 'refresh-history')
    const restoreActions = actions.filter((action) => action.id.startsWith('restore-point:'))
    const contextualActions = actions.filter((action) =>
      action.id !== 'refresh-history' && !action.id.startsWith('restore-point:'))
    const refreshControl = refresh
      ? html`<span data-action-id=${refresh.id}>${this._renderActionButton(refresh)}</span>`
      : html`<button type="button" class="button" @click=${() => this._refresh()}>${icon('refresh', { size: 13 })} Refresh history</button>`

    return this._renderSectionFrame(section, [
      html`<div class="history-summary">${[this._renderMetrics(section.metrics)]}</div>`,
      this._renderInlineJobs(section.jobs),
      contextualActions.length ? html`
        <div class="history-actions" aria-label="History actions">
          ${contextualActions.map((action) => html`<span data-action-id=${action.id}>${this._renderActionButton(action)}</span>`)}
        </div>
      ` : nothing,
      restoreActions.length ? html`
        <section class="timeline" aria-label="Restore points">
          ${restoreActions.map((action) => html`
            <article class="timeline-row" data-action-id=${action.id}>
              <div class="row-main">
                <div class="row-title">${action.label.replace(/^Restore\s+/, '')}</div>
                ${trimmed(action.description) ? html`<div class="row-description">${action.description}</div>` : nothing}
              </div>
              ${this._renderActionButton(action)}
            </article>
          `)}
        </section>
      ` : this._renderCapabilityState(
        'history',
        'history',
        'No restore points yet',
        'Create a restore point to mark a safe return point before a risky graph change.',
      ),
      this._renderNotes(section.notes),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderSecrets(section.secrets),
    ], refreshControl)
  }

  private _renderProviderCards(secrets: readonly MnSettingsSecret[] = []): TemplateResult | typeof nothing {
    if (!secrets.length) return nothing
    return html`
      <div class="card-grid provider-grid" aria-label="AI provider credentials">
        ${secrets.map((secret) => html`
          <article class="feature-card" data-secret-id=${secret.id} data-muted=${secret.disabled ? 'true' : 'false'}>
            <div class="card-eyebrow">AI provider</div>
            <h3 class="card-heading">${secret.label}</h3>
            <p class="card-copy">${trimmed(secret.description) || 'Stored locally and never reflected back into this page.'}</p>
            <div class="card-footer">
              <span class="secret-state" data-tone=${secret.configured ? 'success' : 'neutral'}>
                ${icon(secret.configured ? 'check' : 'circle', { size: 12 })}
                ${secret.configured ? 'Configured' : 'Not configured'}
              </span>
              <span class="row-actions">
                <button type="button" class="button" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'configure')}>
                  ${secret.configured ? 'Replace' : 'Configure'}
                </button>
                ${secret.configured
                  ? html`<button type="button" class="button" data-variant="danger" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'delete')}>Delete</button>`
                  : nothing}
              </span>
            </div>
          </article>
        `)}
      </div>
    `
  }

  private _renderProviderKeys(section: MnSettingsSection): TemplateResult {
    return this._renderSectionFrame(section, [
      section.secrets?.length
        ? this._renderProviderCards(section.secrets)
        : this._renderCapabilityState(
            'api-keys',
            'hash',
            'Credential storage is unavailable',
            'This runtime did not expose a write-only provider-key store.',
          ),
      this._renderNotes(section.notes),
      this._renderMetrics(section.metrics),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderInlineJobs(section.jobs),
      this._renderActions(section.actions),
    ])
  }

  private _renderApiMcp(section: MnSettingsSection): TemplateResult {
    const actions = [...(section.actions ?? [])]
    const used = new Set<string>()
    const actionForMetric = (metric: MnSettingsMetric): MnSettingsAction | undefined => {
      const expectedId = metric.id === 'api-base' ? 'copy-api-url' : metric.id === 'mcp-url' ? 'copy-mcp-url' : ''
      const action = actions.find((candidate) => candidate.id === expectedId)
      if (action) used.add(action.id)
      return action
    }
    return this._renderSectionFrame(section, [
      section.metrics?.length ? html`<div class="endpoint-list" aria-label="API and MCP endpoints">
        ${(section.metrics ?? []).map((metric) => {
          const action = actionForMetric(metric)
          return html`
            <section class="endpoint-card" data-endpoint-id=${metric.id}>
              <div class="field-label">${metric.label}</div>
              <div class="endpoint-value">
                <code>${metric.value}</code>
                ${action ? html`<span data-action-id=${action.id}>${this._renderActionButton(action)}</span>` : nothing}
              </div>
              ${trimmed(metric.detail) ? html`<div class="metric-detail">${metric.detail}</div>` : nothing}
            </section>
          `
        })}
      </div>` : this._renderCapabilityState(
        'api-mcp',
        'link',
        'No external endpoint is exposed',
        'This runtime did not provide an API base or MCP endpoint.',
      ),
      this._renderActions(actions.filter((action) => !used.has(action.id))),
      this._renderNotes(section.notes),
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderProviderCards(section.secrets),
      this._renderInlineJobs(section.jobs),
    ])
  }

  private _renderLocalAiMetrics(metrics: readonly MnSettingsMetric[] = []): TemplateResult | typeof nothing {
    if (!metrics.length) return nothing
    return html`
      <section class="local-ai-group" aria-labelledby="local-ai-overview-title">
        <div class="local-ai-group-header">
          <h3 class="local-ai-group-title" id="local-ai-overview-title">Runtime at a glance</h3>
          <p class="local-ai-group-caption">Live cell state</p>
        </div>
        <div class="local-ai-ledger">
          ${metrics.map(metric => html`
            <div class="local-ai-status-row" data-metric-id=${metric.id} data-tone=${metric.tone ?? 'neutral'}>
              <div class="local-ai-status-label">${metric.label}</div>
              <div class="local-ai-status-main">
                <div class="local-ai-status-value">${metric.value}</div>
                ${trimmed(metric.detail) ? html`<div class="local-ai-status-detail">${metric.detail}</div>` : nothing}
              </div>
              <span class="local-ai-status-mark" data-tone=${metric.tone ?? 'neutral'} aria-hidden="true"></span>
            </div>
          `)}
        </div>
      </section>
    `
  }

  private _renderLocalAiSelects(selects: readonly MnSettingsSelect[] = []): TemplateResult | typeof nothing {
    if (!selects.length) return nothing
    return html`
      <section class="local-ai-group" aria-labelledby="local-ai-configuration-title">
        <div class="local-ai-group-header">
          <h3 class="local-ai-group-title" id="local-ai-configuration-title">Configuration</h3>
          <p class="local-ai-group-caption">Saved to the local runtime</p>
        </div>
        <div class="local-ai-list">
        ${selects.map((setting) => html`
          <div class="local-ai-row" data-setting-id=${setting.id} data-muted=${setting.disabled ? 'true' : 'false'}>
            <div class="local-ai-status-label">${setting.label}</div>
            <div class="local-ai-row-main">
              ${trimmed(setting.description) ? html`<div class="local-ai-row-copy">${setting.description}</div>` : nothing}
            </div>
            <div class="local-ai-row-control">
              <select
                aria-label=${setting.label}
                .value=${setting.value}
                ?disabled=${setting.disabled}
                @change=${(event: Event) => this._select(setting, (event.target as HTMLSelectElement).value)}
              >
                ${setting.options.map((option) => html`
                  <option value=${option.value} ?selected=${option.value === setting.value}>${option.label}</option>
                `)}
              </select>
            </div>
          </div>
        `)}
        </div>
      </section>
    `
  }

  private _renderLocalAiJobs(jobs: readonly MnSettingsJob[] = []): TemplateResult | typeof nothing {
    if (!jobs.length) return nothing
    return html`
      <section class="local-ai-group" aria-labelledby="local-ai-maintenance-title">
        <div class="local-ai-group-header">
          <h3 class="local-ai-group-title" id="local-ai-maintenance-title">Maintenance</h3>
          <p class="local-ai-group-caption">Explicit, cancellable work</p>
        </div>
        <div class="local-ai-list">
        ${jobs.map((job) => html`
          <div class="local-ai-row" data-job-id=${job.id} data-status=${job.status} data-muted=${job.disabled ? 'true' : 'false'}>
            <div class="local-ai-status-label">${job.label}</div>
            <div class="local-ai-row-main">
              <div class="local-ai-row-copy">${trimmed(job.detail) || 'Prepare or refresh this runtime resource on this device.'}</div>
            </div>
            <div class="local-ai-row-control">${this._renderJobControls(job)}</div>
          </div>
        `)}
        </div>
      </section>
    `
  }

  private _renderLocalAiProviders(secrets: readonly MnSettingsSecret[] = []): TemplateResult | typeof nothing {
    if (!secrets.length) return nothing
    return html`
      <section class="local-ai-group" aria-labelledby="local-ai-provider-title">
        <div class="local-ai-group-header">
          <h3 class="local-ai-group-title" id="local-ai-provider-title">AI provider</h3>
          <p class="local-ai-group-caption">Write-only credential</p>
        </div>
        <div class="local-ai-list">
          ${secrets.map(secret => html`
            <div class="local-ai-row" data-secret-id=${secret.id} data-muted=${secret.disabled ? 'true' : 'false'}>
              <div class="local-ai-status-label">${secret.label}</div>
              <div class="local-ai-row-main">
                <div class="local-ai-row-copy">${trimmed(secret.description) || 'Stored outside graph and browser state.'}</div>
              </div>
              <div class="local-ai-row-control row-actions">
                <span class="secret-state" data-tone=${secret.configured ? 'success' : 'neutral'}>
                  ${icon(secret.configured ? 'check' : 'circle', { size: 12 })}
                  ${secret.configured ? 'Configured' : 'Not configured'}
                </span>
                <button type="button" class="button" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'configure')}>
                  ${secret.configured ? 'Replace' : 'Configure'}
                </button>
                ${secret.configured
                  ? html`<button type="button" class="button" data-variant="danger" ?disabled=${secret.disabled} @click=${() => this._secret(secret, 'delete')}>Delete</button>`
                  : nothing}
              </div>
            </div>
          `)}
        </div>
      </section>
    `
  }

  private _renderLocalAiNotes(notes: readonly string[] = []): TemplateResult | typeof nothing {
    const unique = [...new Set(notes.map(note => trimmed(note)).filter(Boolean))]
    if (!unique.length) return nothing
    return html`
      <details class="local-ai-diagnostics">
        <summary>
          <span>Runtime notes</span>
          <span class="local-ai-diagnostics-count">${unique.length} ${unique.length === 1 ? 'note' : 'notes'}</span>
        </summary>
        <ul class="local-ai-diagnostics-list">
          ${unique.map(note => html`<li class="note" data-tone=${noteTone(note)}>${note}</li>`)}
        </ul>
      </details>
    `
  }

  private _renderLocalAi(section: MnSettingsSection): TemplateResult {
    const hasControls = Boolean(
      section.secrets?.length
      || section.metrics?.length
      || section.selects?.length
      || section.jobs?.length
      || section.toggles?.length
      || section.actions?.length,
    )
    return this._renderSectionFrame(section, [
      html`<div class="local-ai-stack">
        ${hasControls ? nothing : this._renderCapabilityState(
          'local-ai',
          'bot',
          'Local AI is unavailable',
          'This runtime did not report a model, index, parser, provider, or maintenance contract.',
        )}
        ${this._renderLocalAiProviders(section.secrets)}
        ${this._renderLocalAiMetrics(section.metrics)}
        ${this._renderLocalAiSelects(section.selects)}
        ${this._renderLocalAiJobs(section.jobs)}
        ${this._renderToggles(section.toggles)}
        ${this._renderActions(section.actions)}
        ${this._renderLocalAiNotes(section.notes)}
      </div>`,
    ])
  }

  private _renderFeatureCards(section: MnSettingsSection): TemplateResult {
    return this._renderSectionFrame(section, [
      this._renderMetrics(section.metrics),
      html`<div class="card-grid feature-grid" aria-label=${`${this._sectionTitle(section)} features`}>
        ${(section.toggles ?? []).map((setting) => html`
          <article class="feature-card feature-toggle-card" data-setting-id=${setting.id} data-muted=${setting.disabled ? 'true' : 'false'}>
            <div class="card-eyebrow">Feature</div>
            <h3 class="card-heading">
              <span>${setting.label}</span>
              <button
                type="button"
                class="toggle"
                aria-label=${setting.label}
                aria-pressed=${setting.checked ? 'true' : 'false'}
                ?disabled=${setting.disabled}
                @click=${() => this._toggle(setting)}
              ></button>
            </h3>
            ${trimmed(setting.description) ? html`<p class="card-copy">${setting.description}</p>` : nothing}
          </article>
        `)}
        ${(section.actions ?? []).map((action) => html`
          <article class="feature-card" data-action-id=${action.id} data-muted=${action.disabled ? 'true' : 'false'}>
            <div class="card-eyebrow">Data control</div>
            <h3 class="card-heading">${action.label}</h3>
            <p class="card-copy">${trimmed(action.description)}</p>
            <div class="card-footer">${this._renderActionButton(action)}</div>
          </article>
        `)}
      </div>`,
      this._renderSelects(section.selects),
      this._renderProviderCards(section.secrets),
      this._renderInlineJobs(section.jobs),
      this._renderNotes(section.notes),
    ])
  }

  private _renderAppearance(section: MnSettingsSection): TemplateResult {
    return this._renderSectionFrame(section, [
      this._renderMetrics(section.metrics),
      this._renderSelects(
        section.selects,
        'Reading room',
        'Theme, skin, and editor material.',
      ),
      this._renderToggles(
        section.toggles,
        'Motion',
        'Tune movement without changing the visual identity.',
      ),
      this._renderNotes(section.notes),
      this._renderActions(section.actions),
    ])
  }

  private _renderInterface(section: MnSettingsSection): TemplateResult {
    return this._renderSectionFrame(section, [
      this._renderMetrics(section.metrics),
      this._renderToggles(
        section.toggles,
        'Workspace chrome',
        'Choose what the shell shows around your documents.',
      ),
      this._renderSelects(section.selects, 'Workspace options'),
      this._renderNotes(section.notes),
      this._renderActions(section.actions),
    ])
  }

  private _renderGeneric(section: MnSettingsSection): TemplateResult {
    const hasContent = Boolean(
      section.metrics?.length
      || section.toggles?.length
      || section.selects?.length
      || section.secrets?.length
      || section.jobs?.length
      || section.actions?.length
      || section.notes?.length
      || trimmed(section.contentSlot),
    )
    return this._renderSectionFrame(section, [
      hasContent ? nothing : this._renderCapabilityState(
        String(section.id),
        'settings',
        'Nothing to configure here',
        'This runtime did not provide any settings for this section.',
      ),
      this._renderMetrics(section.metrics),
      trimmed(section.contentSlot)
        ? html`<div class="custom-content"><slot name=${section.contentSlot!}></slot></div>`
        : nothing,
      this._renderToggles(section.toggles),
      this._renderSelects(section.selects),
      this._renderSecrets(section.secrets),
      this._renderJobs(section.jobs),
      this._renderActions(section.actions),
      this._renderNotes(section.notes),
    ])
  }

  private _renderSection(section: MnSettingsSection): TemplateResult {
    if (section.id === 'account') return this._renderAccount(section)
    if (section.id === 'appearance') return this._renderAppearance(section)
    if (section.id === 'interface') return this._renderInterface(section)
    if (section.id === 'imports') return this._renderImports(section)
    if (section.id === 'graph-ops') return this._renderGraphOps(section)
    if (section.id === 'history') return this._renderHistory(section)
    if (section.id === 'api-keys') return this._renderProviderKeys(section)
    if (section.id === 'api-mcp') return this._renderApiMcp(section)
    if (section.id === 'local-ai') return this._renderLocalAi(section)
    if (section.id === 'experimental' || section.id === 'privacy') return this._renderFeatureCards(section)
    return this._renderGeneric(section)
  }

  private _renderRetainedStatus(status: 'loading' | 'error'): TemplateResult {
    if (status === 'loading') {
      return html`
        <div class="status-banner" data-tone="loading" role="status">
          ${icon('refresh', { size: 14 })}
          <span>Updating settings…</span>
        </div>
      `
    }
    return html`
      <div class="status-banner" data-tone="danger" role="alert">
        ${icon('alert-circle', { size: 14 })}
        <span>${this.error || 'The settings refresh failed.'}</span>
        <button type="button" class="button" @click=${() => this._refresh()}>Try again</button>
      </div>
    `
  }

  private _renderMain(): unknown {
    const currentSection = this._section()
    const retainedSection = currentSection ?? (this.sections.length ? this._retainedSection : undefined)
    if (this.status === 'loading' || this.status === 'idle') {
      if (retainedSection) {
        return [this._renderRetainedStatus('loading'), this._renderSection(retainedSection)]
      }
      return html`<div class="state" data-state="loading" role="status"><mn-loading size="sm" text="Loading settings"></mn-loading></div>`
    }
    if (this.status === 'error') {
      if (retainedSection) {
        return [this._renderRetainedStatus('error'), this._renderSection(retainedSection)]
      }
      return html`
        <div class="state" data-state="error" role="alert">
          <mn-empty-state
            icon="alert-circle"
            title="Settings failed"
            description=${this.error || 'The settings read failed.'}
            mood="danger"
            variant="compact"
          >
            <button slot="action" type="button" class="button state-action" @click=${() => this._refresh()}>Try again</button>
          </mn-empty-state>
        </div>
      `
    }
    const section = retainedSection
    if (!section) {
      return html`
        <div class="state">
          <mn-empty-state
            icon="settings"
            title="No settings available"
            description="This workspace did not provide any settings sections."
            variant="compact"
          ></mn-empty-state>
        </div>
      `
    }
    return this._renderSection(section)
  }

  render(): TemplateResult {
    return html`
      <section class="root" role="region" aria-label="Settings">
        <header class="header">
          <span class="brand">${icon('settings', { size: 18 })}<h1 class="brand-title">Settings</h1></span>
          ${this.showClose ? html`<button type="button" class="close" aria-label="Close settings" @click=${() => this._close()}>
            ${icon('x', { size: 18 })}
          </button>` : nothing}
        </header>
        <div class="layout">
          ${this._renderNav()}
          <main
            class="main"
            aria-busy=${this.status === 'loading' || this.status === 'idle' ? 'true' : 'false'}
            aria-labelledby=${this._section() ? 'settings-section-title' : nothing}
          >${this._renderMain()}</main>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-settings-page': MnSettingsPage
  }
}
