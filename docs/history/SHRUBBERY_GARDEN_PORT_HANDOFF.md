# WIP handoff: Garden frontend port to Shrubbery

Date: 2026-06-23
Branch: `wip/full-garden-port-2026-06-23`
Status: WIP checkpoint, not merge-ready without review

## What this branch is

This branch captures the current work-in-progress port of Garden frontend behavior
into Shrubbery. The goal is still the large one: use Shrubbery's new store and
component/runtime split to strangle the chat interface and then the rest of the
Garden frontend, preserving Garden parity unless we deliberately improve it.

This checkpoint intentionally commits a broad dirty tree so the work is no
longer stranded on one machine. Treat it as a handoff branch, not a clean PR.

## Boundary rules to preserve

Keep these invariants intact while continuing the port:

- `packages/editor-kernel` stays pure TipTap/ProseMirror. No stores, backend
  clients, CRDT providers, fetchers, UI picker ownership, or KaTeX dependency
  should enter the kernel dependency closure.
- `packages/chat-kernel` stays a pure render/intent layer. Runtime transport,
  pricing, billing, and persistence remain host concerns.
- `packages/components` stays controlled and backend-free: data in, events out.
- `packages/runtime` owns host glue, live editor handles, picker controllers,
  editor services, and shell-facing behavior.
- `apps/organism` is allowed to be impure. It owns live cell wiring, fetches,
  history/session state, uploads, routing, and shell orchestration.

## Major work captured

The branch includes a broad Garden-to-Shrubbery lift across:

- Chat kernel and `sh-chat-host` runtime wiring.
- A large component surface in `packages/components`, including toolbar,
  document switcher, wire menus, dialogs, artifact/public/settings/Zotero
  surfaces, landing/public shell pieces, and related tests.
- Editor-kernel ports for outliner behavior, block selection/dragging, zoom,
  footnotes, citations, wikilinks, tags, calendar events, margin glosses, block
  ids/tags, source metadata, and the new slash-command event seam.
- Runtime editor host work for toolbar commands, live collab editor handles,
  picker glue, wire services, pinned wire layers, search, comments, citations,
  image insertion, and document/wire navigation.
- Organism shell cell modules for routes, sidebar documents/mutations, daily
  notes, document comments, inspector projection, document switcher block
  search, tag lens, Zotero sources, public shell, and store conformance tests.
- Nucleus additions for command/menu/selection models, reactive store helpers,
  component library updates, wire predicate vocabulary, and grow verbs.

## Recent completed slice

The slash-command path was ported with the intended purity split:

- `packages/editor-kernel/src/extensions/slash-command.ts` detects `/query`
  and dispatches pure `open-slash-command` / `close-slash-command` events with
  replacement ranges.
- `packages/runtime/src/picker/install-glue.ts` renders the runtime-owned slash
  menu and handles keyboard selection.
- `packages/runtime/src/editor-host.ts` exposes
  `LiveEditorHandle.runSlashCommandAt(...)`.
- Slash currently supports headings, flat list items, blockquote, code block,
  table, horizontal rule, image insertion, and the in-progress math block.
- `queryBlock` remains visible but unavailable until its actual schema/runtime
  split is ported.

## Interrupted WIP: math

The last slice was interrupted while converting `/math` from disabled to real.
Current state:

- `packages/editor-kernel/src/extensions/math.ts` exists and defines
  `mathInline` and `mathBlock`.
- The port intentionally severed Garden's direct `katex` import. The kernel
  has an optional `renderMath` callback and a raw-LaTeX default renderer.
- `packages/editor-kernel/src/index.ts` wires `InlineMath` and `BlockMath` into
  `kernelExtensions`.
- `packages/editor-kernel/src/extensions/block-id.ts` now includes `mathBlock`
  in the standard block-id list.
- `/math` is no longer marked unavailable in the slash catalogue.
- `LiveEditorHandle.runSlashCommandAt(..., 'math')` inserts an empty block math
  node.

Known follow-up for math:

- Add focused tests for `insertInlineMath`, `insertBlockMath`, the `$$...$$`
  input rule, stable `data-math-inline` / `data-math-block` HTML, node-view
  editing, and slash `/math` execution.
- Update `packages/editor-kernel/DEFER.md`; it still describes Math as deferred
  because of KaTeX. That is now stale if the pure renderer-seam approach is kept.
- Decide whether runtime should provide a KaTeX renderer through `renderMath`.
  Do not import KaTeX directly into `editor-kernel`.

## Verification snapshot

Immediately before this handoff:

- `pnpm --filter @shrubbery/editor-kernel typecheck` passed.
- `pnpm --filter @shrubbery/runtime typecheck` passed.
- `git diff --check` passed.
- Strict conflict-marker scan passed:
  `rg -n "^(<<<<<<<|=======|>>>>>>>)" . --glob '!node_modules/**' --glob '!**/dist/**' --glob '!pnpm-lock.yaml'`

Earlier in the same work session, before the interrupted math slice:

- Focused editor-kernel slash/autocomplete tests passed.
- Runtime picker-glue and editor-toolbar tests passed.
- Editor-kernel compose/pure-batch/slash tests passed.
- Runtime render-workspace island and components island tests passed.
- Strict forbidden-import scans for kernel/component purity returned no hits.

Do not assume the full monorepo test suite is green. It was not run as a final
gate for this WIP checkpoint.

## Suggested next steps

1. Finish and test the math slice, or deliberately revert `/math` to unavailable
   before opening a review PR.
2. Update `DEFER.md` so the ledger matches the actual kernel roster.
3. Port `queryBlock` with the same split discipline: schema/serialization can be
   pure, live query execution and visualization controls belong in runtime/shell.
4. Re-run a Garden inventory against the current Garden branch/PR and mark each
   surface as ported, intentionally divergent, or still missing.
5. Break this WIP branch into reviewable commits or stacked PRs before merging.
6. Run organism and Storybook visual QA after the next stabilization pass.

## Local pickup

```bash
git fetch origin
git switch wip/full-garden-port-2026-06-23
pnpm install
pnpm --filter @shrubbery/editor-kernel typecheck
pnpm --filter @shrubbery/runtime typecheck
pnpm --filter @shrubbery/organism dev -- --host 127.0.0.1
```

The organism dev servers that were running during the port were stopped before
this checkpoint was committed.
