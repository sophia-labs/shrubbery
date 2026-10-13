/**
 * aviary-tags.ts — the app-extension registration for AVIARY's own elements.
 *
 * Split out of ux-config.ts on purpose. The repo's convention is "register in
 * the module that owns the WorkspaceConfig", but AVIARY's config never reaches
 * the browser as an object: it is serialized to `sux:` triples server-side and
 * read back over the read seam. Importing the authoring literal into the browser
 * just to trip the registration side effect would put a second, unread copy of
 * the layout in the bundle — the exact confusion the RDF path exists to avoid.
 *
 * So the registration lives here, and BOTH ends import it: the Node-side config
 * module (so the authored tags and the gated tags can never disagree) and the
 * browser boot (so the stamp upgrades instead of resolving to a placeholder).
 */

import { registerRenderableComponentTags } from '@shrubbery/nucleus'

/** The three elements AVIARY adds to the render gate. `mn-app-bar` is NOT here:
 *  it is already in the nucleus's frozen catalog. */
export const AVIARY_TAGS = ['av-rail', 'av-stage', 'av-transport'] as const

registerRenderableComponentTags([...AVIARY_TAGS])
