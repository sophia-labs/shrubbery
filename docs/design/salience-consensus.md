# Salience convergence contract

Status: consensus candidate, 2026-08-01

## Product surface

The editor's right-edge value gutter is the Shrubbery surface for Garden's
computed per-block salience. It keeps Eschaton's three-part interaction:

- signal strength expands the computed score details;
- importance cycles `unrated -> 3 -> 5 -> 0 -> unrated`;
- valence cycles `unrated -> 4 -> -4 -> unrated`.

Scores remain readable in a read-only session. Rating controls are disabled
unless the shell knows the current graph role can write.

## Authority and transport

The hosted route is deliberately:

```text
/g/{graphId}/salience/{graphId}/blocks/values
/g/{graphId}/salience/{graphId}/blocks/user-value
```

The gateway removes the first `/g/{graphId}` before proxying. Gardend still
matches the second graph id in its cell-local salience router. Gateway `GET`
authorization admits Viewers; `PUT` requires Editor or Owner authority.

Garden's current `user-value` route stores one replace-current human value for
the graph. It carries no observer identity, so Shrubbery calls this a
**graph-shared human rating**, not a per-user rating.

## Relationship to the source mirror

Agent valuations and the human value gutter are intentionally different
operations today:

- source `valuation` operations are typed, durable, append/union testimony and
  can enter the offline outbox;
- human `user-value` is a direct, replace-current REST write and is online only.

Shrubbery therefore does not fabricate offline success. A failed optimistic
rating is rolled back block-locally, then the score view is refreshed from the
cell when possible. Other blocks' concurrent updates are preserved.

Making human ratings offline-capable or observer-attributed is a backend
contract change, not a frontend relabeling exercise. It requires a typed
replace-current source operation carrying observer identity, plus matching
Garden fold/materialization and route behavior. Until that exists, the UI and
contract keep the narrower shared/online semantics explicit.

## Convergence composition

The candidate branch composes, in order, the object/source face, Choreograph
setup repair, Atelier chat polish, PR #6 editor fixes, PR #5 outline navigation,
and PR #7 salience gutter. PR #7 was first merged without semantic changes and
validated; the authority corrections above are a separate follow-up commit so
Eschaton's contribution remains reviewable on its own terms.
