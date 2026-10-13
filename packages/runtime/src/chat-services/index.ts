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
  ChatBillingFailure,
  ChatServiceFailure,
  asChatServiceFailure,
} from './chat-service.js'
export type {
  ChatBillingDetail,
  ChatBillingKind,
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
  purgeHostedChatWindows,
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

// Sobremesa: a voice that can be chosen, a conversation that can be picked up, the
// credit line beside the picker, and the one conversation home. Every capability is
// optional on ChatService and absent on the local service.
export { NO_CAPABILITIES } from './chat-service.js'
export type {
  ChatBalance,
  ChatCapabilities,
  ContinueIntent,
  ConversationLineage,
  ConversationSummary,
} from './chat-service.js'
export {
  ContinuationError,
  DEFAULT_WINDOW_LIMITS,
  familyOf,
  matchSourceVoice,
  providerNoticeFor,
  readContinuationPlan,
  recordedVoiceOf,
  seamVoiceLabel,
  seedPayloadFor,
  serializedBytes,
  sourceVoiceMark,
  windowToChatMessages,
} from './continuation.js'
export type {
  ContinuationChoice,
  ContinuationErrorCode,
  ContinuationPlan,
  ContinuationWindow,
  ReadPlanOptions,
  SeedPayload,
  SeedReceipt,
  SourceVoice,
  SourceVoiceMatch,
  WindowLimits,
  WindowMessage,
} from './continuation.js'

// Credits in the chat: the words and the arithmetic (pure), for a shell that needs the
// same figures the chat shows (the amount to preselect in Settings, Billing, say).
export {
  ADD_CREDITS_ACTION,
  CREDITS_NOTICE_DETAILS_ACTION,
  CREDITS_NOTICE_DISMISS_ACTION,
  CREDITS_NOTICE_ID,
  LOW_BALANCE_MICRO_USD,
  MIN_ADMIT_FLOOR_MICRO_USD,
  NEW_CHAT_ACTION,
  PREMIUM_SHORT_TURN_MICRO_USD,
  SERVICE_FEE_PERCENT,
  accountNoteFor,
  annotateVoices,
  billingFailureMessage,
  billingNotice,
  budgetNotice,
  costAnnotation,
  creditsNoticeFor,
  formatCost,
  formatCredit,
  minAdmitMicroUsd,
  multipleOfHouse,
  priceFootnote,
  shortTurnMicroUsd,
} from './chat-billing.js'
export type { BalanceReading, ChatCreditsNoticeSource, ChatCreditsNoticeView } from './chat-billing.js'

// What the backend says about the credits regime on its balance answer (the fee, the gate's mode, the
// day credits start): pure, for the chat and for a shell's Billing alike.
export {
  feePercentOf,
  formatFeePercent,
  parseCreditsFacts,
  parseCreditsStartDate,
  type CreditsFacts,
  type CreditsGateMode,
} from './credits-facts.js'

// The one conversation home: live + imported conversations in one list, the imported
// reader (an archived conversation read a page at a time), and the copy a person can
// keep (Save to Garden, Download as Markdown). Sobremesa; all pure, none touches the DOM.
export {
  createConversationHomeController,
  type ConversationFamily,
  type ConversationHomeController,
  type ConversationHomeState,
  type ConversationHomeView,
  type ImportedLoad,
  type LiveLoad,
  type LoadPhase,
} from './conversation-home-controller.js'
export {
  DEFAULT_MAX_EXPORT_MESSAGES,
  createImportedReader,
  type ContinueConversationIntent,
  type ImportedReader,
  type ImportedReaderHeader,
  type ImportedReaderState,
  type LoadAllOptions,
  type LoadAllResult,
} from './imported-reader.js'
export {
  MARKDOWN_MIME_TYPE,
  buildMarkdownFile,
  importedExportSource,
  liveExportSource,
  type CollectedConversation,
  type ConversationExportSource,
  type ExportContext,
  type MarkdownFile,
} from './conversation-export.js'
export {
  SAVE_TO_GARDEN_INTRO,
  createSaveFlow,
  saveToGardenCopy,
  type SaveFlow,
  type SaveFlowState,
  type SavePhase,
  type SaveTarget,
  type SaveToGardenPort,
  type SaveToGardenRequest,
  type SaveToGardenResult,
} from './save-flow.js'
