# `layout/hosts/` — the guest-app host foundation

Unit S1 of the Mithras Flow playground build. Vera, 2026-08-24 18:26: "Shrubbery
should be flexible enough that the same core concepts can render a Web
Components app or a React app, taking heavy cues from the way Mithras did
their React app. It's fine if it's not the deepest integration in the world,
but the foundations should be good."

This directory is the foundation: one framework-neutral mount contract
(`guest-app.ts`), one bridge from that contract into a real, closed
`FaceRegistration` (`define-guest-face.ts`), two thin sugars over it
(`define-react-face.ts`, `define-element-face.ts`), and the light-DOM host
element that gives a guest a real place to render (`sh-guest-island.ts`). It
does not itself register any Mithras-Flow-specific face — that is a later
unit's job, built on top of this one.

## What a guest app must export

Exactly one thing (`guest-app.ts`'s `GuestAppModule`):

```ts
interface GuestAppModule {
  readonly id: string
  readonly framework: 'react' | 'web-components' | 'other'
  readonly styles?: { css: string; sha256: string }
  mount(ctx: GuestHostContext): Promise<GuestMount> | GuestMount
}
```

`mount` receives one `GuestHostContext` and returns (sync or async) a
`GuestMount`: `{ unmount(): void; update?(next: Partial<GuestHostContext>): void }`.
`ctx.container` is the light-DOM element the guest owns entirely — the guest
renders into it however its own framework wants to (a React root, a custom
element, raw DOM) and is responsible for cleaning up everything it put there
when `unmount()` is called.

`framework` and `styles` are diagnostic/fidelity metadata, never
behavior-selecting — the face registry always dispatches on `faceId`
(LAY-004: "data selects a face; data cannot supply code"), never on which
framework a guest happens to be written in. `styles`, when present, is the
guest's own stylesheet carried byte-VERBATIM plus its precomputed checksum
(FLOW-PIXEL-1/2) — this package never recomputes that checksum; it only
carries the one the guest module ships and stamps it onto the mounted host
element as `data-css-sha256`.

`defineReactFace`/`defineElementFace` are sugar that build a conforming
`GuestAppModule` for the two common cases so most callers never write a raw
one by hand.

## What the host provides

Via `GuestHostContext`, assembled by `defineGuestFace`'s `mount()`:

- **`container`** — a light-DOM element (a `<sh-guest-island>`'s own mount
  point) the guest owns entirely.
- **`base`** — the descriptor's own `params.base` when the face's
  `paramsSchema` declares one, else `'/'`. (The absolute base a specific
  guest bundle was built with — e.g. `/flow/` — is data the FACE'S params
  carry, not something this foundation layer hard-codes; a Flow-specific
  integration built on top of `defineGuestFace` is what would declare that
  params field.)
- **`backend`** (a "handle") — the resource lease's own `value`
  (`context.lease.value`) — whatever the face's `resourceAdapterId` resolved,
  handed through unchanged. Typed `unknown` here; the guest is the one that
  knows its own shape (Flow: `{ repo: RepoLike; persistence: PersistenceLike }`,
  contracts/interfaces.md §E).
- **`signal`** — a fresh `AbortController`'s `signal`, aborted when the face
  is disposed. A guest that adds any global listener (window/document) MUST
  pass this signal to it so teardown is automatic.
- **`awareness`** — reserved by the contract (y-protocols `Awareness`, when
  the host has opened a real collaboration room). This foundation layer does
  not open rooms itself and leaves it unset; a later, room-aware unit
  populates it.

## What the host never does

- **No per-frame SPARQL.** FLOW-GS-11 (MUST, owner organ-garden): "Faces
  paint from the room and query the store only for analysis; paint-by-SPARQL
  is refused as a capacity matter, not a preference... acceptance: a face
  issuing a SPARQL query per frame fails registration." Nothing in this
  directory issues a query at all, let alone on a paint/frame path —
  `defineGuestFace`'s `resize()` is a literal no-op.
- **No writes on the pointer path.** FLOW-SCENE-7 (MUST, owner
  organ-shrubbery engineer chair): "No pointer event ever awaits a durable
  write, and the per-gesture write amplification is measured and disclosed in
  writing." This foundation layer performs no writes of its own at all — it
  only mounts/unmounts a guest and forwards an already-resolved resource
  lease's value through as `backend`.

## The two `cssStrategy` mechanisms (`sh-guest-island.ts`)

Both exist because a light-DOM host cannot simply "not worry about CSS" — a
guest's third-party stylesheet lands somewhere real, and where it lands
determines how it must be rewritten (contracts/shrubbery.md §1's FLOW-EF-9
extension, on why the Excalidraw shadow-root precedent isn't the default
here: "a shadow tree silently defeats the guest's `:root` palette, their
full-height rule and their `@font-face` declarations").

- **`'shadow'`** — reproduces the Excalidraw nesting
  (`excalidraw-runtime.ts:449-462,675-682`): a child div gets
  `attachShadow({mode:'open'})`; the guest's stylesheet is injected INSIDE
  that shadow root with `:root` rewritten to a scope class. The shadow
  boundary itself isolates every other selector, so nothing else needs
  rewriting.
- **`'light-scoped'`** — the mount point stays in the ordinary light DOM (no
  shadow boundary at all); the guest's stylesheet is injected into the TOP
  document once per `faceId` and fully scoped by `scopeCss` (`scope-css.ts`):
  every selector prefixed under the scope class, `:root`/`html`/`body`
  rewritten TO the scope class, `@keyframes`/`@font-face` bodies left alone.
  The mount point itself carries that same scope class so the rewritten
  selectors match something real.

Neither strategy is "more correct" in general — which one a real guest
integration picks is a fidelity decision that belongs to that guest's own
face definition (see contracts/shrubbery.md's `FLOW-PIXEL-1..4` register),
not to this foundation.

## The cues taken from Mithras Flow's own design

Flow's own architecture (measured in `scout/shrubbery.md`, `contracts/
interfaces.md` §E) shaped this contract even though this unit registers none
of Flow's own faces:

- **Store-as-truth.** Flow's `useModelStore` (a Zustand store) is the single
  source of truth its UI reads from; the store, not any individual component,
  owns model state. `GuestHostContext.backend` exists so a guest can hand its
  own store the durable backend it needs (Flow: `setBackend({repo,
  persistence})`) without this host ever reaching into the guest's internals.
- **Snapshots from intent.** Flow derives its serialized/exported form from
  the store's current state on demand (`serializeModel`), not from replaying
  a log of UI events. This host mirrors that shape: `GuestMount.update`
  hands the guest a new `GuestHostContext` snapshot to re-render from: it is
  never asked to replay anything.
- **Gesture-granular writes.** Flow's own undo stack coalesces per gesture
  (`useModelStore.ts`'s `HISTORY_CAP`/`COALESCE_MS`), not per keystroke or
  per frame — the same discipline FLOW-SCENE-7 asks of the host side (no
  durable write awaited on the pointer path).
- **Faces paint from the store.** Exactly FLOW-GS-11's own rule, independent
  of the Mithras Flow precedent: a mounted guest paints from whatever local
  state/store it already holds; it never issues a query per frame.

## Layering

`guest-app.ts` (the contract) is the only file every other module in this
directory depends on. `scope-css.ts` and `sh-guest-island.ts` are consumed by
`define-guest-face.ts`, which is the one file that turns a `GuestAppModule`
into a real `FaceRegistration`. `define-react-face.ts` and
`define-element-face.ts` each depend only on `guest-app.ts` — they build a
`GuestAppModule`, not a `FaceRegistration`; a caller composes
`defineGuestFace({ guest: defineReactFace({...}), ... })` to get one that
registers.

None of this directory is wired into `@shrubbery/runtime`'s public barrel
(`src/index.ts`) or `layout/index.ts` yet, and no tag here is added to
`packages/nucleus/src/workspace/known-components.ts` — see this unit's
structured result for why (a face's own view/host elements are a documented
exception to that allowlist, mirroring `sh-object-card-view`'s existing
carve-out in `apps/atelier/tests/known-components-crosscheck.test.ts`). A
later unit that actually registers a Flow-specific face decides how (and
whether) to surface these exports more widely.
