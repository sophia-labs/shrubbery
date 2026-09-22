/**
 * @shrubbery/source — where triples come from.
 *
 * BROWSER-SAFE barrel: no static node builtins anywhere in this import graph
 * (enforced by tests/browser-safety.test.ts) and external deps limited to
 * @shrubbery/nucleus. Node-only helpers (spawn/seed/fossil-io) live behind
 * the explicit './node' subpath; the emporium migration behind './emporium';
 * the conformance kit behind './conformance' (it imports vitest and is
 * deliberately NOT re-exported here).
 *
 * All four adapters ship now: static-nt (the fossil), gardend-local (U4),
 * sparql-http (U6), hosted-gateway (U7 — GatewayTransport/CognitoAuthSession
 * are fetch(+localStorage)-only, browser-safe).
 */

export * from './boot.js'
export * from './poll.js'
export * from './gardend/gardend-source.js'
export * from './sparql/sparql-source.js'
export * from './gateway/gateway-source.js'
export * from './gateway/gateway-transport.js'
export * from './gateway/cognito-auth-session.js'
export * from './auth.js'
export * from './transport/mcp-client.js'
export * from './transport/parse-term.js'
export * from './transport/wait-healthy.js'
export * from './fossil/fossil-codec.js'
export * from './fossil/fossil-source.js'
export * from './store/source-store.js'
export * from './mirror/source-mirror.js'
export * from './mirror/source-fault.js'
export * from './mirror/source-sync-transport.js'
export * from './mirror/offline-semantic-search.js'
export * from './mirror/graph-lifecycle.js'
export * from './mirror/offline-tool-mutations.js'
