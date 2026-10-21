/**
 * The typed-object read seam (typed objects architecture D6): ONE locator, `{graphId, iri}`, for any typed resource —
 * a run item, a published object, a built-in class instance, a being. The shell implements it (the organism's
 * `typed-object-reader.ts`: SPARQL for the triples, `emporium_vocab`'s `classCatalog` for the class); every host
 * reads through it: the `object.card` layout face, the object page, the injerto in a document, the workflow views.
 *
 * Mirrors the `SourceObjectService` seam `card.object` reads through: the runtime declares the shape, the shell owns
 * the transport, nothing here imports a client.
 */

import {
  type ClassCatalogEntry,
  type ObjectModel,
  type ObjectTriple,
  typedObjectModel,
} from '@shrubbery/nucleus/object-faces'
import type { ObjectUsage } from './object-view-element.js'

/** What one read of a typed resource gives: its types and triples, and its class's catalogue entry when there is one. */
export interface TypedObjectRead {
  readonly graphId: string
  readonly iri: string
  readonly types: readonly string[]
  readonly triples: readonly ObjectTriple[]
  /** Null: no `classCatalog` serves its class (yet), and the face draws the generic model. */
  readonly contract: ClassCatalogEntry | null
  /** The vocabulary's other classes, for nested values. */
  readonly catalog: readonly ClassCatalogEntry[]
}

export interface TypedObjectService {
  /** Null: this graph holds no triple about it (the injerto's honest "Not in this graph"). */
  read(graphId: string, iri: string): Promise<TypedObjectRead | null>
  /** The documents whose blocks embed it (`mdoc:embeds`). */
  usedIn?(graphId: string, iri: string): Promise<readonly ObjectUsage[]>
}

/** The model of one read. */
export function objectModelOfRead(read: TypedObjectRead): ObjectModel {
  return typedObjectModel({ iri: read.iri, types: read.types, triples: read.triples, contract: read.contract, catalog: read.catalog })
}
