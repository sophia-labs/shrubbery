/**
 * sobremesa-paths.ts — the routes and the one schema name of the Sobremesa surface, and nothing else.
 *
 * They live apart from `sobremesa-contract.ts` (which re-exports them: nothing changes for a reader of the contract) so
 * that a script run by plain Node (the browser harnesses serve the scripted host from fixtures) can name the routes
 * without importing the chat kernel, whose Lit elements only a bundler can load.
 */

/**
 * The catalogue of voices: `GET /chat/models?view=chat`, at the GATEWAY ROOT (it is the
 * account's, not a graph's) and forwarded to Choreograph's `GET /api/models?view=chat`
 * unprojected. Confirmed by `C-choreograph-return.md` 1.1 and 1.7. `limit=1000` is the most
 * it serves; it lists the models a launch would admit (288 of the provider's 464 on
 * 2026-09-29), each priced as the person pays.
 *
 * The gateway route is the release's: today the same path answers with the gateway's own
 * old projection (no schema, every model, float prices), which {@link parseCatalogue}
 * refuses, so until the gateway forwards it the picker simply does not appear.
 */
export const VOICE_CATALOGUE_PATH = '/chat/models?view=chat&limit=1000'

/** What the body of {@link VOICE_CATALOGUE_PATH} calls itself. Nothing else is a catalogue of voices. */
export const VOICE_CATALOGUE_SCHEMA = 'choreograph.chat-models.v1'

/**
 * `POST /g/{graph}/chat-seeds` (Editor, as starting a chat is; the body forwarded verbatim; the gateway's
 * 1 MiB cap applies), live on the gateway since `voices-r1`. `C-choreograph-return.md` 1.1, 1.6 and R12.
 *
 * The body is `sophia.chat-seed.v1` with `messages[{ role, text, occurredAt?, voice?: { model } }]` and nothing
 * else (`continuation.ts`'s `seedPayloadFor`); the answer is 201 the first time these bytes are stored for the
 * person and 200 after, `{ digest, bytes, expiresAt }` (`parseSeedReceipt`; `expiresAt` in epoch milliseconds);
 * the launch input's `seed` is `{ seedDigest, bytes, continuesConversation, window: { kept, omitted, total },
 * title? }` (`seedInput`). A refusal never quotes the body: 413 `seed_too_large`, 400 `seed_invalid`.
 */
export const CHAT_SEEDS_PATH = '/chat-seeds'

/**
 * The chat session list rides the run list, `GET /g/{graph}/workflows/runs?view=chat-sessions`
 * (Viewer; no gateway change). Confirmed by `C-choreograph-return.md` 1.1 and 1.4, which also fixes
 * the row (`sessionId`, `runId`, `graphId`, `graphOwnerPrincipal`, `workflow`, `title`,
 * `titleSource`, `model`, `provider`, `createdAt`, `lastActivityAt`, `status`, `lifecycleState`,
 * `continuesConversation`, `seedWindow`) and, for privacy, says **only the caller's own chats are
 * listed, even for the graph owner** (the caller is `x-user-id`, minted by the gateway): a
 * collaborator's first message never becomes a title in someone else's home. The rows carry no
 * per-session owner and need none (`graphOwnerPrincipal` is the graph's), so the SPA has nothing to
 * filter on and does not pretend to: the scoping is Choreograph's, and was traced by the
 * catalogue's desk-check (`C-desk-check-54145c7.md`). A host that ignored it would have to add an
 * owner field first.
 */
export const CHAT_SESSIONS_PATH = '/workflows/runs?view=chat-sessions'

/** Observed live: the account's credit balance, below the gateway root (not a graph route). */
export const BALANCE_PATH = '/billing/balance'
