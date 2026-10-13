/**
 * conversation-home-ports.ts — what the shell hands the chat host so the drawer and
 * the imported reader can do the few things only the shell can.
 *
 * Every port is optional, and a missing port removes the control that would have
 * used it: nothing is drawn that cannot be honoured.
 */

import type { MarkdownFile } from '../chat-services/conversation-export.js'
import type { ContinueConversationIntent } from '../chat-services/imported-reader.js'
import type { SaveToGardenPort } from '../chat-services/save-flow.js'

/** Bubbling, composed: the person asked to continue an imported conversation. `detail` is the intent. */
export const CHAT_CONTINUE_EVENT = 'mn-chat-continue-conversation'

export interface ConversationHomePorts {
  /**
   * Where a copy of a conversation may go, and how to make one. Absent: the Save
   * dialog offers only the download.
   */
  readonly saveToGarden?: SaveToGardenPort
  /**
   * Continue an imported conversation, the shell's own way. A rejection is shown to the
   * person and the drawer stays open; a resolution closes it.
   *
   * Absent (what the workspace does): the host runs its own flow when its service says the
   * workspace can carry a seed (`capabilities.continuation`, read from the registry): the
   * chooser, the window, the seam, the seed at the first message. Where it cannot, no
   * "Continue with…" is drawn, so nothing can silently start a plain chat in its place.
   */
  readonly onContinue?: (intent: ContinueConversationIntent) => void | Promise<void>
  /** Hand a file to the person. Absent: a real browser download. */
  readonly download?: (file: MarkdownFile) => void
  /** The clock the list reads its relative dates from. Absent: the real one. */
  readonly now?: () => number
}
