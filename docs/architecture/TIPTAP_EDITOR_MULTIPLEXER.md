# TipTap editor multiplexer

Status: operational architecture, phases 1-3 implemented; room-owned history ratified and proved

## Thesis

Shrubbery's document center is a small editor multiplexer. A browser or Tauri
window owns a session containing stable panes. Each pane can attach a TipTap
view to a live Garden document room, detach it, navigate to another room, and
become the active control target without changing the identity of the pane.

This is tmux-like in ownership and lifecycle, not an attempt to reproduce every
tmux feature. The useful correspondence is stable presentation slots attached
to longer-lived workloads. The present implementation has two fixed panes; it
does not yet have arbitrary split trees, named windows, cross-window clients,
or background-preserved EditorViews.

## Architectural vocabulary

| Shrubbery concept | tmux analogy | Precise meaning |
| --- | --- | --- |
| `EditorMuxSession` | server/session | Browser-tab-owned topology, focus, navigation, divider, and posture |
| client | tmux client | A browser or Tauri window displaying and controlling a session |
| pane | pane | A stable viewport address such as `center-primary`; never a document id |
| attachment | pane/process attachment | One lifetime in which a pane displays a document location |
| room | process/workload | A graph/document CRDT workload hosted by Gardend |
| provider handle | transport lease | The session's live Y.Doc, awareness, and socket for a room |
| TipTap `EditorView` | terminal view | A pane-local editing view over an attachment and provider |
| active integration | active control target | The one attachment receiving shell-global shortcuts, picker, comments, and wire-mode glue |

Gardend is the durable workload host, not the UI multiplexer. Today the browser
co-locates the multiplexer session and client. Persisting the session projection
and restoring it later can separate those roles without moving CRDT ownership
into the rendering library.

## Identity lattice

Identity must not collapse across layers:

```text
browser tab / mux session
  pane id
    attachment id (one pane-to-location lifetime)
      room key (kind + graph id + document id)
        provider handle (one live session transport per room)
          TipTap EditorView (one per visible pane)
```

Presence has a separate identity envelope:

```text
human + device + browser tab + room + connection epoch
```

A pane is not another human, device, or tab. Consequently, two panes displaying
the same document must share one local awareness identity and one transport,
while retaining two independent EditorViews.

## Ownership and lifetime

| Object | Owner | Created | Destroyed |
| --- | --- | --- | --- |
| pane topology/history/layout | `CenterPanesController` | mux-session boot | mux-session end |
| room pool | Organism shell | cell contract becomes active | contract replacement or shell end |
| attachment lease | Organism shell | pane resolves a document location | pane navigates, closes, or shell resets |
| provider/Y.Doc/awareness/socket | room pool | first attachment to a room | last attachment releases |
| recording undo authority | room-history registry | first EditorView attachment to a Y.Doc + field | last EditorView attachment releases |
| TipTap EditorView | `sh-editor-host` | a visible pane receives a ready provider | attachment replacement or pane removal |
| shell-global editor integration | Organism shell | attachment becomes active | focus changes or attachment ends |

The runtime owns view construction but never opens a room. The shell owns
transport and attachment lifetimes but never reaches inside TipTap's DOM.

## State machines

### Pane

`home -> attached(document A) -> attached(document B) -> home/closed`

Opening another document replaces the pane's current attachment and records its
location in back/forward history. Location history is not a claim that the old
EditorView remains alive.

### Room

`absent -> live(refCount=1) -> live(refCount=N) -> absent`

The first attachment opens the backend provider. Later attachments to the same
room reuse its exact `ProviderHandle`. Releasing the last attachment destroys
that provider exactly once.

### View

`unmounted -> mounting -> ready -> unmounted`

Layout-only rerenders preserve the host and view by object identity. Replacing
the provider is an explicit view teardown. Multiple views may share a provider;
selection and DOM are view-local, while document content is shared.

## Commands

The controlled center accepts these commands:

| Command | Address | Effect |
| --- | --- | --- |
| `open` | pane id + location | replace the addressed pane attachment |
| `open --split` | source pane + location | create/use the secondary pane and attach it |
| `focus` | pane id | move active shell integration without reconnecting rooms |
| `back` / `forward` | pane id | replace attachment from location history |
| `resize` | session | update divider only; preserve every attachment and view |
| `close` | secondary pane id | release its attachment and return control to primary |

Future command grammar may add `new-window`, `select-window`, recursive `split`,
`swap-pane`, `break-pane`, and named sessions. Those require a generalized tree
and suspended-view policy; they should not be simulated with document ids.

## Invariants

