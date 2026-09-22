/**
 * Controlled contract for the document center.
 *
 * Pane assignment and navigation are session state. The renderer receives this
 * plain projection and emits typed intent; graph reads, provider acquisition,
 * persistence, and navigation side effects remain shell-owned.
 */

export const PRIMARY_CENTER_PANE_ID = 'center-primary'
export const SECONDARY_CENTER_PANE_ID = 'center-secondary'

export type CenterPaneId = string
export type CenterPanePosition = 'primary' | 'secondary'
export type CenterPanePosture =
  | 'workspace'
  | 'left-collapsed'
  | 'right-collapsed'
  | 'both-collapsed'
  | 'zen'
  | 'compact'

export interface CenterPaneHomeLocation {
  readonly kind: 'home'
  readonly graphId: string | null
  readonly title?: string
}

export interface CenterPaneDocumentLocation {
  readonly kind: 'document'
  readonly graphId: string
  readonly documentId: string
  readonly title: string
}

export type CenterPaneLocation = CenterPaneHomeLocation | CenterPaneDocumentLocation

export interface CenterPaneNavigationState {
  /** Stable for the lifetime of the browser/session pane. Never a document id. */
  readonly id: CenterPaneId
  readonly position: CenterPanePosition
  readonly current: CenterPaneLocation
  readonly back: readonly CenterPaneLocation[]
  readonly forward: readonly CenterPaneLocation[]
}

export interface CenterPanesState {
  readonly primary: CenterPaneNavigationState
  /** Reserved stable id used whenever the optional second pane is opened. */
  readonly secondaryPaneId: CenterPaneId
  readonly secondary: CenterPaneNavigationState | null
  readonly activePaneId: CenterPaneId
  readonly dividerPercent: number
  readonly posture: CenterPanePosture
}

export interface CenterPaneCapabilities {
  readonly openDocument: boolean
  readonly navigate: boolean
  readonly close: boolean
  readonly openDisabledReason?: string
  readonly navigateDisabledReason?: string
  readonly closeDisabledReason?: string
}

export interface CenterPanesCapabilities {
  readonly split: boolean
  readonly closeSplit: boolean
  readonly resize: boolean
  readonly splitDisabledReason?: string
  readonly closeSplitDisabledReason?: string
  readonly resizeDisabledReason?: string
}

export interface CenterPaneProjection extends CenterPaneNavigationState {
  readonly active: boolean
  readonly title: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly capabilities: CenterPaneCapabilities
}

export interface CenterPaneSplitCommand {
  readonly action: 'open' | 'close'
  readonly pressed: boolean
  readonly label: string
  readonly disabled: boolean
  readonly disabledReason?: string
}

export interface CenterPanesProjection {
  readonly panes: readonly CenterPaneProjection[]
  readonly activePaneId: CenterPaneId
  readonly dividerPercent: number
  readonly dividerMinPercent: number
  readonly dividerMaxPercent: number
  readonly posture: CenterPanePosture
  readonly split: boolean
  readonly splitCommand: CenterPaneSplitCommand
  readonly capabilities: CenterPanesCapabilities
}

export interface CenterPaneOpenIntentDetail {
  readonly paneId: CenterPaneId
  readonly placement: 'active' | 'split'
  /** Absent means “ask the host to choose a document”. */
  readonly location?: CenterPaneLocation
  readonly reason: 'choose-document' | 'split-command' | 'open-in-split'
  readonly activate?: boolean
}

export interface CenterPaneFocusIntentDetail {
  readonly paneId: CenterPaneId
  readonly reason: 'pointer' | 'focus' | 'keyboard' | 'programmatic'
}

export interface CenterPaneCloseIntentDetail {
  readonly paneId: CenterPaneId
  readonly reason: 'pane-command' | 'split-command'
}

export interface CenterPaneNavigateIntentDetail {
  readonly paneId: CenterPaneId
  readonly direction: 'back' | 'forward'
}

export interface CenterPaneResizeIntentDetail {
  readonly dividerPercent: number
  readonly source: 'pointer' | 'keyboard'
}

export type CenterPanesIntent =
  | { readonly type: 'open'; readonly detail: CenterPaneOpenIntentDetail }
  | { readonly type: 'focus'; readonly detail: CenterPaneFocusIntentDetail }
  | { readonly type: 'close'; readonly detail: CenterPaneCloseIntentDetail }
  | { readonly type: 'navigate'; readonly detail: CenterPaneNavigateIntentDetail }
  | { readonly type: 'resize'; readonly detail: CenterPaneResizeIntentDetail }

export const CENTER_PANE_OPEN_EVENT = 'mn-center-pane-open'
export const CENTER_PANE_FOCUS_EVENT = 'mn-center-pane-focus'
export const CENTER_PANE_CLOSE_EVENT = 'mn-center-pane-close'
export const CENTER_PANE_NAVIGATE_EVENT = 'mn-center-pane-navigate'
export const CENTER_PANE_RESIZE_EVENT = 'mn-center-pane-resize'

export const DEFAULT_CENTER_PANES_CAPABILITIES: CenterPanesCapabilities = Object.freeze({
  split: true,
  closeSplit: true,
  resize: true,
})
