# @shrubbery/chat-kernel — DEFER.md

The honest, **tested** ledger of every coupling the chat-kernel relocation
deliberately LEFT BEHIND. The kernel is the pure chat *render* surface (the chat
analog of `@shrubbery/editor-kernel`): a `ChatMessage[]` snapshot — or a raw
`ChatEvent[]` folded by the pure projector — in, render-intents out via PURE
`ChatKernelOptions` callbacks. Everything that touches a backend, a store,
transport, money, or identity is a **host seam**, not kernel code.

This file is not prose decoration: `src/__tests__/compose.test.ts` does a
`readFileSync` of THIS file and asserts every deferred-coupling name below is
present. If you remove a name here, that test goes red. If you sneak one of these
couplings back INTO `src/`, the purity tripwire grep (and the compose test's
src-import assertion) goes red. The two halves pin each other.

> **PURITY INVARIANT.** `packages/chat-kernel/src` imports ONLY `lit` + pure
> deps (`marked`, `dompurify`) + `@shrubbery/nucleus` types + the backend-free
> `@shrubbery/hoja` text-entry primitive. Hoja's transitive editor kernel owns a
> TipTap view, not a provider, store, graph client, transport, or persistence
> adapter. The tripwire:
>
> ```
> grep -rnE "^\s*import .*(yjs|y-websocket|EventSource|chat-store|document-store|session-store|filesystem-store|wire-store|api-cache|/stores/|cognito|auth-websocket|tauri|themeStore|ThemeController|billingStore|MODEL_PRICING)" \
>   packages/chat-kernel/src --include="*.ts" | grep -v __tests__
> ```
>
> MUST be empty. (The token *names* appear in `src/` only inside DOC COMMENTS —
> this ledger lives partly in the code — never as a live `import` or identifier.
> The compose test's src assertion therefore mirrors the import-grep, not a naive
> substring scan, which is the honest check.)

---

## Deferred couplings

### MODEL_PRICING + billing-seam
The original `mn-chat-panel` carried a `MODEL_PRICING` record plus
`getModelPricing` / `getModelPriceValue`, a **price column** in the model
selector, price badges, and `billingStore` credits banners + **send-gating**.
Pricing is a billing concern, not a render concern: **the kernel has no notion of
credits or $-cost**. All of it is STRIPPED.

- **Send-gating** is a HOST seam: the `sendDisabled` prop. The host decides (out
  of credits, read-only, transport down) and sets it; the kernel only respects
  it. The kernel never computes credit state nor parses error strings for
  "insufficient credits".
- **Per-message token annotation** is a HOST seam: the `formatModelAnnotation`
  callback. The kernel renders whatever string the host returns; it never
  computes cost.
- Billing/metering belongs to choreograph + the gateway, not the render kernel.

### chat-store mode fork (`mode: 'local' | 'hosted'`) = the C2 ChatService seam
The original drove everything through a `chatStore` whose `mode` switched between
a **local** path (loopback `gardend` `/mcp`, the `SandboxEvent` stream) and a
**hosted** path (gateway SSE). That fork — `mode`, the transport it selects,
session identity, the message log, the model continuity — is the **C2
`ChatService` seam**. The kernel does NOT pick a transport. It takes the
already-projected `messages: ChatMessage[]`, `streaming: boolean`, and the small
controlled continuity projection (`conversationState` / `sendState` /
`sendRecovery`) and renders them. The legacy `connectionState` face remains only
for low-cost compatibility; gen-2 hosts do not invent persistent offline or
reconnecting states. Folding a raw `ChatEvent[]` is done by the pure `sandbox-adapter`
(`projectEvents` / `finalize`) which itself imports no store. Session drawer ops
(switchSlot / switchSession / create / rename / delete / loadSessions /
exportSession), the active-slot 3-slot switcher, `sessionId`, and `sessionModels`
continuity all DEFER to this seam — surfaced as host callbacks, never stubbed.

