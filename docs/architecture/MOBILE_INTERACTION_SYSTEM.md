# Garden adaptive interaction system

Status: implementation contract, July 2026.

This document defines Garden's compact and medium interaction postures in the
Shrubbery implementation. It is not a second mobile application. The same
`(Resource, Face)` leaves, keyed editor and chat hosts, injected contract, and
typed intents are projected through different delivery-form chrome.

## North-star invariants

1. **Resource identity survives posture changes.** Responsive changes may move,
   reveal, or conceal a keyed face; they must not create another editor, chat
   provider, store, subscription, or document authority.
2. **The shell owns navigation and effects.** Components are controlled faces.
   They receive data and emit intents; they do not import Tauri, call a store,
   or invent a second router.
3. **Chrome follows the delivery form.** Safe areas, system Back, bottom
   navigation, sheets, and keyboard avoidance belong to the shell. Documents,
   Browse, Home, and Sophia remain reusable faces.
4. **Layout is a projection, not a fork.** Compact and medium modes are posture
   interpretations of the same layout/resource plan. Expanded mode remains the
   established desktop projection.
5. **Progressive disclosure preserves capability.** A phone may show fewer
   commands at once, but every supported command remains reachable through a
   labelled disclosure surface and emits the same intent as desktop.
6. **Elaboration is fractal, not parallel.** Begin with the durable resource and
   its primary act, then reveal one task-local layer at a time. Sibling layers
   such as formatting and reference lookup do not remain open and compete for
   the same compact attention or geometry.

## Baseline audit and correction

| Baseline failure | Interaction consequence | Contract now |
| --- | --- | --- |
| Document header, desktop command strip, and bottom tabs compete vertically | Weak hierarchy and little room for the document | One root navigation layer, one contextual top bar, and a five-action compact editor toolbar |
| `Files / Home-Editor / Sophia` mixes destinations with a detail state | Retapping the middle item becomes a hidden Back/Home gesture | Stable `Home / Browse / Sophia` roots; a document is a pushed detail with an explicit Back control |
| Custom edge swipes change roots | Conflicts with iOS edge Back and Android predictive Back | Garden owns no system-edge gesture; visible navigation and native Back drive routes |
| File rows are clickable containers and actions depend on long press | Poor keyboard semantics and undiscoverable destructive actions | Native 56px row buttons plus a persistent labelled 48px overflow button; long press is only an accelerator |
| Rename/Delete and workspace choice use inconsistent popovers | Viewport clipping and incomplete keyboard/focus behavior | Labelled modal bottom sheets with initial focus, trapped Tab order, Escape/backdrop dismissal, and trigger focus return |
| Roughly thirty editor commands remain in a horizontal desktop strip | High recognition and targeting cost | Undo, Redo, Bold, Italic, and More stay primary; the complete existing toolbar becomes a grouped sheet |
| Chat stacks two internal headers and uses a fixed 360px model picker | Dense chrome and narrow-screen overflow | One adaptive chat chrome surface; model selection becomes a viewport-safe sheet on compact widths |
| Chat entry is a textarea while document references live in a separate full editor | Conversation cannot carry the graph's native vocabulary or structured intent | One controlled `<hoja-editor>` composer over a safe editor-kernel profile, with progressive formatting and graph-scoped `[[wikilink]]` lookup |
| “Pop out” creates another window and another chat lifecycle | Draft, focus, stream, and transcript identity can diverge | The exact keyed `sh-chat-host` projects between rail and full-screen top-layer postures and returns intact |
| Controls fall to 24–36px and fixed bars ignore device insets/IME | Mistaps, obscured content, and mobile browser zoom | Shared 48px interaction target, 56px list row, `viewport-fit=cover`, safe-area tokens, 16px composer input, and visual-viewport height |

