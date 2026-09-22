# PLANTER — deployment shapes

Four deployment shapes exist, in **trust order** (least trust required →
most): fossil/CDN, credentialed planter-server, trusted stateless pool,
SPA+Cognito. **None of these
is represented as cloud-proven.** Every claim below states exactly what was
run against what, and every hosted-gateway claim inherits the disclaimers in
`packages/source/tests/gateway-conformance.integration.test.ts`'s own header
comment (Cognito validation, ACLs, ALB WebSocket behavior, and Kubernetes
cell orchestration are explicitly NOT covered by anything in this repo).

## Shape 1 — fossil + CDN (no backend, lowest trust required)

A `static-nt` fossil (`docs/planter/site-vocab/`-adjacent provenance-headed
`.nt`, written by `apps/planter/scripts/dump.mts`) served as a static file.
No credentials, no live process, no gateway. `staticNtSource(body,
provenance)` refuses construction without capture provenance (invariant 7 —
no-mocks applies to timestamps: stamping load time would launder a fossil's
age into apparent freshness). This is the ONLY shape with zero moving parts
— appropriate for a truly static, infrequently-updated site. The full
route×face S3-layout static build (`build-static.mts`) is a **named later
slice** (design §7, D17); what ships this slice is the fossil adapter +
the static/live byte-parity test (U12), which is the piece of the later
slice that had to land now to prove the fossil path is honest.

## Shape 2 — credentialed planter-server (a real process, direct or behind the gateway)

`apps/planter/src/server-entry.ts` binds the reusable renderer in
`server.ts` to any `TripleSource` via
`sourceFromBoot`. Two sub-modes:

- **Direct to a local gardend** (`adapter:'gardend-local'`): dev/bench mode,
  `PLANTER_ENDPOINT`/`PLANTER_GRAPH`/`PLANTER_AUTH_MODE=dev`/
  `PLANTER_AUTH_TOKEN` env vars. `PLANTER_ADAPTER=gardend-local` must be
  given explicitly — `boot.ts`'s refusal semantics (HIGH-2) name exactly TWO
  inference rules (an endpoint starting `static:` → `static-nt`,
  `auth.mode:'cognito'` → `hosted-gateway`), so an adapter-less config here
  refuses naming the `adapter` field rather than silently guessing
  `gardend-local`. No gateway involved at all.
- **Behind platform-next's gateway** (`adapter:'hosted-gateway'` —
  explicit, same reason as above; `readPath:'sparql'` by default): the
  server itself holds the credential (a service/dev token or a Cognito
  session), requires the exact typed `PLANTER_OWNER`, and proxies reads
  through `POST /o/{owner}/g/{id}/api/sparql/query` — the Viewer-eligible
  path. This is the shape a curl-able, agent-discoverable
  published site actually wants: the credential never reaches a browser.
  All of these fields resolve through the SAME validated
  `PlanterBootConfig`/`sourceFromBoot` machinery the SPA uses (`server-boot.ts`'s
  `bootConfigFromProcessEnv`) — there is no separate, less-strict boot path
  for the server entry.

## Shape 3 — trusted stateless render pool (cloud deployment shape)

`apps/planter/src/pool.ts` is the production pool boundary. It is not a
public origin. Platform-next first ACL-checks an exact owner+graph request,
replaces the target/actor headers, and authenticates to the pool with
`x-planter-internal-service`. The pool then calls the ordinary canonical
gateway route with its service token plus `x-pn-on-behalf-of`; the user token
never reaches the pool and the service token never reaches a sandbox or
browser.

The pool does not accept a graph slug without an owner. Before interpreting
layout, it queries the target's reserved `:projection:site` graph for exactly
one complete `site:SiteDefinition`, selects the exact package+version from its
closed interpreter registry, and verifies bundle id/version plus layout SHA.
Missing, ambiguous, unknown, `latest`, or byte-drifted definitions refuse.
`/healthz` reports process readiness without probing a graph; target `/health`
continues to report the real upstream read status.

The dependency-closed artifact and container are built with:

```sh
pnpm --filter @shrubbery/planter build:pool
docker build --platform linux/amd64 -f Dockerfile.planter -t planter-pool:local .
```

The image runs as the unprivileged Node user and requires all three host-side
bindings: `PLANTER_GATEWAY_ORIGIN`, `PLANTER_GATEWAY_SERVICE_TOKEN`, and
`PLANTER_INTERNAL_SERVICE_SECRET`. The emitted bundle and its real `/healthz`
entry have been exercised locally; platform-next routing and cloud rollout are
separate evidence gates.

## Shape 4 — SPA + Cognito (browser holds the identity)

