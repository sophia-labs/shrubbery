/**
 * app-toolbar — the per-app contextual toolbar registry for mn-top-bar.
 *
 * The icon buttons to the right of the app picker depend on the ACTIVE app.
 * They are declared here, keyed by app id, never hard-coded in the bar's
 * markup: adding a button to an app is one entry in APP_TOOLBAR_ACTIONS.
 *
 * Each action names the composed DOM event the bar emits when it is pressed.
 * The bar holds no behaviour of its own; the shell that already listens for
 * that event (e.g. `mn-navigate-home`) does the work. So a new action is
 * either an existing chrome event or a new event name plus a shell listener.
 *
 * Backend-free: pure data + a lookup. No lit, no stores.
 */

import { t } from '@shrubbery/nucleus'
/** One icon-only toolbar button. */
export interface AppToolbarAction {
  /** Stable id; rendered as `data-app-action` for tests and harnesses. */
  readonly id: string
  /** Accessible name and tooltip (the button has no visible caption). */
  readonly label: string
  /** An icons.ts glyph name. */
  readonly icon: string
  /** Composed, bubbling CustomEvent the bar dispatches on press. */
  readonly event: string
  /** Optional detail carried on the event. */
  readonly detail?: unknown
  /** Rendered but not pressable (e.g. a read-only workspace). */
  readonly disabled?: boolean
}

/** The Garden home: the same navigation the masthead has always emitted. */
export const HOME_ACTION: AppToolbarAction = {
  id: 'home',
  get label() { return t('Home') },
  icon: 'home',
  event: 'mn-navigate-home',
}

/** Choreograph's home: the modes surface's Overview screen. */
export const CHOREOGRAPH_OVERVIEW_ACTION: AppToolbarAction = {
  id: 'overview',
  get label() { return t('Choreograph overview') },
  icon: 'home',
  event: 'mn-choreograph-overview',
}

/** Start a new mode in the Choreograph modes editor. */
export const CHOREOGRAPH_NEW_MODE_ACTION: AppToolbarAction = {
  id: 'new-mode',
  get label() { return t('New mode') },
  icon: 'plus',
  event: 'mn-choreograph-new-mode',
}

/** Hoja: start a new note — a "leaf", in Hoja's own words — in the open workspace. */
export const HOJA_NEW_NOTE_ACTION: AppToolbarAction = {
  id: 'new-note',
  get label() { return t('New leaf') },
  icon: 'plus',
  event: 'mn-hoja-new-note',
}

/**
 * The registry. Keyed by app id (the same ids the app picker renders, see
 * ChromeAppTab.id). An app with no entry has an empty toolbar — the bar then
 * renders nothing there rather than inventing a default.
 */
export const APP_TOOLBAR_ACTIONS: Readonly<Record<string, readonly AppToolbarAction[]>> = {
  garden: [HOME_ACTION],
  choreograph: [CHOREOGRAPH_OVERVIEW_ACTION, CHOREOGRAPH_NEW_MODE_ACTION],
  hoja: [HOJA_NEW_NOTE_ACTION],
}

/** The declared toolbar for an app id; an unknown id yields an empty list. */
export function appToolbarActions(appId: string): readonly AppToolbarAction[] {
  return APP_TOOLBAR_ACTIONS[appId] ?? []
}