WCAG 2.2's Level AA target minimum is 24 CSS pixels. Garden deliberately uses
the stronger cross-platform touch posture: Apple recommends at least 44 points
and Android recommends 48dp. In Shrubbery, `--mn-touch-target-size: 48px` is the
shared compact interaction role and `--mn-mobile-list-row-height: 56px` gives
rows additional separation.

## Living Codex direction, current authority

The older `mnemosyne-platform/frontend` is a design archive, not an application
or backend dependency. Its strongest direction described a “Living Codex”:
parchment atmosphere, typography as the primary interface ink, quiet rules and
whitespace instead of dashboard boxes, and direct manipulation close to the
thing being changed. This pass deliberately translates those qualities onto the
Shrubbery/gardend architecture.

| Archive cue | Shrubbery translation | Boundary retained |
| --- | --- | --- |
| Literary, serif-first hierarchy | Editorial Home bookplate, manuscript sections, document shelves, and calmer Sophia reading rhythm | Semantic tokens and controlled faces; no old global font/palette or Material dependency |
| Paper, grain, botanical ink, and quiet rules | Existing Garden skin atmosphere plus warm surfaces, fern accents, and structural rules | Light/dark remain first-class token projections, not hard-coded screenshots |
| Rename beside the file name | Explicit inline edit with select-all, Save/Cancel, Enter/Escape, validation, and focus return | Emits `proposedLabel`; the shell commits through gardend and waits for the refreshed authoritative projection |
| A visible Move action | Named “Move to folder…” action and a safe-area-aware destination sheet | Existing folder commands and controlled picker; no component store access |
| Consequences close to actions | Action-sheet copy names irreversible document removal and Garden's refusal to delete non-empty folders | Existing host confirmation and gardend validation remain authoritative |
| Full-bleed reading and conversation | Unboxed assistant responses, bylines, a botanical rule, and a named composer | No cloud-1 SSE/store/reconnect/watchdog behavior is imported |
| A separate-window conversation workspace | Reversible full-screen projection of the same live host, transcript, stream, and composer | No cloned store, duplicated EditorView, URL mode, or `window.open` lifecycle |

The archive's combined `Home/Editor` destination, overloaded document toolbar,
custom edge gestures, direct API/store mutations, blur-autosave rename, and
transport-derived “saved” claims remain rejected. Design lineage is recovered;
obsolete ownership is not.

## Navigation model

The compact navigation graph has three stable roots:

```text
Home ────────> Document detail ──Back──> Home
Browse ──────> Document detail ──Back──> Browse
Sophia
```

- Root navigation is a semantic `nav` landmark with `aria-current`, not an ARIA
  `tablist`. These destinations each retain their own nested route state; they
  are not three interchangeable tab panels.
- Activating the current root is inert. It never doubles as Back, scroll-to-top,
  or state reset.
- Home and Browse retain independent document-detail routes. Switching roots
  does not destroy the loaded editor or conversation.
- Opening a Home document records a Home detail route. Opening a file records a
  Browse detail route. Back clears only that route projection; it does not
  destroy or unload the underlying resource.
- The bottom navigation remains stable while traversing root/detail content and
  hides only while the software keyboard requires the vertical space or while a
  modal surface covers it.

## Responsive postures

| Posture | Width contract | Projection |
| --- | --- | --- |
| Compact | up to 600 CSS px | Single active root/detail, bottom primary navigation, compact controls and sheets |
| Medium | 601–1024 CSS px | Same navigation contract, centered root content with more reading width; no new resource instances |
| Expanded | above 1024 CSS px | Existing multi-pane desktop layout and complete desktop toolbars |

The thresholds select usable space, not a device name or user agent. Posture
changes are reversible and preserve exact editor/chat DOM identity.

## Continuity and recovery grammar

Responsive structure is only the first layer. Every surface that crosses a
storage, projection, or transport boundary uses the same controlled continuity
states while keeping the last useful face mounted whenever it is safe to do so.

