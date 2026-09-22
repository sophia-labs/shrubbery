/**
 * editor-services/index.ts — the EditorServices ontology barrel (RUNTIME-INTERNAL).
 *
 * EditorServices is a host-side PROJECTION over the ShrubberyContract at the editor-seam
 * boundary (the `asReactiveStore` move). It is RUNTIME-INTERNAL: the host binding imports
 * it via './editor-services/index.js' — a './'-relative subdir import that passes the
 * non-recursive island guard (exactly like editor-host.ts imports './collab/live-editor.js').
 * EditorScope itself stays NUCLEUS-exported (the scope literal is nucleus-typed); these
 * services are the host-side adapters OVER that nucleus scope — the two are kept distinct.
 *
 * This barrel re-exports the ontology: the three service interfaces + their defaults/
 * factories, the suggestion-item shape, the verbatim fuzzy scorer, the SPARQL builders +
 * escapeLiteral, and the assemble/build boundary functions. NO adapters are mounted here;
 * NO kernel edits are made. Shell wiring is a later rung.
 */

export {
  type NavigationService,
  type OpenDocumentDetail,
  type OpenZoteroSourceDetail,
  OPEN_DOCUMENT_EVENT,
  OPEN_ZOTERO_SOURCE_EVENT,
  eventNavigationService,
} from './navigation-service.js'

export {
  type WikiLinkSearchService,
  type WikiLinkSearchScope,
  type WikiLinkSuggestionItem,
  docListSparql,
  fuzzyFilterDocuments,
  makeWikiLinkSearchService,
} from './wikilink-search-service.js'

export {
  type WikiLinkBlockItem,
  type WikiLinkBlockSearchService,
  wikilinkBlockListSparql,
  filterWikiLinkBlocks,
  wikilinkBlockRowsToItems,
  makeWikiLinkBlockSearchService,
} from './wikilink-block-search-service.js'

export {
  type TagSearchService,
  makeTagSearchService,
  normalizeTagSuggestionName,
  tagSuggestionListSparql,
  tagSuggestionsFromRows,
} from './tag-search-service.js'

export {
  type WireService,
  type WireCreateParams,
  DEFAULT_WIKILINK_PREDICATE,
  mintWireId,
  wireInsertSparql,
  wireDeleteSparql,
  makeWireService,
} from './wire-service.js'

export {
  type WireBundle,
  type WireSummary,
  type WireBundleService,
  EMPTY_WIRE_BUNDLE,
  wireBundleSparql,
  deduplicateBidirectionalWires,
  buildWiredBlockIdSet,
  makeWireBundleService,
  makeScopedWireBundleLoader,
  rowsToWireBundle,
} from './wire-bundle-service.js'

export {
  type SalienceBundle,
  type SalienceBundleService,
  type SalienceScoreCheckpoint,
  EMPTY_SALIENCE_BUNDLE,
  captureSalienceScore,
  withSalienceScore,
  rollbackSalienceScore,
  makeSalienceBundleService,
  makeScopedSalienceBundleLoader,
  IMPORTANCE_CYCLE,
  VALENCE_CYCLE,
  signalLevel,
  signalIcon,
  nextImportance,
  nextValence,
  importanceIcon,
  isVeryImportant,
  hasUserImportance,
  valenceIcon,
  importanceLabel,
  valenceLabel,
  combinedImportance,
  combinedValence,
} from './salience-bundle-service.js'

export {
  inferQueryBlockQueryKind,
  formatQueryBlockTerm,
  plainQueryBlockTermValue,
  makeQueryBlockService,
  makeQueryBlockRenderer,
  type QueryBlockService,
  type QueryBlockResult,
  type QueryBlockRow,
  type QueryBlockTerm,
  type QueryBlockQueryKind,
  type QueryBlockRendererOptions,
} from './query-block-service.js'

export {
  QUERY_BLOCK_VEGA_CONFIG,
  mountQueryBlockVega,
  parseVegaLiteSpec,
  transformBindingsToVegaValues,
  vegaTermPrimitive,
  setVegaThemeScopeOverrides,
  resolveVegaThemeOverride,
  type MountQueryBlockVegaOptions,
  type QueryBlockVegaEmbed,
  type QueryBlockVegaEmbedLoader,
  type QueryBlockVegaEmbedResult,
  type QueryBlockVegaView,
} from './query-block-vega.js'

// The chart grammar: house Vega-Lite theme/config builder + the validated
// observatory chart palette + theme-as-data merge/validate primitives.
export {
  buildVegaTheme,
  mergeVegaTheme,
  resolveVegaThemeMode,
  assignCategoricalScale,
  createCategoricalSlotAssignment,
  isValidVegaThemeOverride,
  validateVegaThemeOverride,
  isLawfulSeriesColor,
  sanitizeAuthoredVegaConfig,
  sanitizeAuthoredVegaSpecColors,
  observeVegaThemeFlips,
  ensureVegaTooltipStyles,
  statusColor,
  sequentialRange,
  divergingRange,
  CATEGORICAL_PALETTE,
  DARK_BASELINE_SKINS,
  MAX_CATEGORICAL_SERIES,
  VEGA_THEME_OVERRIDE_KEYS,
  VEGA_THEME_LAW_GUARDED_KEYS,
  VEGA_THEME_COLOR_LAW_MARK_PROPERTIES,
  type VegaLawSanitization,
  type VegaThemeOverrideVerdict,
  type VegaThemeConfig,
  type VegaThemeMode,
  type VegaCategoricalSlot,
  type VegaCategoricalScale,
  type VegaCategoricalSlotAssignment,
  type VegaSeriesValue,
  type VegaStatusTone,
} from './vega-theme.js'

export {
  applyMermaidSvg,
  buildMermaidThemeVariables,
  defaultMermaidRenderHost,
  makeMermaidRenderHost,
  parseSafeMermaidSvg,
  type MermaidEngine,
  type MermaidRendererOptions,
  type MermaidRenderController,
  type MermaidRenderResult,
} from './mermaid-renderer.js'

export {
  type EditorServices,
  assembleEditorServices,
  buildKernelOptions,
} from './assemble.js'

export {
  WIRE_NS,
  XSD_NS,
  RDF_TYPE,
  graphSubject,
  workspaceProjectionGraphIri,
  documentSubject,
  documentRefUri,
  blockRefUri,
  wireRefUri,
  wirePredicateUri,
  escapeLiteral,
} from './sparql-terms.js'

export {
  createDocumentSnapshotService,
  type DocumentSnapshotService,
  type DocumentSnapshotListResult,
  type DocumentSnapshotTransport,
} from './document-snapshot-service.js'

export {
  createWorkspaceCatalogService,
  createAccessGrantService,
  WorkspaceGatewayHttpError,
  type WorkspaceGatewayTransport,
  type WorkspaceGraphRole,
  type WorkspaceGraphCellState,
  type WorkspaceCatalogEntry,
  type WorkspaceCatalogService,
  type AccessGrantEntry,
  type PutAccessGrantRequest,
  type AccessGrantService,
} from './workspace-gateway-service.js'
