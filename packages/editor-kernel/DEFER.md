# DEFER.md — `@shrubbery/editor-kernel` v1 exclusions

This file is the honest, complete ledger of every Garden TipTap extension that
the v1 kernel **does not** include, and **why**. The kernel's purity invariant
(enforced by the anchored lockfile tripwire) is that the dependency closure is
`@tiptap/*` + `prosemirror-*` ONLY — no `yjs`/`y-*`/collab, no stores, no
fetchers, no UI pickers, no `katex`/`lit`/`mermaid`. Anything whose port would
drag one of those in is deferred and labeled here.

## Provenance honesty (read this first)

The v1 roster is a **curated minimal-clean cut**. It is **NOT** a copy of
garden's `tiptap-export-extensions.ts` `EXPORT_EXTENSIONS` barrel.

- The barrel is a **render-only subset** (per its own header): it is the array
  fed to `generateHTML(json, EXPORT_EXTENSIONS)` for serialization. By design it
  **OMITS** `Placeholder`, `Search`, and `WikiLinkSuggestion` ("UI-only"), and it
  **INCLUDES** `Footnote`, `InlineMath`, and `BlockMath` (their `renderHTML`
  affects serialized output).
- The kernel **includes** `Search`, `Placeholder`, `Footnote`, and `Math` (they
  are live-editing affordances / document structure, and stay pure `@tiptap/*` +
  `prosemirror-*`). `Math` is included via the **pure-renderer seam** — schema,
  commands, input rule, and edit-on-click NodeView ship in the kernel; KaTeX
  rendering is host-supplied through `KernelOptions.renderMath` (default
  renderer paints raw LaTeX text).

So the barrel and the kernel roster **differ in both directions**. The barrel is
useful only as a **purity signal** — it is hand-maintained to contain no
backend-coupled file, which corroborates which ports are clean — it is **NOT** a
membership signal for the kernel. v1 membership was decided file-by-file against
the purity invariant, not by mirroring any existing array.

## INCLUDED in v1 (for contrast)

base layer (`base.ts`): `StarterKit` (codeBlock/bulletList/orderedList/listItem
disabled; heading levels 1-3; link `openOnClick:false`; `undoRedo` re-enabled) +
`CopyableCodeBlock` (TipTap `codeBlock` schema/commands + pure NodeView; Mermaid
severed to `KernelOptions.mermaid`) + `TextAlign` + `TextStyle` + `FontFamily` +
`FontSize` + `Highlight` + `Table`/`TableRow`/`TableHeader`/`TableCell` +
`Placeholder`.

customs (ported from Garden's `frontend/src/lib/tiptap-*.ts`, severing only the
named couplings): `CommentMark`, `ListItem`, `Outliner`, `BlockSelection`,
`BlockDnd`, `OutlinerZoom`, `Search`, `Footnote`, `ImageBlock`,
`CalendarEvent`, `InlineMath` + `BlockMath` (KaTeX coupling severed to
`KernelOptions.renderMath`), `MarginGloss`, `WikiLink` (node + pure autocomplete event source),
`SourceMetadata`, `TagAutocomplete` (pure event source only),
`TagChip` (plain pure atom, Lit node-view severed),
`TagRecognition` (daily-note side effects severed to `KernelOptions.onScheduledTag`),
`BlockTags`, `QueryBlock` (durable schema + command + host-owned renderer/execution
seam), `SlashCommand` (pure trigger/catalogue; runtime owns its picker), and
`BlockId` (its `featureFlags` coupling severed to the
`KernelOptions.enabledNodeTypes` seam).

---

## DEFERRED — every excluded extension + reason

| Extension | Garden source file | Coupling / reason deferred |
|-----------|--------------------|----------------------------|
| **Collaboration** | (`@tiptap/extension-collaboration`, configured in `document-editor.ts`) | **CRDT.** Binds a `Y.Doc`; pulls `yjs` + `y-prosemirror`. The whole point of the kernel is to be collab-free; would breach the lockfile tripwire directly. |
| **CollaborationCursor** | (`@tiptap/extension-collaboration-cursor`) | **CRDT.** Renders remote awareness cursors over a `Y.Doc` provider; same `yjs`/`y-*` closure as Collaboration. |
| **WikiLinkSuggestion** | `tiptap-wikilink-suggestion.ts` | **Garden monolith excluded from the pure kernel.** Garden's extension combines `[[` trigger detection, document lookup, popup rendering, and command execution. Shrubbery ports this as a split seam instead: `WikiLinkAutocomplete` dispatches pure `open-wikilink-picker` / `close-wikilink-picker` events with the typed trigger range, and runtime owns GRAPH-scoped lookup, wire creation, dropdown UI, and range replacement. |
| **TagSuggestion** | `tiptap-tag-suggestion.ts` | **Garden monolith excluded from the pure kernel.** Garden's extension combines trigger detection, tag index lookup, popup rendering, and scheduled-tag side effects. Shrubbery ports this as a split seam instead: `TagAutocomplete` dispatches pure `open-tag-picker` / `close-tag-picker` events, `tag-suggestions.ts` carries the backend-free vocabulary/filter/heading-safe gate, and runtime owns GRAPH-scoped lookup plus dropdown commit (Enter/click chip, Tab literal text). Garden's daily-note materializer remains a host/backend concern, not kernel code. |

