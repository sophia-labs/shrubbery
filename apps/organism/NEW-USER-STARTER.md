# One new-account starter

`cell/new-user-starter.ts` is the automatic consumer for one server-registered
private **My Garden** containing the existing nine-page edition. It is separate
from the explicit, separately confirmed `garden-onboarding.ts` tour producer.
It does not create a second automatic tour graph, infer newness from a catalog
or browser storage, navigate, or run a background retry loop.

## Startup adapter boundary

Call `ensureNewUserStarter({subject, authority, mcp, isCurrent, signal?,
timeoutMs?, onState?})` once for a captured native Cognito subject and ID token.
`subject` is the raw sub; the server must return owner `user:${subject}`.
`createStarterAuthority({gatewayBaseUrl, token, isCurrent, fetch?})` captures the
token for the three fixed HTTP endpoints. The main/auth adapter must separately
bind MCP dispatch to that same captured token and the canonical workspace:

```ts
mcp.callTool(workspace, name, arguments, signal)
// workspace: {owner, graphId, generation: positive safe integer}
// name: list_documents | read_document | create_document_once
```

Routing identity is not an extra tool argument. Use the owner-qualified gateway
path, enforce the actual deployed generation precondition, and check the captured
subject/token and abort signal immediately before dispatch and after responses.
Do not substitute the source mirror or a transport that silently switches to a
new identity. The module's logical pre/post fences do not by themselves implement
that HTTP dispatch or generation gate. The adapter is separately owned and tested.

The whole invocation defaults to 60 seconds, accepts a caller bound up to 120
seconds, and clears its timer/listener on exit. Timeout can leave an already-sent
engine operation pending; it does not promise cancellation of server work. The
retained page claim prevents a later automatic resend.

Results are `not-applicable`, `unavailable`, `stale`, `retained-unavailable`,
`attention`, `client-observed-complete`, or `preserved`. Only exact subject-bound
HTTP503 `starter_disabled` is a quiet disabled feature; another authority error
is not ineligibility or an empty catalog. Attention retains the exact workspace
identity when known. Release ordinary app navigation after a bounded opportunity;
preserve explicit Home, graph/document and safe return destinations. Never allow
a late result to navigate a route that has since changed.

`onState` reports registering/preparing, not readiness. `client-observed-complete`
means nine complete projected titles/bodies were observed in this invocation and
reported. `preserved` means the server's historical client-observed completion was
retained, without comparing or repairing the user's later edits/deletes. Neither
result is a rendered-browser, terminal-queue or published-snapshot certificate;
`durabilityConfirmed` is deliberately always false.

## Fixed authority and nine page attempts

Cloud3 owns server eligibility, a permanent once-only registration identity,
atomic quota/membership registration and deliberate-create suppression. The
client uses only these pinned endpoints, with schema `sophia.account-starter.v1`:

- `POST /me/starter-workspace {}`.
- `POST /me/starter-workspace/pages/{documentId}/claim {}`.
- `POST /me/starter-workspace/pages/{documentId}/report` with original attempt ID,
  `observation`, and exact canonical page hash/revision for template-present.

Every registered response binds subject, canonical workspace and seed edition,
manifest and all nine page rows. Only claim **201/freshGrant=true** grants one
first send. A duplicate or ambiguous claim is **200/freshGrant=false**, never a
new grant. The client rejects identity/edition changes, journal regression and
inconsistent claim/report status. Current page observation may advance to
observed-present; later negative reports cannot downgrade that historical state.

A fresh complete census must contain no unrelated document. For each fixed page,
claim and then read before considering any first send. Existing exact content is
reported without writing. Edited/different, tombstoned or unreadable content is
preserved; attempted+missing stays attention. A fresh grant plus the narrowly
recognized current missing result may call **create_document_once** exactly once:

```ts
{ graph_id, document_id, title, tiptapJson,
  order: (pageIndex + 1) * 10, parentId: null, awaitDurable: true }
```

No `expectedRevision`, extra routing aliases, comments, operation ID, or legacy
`write_document` fallback is sent. Old/unsupported engines stop at attention.
Garden owns the distinct tool/kind, managed write-lease checks and retained
admission fence; their local source/tests and eventual exact artifact are a
separate prerequisite, not supplied by these client fixtures.

Read after a send even when its result is ambiguous, if time/identity still
permit. A refused/uncertain create stops further writes in that invocation,
even if a matching projection is observed. A later invocation may settle that
existing content without resending. Matching content is not proof of terminal
persistence or off-host durability. No automatic deletion, overwrite, replacement
graph, new grant or provider job is part of this module.

The v3 journal preserves the original attempt ID/time and never resets or
regrants it. Detailed historical RPC error causation is not durably retained
after a later observation settles that page; the current invocation's ambiguity
is surfaced by its attention result. No extra sticky error field is implied.

## Immutable content and maintenance

The server/client edition is `2026-09-06`. The raw manifest is UTF-8
`JSON.stringify({schema:'sophia.garden-starter-manifest.v1',edition,pages})` with
generator page/key order and no newline. It is 17,919 bytes, SHA-256
`b6b781c0b096e89bc7962939fa3a569796d83322e18e6eadb56e4706efef9c3f`.
The runtime checks this before registration; the tests pin all nine canonical
page hashes independently.

Readback comparison recursively sorts object keys only in the complete
`{documentId,title,tiptapJson}` projection. It preserves every property, array
entry, node, attribute and text byte. Garden qualified this exact nonempty
paragraph/heading generator by source reading; it is not general TipTap
normalization or a new runtime roundtrip witness.

Never edit this published edition to update existing copies. A future edition
needs an explicitly reviewed manifest/eligibility policy; it does not replace
the permanent registration marker or automatically rewrite existing user pages.
The explicit opt-in tour stays a separate action. Native/cloud-1 onboarding is
unchanged. Feature activation requires the joined gateway, engine and startup
adapter contracts and an explicit release decision; this local module performs
no live signup, seeding, IAM change or deployment.
