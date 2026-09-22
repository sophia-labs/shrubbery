/**
 * chat-services/index.ts — the ChatService ontology barrel (RUNTIME-INTERNAL).
 *
 * ChatService is the host-side imperative chat seam — the chat analog of
 * editor-services/. It is RUNTIME-INTERNAL: the host imports it via
 * './chat-services/index.js' — a './'-relative subdir import that passes the
 * non-recursive island guard (exactly like editor-services/ and collab/). The
 * subdir may legally depend on @shrubbery/chat-kernel (types) — the runtime
 * top-level island scan never reaches it.
 *
 * This barrel re-exports the seam interface + its types (C2.1), and — once landed
 * — the real local impl + the assemble/build boundary (C2.2/C2.3). The kernel is
 * NEVER imported by the runtime top-level; only this subdir touches it.
 */

export {
  ChatServiceFailure,
  asChatServiceFailure,
} from './chat-service.js'
export type {
  ChatService,
  ChatFailurePhase,
  ChatFailureRecovery,
  ChatTurnHandle,
  ChatTurnOutcome,
  CreateSessionOpts,
  HydratedSession,
} from './chat-service.js'

// The REAL local in-process impl (option a — Map-backed store + injectable ECHO
// turnDriver emitting real ChatEvent[]). makeLocalChatService is what the local
// branch of assembleChatServices returns.
export {
  makeLocalChatService,
  type LocalChatServiceOptions,
  type TurnDriver,
} from './local-chat-service.js'

export {
  makeHostedChatService,
  parseSse,
  type HostedChatServiceOptions,
} from './hosted-chat-service.js'

// The DETERMINISTIC GROW-DRIVER (N0a) — a TurnDriver that matches a fixed phrase
// catalog to a structural VerbSpec and calls the REAL grow() (the LOCAL-N0 swap
// for the ECHO driver). The C4 LLM driver slots into the same TurnDriver seam.
export { makeGrowTurnDriver } from './grow-turn-driver.js'
export {
  InProcessChatStore,
  computeAggregates,
  type SessionAggregates,
  type CreateSessionRow,
} from './in-process-chat-store.js'

// The local/hosted factory + the boundary adapter that projects the stateful
// service/store into the kernel's pure props.
export {
  assembleChatServices,
  buildChatKernelOptions,
  defaultModels,
  type AssembleChatServicesOptions,
  type ChatServiceMode,
  type ChatProjection,
  type ChatProjectionSource,
} from './assemble.js'