| State | Meaning | Presentation and behavior |
| --- | --- | --- |
| `ready` | The host has no continuity concern to report | Quiet by default; never reinterpret a connected transport as a durable-write acknowledgement |
| `loading` | No useful projection is available yet | Labelled progress in the content region; never a blank face or an invented timeout |
| `saving` | A scoped operation is in flight and its outcome is not known yet | Keep the affected projection stable and gate only conflicting actions; do not claim server acceptance early |
| `offline` | The host knows the transport is unavailable | Preserve available local content and state exactly what remains possible; never promise queuing or sync unless the host guarantees it |
| `reconnecting` | Recovery is in progress | Preserve useful content, announce progress politely, and avoid repeated alert interruptions |
| `error` | The current operation or projection failed | Plain-language alert with a visible recovery action when the host can honestly provide one |

`mn-continuity-status` is the shared presentation face for this grammar. It
receives state, copy, and an optional action label, then emits only a
`continuity-action` intent. It never probes connectivity, retries a request,
owns a timer, or decides whether work is durable.

Continuity feedback is layered rather than replacing content indiscriminately:

1. **Keep the last useful projection.** Offline/reconnecting/saving feedback is
   adjacent to existing content, not a destructive full-screen replacement.
2. **Block only what is actually blocked.** Browse refresh may fail while an
   already-open document remains readable; Sophia may hydrate a conversation
   while its retained transcript remains available.
3. **Separate empty from failed.** “No documents” is data; “Could not load
   documents” is an operation failure and must offer recovery when possible.
4. **Name the affected scope.** Copy says “Could not refresh Browse” or “Message
   not sent,” rather than treating every problem as an application-wide outage.
5. **Return control to the owner.** Retry, reconnect, reload, and discard remain
   typed shell/service intents. Presentation components do not perform effects.

### Garden authority boundaries

The continuity vocabulary is shared; the evidence behind it is deliberately
surface-specific. A label is permitted only when the owning authority can prove
the corresponding fact.

| Surface | Authoritative lifecycle | Honest UI claim | Claim that is not available |
| --- | --- | --- | --- |
| Document | Live `y-websocket` status and room-sync events | Connecting, Connected, Reconnecting, intentionally Disconnected | “Saved” or “Up to date”; the browser receives no causal durability acknowledgement for the latest edit |
| Browse mutation | gardend MCP request plus the refreshed authoritative file projection | Pending, reflected success, rejected, or indeterminate | Automatic success from an optimistic row change; safe replay after a lost response |
| Sophia | Conversation hydration plus one accepted local/hosted turn stream | Loading conversation, sending, safely resubmittable pre-accept failure, or ambiguous accepted turn | A persistent offline/reconnecting chat transport; gen-2 has none |

`ProviderHandle.whenSynced` is only the initial editor-mount gate. Every network
provider also exposes a live `lifecycle` source with current connection,
synchronization, and connection-intent facts. The chrome controller derives
initial connecting versus later reconnecting from that source. “Connected”
means the Yjs room handshake is current; it says nothing about the durable
flush boundary in gardend.

File operations use four explicit states: `pending`, `success`,
`terminal-error`, and `indeterminate`. Success is projected only after the MCP
operation resolves and the refreshed sidebar reflects the requested result. A
known validation/conflict rejection may offer retry only when the host marks it
safe. Timeout or response loss can leave an operation durably queued in Garden,
so the recovery action is **Check files**: refresh and reconcile without
repeating the mutation.

Sophia separates conversation hydration from submission delivery. A local
driver construction failure can be proven pre-accept and may offer **Retry
send**. A hosted POST or stream can fail after Choreograph persisted the user
message, so it offers **Check status** and rehydrates durable history. It never
blindly posts the message again.

## Surface hierarchy

### Home

Home is a root face: orientation, daily note, resume, pinned/recent work, and
creation. Its top bar names the graph. Opening content pushes a document detail
inside Home.

### Browse

Browse is a root face for workspace and document navigation.

