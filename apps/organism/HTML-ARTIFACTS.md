# Agent-editable HTML artifacts

This source candidate renders `text/html` artifacts in Garden's normal artifact
surface and refreshes an open preview after committed native edits. It depends
on Garden's matching `create_artifact_text`, `write_artifact_text` and strict
text-read service. The local September 8 candidate is not a deployed Sirin or
Tauri release.

## Agent journey

Discover the actual connected server's tool schemas first. Bind the graph's
current incarnation from an authoritative response; do not invent or reuse an
old graph-life token. The local graph catalog exposes it. The existing
`source_pull` response also carries `graphIncarnation`, but that operation can
reconcile source state and requires Editor authority; it is not an innocuous
Viewer metadata read. Hosted first-create discovery must be validated against
the actual connected backend before publishing.

1. Call `create_artifact_text` with `graph_id`, `graph_incarnation`, a new
   `artifact_id`, a stable `operation_id`, `filename`, `mime_type: "text/html"`
   and exact `text`. Optional `parent_id` uses the normal workspace placement.
   Creation never overwrites an existing artifact or orphan original bytes.
2. Call `read_artifact` with `strict_utf8: true` to obtain exact current text,
   `graphIncarnation` and `contentHashSha256`. Default legacy `read_artifact`
   decoding is not a guarded-edit precondition.
3. Call `write_artifact_text` with the same graph/artifact, that incarnation,
   `expected_content_sha256`, a new stable operation ID and replacement text.
   Concurrent or stale writes refuse. Re-read and reconcile deliberately;
   do not overwrite someone else's newer work by silently refreshing the hash.
4. Keep an artifact view open. Its existing authenticated workspace-room lease
   observes committed-content hints and reads the authoritative bytes again.
   No whole-page reload or separate notification service is required.

Reuse an operation ID only for the identical request after uncertainty. Its
replayed receipt acknowledges the historical operation, not the artifact's
current existence or contents. Current bytes must be read again. Equal-content
writes are no-ops and do not add history or refresh the frame.

## History, rendering and limits

The existing History panel lists the native revision store. HTML Restore uses
`POST /artifacts/{graph}/{artifact}/text/restore`, with the incarnation/current
SHA captured before confirmation, operation ID and selected revision ID. A
network timeout is uncertain, not proof of failure; the UI keeps the operation
identity and does not automatically repeat a write. Text-owned originals refuse
legacy unguarded byte/revision writers. There is no adoption mechanism for older
uploaded HTML in this first version.

Text is strict UTF-8, at most 2 MiB, including valid empty content. Initial MIME
is exactly `text/html` or `text/plain`; only HTML gets the HTML renderer. The
workspace/RDF projection carries derived content identity, not a second copy of
the HTML bytes. Original bytes and the existing native revision store remain
authoritative.

HTML and CSS render in an opaque-origin sandbox with a restrictive CSP. Scripts
are off in the actual shell. The component supports an explicit strict-boolean
sandboxed-inline-script option for a later reviewed host choice, with no parent
bridge or same-origin privilege. CSP/sandbox is not absolute network isolation:
self-frame navigation still needs host consideration, and enabled scripts can
consume CPU. Native WebView/IPC safety is a separate acceptance gate.

Unrelated shell rerender and unchanged bytes preserve the frame; changed bytes
start a fresh iframe context. This does not preserve arbitrary JavaScript state
across changed content. No human HTML code editor or simultaneous document-draft
preservation claim is included. The known create-crash window after an uncertain
workspace publication safely refuses rather than resurrecting a deleted entry;
this is not complete creation recovery.
