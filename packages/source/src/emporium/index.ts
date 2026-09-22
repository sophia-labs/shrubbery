/**
 * @shrubbery/source/emporium — the U10 migration target for the shell-side
 * EMPORIUM cell reads (design §5, R3).
 *
 * Hoisted verbatim (transport logic byte-identical) from
 * apps/organism/src/cell/{emporium-client,emporium-store}.ts, the iteration-6
 * package-exports convention this subpath supersedes. apps/organism is
 * NO-TOUCH (its own copies stay in place, deprecated-in-place, zero external
 * consumers after this migration); apps/emporium is this subpath's sole
 * external consumer, reached over @shrubbery/source's explicit './emporium'
 * export (NOT the browser-safe '.' barrel — this subpath is a cell-read
 * client, not part of the lit-free '.' charter, but it stays DOM-free itself;
 * the DOM view (vocab-views.ts) lives in apps/emporium, its only consumer).
 */

export * from './client.js'
export * from './store.js'
