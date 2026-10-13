/**
 * graph-projector.ts — NODE-SIDE: the two graph bodies the read seam serves.
 *
 * The ONE module that turns the aigua directory into N-Triples, and the ONE
 * module that turns AVIARY's authored layout into N-Triples. Both go through
 * the real nucleus codec (`triplesToNT`, `serializeConfigToTriples`) so the
 * bytes on the wire and the bytes the browser parses are the same contract, not
 * two hand-rolled halves.
 *
 * It is loaded THROUGH VITE (`server.ssrLoadModule`) rather than imported from
 * `vite.config.ts`, because Vite's config loader hands bare specifiers to plain
 * Node, which cannot execute the workspace packages' TypeScript. Going through
 * the module graph also means editing the projection hot-reloads.
 */

import { serializeConfigToTriples, triplesToNT } from '@shrubbery/nucleus'
import { aviaryWorkspaceConfig } from '../library/ux-config.js'
import { projectLibrary } from '../library/project.js'

/** The `aig:` projection of the library rooted at `root`. Throws
 *  LibraryRootError when the manifest is unreadable — the caller answers 503
 *  with the real message rather than serving an empty graph. */
export function libraryNt(root: string): string {
  return `${triplesToNT(projectLibrary(root))}\n`
}

/** The `sux:` projection of AVIARY's own layout. */
export function uxConfigNt(): string {
  return `${triplesToNT(serializeConfigToTriples(aviaryWorkspaceConfig()))}\n`
}

/** The shape the middleware needs; `graph-projector.ts` itself satisfies it. */
export interface GraphProjector {
  libraryNt(root: string): string
  uxConfigNt(): string
}
