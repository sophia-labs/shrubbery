/**
 * poll.ts — the ONE default poll interval for live TripleSource adapters
 * (MED-1: "the 3000ms literals become one named constant with an owner").
 *
 * Owner: @shrubbery/source. Every 'poll'-liveness adapter this package ships
 * (gardend-local, sparql-http, hosted-gateway) declares this as
 * `description.suggestedPollMs` whenever the caller doesn't supply an
 * explicit `suggestedPollMs` override — so a boot config that names no
 * `pollMs` still gets a live re-read loop (a host's `config.pollMs ??
 * description.suggestedPollMs` resolves to a real interval, never
 * `undefined`), rather than silently degrading to a single read.
 *
 * 'static' sources (the fossil adapter) never touch this constant — a fossil
 * can never change, so `PlanterBootConfig`'s own doc says 'static' ignores
 * `pollMs` outright.
 */
export const DEFAULT_SUGGESTED_POLL_MS = 5_000
