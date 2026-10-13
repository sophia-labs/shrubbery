/**
 * The shell's answer to the chat's "Add credits".
 *
 * The chat does not sell credits and does not know how they are bought. Its refusal banner and its
 * balance line raise one bubbling, composed event (`sh-chat-add-credits`) and say what the person
 * needs to know: their balance and what one message needs at the least. This file is the shell's end
 * of that seam: it takes the person to Settings, Billing with the amount that covers the need already
 * armed (the person still presses the button; nothing is bought by arriving).
 *
 * It goes THROUGH the Settings overlay the gear uses, not past it. The overlay leaves the workspace
 * mounted and inert underneath, so the conversation, the refusal and the words the person kept in the
 * composer are all still there when Settings closes; a plain navigation would reload the page. The URL
 * is the gear's own (`settingsNavigationUrl`: the cell graph Settings must keep, and where to return
 * to), with Billing and the amount added.
 */

import { CHAT_ADD_CREDITS_EVENT, type ChatAddCreditsDetail } from '@shrubbery/runtime'
import { TOPUP_PARAM, suggestTopUpUsd } from './add-credits.js'
import { settingsNavigationUrl } from './settings-navigation.js'

/** What the chat said, tolerated when it said less: asking to add credits is never wrong, so it never throws. */
type Said = Partial<ChatAddCreditsDetail>

/**
 * The Settings URL for "Add credits": Billing, on the amount that covers what the chat said it
 * needed (see `suggestTopUpUsd`), built on the same URL the Settings gear would build from here.
 * For the credits notice's "Details" it is Billing with nothing armed.
 */
export function billingSettingsUrl(current: URL, graphId: string | null, said: Said | null | undefined): URL {
  const target = settingsNavigationUrl(current, graphId)
  target.searchParams.set('settings', 'billing')
  // "Details" on the credits notice is a request to look, not to buy: nothing is armed for it. Every other
  // way here is a person who needs credits, and the amount that covers the need is ready for them.
  if (said?.source !== 'notice') {
    target.searchParams.set(TOPUP_PARAM, String(suggestTopUpUsd({
      balanceMicroUsd: said?.balanceMicroUsd ?? null,
      requiredMicroUsd: said?.requiredMicroUsd ?? null,
    })))
  }
  return target
}

export interface ChatCreditsShell {
  /** The element the chat's event reaches (the event bubbles and is composed, so any ancestor of the chat host will do). */
  readonly host: EventTarget
  /** Where the person is now. */
  readonly currentUrl: () => URL
  /** The cell graph Settings must keep; null when there is none. */
  readonly graphId: () => string | null
  /**
   * Open Settings at `target` over the live workspace, returning focus to `focusReturn` when it closes.
   * False when the shell cannot do that here (some other route is open): the way out is `assign`.
   */
  readonly open: (target: URL, focusReturn: HTMLElement | null) => boolean
  /** A full navigation to a local path, for when `open` cannot. */
  readonly assign: (path: string) => void
}

/** The first connected element the event came from: where focus goes back to when Settings closes. */
function focusReturnOf(event: Event): HTMLElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  return path.find((candidate): candidate is HTMLElement => (
    candidate instanceof HTMLElement && candidate.isConnected
  )) ?? null
}

/** Listen for the chat's "Add credits" and take the person to Billing. Returns the way to stop listening. */
export function connectChatCredits(shell: ChatCreditsShell): () => void {
  const listener = (event: Event): void => {
    const said = (event as CustomEvent<ChatAddCreditsDetail | null>).detail
    const target = billingSettingsUrl(shell.currentUrl(), shell.graphId(), said)
    if (shell.open(target, focusReturnOf(event))) return
    shell.assign(`${target.pathname}${target.search}${target.hash}`)
  }
  shell.host.addEventListener(CHAT_ADD_CREDITS_EVENT, listener)
  return () => shell.host.removeEventListener(CHAT_ADD_CREDITS_EVENT, listener)
}