### EventSource / SSE / reconnect / watchdog
The hosted path used a raw **EventSource** (`text/event-stream`), with
`manualReconnect`, an exponential-backoff **reconnect** loop, a streaming
**watchdog** timer (`lastSseEventAt` + `streamingTimerId` / `streamingRefreshId`),
`offline` / `reconnecting` / `connecting` / `reconnectAttempt` /
`maxReconnectAttempts` lifecycle flags, and `abort` / `refreshMessages`. ALL of
that is transport plumbing — STRIPPED. The continuity surfaces are render-only:
the host injects conversation hydration plus typed send recovery and optional
error copy, and the kernel emits `retry-load`, safe `retry-send`, or
`reconcile-turn` intents but never owns the socket, attempts, timers, or payload.
A hosted POST or stream that may already have committed is reconciled against
durable history, never blindly resubmitted.

### persistence
No durable storage of any kind: no localStorage session cache, no message
persistence, no draft restore-on-boot, no `wire-store` / `document-store` /
`session-store` / `filesystem-store` / `api-cache`. The panel and its Hoja child
hold only the currently projected in-flight composer value plus presentation
state such as `theme`; neither reads browser storage. Best-effort same-session
draft recovery belongs to `sh-chat-host`: a canonical string remains authority,
and a versioned rich JSON/reference sidecar is accepted only when that string
matches. Message/session durability remains a host/cell concern (EFS-backed
gardend cell durable plane), DEFERRED entirely.

### cognito / auth
No identity at all: no **cognito** pool, no `auth-websocket`, no session token,
no on-behalf-of header minting. The original carried these via `chatStore` +
`sessionStore`. Auth is the gateway's job (it terminates TLS, validates
Cognito / API-key / agent-token, checks the graph ACL) — never the render
kernel's. STRIPPED.

### themeStore / ThemeController (dark mode)
Dark mode is driven by the `theme` **@property** (`'light' | 'dark' | 'auto'`)
which writes `data-theme` on the host element; the adopted-stylesheet rules
(`sh-chat-panel[data-theme='dark'] …`) activate off that attribute. `'auto'`
resolves via `matchMedia('(prefers-color-scheme: dark)')` — a pure platform read,
NOT a store. The original `ThemeController(this)` instance + `themeStore`
subscription are DEFERRED to the host (it can set `theme` from whatever store it
likes); the kernel imports neither.

### tauri / desktop host
No `tauri` invoke / IPC, no desktop-only file or clipboard bridges. The kernel
runs in any DOM (desktop app, hosted SPA, Storybook, test). Desktop integration
is a host concern, DEFERRED.

### yjs / y-websocket (live CRDT transport)
No `yjs` / `y-websocket` / Hocuspocus room. Live collaborative chat transport (if
any) is the cell's job; the kernel sees only projected render data. DEFERRED.

### TTS read-state (host seam)
The original wired `ttsService.readChatMessage` / `isActiveForMessage` / `stop`.
The kernel has no notion of audio. Read/stop is surfaced via the
`onMessageAction(id, action)` seam (the host plays/stops); read-active state, if
shown, rides a host-supplied prop. DEFERRED as a HOST seam, never computed in the
kernel.

---

## Why `jsdom` is in the test tree

The package default test environment is **happy-dom** (`vitest.config.ts`) — it
matches runtime / nucleus / garden-frontend and is the right env for the panel's
Lit *functional* tests (light DOM, tool-call badges, composer→onSend, the
sanitize-seam-is-WIRED checks).

But **DOMPurify only sanitizes correctly on a spec-compliant DOM**. happy-dom 15
*degrades* DOMPurify (it can strip block wrappers and, worse, leak handlers),
which would turn an XSS payload assertion into a **false proof**. So the genuine
end-to-end "DOMPurify strips a real `<script>` / `<img onerror>` payload through
the panel's prose render" proof runs under **jsdom**, pinned per-file via a
`// @vitest-environment jsdom` pragma (same idiom as `sanitize.test.ts` and
`chat-panel-xss.test.ts`). No package-default change; jsdom is a **test-only
devDep** sitting OUTSIDE the `src/` purity closure. That is the documented
no-mock scoping call: pick the real environment that gives a real proof, per
file, rather than mocking the sanitizer.
