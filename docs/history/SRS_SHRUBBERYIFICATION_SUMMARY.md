# SRS Shrubberyification Summary

Date: 2026-06-30
Branch: `wip/full-garden-port-2026-06-23`
Remote checkpoints:

- `bbc1de9` (`Add SRS research skin and workspace stories`)
- `f81c605` (`Document SRS shrubberyification work`)

Local source checkpoints before replay onto the updated remote branch:

- `9615ee7` (`Add SRS research skin and workspace stories`)
- `558c1ea` (`Document SRS shrubberyification work`)

Status: SRS frontend shape is now Shrubbery-native and Storybook-verified; real paper retrieval remains a host-owned stub.

Update 2026-07-01: the continuation of this line is tracked in
`GREENHOUSE_SHRUBBERYIFICATION_SUMMARY.md`. SRS remains the research-service
front-end substrate; Greenhouse is the AgentWorld/workflow IDE shell built on
that substrate.

## Executive Summary

The Sophia Research Service (SRS) prototype started as a standalone wireframe in
`/Users/vera/dev/sophia/srs`: a research-desk chat shell with a sidebar, a
centered conversation, a right artifact pane, source/workflow views, and a soft
serif/paper aesthetic. The shrubberyification work moved the useful parts of
that prototype into Shrubbery without preserving it as a duplicate app shell.

The result is a reusable Shrubbery surface:

- SRS-specific UI is decomposed into controlled, backend-free components in
  `packages/components`.
- The existing shared `sh-chat-panel` is generalized so SRS can use it instead
  of forking a second sidebar chat.
- Paper search is represented as host-owned data and tool/provenance state, not
  as a component-local API client.
- The original SRS wireframe aesthetic is captured as a first-class token skin:
  `data-skin="research"`.
- Storybook now contains atom, molecule, organism, and complete SRS stories,
  with browser checks proving the new skin axis works alongside Garden and
  Emporium.

This is not a production SRS app yet. It is the frontend/kernel substrate that a
production SRS shell can drive.

## Work Product Index

| Area | Concrete artifact | Why it matters |
|------|-------------------|----------------|
| Research components | `mn-research-source-chip`, `mn-research-source-card`, `mn-research-run-trace`, `mn-research-workspace` | Gives SRS a Shrubbery-native component vocabulary instead of a copied standalone app. |
| Shared chat | generalized `sh-chat-panel` props/events | Lets SRS reuse the sidebar chat organism with research-specific prompts and controls. |
| Paper integration | host-owned stub records and trace steps | Keeps arXiv/Paperpile/Paperclip/Zotero concerns out of component packages until a real service exists. |
| Skin system | `data-skin="research"` and `skin-research.css` | Preserves the SRS wireframe's warmer research-desk direction through tokens, not bespoke CSS forks. |
| Storybook | `Research / SRS` stories plus catalogue entries | Makes the full surface inspectable as atom/molecule/organism/story. |
| Tests | token, component, chat-kernel, Storybook Vitest, and browser checks | Guards the new UI vocabulary, the third skin axis, and the chat reuse seam. |

## Goals

The work had five practical goals:

1. Avoid a one-off SRS frontend that diverges from the Shrubbery system.
2. Preserve what was good about the SRS prototype: research posture, source
   provenance, workflow trace, and the calmer research-desk look.
3. Reuse the shared chat panel rather than inventing a parallel chat surface.
4. Keep integration seams honest: components render data and emit intents; hosts
   own retrieval, persistence, graph access, and tool execution.
5. Make the visual divergence from core Garden/Emporium expressible through the
   existing skin/token system.

## Source Material Reviewed

The original prototype reviewed for this pass lives under:

- `../srs/src/styles/tokens/*`
- `../srs/src/chat/srs-app.ts`
- `../srs/src/chat/srs-composer.ts`
- `../srs/src/chat/srs-message.ts`
- `../srs/src/chat/srs-artifact-pane.ts`
- `../srs/src/chat/srs-artifact-workflow.ts`

The raw SRS token files were not the main point of divergence. Most of the raw
token structure had already converged with Shrubbery's token system. The more
important divergence was component-level feel:

- warm paper background (`#f7f5f0` family)
- centered reading column
- slim masthead
- raised white composer with soft shadow
- pill-ish research controls
- serif-led prose and chrome
- user messages as light accent washes
- right artifact pane for sources/workflows
- dotted/sketchy workflow affordances

The new `research` skin converts that feel into reusable role tokens.

## What Was Built

### 1. Research Components

New controlled components:

