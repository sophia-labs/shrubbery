# Maintaining the hosted Garden tour

The editable source is `src/cell/garden-onboarding-content.ts`. It is an authored,
versioned nine-page first project, not an export of a person's workspace. The
current edition is `2026-09-06`. Its companion seeder is
`src/cell/garden-onboarding.ts`.

## Delivery and authority

The host offers **Start the Garden tour** on Garden Home through the optional
`OrganismGardenHomeService.startOnboarding()` callback. Merely loading Home or
signing in never provisions a tour. `main.ts::startHostedGardenTour` imports the
content and seeder lazily, obtains explicit confirmation that this creates a
separate editable graph using one workspace slot, and uses the ordinary hosted
creation lifecycle and fresh directory confirmation. The directory must confirm
the captured user's exact Owner principal. A retained `localCreation` placeholder
is not enough. The captured account, token and host contract fence each stage.

Only then does the seeder use the host's raw authoritative MCP client. It requires
a complete empty document census, writes each page once with `expectedRevision: 0`,
and verifies its title, stable block IDs, structure and text through JSON readback.
It deliberately does not use the metadata-upserting `create_document` operation.
Graph creation, content return and off-host durability are separate claims:
`contentVerified` requires all nine matching reads; `durabilityConfirmed` is true
only if every write explicitly reports `published`. Pending, unchecked or local
durability never becomes a cloud-survival claim. Missing, revoked or contradictory
durability acknowledgements fail closed. No polling loop manufactures success.

Root's host consumer navigates to the graph only after a complete verified new
seed, or a preserved existing complete edition. The numbered Documents sidebar
is the entry path; no unimplemented document deep link is assumed.

## Preservation and failure

A complete existing set of edition IDs is returned as `preserved`, with no writes
and no fresh content/durability certificate. Any other nonempty or partial graph
is refused without filling gaps. This is a fresh, unopened, confirmed-owned graph
initializer, not a general migration over an actively edited workspace.
Revision zero protects against an ordinary persisted revision winning after the
empty census; it is not a transactional graph lock or an atomic absent-document
primitive against all concurrent unpersisted editor activity.

On a refusal, malformed response, uncertain write, or identity change, stop. The
error identifies the retained graph and says that no automatic retry or deletion
occurred. Home reloads its catalog so retained work can be found. Do not retry
content writes blindly, delete the partial graph, or call a local placeholder a
success. An already-issued network request cannot be recalled by the identity
fence. The host transport must eventually settle; this seeder adds neither a
transport cancellation protocol nor an independent deadline.

## Authoring the next edition

1. Preserve earlier published source in version history. Change the edition and
   give the next edition new deterministic document/block IDs. Never apply new
   text over an existing user's pages, even if they still have the old titles.
2. Keep one useful first project with next actions. Check feature instructions
   against the actual hosted UI and service source; do not infer a Viewer shell,
   invitations, desktop controls or third-party agent access from an API name.
3. New and existing accounts both explicitly request a separate copy from Home;
   normal account quota applies. This is the update path. An in-place add-only
   upgrade would need its own authority, absence/conflict protocol and tests.
4. Update and run the focused checks from `apps/organism`:

   ```sh
   pnpm exec vitest run src/cell/__tests__/garden-onboarding.test.ts src/cell/__tests__/garden-home-route.test.ts src/cell/__tests__/hosted-workspace-creation.test.ts
   pnpm exec tsc --noEmit --pretty false
   ```

   Also run `mn-garden-home.test.ts`, `mn-workspace-selector.test.ts` and
   `mn-local-creation-gates.test.ts` from `packages/components` when Home changes.
   A real, source-bound cell and fresh authorized hosted user journey are separate
   release checks; synthetic fixture success is not their substitute.
5. The frontend build carries this edition in its lazy onboarding chunk and Home
   caller. Publish through the normal coordinated frontend release, then inspect
   that exact artifact. No gateway/cell deployment is implicitly part of a text
   change, but the deployed cell must satisfy the tested MCP response contract.

## Separate historical producers

The Garden native archive at
`src-tauri/resources/onboarding/onboarding-v2.tar.gz` and its desktop-gated Rust
importer are not this hosted producer. Their existing `seeded.json` guard does not
upgrade a previously seeded copy. No current native frontend invocation was
established in the bounded source audit. Cloud-1's configured workspace-open/S3
archive seed is another independent path. Neither archive nor producer is changed
by this feature, and neither certifies first-login delivery on cloud-3.
