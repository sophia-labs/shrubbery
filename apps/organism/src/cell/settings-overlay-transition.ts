/**
 * In-place Settings navigation for an already-mounted Organism shell.
 *
 * The workspace/Home DOM remains mounted underneath an inert modal layer while
 * Settings loads. History still receives the canonical /settings URL, so Back,
 * Forward, deep links, and a cold route boot keep their ordinary meanings.
 */

import {
  detectOrganismAppRoute,
  type OrganismAppRouteMount,
} from './app-routes.js'

export interface SettingsOverlayHistory {
  readonly state: unknown
  pushState(data: unknown, unused: string, url?: string | URL | null): void
  back(): void
}

export interface SettingsOverlayTransitionOptions {
  /** The whole background surface which remains mounted while Settings is open. */
  readonly host: HTMLElement
  readonly history: SettingsOverlayHistory
  readonly mount: (
    host: HTMLElement,
    location: URL,
    onClose: () => void,
  ) => OrganismAppRouteMount | null
  /**
   * Lets the shell transfer transient chrome ownership before the Settings
   * route mounts its own frame. This keeps one mounted instance rather than
   * merely making a duplicate inert.
   */
  readonly onBeforeOpen?: () => void
  /** Restores shell-owned transient chrome after the Settings frame closes. */
  readonly onAfterClose?: () => void
}

export interface OpenSettingsOverlayOptions {
  readonly pushHistory?: boolean
  readonly focusReturn?: HTMLElement | null
}

interface BackgroundState {
  readonly element: HTMLElement
  readonly inert: boolean
  readonly ariaHidden: string | null
}

interface ActiveSettingsOverlay {
  readonly element: HTMLElement
  readonly mount: OrganismAppRouteMount
  readonly background: BackgroundState
  readonly focusReturn: HTMLElement | null
  readonly title: string
}

export interface SettingsOverlayTransition {
  readonly isOpen: boolean
  open(location: URL, options?: OpenSettingsOverlayOptions): boolean
  /** Returns true when this popstate belonged to the Settings overlay. */
  handlePopState(location: URL, focusReturn?: HTMLElement | null): boolean
  close(): void
  destroy(): void
}

function localPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}

function settingsRoute(url: URL): boolean {
  return detectOrganismAppRoute(url)?.kind === 'settings'
}

function historyState(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function createSettingsOverlayTransition(
  options: SettingsOverlayTransitionOptions,
): SettingsOverlayTransition {
  const document = options.host.ownerDocument
  let active: ActiveSettingsOverlay | null = null

  const restoreBackground = (item: BackgroundState): void => {
    item.element.inert = item.inert
    if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden')
    else item.element.setAttribute('aria-hidden', item.ariaHidden)
  }

  const close = (): void => {
    const current = active
    if (!current) return
    active = null
    current.mount.destroy()
    current.element.remove()
    restoreBackground(current.background)
    options.onAfterClose?.()
    document.body.removeAttribute('data-organism-settings-open')
    document.title = current.title
    if (current.focusReturn?.isConnected) {
      current.focusReturn.focus({ preventScroll: true })
    }
  }

  const open = (
    location: URL,
    openOptions: OpenSettingsOverlayOptions = {},
  ): boolean => {
    if (active) return true
    if (!settingsRoute(location)) return false

    // The settings route owns its own banner/overlay frame. Retire the
    // resident workspace copies synchronously before that frame mounts so a
    // fixed overlay can never briefly exist twice with the same identity.
    options.onBeforeOpen?.()

    const overlay = document.createElement('div')
    overlay.className = 'organism-settings-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Settings')

    // Inert the stable host rather than its current children. Lit can replace
    // those children while Settings is open; keeping the boundary inert means
    // a background rerender cannot accidentally become interactive.
    const background: BackgroundState = {
      element: options.host,
      inert: Boolean(options.host.inert),
      ariaHidden: options.host.getAttribute('aria-hidden'),
    }
    options.host.inert = true
    options.host.setAttribute('aria-hidden', 'true')
    document.body.append(overlay)

    const mount = options.mount(overlay, location, () => options.history.back())
    if (!mount) {
      overlay.remove()
      restoreBackground(background)
      options.onAfterClose?.()
      return false
    }

    active = {
      element: overlay,
      mount,
      background,
      focusReturn: openOptions.focusReturn ?? null,
      title: document.title,
    }
    document.body.setAttribute('data-organism-settings-open', '')
    document.title = 'Settings — Garden'

    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      options.history.back()
    })
    queueMicrotask(() => {
      const page = overlay.querySelector<HTMLElement>('mn-settings-page')
      if (!page || !active || active.element !== overlay) return
      page.tabIndex = -1
      page.focus({ preventScroll: true })
    })

    if (openOptions.pushHistory !== false) {
      options.history.pushState(
        { ...historyState(options.history.state), organismOverlayRoute: 'settings' },
        '',
        localPath(location),
      )
    }
    return true
  }

  return {
    get isOpen() { return active !== null },
    open,
    handlePopState(location, focusReturn = null) {
      if (active) {
        if (!settingsRoute(location)) close()
        return true
      }
      if (!settingsRoute(location)) return false
      return open(location, { pushHistory: false, focusReturn })
    },
    close,
    destroy: close,
  }
}
