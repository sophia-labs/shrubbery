/**
 * mount-chat-host.ts — the Class-B chat-host mount glue (C3).
 *
 * The chat analog of mountEditorHost: mountChatHost(service, sessionId) returns
 * the ONE live <sh-chat-host>, wrapped in a LITERAL-CONSTANT keyed() ChildPart so
 * Lit reuses the SAME ChildPart — hence the SAME DOM node — across EVERY re-render,
 * including an interface-grow (W2) that adds/removes regions around it. The service
 * + sessionId flow in as PROPS; a value change re-renders but never re-creates the
 * node.
 *
 * CRITICAL (mount-once correctness, mirror mount.ts): the host must be rendered at
 * a STABLE template-slot position. The standalone chat demo uses a fixed final
 * binding. The workspace renderer uses the stable `mn-chat-panel` region body
 * part, so the live chat sits in the right-rail pane instead of as detached
 * chrome. In both cases keyed() protects the host node while the same part is
 * re-rendered with the same service/session identity.
 *
 * Dependencies: lit (+ lit/directives/keyed.js) and the sibling chat-host element
 * + the chat-services ChatService TYPE. No store/contract/CRDT at the value level.
 */

import { html, nothing } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import type { HojaWikiLinkResolver, SurfaceActionIntent } from '@shrubbery/chat-kernel'
import type { ChatService } from '../chat-services/chat-service.js'
import type {
  ChatCodeCopyDetail,
  ChatHeaderActionDetail,
  ChatHostCredits,
  ChatHostWorkspace,
  ChatMessageActionDetail,
  ChatPresentation,
  ChatSessionActionDetail,
} from './chat-host.js'
import type { ConversationHomePorts } from './conversation-home-ports.js'
// Side-effect import: registers the <sh-chat-host> custom element.
import './chat-host.js'

/** Stable key for the keyed() ChildPart — guarantees ONE reused live node. */
const CHAT_HOST_KEY = 'sh-chat-host'

/**
 * The ONE live <sh-chat-host>, mounted via a literal-constant keyed() part so Lit
 * reuses the SAME DOM node across every re-render (collapse permutations,
 * interface-grow region adds, app/branch switches). The service + sessionId flow
 * in as PROPS; a value change re-renders but never re-creates the node.
 *
 * Returns `nothing` when no service is provided, so a shell with no chat host is
 * byte-identical to the no-host path (back-compat).
 */
export function mountChatHost(
  service: ChatService | null | undefined,
  sessionId: string | null | undefined,
  opts: {
    readonly onSurfaceAction?: (action: SurfaceActionIntent) => void
    readonly onMessageAction?: (detail: ChatMessageActionDetail) => void
    readonly onCodeCopy?: (detail: ChatCodeCopyDetail) => void
    readonly onHeaderAction?: (detail: ChatHeaderActionDetail) => void
    readonly onSessionAction?: (detail: ChatSessionActionDetail) => void
    readonly presentation?: ChatPresentation
    readonly composerReferenceResolver?: HojaWikiLinkResolver
    /** What only the shell can do for the history drawer: save a copy, continue an import, download, the clock. */
    readonly conversationHome?: ConversationHomePorts
    /**
     * What the shell lets the chat do about credits (the balance line, "Add credits"). Absent: neither.
     * Written to the host on every render, so a render that no longer grants one takes it back.
     */
    readonly credits?: ChatHostCredits
    /**
     * What the shell lets the workspace chat do with what a turn changed (links, names, the live preview).
     * Written to the host on every render, like credits.
     */
    readonly workspace?: ChatHostWorkspace
  } = {},
): unknown {
  if (!service) return nothing
  return keyed(
    CHAT_HOST_KEY,
    html`<sh-chat-host
      id="sh-chat-host"
      class="chat-host-singleton"
      .service=${service}
      .sessionId=${sessionId ?? null}
      .presentation=${opts.presentation ?? 'rail'}
      .composerReferenceResolver=${opts.composerReferenceResolver}
      .conversationHome=${opts.conversationHome}
      .showBalance=${opts.credits?.showBalance === true}
      .canAddCredits=${opts.credits?.canAddCredits === true}
      .creditsNotice=${opts.credits?.notice}
      .workspace=${opts.workspace}
      .onSurfaceAction=${opts.onSurfaceAction}
      .onMessageAction=${opts.onMessageAction}
      .onCodeCopy=${opts.onCodeCopy}
      .onHeaderAction=${opts.onHeaderAction}
      .onSessionAction=${opts.onSessionAction}
    ></sh-chat-host>`,
  )
}
