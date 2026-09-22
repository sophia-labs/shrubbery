# hoja — the app

A shockingly minimalist notes app. Looks like Apple Notes / Bear; is actually
Sophia: every row in the left pane is a `.sd` seed file (a Y.Doc in Garden's
exact document shape) served by a local [`soil`](https://github.com/sophia-labs/soil)
process. The first line of a note is its title. That's the whole interface —
until you type a word that turns out to be an affordance.

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

## v0 behavior

- List of seeds (title, snippet, quiet timestamp), newest first
- Select → edit with the hoja component (page posture), autosave to the seed
- `+` / ⌘N → new leaf
- Two panes on desktop; list ↔ editor swap on mobile widths
- `SeedStore` keeps local `SoilStore` and hosted `CellStore` interchangeable
