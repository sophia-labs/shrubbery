# Sophia for KOReader

A native e-ink Sophia home for the Shrubbery `koreader` artifact target.

It synchronizes a versioned JSON manifest, semantic XHTML documents and JSON
reader-model sidecars into KOReader's data directory. Its full-screen home uses
KOReader-native widgets to carry Sophia's serif hierarchy, botanical bookplate,
quiet rules and manuscript shelves into a monochrome reader. Documents still
open through KOReader's own file-opening path, so KOReader remains responsible
for pagination, typography, dictionaries, bookmarks, highlights and position.

## Install

Copy the entire `sophia.koplugin` directory into a KOReader plugin directory and
restart KOReader. The final path must end in:

```text
plugins/sophia.koplugin/main.lua
```

Sophia opens at startup. Enter a URL ending in `manifest.json` under
**Settings**, then choose **Sync Garden**. From an open manuscript, return via
**More tools → Sophia → Open Sophia**. Generated manuscripts also expose
Library, position, Previous and Next navigation. KOReader asks for confirmation
before following a link to another cached local XHTML document.

The bottom bar keeps Sophia's native **Home** and **Browse** roots available.
Browse uses the synchronized Garden folder tree rather than KOReader's device
filesystem. Tap the workspace row to choose another packaged Garden graph; the
plugin downloads that graph's manifest and keeps cache filenames graph-scoped.

## Current boundary

- Read-only synchronization is implemented.
- Documents and semantic sidecars are cached offline.
- Workspace catalogue and Garden folder navigation are cached offline.
- Sync is manual and invalidates on Garden revisions or Shrubbery projection
  versions.
- The bearer token is stored in KOReader's ordinary Lua settings file; use a
  narrow, revocable Viewer token for the current reader foundation.
- KOReader bookmarks/highlights remain in KOReader sidecars. Garden write-back
  is deliberately deferred until a stable annotation-position adapter exists.
