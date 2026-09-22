# Prime notebook: local Shrubbery over a cloud-2 cell

This is the development topology for the Prime execution-journal surface:

```text
local Prime worker -> local Choreograph -> cloud-2 gateway/cell -> local Organism
```

Choreograph's libSQL execution journal remains authoritative. After each cell
settles, Choreograph publishes an idempotent RDF projection to the selected
cloud-2 graph. The local Organism reads that graph through the normal hosted
Garden transport and renders the graph-authored `LayoutDocument`; it does not
talk to the kernel or acquire execution authority.

The Vite proxy is development-only. It reads the service token on the server,
replaces the browser's inert development bearer, and adds the explicit
on-behalf-of subject. The service token never enters browser JavaScript or a
production build. Bind this arrangement only to a trusted local interface.

## Run the local publisher

From the Choreograph worktree, use the checked-in local launcher (it reads the
canary token on the server side and never prints it):

```bash
cd /Users/vera/dev/choreograph-a1
./scripts/run-prime-notebook-local.sh
```

`SOPHIA_NOTEBOOK_ATTACH_CENTER=1` is suitable for the dedicated proof graph. It
creates a minimal valid Garden workspace only when the graph has none, then
binds its center to the latest Agent Session's notebook. It does not replace an
existing workspace.

In another terminal, publish a real resident Prime run. The validator waits for
the workflow's initial result, then sends a prompt and a follow-up through
Choreograph's durable command queue, retries the first command idempotently,
and verifies three ordered cells from the same body:

```bash
cd /Users/vera/dev/choreograph-a1
SOPHIA_AGENT_RUNTIME_ENTRYPOINT=/Users/vera/dev/prime-agent-a1/packages/coding-agent/src/sophia/host-worker.ts \
SOPHIA_VEHICLE_BIN=/Users/vera/dev/sophia/vehicle/target/debug/vehicle \
SOPHIA_NOTEBOOK_GRAPH_ID=prime-notebook-lab \
pnpm validate:prime-notebook-cloud2
```

With `SOPHIA_VEHICLE_BIN` set, both resident commands and the duplicate retry
are submitted by Vehicle's `choreograph-prompt` client against local
Choreograph. Omitting it falls back to direct HTTP for a Choreograph-only proof.

## Run the local display

From the Shrubbery worktree:

```bash
cd /Users/vera/dev/sophia/shrubbery

CLOUD2_GATEWAY_BASE_URL=https://api.canary.sophia-labs.com \
CLOUD2_SERVICE_TOKEN_FILE=/Users/vera/.sophia-mcp/canary.token \
CLOUD2_ON_BEHALF_OF=e9e949fe-0091-7015-0ab8-10bf259084ab \
VITE_GATEWAY_BASE_URL=http://127.0.0.1:5180/cloud2 \
VITE_COGNITO_REGION=us-west-1 \
VITE_COGNITO_CLIENT_ID=46raltmjse1gjkkt6hvq30tsk7 \
VITE_COGNITO_USER_POOL_ID=us-west-1_BlPVDVQJx \
VITE_CLOUD2_SERVICE_PROXY_SUBJECT=e9e949fe-0091-7015-0ab8-10bf259084ab \
pnpm --dir apps/organism dev --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5180/?graph=prime-notebook-lab
```

The page should render one `compute.cell` card per settled journal cell in
generation/ordinal order. It should grow from one to three cards as the two
resident commands complete; this specifically proves that projection remains
live after the original workflow request has finished. A deployed Shrubbery
build that predates this slice will correctly reject `itemFaceId: "compute.cell"`;
hosted publication is a separate, approval-gated step.

Live-cell mode also polls the complete graph-authored `:ux:config` every three
seconds. Exact N-Triples content identity is the fragment revision: an unchanged
read does no fragment work, while a changed `ux:layoutJson`, sibling theme, or
other source/config triple re-reads and revalidates the declared fragment. The
currently rendered fragment remains visible during that read; a newer read
fences any older in-flight result.

To prove that loop against the real cloud-2 graph while the page remains open:

```bash
pnpm --dir apps/organism test:prime-notebook-config-refresh-browser
```

The proof changes the attached notebook grid from stack to a distinctive reflow
width, observes the live DOM geometry change without a page reload, restores the
original `ux:layoutJson` literal, and observes the DOM restore. The original
literal is also restored from `finally` if an assertion fails.