- `packages/components/src/mn-research-source-chip.ts`
- `packages/components/src/mn-research-source-card.ts`
- `packages/components/src/mn-research-run-trace.ts`
- `packages/components/src/mn-research-workspace.ts`

They are deliberately host-owned:

- `mn-research-source-chip` renders compact paper/source adapter state and emits
  source selection.
- `mn-research-source-card` renders a resolved paper/source candidate and emits
  select/open/promote intents.
- `mn-research-run-trace` renders caller-owned run steps and emits step-open
  intents.
- `mn-research-workspace` owns only the slotted layout and source/workflow pane
  selection.

None of these components fetch, persist, authenticate, or execute tools. They
consume props and emit events.

Tests:

- `packages/components/src/__tests__/mn-research-service.test.ts`

Exports and catalogue wiring:

- `packages/components/src/index.ts`
- `apps/storybook/catalog/catalog-model.ts`
- `apps/storybook/catalog/catalog-coherence.test.ts`
- `apps/storybook/stories/catalog.stories.ts`

### 2. SRS Storybook Surface

New Storybook files:

- `apps/storybook/stories/research-service.stories.ts`
- `apps/storybook/catalog/research-service-story.test.ts`

The Storybook surface is layered as:

- Atom: `mn-research-source-chip`
- Molecule: `mn-research-source-card`
- Molecule: `mn-research-run-trace`
- Organism: `mn-research-workspace`
- Story: complete SRS composition using the shared chat panel, sidebar, source
  workbench, Excalidraw/workflow canvas, and trace.

The complete story uses stubbed source data and run steps, but the architecture
is real: the data is host-projected and all user actions leave as events/callbacks.

### 3. Shared Sidebar Chat Generalization

Instead of porting the standalone SRS chat shell as a second chat system, the
existing `@shrubbery/chat-kernel` panel was generalized.

Important additions in `packages/chat-kernel/src/chat-panel.ts`:

- `assistantLabel`
- `composerPlaceholder`
- `emptyIcon`
- `emptyTitle`
- `emptyDescription`
- `emptySuggestions`
- `composerControls`
- `promptCards`
- `onSuggestionUse`
- `onComposerControlChange`
- `onPromptOptionUse`
- `onPromptSubmit`

This lets SRS express:

- "Start a research run" empty states.
- Research-specific suggestion prompts.
- Depth/reach controls in the composer.
- Agent-posed calibration cards.
- Host-owned prompt-card answer collection.

The key architectural decision: the chat kernel still owns only rendering and
interaction mechanics. It does not own retrieval, sessions, billing, tool
execution, persistence, or graph operations.

Tests:

- `packages/chat-kernel/src/__tests__/chat-panel.test.ts`

### 4. Stubbed Paper Integration

The paper integration is intentionally a stub at this layer.

Storybook currently uses host-owned records such as:

- `paperSources`
- `runSteps`
- `sourceItem`
- `sourceAnnotations`
- `incomingWires`

The trace and chat stories use tool names like:

- `papers.search`
- `arxiv.stub`
- `research.plan`
- `research.synthesize`
- `search_blocks`

These names document the intended seam without introducing a component-level
paper client. Future real integrations should materialize the same kinds of
source/run records from a host service.

The design point is important: SRS should not be "a chat component that knows
about arXiv." It should be a host-driven research workflow whose source records
and traces are rendered by generic Shrubbery pieces.

### 5. Research Skin

The original SRS wireframe aesthetic became a new skin:

- `packages/tokens/css/skin-research.css`

It is imported by:

- `packages/tokens/css/tokens.css`

And exposed programmatically through:

- `packages/tokens/src/index.ts`

The skin value is:

```ts
type Skin = 'garden' | 'emporium' | 'research'
```

DOM hook:

```html
<html data-skin="research" data-theme="light">
```

Storybook toolbar label:

```text
Research (SRS)
```

Core visual choices:

- Literata for chrome, display, and prose.
- Muted blue-lavender accent: `#586f93`.
- Warm paper base: `#f6f4ef`.
- Raised work surface: `#fffdf8`.
- Comfortable density: 30px row/control height.
- Soft surface radius: 12px.
- Visible labels and texture.
- Gentle rule hierarchy, not Emporium's strong Swiss frame grid.
- Soft card/composer/popover shadows.
- Dark theme override with cool research-desk surfaces.

Related tests:

- `packages/tokens/src/__tests__/tokens.test.ts`

The token tests parse the shipped CSS directly and assert:

