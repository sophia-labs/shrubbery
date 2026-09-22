# `shrubbery-site` 0.2.1 — rationale

Status: registered internal substrate. Garden embeds and SHA-pins the golden,
serves it through the Emporium catalogue, derives SHACL from it, and alone owns
the reserved `:projection:site` write target. The 2026-07-11 Planter design and
its Appendix A remain historical input; they are no longer the byte authority.

## What the pack describes

A site is graph-defined content plus a code interpreter. In cloud-2, the target
is always the exact `(owner principal, graph id)` tuple. A graph slug alone is
neither identity nor authority.

| class | role |
|---|---|
| `SiteDefinition` | Pins a reviewed bundle id/version, interpreter package/version, and layout-seed SHA. |
| `PublicationRoute` | Host-owned name/path → exact owner+graph route, with interpreter facts copied from the definition and human testimony required for public state. |
| `Surface` | Names a presentation of an existing `sux:Workspace`. |
| `Route` | Maps a local path to the existing dim-app machinery. |
| `Theme` | References the existing dim-theme/dim-skin machinery. |
| `ComponentBinding` | Records custom-element tag → package/version/persistence facts. |
| `ContentSource` | Redacted read testimony: endpoint, optional exact owner, graph, auth mode, liveness, read time, and count. |
| `PackProvenance` | Records the exact Emporium pack version and content SHA a site trusted. |

No credential is represented by this vocabulary.

## Phanes-strength authority

Phanes is the precedent for the site effect edge:

- the durable host commits the source turn before launching a sandbox;
- the host binds owner, graph, interpreter, and replay identity from trusted
  state;
- a sandbox emits a typed proposal, never permission;
- the host rechecks grant, fence, quota, and approval immediately before the
  Emporium dry-run/apply/replay sequence;
- public publication requires a `user:` approval witness;
- retry identity comes from the host turn plus effect ordinal, not an
  agent-supplied idempotency string.

Consequently, `PublicationRoute` carries `ownerPrincipal` and `graphId`
separately, and `@shrubbery/site` derives the interpreter fields from the
reviewed bundle rather than accepting them from route input. A same-slug graph
under another owner cannot be selected accidentally.

## Interpreter pinning

RDF does not execute itself. `SiteDefinition` records the exact package and
version that gives the graph its rendering semantics. The render pool may map
that pair to an immutable image digest, but it must refuse an unknown pair; it
must never reinterpret an existing site with whichever Shrubbery build happens
to be newest.

The initial Garden bundle pins `@shrubbery/planter` `0.0.0`, matching the actual
workspace package version. A release changes the graph pin and deployment
registry consciously.

## Extend existing layout identity

Surface, Route, and Theme add no parallel layout model. Their URI predicates
reference the exact `sux:` subjects emitted by Nucleus's deployed layout
serializer. This supersedes the draft's proposed URN alias universe: an alias
that no serialized graph contains is weaker than a direct reference to the
real node.

Site-owned instance subjects still live under
`urn:mnemosyne:local:graph:{graph_id}:projection:site:*`, never in an ontology
namespace. Only references to already-existing layout subjects use the `sux:`
identity.

## Reconciliation and publication

Every class is a current-state, code-backed materialization into
`projection:site`. Garden's generic Emporium planner and SHACL gate provide the
authority boundary; callers do not write the reserved graph directly.

The raw SHACL supplement closes the important semantic sets:

- host authentication testimony, including delegated `service` reads without
  ever representing a credential;
- source liveness (`static | poll | push`);
- typed owner principal grammar;
- canonical cloud-2 graph slug grammar;
- `unlisted | published | retired` publication states;
- human approval fields for `published`;
- 64-lowercase-hex layout seed hashes.

Retirement remains a deferred host operation rather than an in-wave delete.
The vocabulary can represent `retired`; it does not grant permission to enter
that state.

## Evidence

Shrubbery tests prove deterministic bundle and route triples, references to
subjects that actually occur in the canonical serialized layout, exact-owner
validation, interpreter derivation, and publish approval refusal. Garden tests
compile the real contract, traverse its generic planner and SHACL validator,
and pin the served bytes by SHA.