- Workspace, Folders/Recents, and search are visible and labelled.
- Folder buttons expose `aria-expanded` and stable `aria-controls`.
- The active document exposes `aria-current="page"`.
- Row activation and row actions are separate targets. Rename, Move, and Delete
  never depend on precision placement or a hidden gesture.
- Rename is an explicit inline transaction: empty labels are refused locally,
  but the row is never mutated optimistically. The validated proposal crosses
  the controlled action boundary and gardend owns its outcome.
- Move opens the shared destination picker. Current and unavailable targets are
  named, selection and confirmation are separate actions, and descendant
  folders remain unavailable when moving a folder.

### Document editor

The existing controlled toolbar remains the only editor command surface.

- Compact primary actions: Undo, Redo, Bold, Italic, More.
- More opens the complete grouped toolbar; desktop renders that same toolbar
  inline.
- The disclosure announces its expanded state and controlled region, closes by
  Done, backdrop, or Escape, and restores focus to More.
- Editor selection is preserved because toolbar actions keep focus and emit the
  established `mn-editor-*` intents.
- Find/replace reflows within the viewport and all compact controls use the
  shared touch-target role.

### Sophia

`sh-chat-panel` remains one controlled chat face.

- The superbar and header become one adaptive compact chrome surface.
- Secondary header actions move to a labelled overflow menu while desktop
  actions remain inline.
- Model choice is a grouped desktop popover and a modal compact sheet using the
  same model data and change intent.
- Transcript spacing favors reading; assistant content may use the full width
  while user messages remain visually distinct.
- The composer is one light-DOM `<hoja-editor posture="composer">` backed by the
  existing editor kernel's deliberately small `composer` profile. It excludes
  document collaboration, slash commands, citations, global picker events, and
  every backend concern.
- Hoja's lossless composer dialect is paragraphs/hard breaks, bold, italic,
  inline code, ordinary links, and `[[label]]` references. Canonical Markdown is
  the transport and compatibility value; TipTap JSON and resolved reference ids
  are additive metadata, never a replacement wire format.
- Formatting and document-reference lookup are sibling elaborations. Opening
  either closes the other; the draft and selection survive. Every compact action
  uses the same 48px role.
- Plain Enter accepts the active reference result while the combobox is open and
  submits only after it closes. Arrow keys move the active descendant, Escape
  closes only the local tray, Shift+Enter inserts a line, and composition Enter
  never submits.
- Reference lookup is injected by the shell and scoped to the current gardend
  graph projection. One full document list is fetched per graph and filtered
  locally across successive keystrokes. Accepting a result records stable graph
  and document ids in the draft sidecar; it does not create a persistent wire.
- The canonical draft string remains readable by old hosts. `sh-chat-host` may
  persist a versioned rich sidecar beside it for same-session recovery, but only
  when its canonical value matches; malformed, stale, or unavailable sidecars
  are ignored. `ChatService.startTurn(sessionId, text)` remains unchanged.
- The composer is sticky and IME-aware, uses 16px text to avoid focus zoom, grows
  only to `min(32dvh, 11.25rem)`, then scrolls internally. The presentation owner
  applies safe-area padding once; Hoja does not guess its embedding shell.

Full-screen conversation is another posture of the same resource, not another
chat. The shell changes `presentation: rail | fullscreen`; `sh-chat-host` enters
the browser top layer when available and uses a fixed viewport fallback in older
WebViews. The same host, store, `sh-chat-panel`, `<hoja-editor>`, ProseMirror
EditorView, transcript, draft, stream, and focus chain remain connected. Escape
closes an inner reference/model/history disclosure first, then returns the chat
to its rail. Full-screen transcript and composer share a readable 54rem measure.