- **MUX-001** — A pane id is stable for its session lifetime and is never a document id.
- **MUX-002** — Room identity is independent of pane identity.
- **MUX-003** — At most one provider transport exists per mux session and room key.
- **MUX-004** — Multiple local TipTap views may share that provider.
- **MUX-005** — Only the active attachment owns shell-global picker, wire, comment, and shortcut integration.
- **MUX-006** — The last attachment lease destroys its provider exactly once.
- **MUX-007** — Layout and focus rerenders preserve pane host and provider identity.
- **MUX-008** — Replacing the last attachment tears down the room's undo authority unless a future retained-room policy explicitly preserves it.
- **MUX-009** — Restored layout state is graph-scoped, per-tab, and schema-versioned.
- **MUX-010** — Diagnostics expose pane -> attachment -> room -> provider/view state without credentials or document content.
- **MUX-011** — Presence identity is human/device/tab/room/epoch; a pane never fabricates another presence session.
- **MUX-012** — Without a retained background host, Shrubbery does not claim tmux-style process/view persistence after navigation.
- **MUX-013** — Exactly one recording `UndoManager` exists per attached Y.Doc + field; TipTap's required per-view undo plugins are non-recording lifecycle adapters.
- **MUX-014** — Undo/redo invoked from any view addresses the room stack; closing one view preserves it, and the last view release destroys it.

## Diagnostics contract

The room pool exposes content-free snapshots suitable for tests and future
observability:

```json
{
  "roomCount": 1,
  "attachmentCount": 2,
  "rooms": [
    {
      "roomKey": "[\"doc\",\"my-graph\",\"my-document\"]",
      "kind": "doc",
      "graphId": "my-graph",
      "documentId": "my-document",
      "refCount": 2,
      "attachmentIds": [
        "center-primary::my-graph::my-document",
        "center-secondary::my-graph::my-document"
      ]
    }
  ]
}
```

Provider objects, auth tokens, document content, and awareness payloads are not
part of this projection.

## Ratified semantic decision: room-owned undo authority

The room/provider pool revealed a second ownership problem. Stock TipTap Collaboration
installs a separate Yjs `UndoManager` in every EditorView. Each manager
tracks all local transactions on the shared Y.Doc, but their undo/redo stacks are
independent. This is not coherent pane-local history.

A real two-view probe produced this sequence:

```text
document: "alpha beta"
undo in pane A -> "alpha"
undo in pane B -> ""
redo in pane A -> ""       (no restoration)
redo in pane B -> "alpha"  (" beta" is now absent from redo)
```

Two policies were evaluated:

1. **Room-owned history (ratified).** One UndoManager belongs to the live room;
   undo/redo from either view addresses that manager. Selections and focus remain
   view-local. Closing one view preserves history while another attachment lives;
   the last release destroys it.
2. **Strict view-owned history.** Each view tracks only transactions originating
   from that view. This requires distinct transaction origins and deliberately
   makes undo depend on which pane is focused.

Room-owned history matches split editors in mainstream code/document tools and
the tmux idea that multiple views control one workload. The implementation has
three pieces:

1. `room-history.ts` leases one recording manager per Y.Doc + fragment field and
   matches y-tiptap's transaction/delete policy.
2. Each stock TipTap yUndo plugin receives its own inert manager. This preserves
   Collaboration's sync/mapping lifecycle without giving the view another stack.
3. A lower-priority TipTap extension replaces the stock commands with room-level
   commands. Collaboration's own keyboard map calls those replaced commands, so
   keyboard and toolbar paths share the same authority.

The final lease destroys the recording manager and explicitly removes the Y.Doc
destroy listener that Yjs otherwise retains. Handing one recording manager to
two stock plugins was deliberately rejected: either view's plugin teardown can
destroy that shared object, and its selection listeners are not ref-counted.

The original failing sequence is now an executable regression test. Happy DOM
proves alternating commands, survivor lifecycle, final-release reset, and room
independence. Chromium against a fresh real Gardend repeats the alternating
keyboard sequence through the production Organism entry with no page, console,
or request errors.

## Proof obligations

The multiplexer line is complete only when automated tests demonstrate:

1. Two attachments to one room cause one backend `open` and receive the same provider.
2. Distinct rooms receive distinct providers.
3. Releasing one of two attachments keeps the provider live; releasing the last destroys it once.
4. A real Gardend and Chromium can display two TipTap views of one document, synchronize edits, and close either view without disconnecting the survivor.
5. Focus and divider changes preserve pane host and provider identity.
6. Back/forward behavior is described honestly: document content survives through CRDT durability, while undo is not promised after the room's last attachment releases.
7. A production-entry reload restores graph-scoped pane addresses, independent history, active pane, divider, and posture without claiming EditorView identity survived.
8. Alternating undo/redo between two views of one room follows the chosen single policy without divergent stacks or lost redo. **Proved in Happy DOM and real Gardend Chromium.**

## Roadmap

1. **Shared rooms — implemented.** Reference-counted room pool, content-free diagnostics, and real-browser proof.
2. **Session restore — implemented.** Versioned, graph-scoped `sessionStorage` codec for topology, location history, active pane, divider, and posture, with per-tab isolation.
3. **Shared history — implemented.** Room-owned recording manager, inert per-view adapters, final-lease cleanup, and two-layer regression proof.
4. **Windows and suspended views.** Decide an explicit memory budget/LRU policy if navigation should retain EditorViews and undo histories.
5. **Generalized layout.** Recursive split tree, pane movement, and keyboard command surface.
6. **Multiple clients.** Only if useful, move mux-session state behind a local Tauri/Gardend boundary so another window can attach to it.

The phase order matters: shared room ownership and honest lifetimes make later
layout features tractable. A recursive UI tree without these primitives would
multiply sockets, presence collisions, and teardown ambiguity.
