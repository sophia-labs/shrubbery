/**
 * @shrubbery/render — the pure render-target core.
 *
 * `RenderTarget` is a parameter; one resource has FOUR faces (dom/hypertext/
 * turtle/json). Hypertext markdown, turtle RDF, compacted JSON-LD, and the
 * pure DOM-string kinded-value carrier are rendered here. Lit DOM lives in
 * @shrubbery/runtime.
 *
 * Lit-free, DOM-free, network-free. Depends only on @shrubbery/nucleus (for the
 * Triple model + the reused sux: config serializer) + jsonld (a pure transform).
 *
 *   renderResource(resource, target, ctx) → { body, contentType, links }
 *
 * Content negotiation (Accept→target, default markdown, explicit .ext wins)
 * lives here too — `negotiate()` is the ONE pure decision rule every serving
 * host imports (D12/R5). SERVING (static S3 OR live cell) stays an APP/TOOLING
 * concern built ON TOP — see the conneg dev servers in apps/storybook/conneg
 * and apps/rhizome.
 */

// The render-target abstraction + resource model + context.
export type {
  RenderTarget,
  TextTarget,
  RenderedResource,
  AltLink,
  LinkRel,
  RenderCtx,
  Resource,
  CatalogResource,
  ComponentResource,
  WorkspaceResource,
  CatalogComponent,
  VocabResource,
  VocabPackResource,
  VocabSummary,
  VocabPack,
  VocabClass,
  VocabClassPredicate,
  VocabEnum,
  VocabRelationship,
  VocabMinting,
  PlotResource,
  PlotSubject,
  SubjectResource,
  MemoryRecord,
  BouquetResource,
  BouquetStar,
  BouquetRetrieval,
  StarWhy,
  WalkResource,
  WalkIndexResource,
  WalkIndexRun,
  WalkTurn,
  WalkToolCall,
  WalkToolResult,
  WalkUsage,
  WalkEdge,
  KnobResource,
  GreenhouseResource,
  KnobMeter,
  KnobAxis,
  KnobLaw,
  KnobFamily,
  KnobWriteMode,
  KindedAttribution,
  KindedValueNode,
  KindedValueResource,
  FlowBoardResource,
  FlowBoardRows,
  FlowBoardRow,
  FlowScalar,
  FlowTableName,
} from './target.js'
export { CONTENT_TYPE, FACE_EXT } from './target.js'

// The Mithras Flow vocabulary map (unit S5, FLOW-SHRUB-1a) — S5's independent
// implementation of contracts/vocabulary-map.md (the same map the cell's
// `flow` Emporium pack registers; the integration seat diffs the two turtles).
export { FLOW_TABLES } from './flow-vocab.js'
export type { FlowTableSpec, FlowPredicateSpec, FlowDatatype } from './flow-vocab.js'

// The dispatcher.
export { renderResource, renderTextSync } from './render-resource.js'

// Individual faces (handy for hosts that already know the target).
export { renderTurtle } from './render-turtle.js'
export { renderJson, toCompactJsonLd } from './render-json.js'
export { renderHypertext } from './render-hypertext.js'
export { renderDom } from './render-dom.js'

// Links — the shared AltLink set + the Link-header serializer (the conneg server
// emits this) + face URL minting.
export { linksFor, toLinkHeader, faceUrl } from './links.js'

// Content negotiation — THE one negotiate (D12/R5): explicit .ext ALWAYS wins,
// Accept table, bare curl → markdown. Pure string-in/decision-out
// (CloudFront-transcribable); every serving host imports this.
export { negotiate, targetFromAccept } from './negotiate.js'
export type { NegotiationResult } from './negotiate.js'

// The shared @context + vocabulary (defined ONCE up front).
export {
  SHARED_CONTEXT,
  PREFIXES,
  COMP_NS,
  CAT_NS,
  SUX_NS,
  EMP_NS,
  MEM_NS,
  RZ_NS,
  WK_NS,
  BQ_NS,
  DK_NS,
  compIri,
  catIri,
  empIri,
  vocabIri,
  plotIri,
  subjectIri,
  bouquetIri,
  starIri,
  retrievalIri,
  walkIndexIri,
  runIri,
  turnIri,
  callIri,
  TN_NS,
  FLOW_NS,
  greenhouseIri,
  knobIri,
  meterIri,
  axisIri,
  lawIri,
  kindedValueIri,
  flowGraphSubject,
  flowRowIri,
} from './context.js'

// RDF production (resource → Triple[]) + the Turtle codec (serializer + parser).
export { resourceToTriples } from './resource-triples.js'
export { triplesToTurtle, parseTurtle } from './turtle.js'
