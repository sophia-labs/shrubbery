/**
 * Shell-owned keyboard routing for the bounded Garden parity slice.
 *
 * Document commands are resolved from the same CommandRegistry entries used by
 * the palette and shortcuts dialog. F6 remains direct focus navigation, matching
 * Garden's app shell: it changes focus but does not pretend to be a command.
 */

import type { CommandContext, CommandRegistry } from '@shrubbery/nucleus'

const DOCUMENT_SHORTCUT_IDS = new Set(['document.new', 'document.rename'])
const LANDMARK_SELECTOR = '[role="navigation"], [role="main"], [role="complementary"]'
const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'

type RegistryShortcutEvent = Pick<KeyboardEvent,
  | 'altKey'
  | 'code'
  | 'ctrlKey'
  | 'defaultPrevented'
  | 'key'
  | 'metaKey'
  | 'repeat'
  | 'shiftKey'
  | 'target'
  | 'composedPath'
  | 'preventDefault'
  | 'stopPropagation'
>

function eventPath(event: Pick<RegistryShortcutEvent, 'target' | 'composedPath'>): EventTarget[] {
  const path = event.composedPath()
  return path.length > 0 ? path : event.target ? [event.target] : []
}

function elementIsTextEntry(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (element instanceof HTMLElement && element.isContentEditable) return true
  const role = element.getAttribute('role')?.toLowerCase()
  return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton'
}

export function isTextEntryEvent(event: Pick<RegistryShortcutEvent, 'target' | 'composedPath'>): boolean {
  return eventPath(event).some(node => node instanceof Element && elementIsTextEntry(node))
}

export function isModalEvent(event: Pick<RegistryShortcutEvent, 'target' | 'composedPath'>): boolean {
  return eventPath(event).some(node => node instanceof Element && node.matches(MODAL_SELECTOR))
}

function shortcutMatches(shortcut: string, event: RegistryShortcutEvent): boolean {
  const tokens = shortcut.split('+').map(token => token.trim()).filter(Boolean)
  const lower = new Set(tokens.map(token => token.toLowerCase()))
  const mod = event.metaKey || event.ctrlKey
  if (lower.has('mod') !== mod) return false
  if (lower.has('alt') !== event.altKey) return false
  if (lower.has('shift') !== event.shiftKey) return false

  const keyToken = tokens.find(token => !['mod', 'alt', 'shift'].includes(token.toLowerCase()))
  if (!keyToken) return false
  if (/^[a-z]$/i.test(keyToken)) {
    // e.code is layout-independent and survives macOS Option producing a
    // composed character in e.key (Option+N commonly yields "˜").
    return event.code === `Key${keyToken.toUpperCase()}`
      || (!event.code && event.key.toLowerCase() === keyToken.toLowerCase())
  }
  return event.key.toLowerCase() === keyToken.toLowerCase()
    || event.code.toLowerCase() === keyToken.toLowerCase()
}

export function registryDocumentShortcutId(
  event: RegistryShortcutEvent,
  registry: Pick<CommandRegistry, 'available'>,
  ctx: CommandContext,
): string | null {
  if (event.defaultPrevented || event.repeat || isTextEntryEvent(event) || isModalEvent(event)) return null
  const command = registry
    .available(ctx, 'shortcut')
    .find(candidate =>
      DOCUMENT_SHORTCUT_IDS.has(candidate.id)
      && candidate.disabled !== true
      && typeof candidate.shortcut === 'string'
      && shortcutMatches(candidate.shortcut, event))
  return command?.id ?? null
}

/** Resolve, synchronously consume, and execute a real registry command. */
export function handleRegistryDocumentShortcut(
  event: RegistryShortcutEvent,
  registry: Pick<CommandRegistry, 'available' | 'exec'>,
  ctx: CommandContext,
  onError: (error: unknown) => void = () => undefined,
): string | null {
  const id = registryDocumentShortcutId(event, registry, ctx)
  if (!id) return null
  event.preventDefault()
  event.stopPropagation()
  void registry.exec(id, ctx).catch(onError)
  return id
}

function isVisibleLandmark(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0
}

function isFocusable(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('disabled')) return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'a' && element.hasAttribute('href')) return true
  if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return true
  if (element.isContentEditable) return true
  return element.tabIndex >= 0
}

function firstFocusable(root: ParentNode): HTMLElement | null {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (isFocusable(child)) return child
    if (child.shadowRoot) {
      const shadowMatch = firstFocusable(child.shadowRoot)
      if (shadowMatch) return shadowMatch
    }
    const nested = firstFocusable(child)
    if (nested) return nested
  }
  return null
}

export interface LandmarkCycleOptions {
  /** Test seam; production uses the same layout visibility test as Garden. */
  readonly isVisible?: (element: HTMLElement) => boolean
}

export function cycleLandmarkFocus(
  root: ParentNode,
  ownerDocument: Document,
  reverse = false,
  options: LandmarkCycleOptions = {},
): HTMLElement | null {
  const visible = options.isVisible ?? isVisibleLandmark
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(LANDMARK_SELECTOR)).filter(visible)
  // Panel components may expose their own nested landmark (for example a chat
  // aside inside the shell's complementary rail). Garden cycles shell regions,
  // so retain only the outermost visible landmark in each branch.
  const regions = candidates.filter(candidate =>
    !candidates.some(other => other !== candidate && other.contains(candidate)))
  if (regions.length === 0) return null

  const active = ownerDocument.activeElement
  const currentIndex = regions.findIndex(region => region === active || (active !== null && region.contains(active)))
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + (reverse ? -1 : 1) + regions.length) % regions.length
  const target = regions[nextIndex] ?? null
  if (!target) return null

  const focusable = firstFocusable(target)
  if (focusable) {
    focusable.focus()
    return target
  }

  const previousTabIndex = target.getAttribute('tabindex')
  target.setAttribute('tabindex', '-1')
  target.focus()
  if (previousTabIndex === null) {
    // Removing tabindex synchronously can make Chromium drop focus back to the
    // body. Keep the temporary programmatic-focus affordance until focus leaves.
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
  } else {
    target.setAttribute('tabindex', previousTabIndex)
  }
  return target
}

export function handleLandmarkCycleShortcut(
  event: RegistryShortcutEvent,
  root: ParentNode,
  ownerDocument: Document,
  options: LandmarkCycleOptions = {},
): HTMLElement | null {
  const mod = event.metaKey || event.ctrlKey
  if (event.defaultPrevented || event.repeat || event.key !== 'F6' || mod || event.altKey || isModalEvent(event)) {
    return null
  }
  event.preventDefault()
  event.stopPropagation()
  return cycleLandmarkFocus(root, ownerDocument, event.shiftKey, options)
}
