# `@shrubbery/hoja`

Hoja is Shrubbery's backend-free text-entry surface over
`@shrubbery/editor-kernel`. One `<hoja-editor>` can take a compact `composer`,
bounded `embedded`, or document-scale `page` posture without changing its
controlled data contract.

## Core contract

- The host owns `value`, `valueKey`, persistence, submission, graph scope, and
  side effects.
- Hoja owns one TipTap view, selection/focus, the compact formatting surface,
  and accessible reference suggestions.
- `value` is canonical Markdown. The deliberately small, lossless dialect is
  paragraphs/hard breaks, bold, italic, inline code, links, and `[[label]]`.
- Every change or submit also reports plain text, TipTap JSON, emptiness, and
  ordered resolved/unresolved reference metadata in `HojaComposerDetail`.
- A host may persist that rich detail beside the canonical string, but must
  discard it whenever the two values disagree.

```ts
import '@shrubbery/hoja'
import type { HojaComposerDetail, HojaWikiLinkResolver } from '@shrubbery/hoja'

const editor = document.createElement('hoja-editor')
editor.posture = 'composer'
editor.value = draft
editor.valueKey = sessionId
editor.resolveWikiLinks = resolveCurrentGraphDocuments satisfies HojaWikiLinkResolver
editor.onChange = (detail: HojaComposerDetail) => persistDraft(detail)
editor.onSubmit = (detail: HojaComposerDetail) => send(detail.value)
```

## Reference lookup

Typing `[[query` or activating **Link a document** opens one instance-scoped
combobox. Hoja emits/resolves a request carrying the query and replacement
range; it never queries Garden itself and never invents an id from a label.

- Arrow Up/Down changes `aria-activedescendant`.
- Enter accepts the active ready result and does not submit the composer.
- Enter during loading/empty/error is consumed rather than sending unresolved
  trigger text accidentally.
- Escape closes only this editor's request and aborts its resolver.
- Newer requests abort older ones; late results cannot replace current results.
- Accepting a suggestion inserts stable document/graph metadata into the draft.
  It does not create a Garden wire.

Formatting and reference lookup are mutually exclusive elaborations. Opening
one closes the other while preserving the editor, draft, selection, and marks.

## Composer keyboard and geometry

- Enter submits a non-empty composer.
- Shift+Enter inserts a line.
- IME composition Enter and key code 229 never submit.
- Compact controls are 48px; editor text is at least 16px.
- The host sets the composer growth variables and owns safe-area padding. Hoja
  becomes an internal scroller at its maximum instead of consuming the page.

## Purity boundary

Hoja does not import Garden REST/MCP, Tauri, Yjs providers, chat services,
stores, auth, wires, routing, or browser persistence. The `composer` kernel
profile also excludes document-only slash commands, citations, collaboration,
and legacy document-global picker events.