| Layer | Owns | Must not own |
| --- | --- | --- |
| `hoja-editor` | TipTap view, compact formatting, reference request UI, canonical/rich change and submit intents | Garden REST, graph choice, wires, chat send, draft persistence, safe areas |
| `sh-chat-panel` | Conversation composition, send/clear controls, transcript and controlled presentation props | Chat transport, session durability, reference search implementation |
| `sh-chat-host` | One live panel/store, session-scoped canonical draft plus optional rich sidecar, rail/full-screen projection | Graph data access, reference ranking, cloned windows |
| Organism shell | Current graph, injected gardend lookup, navigation, theme, safe areas, full-screen policy | TipTap document state, chat message lifecycle |

## Overlay and disclosure contract

A modal bottom sheet is a dialog, not a restyled context menu.

1. The trigger declares that it opens a dialog and exposes expanded state when
   applicable.
2. The dialog has a visible title (or an explicit accessible label),
   `role="dialog"`, and `aria-modal="true"`.
3. Opening places focus inside. Tab and Shift+Tab remain inside until closure.
4. Escape, an explicit close/cancel control, and a backdrop all close it.
5. Focus returns to the exact live trigger when it still exists.
6. Destructive actions are visibly labelled; color is not their only signal.
7. Compact sheets respect left, right, and bottom safe-area insets and cap their
   height against the dynamic viewport.

Modal owners announce `mn-overlay-state-change` with a stable overlay identity.
The shell aggregates those controlled intents and suppresses its bottom
navigation until every modal closes. Components remain independent of the
shell/Tauri, while delivery-form chrome can never sit above their backdrop.
The full-viewport adaptive shell occupies `--mn-z-delivery-shell`; modal,
popover, and toast layers remain above it in the shared z-layer contract. A
responsive delivery form is never promoted into a fake modal plane.

Only true transient tasks use this contract. The editor's formatting disclosure
stays attached to the editor command context; it does not create another editor
face or state owner.

### Host-owned transactions

Create, move, and destructive confirmation are one modal family even though
their data contracts differ:

- `mn-input-dialog` collects a proposed label; the host validates and performs
  creation. Enter submits only from the text field, never from a global document
  listener.
- `mn-folder-picker-dialog` separates choosing a destination from committing it.
  Enter on a folder therefore cannot confirm a stale selection.
- `mn-confirmation-dialog` starts focus on the non-destructive action and never
  treats an unrelated global Enter as consent.

Each member emits a balanced, stable `mn-overlay-state-change` lifecycle and
uses the same compact bottom-sheet geometry, dynamic viewport cap, safe-area
padding, 48px controls, focus containment, Escape/cancel path, and trigger focus
return. Because host dialogs open above components with their own shadow roots,
the invoker is the deepest active element, not merely
`document.activeElement`. Browse restores its overflow trigger before emitting a
Move/Delete intent so the global dialog can return to the exact live control.

## Insets, keyboard, and system gestures

- The document declares `viewport-fit=cover` and
  `interactive-widget=resizes-content`.
- Shell geometry uses `env(safe-area-inset-*)`; no component guesses a notch or
  home-indicator size.
- `visualViewport.height` supplies `--organism-vvh` while the IME is open. The
  compact root navigation hides during that interval and the active content uses
  the recovered space.
- Scrollable regions contain overscroll where appropriate, but Garden does not
  suppress the operating system's Back/predictive-Back edge.
- A future Tauri mobile bridge maps native Back to the shell's explicit detail
  route first, then to the platform default. It must not synthesize touch swipes.

## Native delivery boundary

The interaction work is immediately valid in the hosted/mobile browser and the
existing Tauri desktop WebView because it is delivery-form chrome around the
same Shrubbery resources.

Garden's current Tauri product is a native **desktop** application. Treating its
Rust engine as an iOS/Android product requires a separate runtime-port gate; it
is not enabled merely by running `tauri ios init` or `tauri android init`.

Before shipping a mobile native runtime:

1. split desktop window/title-bar setup and commands from mobile setup;
2. introduce an explicit mobile runtime feature instead of routing mobile
   targets through the current `desktop`/Wry feature;
