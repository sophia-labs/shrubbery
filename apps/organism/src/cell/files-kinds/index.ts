/** The kinds Files ships with. A kind is a value of `FileKind`; adding one is adding it here (and its module), never touching the card, the list or the status line. */
import type { FileKind } from './registry.js'
import { datasheetKind } from './datasheet.js'

export const FILE_KINDS: readonly FileKind[] = Object.freeze([datasheetKind])
export { datasheetKind }
export { evidenceQuery, readEvidence, kindsMatching, type FileKind, type KindRecord, type KindItem, type MarginReading, type MarginRowData, type FileKindMargin } from './registry.js'
