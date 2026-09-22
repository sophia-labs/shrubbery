# Sophia KOReader navigation — notes from the mobile shell

**Status:** native roots and Garden-backed Browse implemented 2026-07-31

## What the mobile layout already decided

The Garden mobile shell and its Shrubbery successor agree on the important
information architecture even though their labels differ:

- Primary destinations are stable roots. Garden names them Files, Home/Editor
  and Sophia; Shrubbery names them Home, Browse and Sophia.
- A document is a detail inside Home or Browse, never a fourth primary tab.
- Root selection and document selection are separate state. Returning to a root
  does not destroy the remembered document, and selecting the document root can
  resume it.
- Detail navigation gets a dedicated top bar: Back, a centered truncated title
  and Search. Utility actions do not compete with primary destinations.
- The bottom bar is persistent outside text entry and modal states, uses the
  full safe area, and gives every destination an equal, generous touch target.
- The host owns navigation and history. Components emit an intent with a stable
  identity; they do not guess routes or remount the document to simulate a
  transition.

The reference implementations are
`packages/components/src/mn-mobile-tabs.ts` and
`apps/organism/src/cell/mobile-shell-controller.ts`. The older Garden form is
in `garden/frontend/src/components/mobile/mn-mobile-tabs.ts` and
`garden/frontend/src/app-shell.ts`.

## Translation to KOReader

KOReader owns the manuscript view, so Sophia cannot simply place web chrome
around the reader. The same information architecture should appear in layers:

1. **Now — manuscript navigation.** Every generated XHTML document carries a
   restrained navigation rule with Library, position and Next at the top, plus
   Previous, position and Next at the end. All links use stable cached document
   filenames. This makes distinct-document movement explicit even when source
   prose mentions another document without encoding a wiki link.
2. **Now — native roots.** Sophia has an honest Home/Browse distinction in a
   persistent bottom bar. Sync and Settings sit in a secondary utility row.
   Browse consumes Garden's navigation tree and graph catalogue; KOReader's
   device filesystem is not part of the Sophia information architecture.
3. **When real — Sophia root.** Add the third primary destination only when an
   actual reader conversation surface exists; do not ship a decorative or dead
   tab.
4. **Then — reader-detail bridge.** Add a native Back-to-Sophia action and
   document switcher beside KOReader's own reading controls, while preserving
   KOReader pagination, selection and sidecars.

## State contract

Navigation state should remain small and identity-based:

```text
active root        home | browse | sophia
active document    Garden document ID or none
last document/root one remembered Garden document ID per document-bearing root
history            bounded stack of root + document ID
```

Titles are labels only. Links, cache paths, resume state and callbacks must all
resolve through Garden document IDs. Revisions invalidate content, not
navigation identity.

## Interaction gates

- Selecting two different shelf rows opens two different cached paths and
  visibly different document titles.
- Previous and Next resolve to the same order shown by the library index.
- KOReader's standard confirmation for opening another local XHTML file is
  expected at this layer; removing it requires a native reader-detail bridge,
  not unsafe global setting changes or renderer tricks.
- Library always exits a manuscript to Browse; the ordinary KOReader Back
  action can still return through its own location history.
- First and last documents expose an honest boundary instead of wrapping
  silently.
- Missing cache entries fail visibly and never fall back to the last document.
- Navigation remains usable without network access after synchronization.
- Workspace switching resolves a packaged Garden manifest, scopes cache names
  by graph ID and never asks the user to choose a device directory.
- Empty Garden folders remain visibly empty; the reader does not infer false
  parentage for root-level documents.
