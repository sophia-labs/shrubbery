/**
 * chat-host/index.ts — the Class-B chat-host barrel (RUNTIME-INTERNAL, host-side).
 *
 * The chat analog of the editor-host trio (editor-host.ts + mount.ts +
 * editor-host-binding.ts), but quarantined to a SUBDIR (not island-scanned) so it
 * may side-effect-import @shrubbery/chat-kernel to register <sh-chat-panel> +
 * <sh-chat-host>. The runtime top-level island scan never reaches here; the kernel
 * stays pure (the kernel never imports the host/store).
 *
 * The shell does:
 *   const svc = assembleChatServices(contract, scope, 'local')
 *   const session = await svc.createSession({ title })   // SHELL POLICY
 *   render(html`${spine}${mountChatHost(svc, session.id)}`, container)
 */

export {
  ShChatHost,
  CHAT_ADD_CREDITS_EVENT,
  CHAT_CHANGE_ACTION_EVENT,
  type ChatHostWorkspace,
  CHAT_CODE_COPY_EVENT,
  CHAT_CONTINUE_WITH_EVENT,
  CHAT_HEADER_ACTION_EVENT,
  CHAT_MESSAGE_ACTION_EVENT,
  CHAT_OPEN_ORIGINAL_EVENT,
  CHAT_SESSION_ACTION_EVENT,
  type ChatAddCreditsDetail,
  type ChatCodeCopyDetail,
  type ChatHeaderActionDetail,
  type ChatHostCredits,
  type ChatMessageActionDetail,
  type ChatMessageExportDetail,
  type ChatMessageRegenerateDetail,
  type ChatPresentation,
  type ChatSessionActionDetail,
  type HojaComposerDetail,
  type HojaWikiLinkResolver,
  type HojaWikiLinkSuggestion,
} from './chat-host.js'
export { CHAT_CONTINUE_EVENT, type ConversationHomePorts } from './conversation-home-ports.js'
export { mountChatHost } from './mount-chat-host.js'
export {
  ShChatArtifactPreview,
  type ChatArtifactPreviewHandle,
  type ChatArtifactPreviewPort,
  type ChatArtifactPreviewView,
} from './chat-artifact-preview.js'
export {
  CONTINUE_HERE_ACTION,
  createChatServiceStore,
  type ChatServiceStore,
  type ChatServiceStoreOptions,
  type ChatServiceStoreState,
} from './chat-service-store.js'
export { ShContinueChooser, type ContinueConfirmDetail, type ContinuePhase } from './continue-chooser.js'
// Kernel types the shell's change links speak; re-exported here because the top-level island scan
// forbids src/index.ts from importing @shrubbery/chat-kernel directly.
export type { ChatChangeIntent, ChatArtifactPreviewRequest } from '@shrubbery/chat-kernel'