---

## Garden source present but intentionally not registered

- **Indent** (`tiptap-indent.ts`) is not a live Garden extension. The file still
  exists, but `document-editor.ts` neither imports nor registers it. Garden's
  active `Outliner` extension is the sole owner of `increaseIndent`,
  `decreaseIndent`, Tab, and Shift-Tab. It covers the complete flat-tree model
  (paragraph, heading, list item, blockquote, and table; child cascading;
  multi-selection; levels 0–6) and yields inside code blocks/tables. Shrubbery
  ports that active implementation and deliberately does not register the dead
  duplicate. `indent-parity.test.ts` locks the live keyboard behavior and the
  single-owner invariant.

---

## Severed couplings in INCLUDED extensions (for the record)

- **BlockId** — garden's `import { featureFlags } from '../config/feature-flags.js'`
  was severed. `featureFlags.queryBlocksEnabled` only toggled whether the string
  `'queryBlock'` appeared in the `data-block-id` target list; that ternary is now
  `KernelOptions.enabledNodeTypes` (default `[]`). `featureFlags.ts` is itself
  import-free, so this sever is hygiene + host-opt-in, not a safety leak.
- **WikiLink** — the node stays pure. `Mod-Shift-k` dispatches
  `document.dispatchEvent(CustomEvent('open-wikilink-picker'))`; click/delete are
  surfaced via `KernelOptions.onWikiLinkClick` / `onWikiLinkDelete` callbacks the
  host wires — never a backend import.
- **MarginGloss** — garden imported `WireSummary` from `stores/wire-store` and
  dispatched a global `document-open` event from decoration DOM. The kernel
  version keeps the pure decoration/plugin behavior but defines its own structural
  `MarginGlossWireSummary` type and surfaces gloss target clicks through
  `KernelOptions.onMarginGlossOpen`. Runtime feeds it from the host-owned
  `WireBundle`; the kernel never imports stores or fetchers.
- **CalendarEvent** — garden imports the Lit
  `<mn-calendar-event-specimen>` component and mounts it as a rich editable
  NodeView. The kernel version keeps the block atom, attrs, parse/render, and
  `insertCalendarEvent` command, but severs the specimen NodeView. Rich calendar
  editing is a future host/component concern, not kernel code.
- **TagChip** — garden's atom renders a Lit `<mn-tag-chip-specimen>` node view and
  dispatches browser navigation events directly. The kernel version is a plain
  inline atom rendered as `<span data-tag-chip>`; click navigation is surfaced via
  `KernelOptions.onTagClick`.
- **TagRecognition** — garden imports `filesystemStore` and
  `daily-note-atom-materializer`. The kernel version keeps the pure input-rule
  parser and chip/attribute mutation, but scheduled-tag side effects are surfaced
  via `KernelOptions.onScheduledTag` and the date default is injectable via
  `KernelOptions.getToday`.
- **InlineMath / BlockMath** — garden's `tiptap-math.ts` imports `katex`
  directly to render LaTeX in a NodeView. The kernel version keeps the schema,
  the `insertInlineMath` / `insertBlockMath` commands, the `$$…$$` inline input
  rule, the click-to-edit NodeView (input bar, Enter/Escape handling), and a
  stable `data-math-inline` / `data-math-block` HTML round-trip — but rendering
  goes through an optional `KernelOptions.renderMath(target, request)`
  callback. The default renderer paints the raw LaTeX text into the rendered
  span; hosts that want KaTeX call into katex inside their `renderMath`. Async
  renderer rejections set `data-math-error` on the node so styling can degrade
  cleanly.
- **QueryBlock** — the durable atom, full Garden attribute grammar, HTML
  round-trip, `insertQueryBlock`, and fallback face live in the pure kernel.
  `KernelOptions.renderQueryBlock` and `getGraphId` move graph execution and the
  interactive result face into runtime. Runtime executes only read-only
  ASK/SELECT/CONSTRUCT/DESCRIBE through `RestClient`, normalizes both W3C and
  cell-serialized terms, and renders table/stat/triples/bar/network/JSON views.
- **CopyableCodeBlock** — Garden's NodeView imported `mermaid` and its theme
  store directly. The kernel keeps the `codeBlock` schema/commands, copy action,
  plain/diagram NodeViews, render-on-leave lifecycle, stale-render guard, source
  toggle, and block-id/language round-trip. `KernelOptions.mermaid` is the pure
  host seam. Runtime owns Mermaid's dynamic import, strict configuration,
  semantic-token theme adapter, LRU/in-flight cache, SVG admission/sanitization,
  and theme invalidation. The editor-kernel dependency closure still contains
  no `mermaid` package.
- **SlashCommand** — the kernel owns only trigger detection and the available
  catalogue. Runtime owns the dropdown and command execution. QueryBlock and
  Math are now available entries because their schema/host seams ship.