- `[data-skin="research"]` exists.
- `SKIN_APPLICATIONS.research.appliesAttribute` is `[data-skin=research]`.
- Research accent differs from Garden and Emporium.
- The font role is Literata for chrome/prose/display.
- Surface, radius, density, rule, and shadow tokens match the intended posture.
- The dark override lightens the accent and changes the surfaces.

### 6. Storybook Skin Axis

Storybook now knows about all three skins:

- Garden
- Emporium
- Research (SRS)

Files:

- `apps/storybook/.storybook/preview.ts`
- `apps/storybook/.storybook/test-runner.ts`
- `apps/storybook/stories/tokens.stories.ts`

The browser test runner now flips all shipped skins in Chromium and asserts that
skin-aware components mirror the ambient skin and resolve distinct accent tokens.

The SRS story namespace defaults to the Research skin:

```ts
const meta = {
  title: 'Research/SRS',
  globals: { skin: 'research' },
  parameters: { layout: 'fullscreen' },
}
```

Users can still flip the toolbar back to Garden or Emporium to see whether the
surface remains properly generic.

### 7. Token Consumption Polish

Several SRS-facing surfaces were adjusted to consume generic token roles instead
of hard-coded values:

- `mn-research-source-card` now uses `--mn-radius-surface`,
  `--mn-color-surface-raised`, and `--mn-shadow-card`.
- `mn-research-run-trace` now uses `--mn-radius-surface`,
  `--mn-color-surface-raised`, and `--mn-shadow-sm`.
- `sh-chat-panel` now routes composer/prompt-card styling through surface,
  radius, border, prose-font, and shadow tokens.

This is what allows the Research skin to carry the original SRS composer/card
feel without a `:host([data-skin=research])` special case.

### 8. Reuse Decisions That Matter

The main shrubberyification win is reuse, not visual recreation:

- SRS uses `sh-chat-panel` instead of reviving `srs-chat-*` as a second chat
  implementation.
- SRS source results are represented as `MnResearchSource` records, which can be
  produced by any host service.
- SRS workflow/provenance is represented as `MnResearchRunStep[]`, not as a
  hard-coded arXiv-specific timeline.
- The central layout is a slotted `mn-research-workspace`, so a production app
  can swap in a real chat host, source adapter, Excalidraw/workflow canvas, or
  graph-backed artifact pane.
- The visual divergence lives in token roles and Storybook globals, so Research
  can diverge from Garden/Emporium without becoming a parallel design system.

This matters for future SRS and Vehicle-style work: new agent-room or research
room shells should start by composing these reusable pieces, then add host
state and services around them.

## Boundaries Preserved

The shrubberyification preserves the package split:

- `packages/tokens`: skin/theme role values and applier only.
- `packages/components`: controlled visual components, data in and events out.
- `packages/chat-kernel`: pure chat render/intent element, still no backend.
- `apps/storybook`: story/demo/test harness, allowed to assemble stubs.
- Future runtime/app layer: responsible for real papers/search/graph effects.

No paper API client was added to `packages/components`.
No graph or Mnemosyne MCP dependency was added to the UI components.
No retrieval or persistence was added to `chat-kernel`.

## Verification Snapshot

These checks passed after the SRS/research-skin work:

```sh
pnpm --dir shrubbery/packages/tokens typecheck
pnpm --dir shrubbery/packages/tokens test:run
pnpm --dir shrubbery/packages/components typecheck
pnpm --dir shrubbery/packages/components test:run
pnpm --dir shrubbery/packages/chat-kernel typecheck
pnpm --dir shrubbery/packages/chat-kernel test:run
pnpm --dir shrubbery/apps/storybook build-storybook
pnpm --dir shrubbery/apps/storybook test:run
pnpm --dir shrubbery/apps/storybook test-storybook:ci
```

Counts observed:

- Tokens: 31 tests passing.
- Components: 443 tests passing.
- Chat kernel: 85 tests passing.
- Storybook Vitest: 88 tests passing.
- Storybook browser CI: 116 tests passing across 11 suites.

The Storybook Vitest and browser checks required local socket permissions because
they start local IPC/HTTP servers and drive Chromium against loopback.

## Current Commit Shape

The clean SRS/research-skin work was first committed locally as:

```text
9615ee7 Add SRS research skin and workspace stories
558c1ea Document SRS shrubberyification work
```

Because the remote branch advanced before push, those commits were replayed onto
the updated remote branch and pushed as:

```text
bbc1de9 Add SRS research skin and workspace stories
f81c605 Document SRS shrubberyification work
```

The implementation commit includes:

- SRS research components.
- Shared chat generalization.
- Storybook SRS stories and catalogue tests.
- Research skin tokens and skin applier wiring.
- Storybook toolbar/browser checks for the third skin.

The documentation commit adds this summary. Known local caveat at the time this
summary was written: there is unrelated VTuber WIP in the same `shrubbery`
working tree, and the local branch is ahead/behind the remote. The pushed remote
branch contains the clean SRS commits above; local working tree state should not
be treated as the canonical SRS checkpoint.

## What Is Intentionally Still Stubbed

### Real Paper Retrieval

The current SRS story has no real arXiv/Paperpile/Paperclip/Zotero adapter call.
The right move is to add a host service that produces `MnResearchSource` records
and `MnResearchRunStep` traces, then feed those into the existing components.

Recommended future shape:

```ts
interface PaperSearchService {
  search(query: string, opts: PaperSearchOptions): Promise<MnResearchSource[]>
  open(sourceId: string): Promise<void>
  promote(sourceId: string, target: ResearchArtifactTarget): Promise<void>
}
```

That service belongs in runtime/app land, not `packages/components`.

### Production SRS Shell

Storybook demonstrates the complete composition, but there is no dedicated
production `apps/srs` or cloud route wired to a live service yet.

A production shell would own:

- current research session
- selected source
- paper adapter choice
- tool execution
- source materialization
- graph writes/wires
- artifact persistence
- auth/billing if applicable

### Visual QA

The skin is tested via token parsing and Storybook browser execution, not yet by
pixel/screenshot review. The next aesthetic pass should inspect:

- SRS desktop full composition
- mobile/narrow layout
- dark Research skin
- Garden/Emporium fallback rendering of SRS components
- chat composer text fit and control wrapping

## Follow-Up Recommendations

1. Decide the host surface for real SRS:
   - dedicated `apps/srs`
   - an organism route
   - or a runtime-mounted panel/workspace inside Garden.

2. Implement the papers service seam:
   - start with `papers.search`
   - return `MnResearchSource[]`
   - map tool calls to `MnResearchRunStep[]`
   - keep source retrieval out of components.

3. Add a real source adapter:
   - arXiv wrapper first if the goal is literature discovery
   - Zotero/Paperpile/Paperclip later if the goal is personal-library grounding.

4. Add artifact persistence:
   - selected sources should promote into a citation-aware brief/document
   - workflow nodes should be graph-linkable
   - source annotations should wire back into the graph.

5. Continue tokenizing shared chat:
   - `sh-chat-panel` now consumes many skin roles, but still carries Garden-era
     structure and some hard-coded fallbacks.
   - move more repeated surface/radius/shadow values to role tokens as they
     become real variation points.

6. Add screenshot QA for Research skin:
   - full SRS story
   - token palette
   - source card
   - run trace
   - dark mode

## Implications For Vehicle / Agent-Room Work

The SRS shrubberyification created several pieces that are directly useful for a
future Vehicle-shaped Shrubbery app:

- Use `mn-research-workspace` as the high-level room shell when a center
  conversation needs a right-side provenance/world/tool pane.
- Use `sh-chat-panel` for the message/composer surface, with host-owned labels,
  prompt cards, controls, and send handlers.
- Project Choreograph or agent-world events into the same trace idea used by
  `mn-research-run-trace`, rather than inventing a second activity timeline.
- Keep service integration outside the component layer: Choreograph, Garden,
  paper retrieval, and graph writes should be app/runtime services that feed
  controlled components.
- Prefer a new skin only when the app has a real aesthetic direction that cannot
  be expressed by Research/Garden/Emporium tokens.

In short: SRS gives the next app a reusable research/agent-room grammar. Vehicle
can supply richer session semantics, but it should not fork chat, trace, or
workspace primitives unless a concrete interaction forces it.

## Quick Pickup Commands

```sh
cd /Users/vera/dev/sophia/shrubbery

pnpm --dir packages/tokens test:run
pnpm --dir packages/components test:run
pnpm --dir packages/chat-kernel test:run
pnpm --dir apps/storybook build-storybook
pnpm --dir apps/storybook storybook
```

Open Storybook and use:

```text
Research / SRS
Tokens / Palette
Catalog / mn-research-*
```

The Storybook skin toolbar should include:

```text
Garden (fern)
Emporium (purple)
Research (SRS)
```

## Bottom Line

The SRS frontend is no longer a separate wireframe island. Its useful pieces now
exist as Shrubbery components, shared chat affordances, Storybook stories, and a
proper Research skin. The remaining work is to connect a real host-owned papers
service and production shell to these pieces.