The planter SPA (`apps/planter`, Vite) boots via `sourceFromBoot` with
`auth.mode:'cognito'` (inferred adapter: `hosted-gateway`, per `boot.ts`'s
two inference rules). `CognitoAuthSession`
(`packages/source/src/gateway/cognito-auth-session.ts`, hoisted near-as-is
from organism) does real `cognito-idp` IDP calls (`USER_PASSWORD_AUTH` /
`REFRESH_TOKEN_AUTH`), persists tokens to `localStorage`, and auto-refreshes
before expiry. **Cognito clientId-audience pairing**: the gateway validates
the JWT's `audience` against its configured user pool, so a boot config's
`auth.clientId` MUST name the client id registered against the TARGET
gateway's Cognito user pool — pointing a boot config at, e.g., canary's
gateway (user pool `us-west-1_BlPVDVQJx`, per root `CLAUDE.md`) with a
mismatched or unset `clientId` produces an honest `401 → 'unauthorized'`,
never a silent downgrade. This repo does not hold or exercise real Cognito
credentials in CI or in any committed test — the cognito arm's coverage is
construction + `whenReady` gating + the honest-401 classification path
only, stated in-file (`gateway-conformance.integration.test.ts`).

## The P2.5 local docker-desktop gateway runbook (env-gated, `ctx.skip`s honestly when absent)

This is a feasible, cloud-free proof tier for shape 2/3's gateway path —
**nothing in this repo has run it as part of the committed test suite**; it
is the recipe the env-gated test
(`packages/source/tests/gateway-conformance.integration.test.ts`, "ENV-GATED
— real platform-next gateway (P2.5, docker-desktop)") activates when its
exact owner/graph route and connection env vars are set, and `ctx.skip()`s
honestly otherwise.

```sh
# 1. Point kubectl at the LOCAL docker-desktop cluster (dev-local.sh refuses
#    to run against any other context).
kubectl config use-context docker-desktop

# 2. skaffold.yaml builds ONLY the gardend image — pn-gateway:dev and
#    parser-pool:dev must be built manually (pullPolicy: Never; they will
#    ImagePull-fail otherwise).
docker build -t pn-gateway:dev platform-next/gateway
docker build -t parser-pool:dev platform-next/parser-pool

# 3. Bring the chart up (values-local.yaml: authMode=dev, devToken=pn-dev-token,
#    acl.mode=none/allow-all, durable NFS stand-in, all secrets throwaway).
cd platform-next && ./scripts/dev-local.sh run

# 4. The gateway service is NOT in skaffold's port-forward list — forward it
#    manually (publicBaseUrl in values-local.yaml assumes 8088).
kubectl -n platform-next port-forward svc/pn-gateway 8088:80

# 5. Run planter's env-gated P2.5 conformance test against it:
PLANTER_GATEWAY_URL=http://127.0.0.1:8088 \
PLANTER_GATEWAY_OWNER=user:dev \
PLANTER_GATEWAY_GRAPH=g1 \
PLANTER_GATEWAY_TOKEN=pn-dev-token \
  pnpm --filter @shrubbery/source exec vitest run tests/gateway-conformance.integration.test.ts
```

**PN_CORS_ORIGINS note:** local Helm values leave `corsOrigins` empty, which
**disables the CORS layer entirely**. Node/curl clients (shape 2, the
planter-server) are unaffected — server-to-server requests carry no
preflight. A **browser-hosted planter SPA** (shape 3) served from a
different origin than the gateway will fail CORS preflight against this
local gateway unless `PN_CORS_ORIGINS` (the gateway's `corsOrigins` Helm
value) is set to include the SPA's origin. This is the same env var named in
the Eschaton memo's CDN-origins item — the local runbook and the eventual
CDN-fronted shape 3 deployment share the identical gap.

**What this tier proves, and what it explicitly does not:** auth plumbing
(dev token forms, header/subprotocol shapes, exact `/o/{owner}/g/{id}`
routing, the cell-token
swap at the proxy) and the gateway's own read-path routing. `acl.mode=none`
locally means allow-all, so this tier does **not** prove role enforcement
(403/404 semantics) — `acl.mode=file` exists for that if the proof is ever
extended. It does not touch AWS, Cognito, ALB, or any canary infrastructure.

## Summary — never claims cloud-proven

No document, test name, or code comment in this slice asserts that any
hosted-gateway path has been proven against real Cognito validation, real
ACLs, ALB WebSocket behavior, or Kubernetes cell orchestration on canary or
any other cloud environment. The strongest claim made anywhere is: (a) the
gateway conformance suite is green against a REAL gardend behind a local
path-rewriter standing in for the gateway's routing (both readPaths); (b)
the P2.5 tier above is a documented, runnable, cloud-free recipe that has
NOT been executed as part of this campaign's committed record. Closing that
gap is future work, not a claim made here.
