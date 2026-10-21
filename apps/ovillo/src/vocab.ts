/**
 * vocab.ts — the `ovl:` vocabulary and the graph's named graphs.
 *
 * The contract between the builders (hub plan plans/2026-10-20-ovillo-sophia-app.md):
 * namespace `ovl:` = http://sophia.ai/ovillo#, `dcterms:` for titles and dates,
 * subjects https://ovillo.sophia-labs.com/id/<kind>/<slug>, the graph `ovillo`
 * with its triples in `user:rdf` and the app's layout in `:ux:config`. Large
 * files are static files under the site, referenced by URL.
 */

import { uxConfigGraphIri } from '@shrubbery/nucleus'

export const OVILLO_GRAPH_ID = 'ovillo'
export const SITE_ORIGIN = 'https://ovillo.sophia-labs.com'

export const OVL = 'http://sophia.ai/ovillo#'
export const DCT = 'http://purl.org/dc/terms/'
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'

export const ovl = (local: string): string => OVL + local
export const RDF_TYPE = `${RDF}type`
export const RDFS_LABEL = `${RDFS}label`
export const RDFS_COMMENT = `${RDFS}comment`
export const DCT_TITLE = `${DCT}title`
export const DCT_CREATED = `${DCT}created`

/** `urn:mnemosyne:local:graph:{graph_id}:user:rdf` — where gardend keeps a graph's own triples. */
export const userRdfGraphIri = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}:user:rdf`

export const OVILLO_DATA_GRAPH = userRdfGraphIri(OVILLO_GRAPH_ID)
export const OVILLO_UX_GRAPH = uxConfigGraphIri(OVILLO_GRAPH_ID)

/** A subject in the contract's id space. */
export const idIri = (kind: string, slug: string): string => `${SITE_ORIGIN}/id/${kind}/${slug}`
