# Hoja — the app

Hoja is a quiet notes app in the Sophia suite. Its top bar shares Garden's app
picker, so Garden and Choreograph stay reachable from the note list, editor,
and sign-in screen. The picker saves a pending edit before leaving Hoja.

In local Soil mode, each row is a `.sd` seed file (a Y.Doc in Garden's document
shape). The first line of a note is its title.

Not to be confused with `packages/hoja`, the backend-free editor *component*
this app hosts. The component is the organ; this is the creature.

## Run

```bash
# production shape: soil serves the built app
cd apps/hoja && pnpm build
soil app ~/Notes            # serves the app + your folder of seeds

# dev shape: vite serves the app, soil serves only the seeds API
soil app ~/Notes --no-open  # port 7777
pnpm dev                    # port 5190, /api proxied to soil
```

For a self-contained UI preview, run `pnpm dev:fixture` in `apps/hoja` and open
`http://127.0.0.1:5190/`. Its app picker points to Organism's local browser
harness on port 5191. In hosted mode, the picker defaults to `/` for Garden and
`/choreograph` for Choreograph. Set `VITE_GARDEN_APP_URL` and
`VITE_CHOREOGRAPH_APP_URL` at build time when either app lives elsewhere.

The same app can bind to a Cloud-2 Garden cell without changing its UI:

```bash
VITE_GATEWAY_BASE_URL=https://api.canary.sophia-labs.com \
VITE_COGNITO_REGION=us-west-1 \
VITE_COGNITO_CLIENT_ID=46raltmjse1gjkkt6hvq30tsk7 \
pnpm build:cloud
```

In hosted mode, `?graph=<graph-id>` selects a graph; otherwise Hoja restores
its last graph and then prefers a running graph the user may edit. Cognito uses
the shared Shrubbery token store, so a same-origin Organism login is reusable;
Hoja also exposes its own minimal sign-in face. The resulting artifact has a
`/hoja/` Vite base and is safe to sync only to that S3 prefix.

## Behavior

- List of seeds (title, snippet, quiet timestamp), newest first
- Select → edit with the hoja component (page posture), autosave to the seed
- `+` / ⌘N → new leaf: an empty, focused draft that becomes a document on
  the first keystroke (pressing New again reuses an untouched draft)
- Saves are fenced by the cell revision: a leaf changed elsewhere is refused
  with a "Load latest / Keep mine" prompt, never silently overwritten; an open
  leaf picks up other writers' revisions by polling; failed saves retry with
  backoff; edits pending at unload are flushed (keepalive) behind a guard
- Two panes on desktop; list ↔ editor swap on mobile widths
- Workspace picker, appearance controls, and suite app picker
- `SeedStore` keeps local `SoilStore` and hosted `CellStore` interchangeable

## Tests against a real cell

`pnpm test` includes `tests/cell-store.cell.test.ts`, and
`pnpm test:cell-browser` runs the Chromium/WebKit/Firefox battery in
`scripts/hoja-cell-harness.mts`. Both spawn a real `gardend` from
`GARDEND_BIN` (e.g. a garden checkout's
`src-tauri/target/debug/examples/gardend`); without it the cell suite skips.
