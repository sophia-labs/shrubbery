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
  CHAT_CODE_COPY_EVENT,
  CHAT_HEADER_ACTION_EVENT,
  CHAT_MESSAGE_ACTION_EVENT,
  CHAT_SESSION_ACTION_EVENT,
  type ChatCodeCopyDetail,
  type ChatHeaderActionDetail,
  type ChatMessageActionDetail,
  type ChatMessageExportDetail,
  type ChatMessageRegenerateDetail,
  type ChatPresentation,
  type ChatSessionActionDetail,
  type HojaComposerDetail,
  type HojaWikiLinkResolver,
  type HojaWikiLinkSuggestion,
} from './chat-host.js'
export { mountChatHost } from './mount-chat-host.js'
export {
  createChatServiceStore,
  type ChatServiceStore,
  type ChatServiceStoreState,
} from './chat-service-store.js'