3. prove every Rust dependency for the Android/iOS target triples, especially
   embedded semantic-model and parser/runtime dependencies;
4. define foreground/background and suspension behavior for the loopback cell,
   CRDT drains, scheduler, and local API;
5. replace desktop child-process/Python service resources with mobile-capable
   hosted services or honest unavailable capability states;
6. replace localhost OAuth callbacks and profile-JSON secrets with app/deep
   links and Keychain/Keystore-backed capability adapters;
7. add Kotlin/Swift plugins only for true device capabilities (Back, share/open,
   lifecycle, secure key storage), keeping them behind the shell capability
   contract;
8. add device/simulator, signing, privacy, and store-delivery lanes after the
   unsigned compile/runtime lane is green.

The Garden packaging pipeline must materialize the exact immutable Shrubbery
revision declared by `shrubbery-ui.lock.json`, build it, and retain its provenance
in the bundle. Workflow files must not duplicate a second revision.

Garden's internal desktop workflows require a repository-scoped
`SHRUBBERY_READ_TOKEN` with read access to materialize this pinned revision;
they fail explicitly when it is absent. The credential authorizes checkout,
while the lock remains the only revision authority.

## Acceptance matrix

Every compact release must prove:

- 320, 390, 600, 768, 1024, and expanded widths;
- portrait/landscape and compact/medium/expanded transitions;
- safe-area top/bottom/left/right and open/closed software keyboard;
- keyboard-only root navigation, rows, toolbar, menus, and sheets;
- screen-reader names, current/expanded state, dialog titles, and focus return;
- reduced motion, 200% text zoom/reflow, light/dark and supported skins;
- Home/Browse detail-route preservation and inert active-root retap;
- exact editor/chat node identity across every route and posture transition;
- no custom system-edge gesture capture;
- offline/reconnecting data remains usable and status remains honest;
- loading, empty, offline, reconnecting, and error remain distinguishable by
  copy, semantics, and recovery behavior;
- room connection is never labelled as a saved or durable document state;
- an indeterminate gardend mutation reconciles current files without replay;
- inline rename sends one trimmed proposal to the host and never opens a second
  prompt or changes authoritative row data itself;
- folder destination selection cannot commit from stale Enter handling, and its
  modal remains above the adaptive delivery shell;
- create/move/delete dialogs each emit one balanced modal lifecycle, contain
  focus, and return to their exact shadow-root invoker;
- global Enter never creates, moves, or deletes without the focused control's
  own activation semantics;
- an ambiguous hosted Sophia turn checks durable history without reposting;
- compact Sophia mounts exactly one Hoja/ProseMirror composer and no textarea;
- Hoja formatting and reference lookup are mutually exclusive elaborations with
  48px targets, an accessible listbox/active descendant, and no clipped controls;
- successive `[[query` keystrokes issue one graph-projection read, never leak a
  document from another graph, and accepting a result creates no Garden wire;
- reference Enter does not send, composition Enter does not send, Shift+Enter
  adds a line, and the first later plain Enter crosses the existing string-only
  ChatService seam exactly once;
- canonical and rich draft recovery agree on the same value; a successful send
  or explicit clear removes both, while root/posture changes preserve them;
- a long composer draft clamps and scrolls without hiding transcript or primary
  navigation;
- rail → full-screen → rail preserves exact host, panel, Hoja, and ProseMirror
  node identity and keeps transcript/composer within the 54rem reading measure;
- a failed refresh never destroys a previously useful projection;
- the pinned Shrubbery revision is the revision recorded in the built Garden
  frontend.

## External pattern references

- [Apple HIG: Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- [Apple HIG: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Apple UI design tips: 44pt hit targets](https://developer.apple.com/design/tips/)
- [Android accessibility: 48dp touch targets](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)
- [WCAG 2.2: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [WAI-ARIA APG: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Tauri v2: Mobile prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri v2: Mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)
