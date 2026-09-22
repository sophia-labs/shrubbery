/**
 * flow-vocab.ts — the Mithras Flow table→class→predicate map (unit S5,
 * FLOW-SHRUB-1a), implemented INDEPENDENTLY from `contracts/vocabulary-map.md`
 * (G1's output — the SAME map the gardend cell's `flow` Emporium pack and its
 * `:projection:flow` materializer implement; the integration seat diffs the
 * two turtles, interfaces.md §G).
 *
 * One entry per Flow DDL table (13 — `flow:Snapshot` is the JSON envelope,
 * not a table, and is out of scope), in Flow's own `emptyModel()` order.
 * Geometry columns (`x`/`y`/`width`/`height` and `waypoints` — the 14 fields
 * interfaces.md §C names) are NEVER predicates here: they live in the board
 * Y.Doc's `scene` root and never reach `:projection:flow`. `display_mode`,
 * `parent_id` and `sort_order` ARE resource facts (§C is explicit) and are
 * materialized. Predicate order = `sh:order` = the DDL column order.
 *
 * The three RTRIP-11 renames are carried: `requirements.source` →
 * `flow:requirementSource` (#1, the flow:source/flow:Source case collision),
 * `sources.text` → `flow:sourceCitation` (#2), `trades.description` →
 * `flow:tradeRationale` (#3).
 *
 * Pure data — no DOM, no network, no app imports.
 */

import type { FlowTableName } from './target.js'

/** The four datatypes this pack uses (RTRIP-6: integer, never long/double). */
export type FlowDatatype = 'uri' | 'string' | 'integer' | 'boolean'

/** One materialized predicate: CURIE local name, DDL source column, datatype. */
export interface FlowPredicateSpec {
  /** The CURIE local name under `flow:` (FLOW_NS). */
  readonly local: string
  /** The DDL column this predicate reads from. */
  readonly column: string
  readonly datatype: FlowDatatype
}

/** One Flow table: DDL name, the RDF class's two spellings, its predicates. */
export interface FlowTableSpec {
  /** The literal SQL/DDL table name (also the FlowBoardRows key). */
  readonly ddl: FlowTableName
  /** The kebab path segment of the subject rule (`…:workflow-link:{id}`). */
  readonly kebab: string
  /** The PascalCase CURIE local name of the class (`flow:WorkflowLink`). */
  readonly pascal: string
  readonly predicates: readonly FlowPredicateSpec[]
}

const p = (local: string, column: string, datatype: FlowDatatype): FlowPredicateSpec => ({
  local,
  column,
  datatype,
})

/**
 * The 13 tables in `emptyModel()` order. NOTE: table `deps` carries the class
 * `Dependency` (vocabulary-map.md § flow:Dependency), and the three-word
 * tables are snake_case here (the DDL spelling), not the JSON file's camelCase.
 */
export const FLOW_TABLES: readonly FlowTableSpec[] = [
  {
    ddl: 'systems',
    kebab: 'system',
    pascal: 'System',
    predicates: [
      p('parent', 'parent_id', 'uri'),
      p('name', 'name', 'string'),
      p('description', 'description', 'string'),
      p('displayMode', 'display_mode', 'string'),
      p('color', 'color', 'string'),
    ],
  },
  {
    ddl: 'requirements',
    kebab: 'requirement',
    pascal: 'Requirement',
    predicates: [
      p('ownedBy', 'system_id', 'uri'),
      p('text', 'text', 'string'),
      p('requirementSource', 'source', 'string'),
      p('status', 'status', 'string'),
      p('sortOrder', 'sort_order', 'integer'),
      p('startDate', 'start_date', 'string'),
      p('dueDate', 'due_date', 'string'),
      p('durationDays', 'duration_days', 'integer'),
    ],
  },
  {
    ddl: 'tasks',
    kebab: 'task',
    pascal: 'Task',
    predicates: [
      p('ownerType', 'owner_type', 'string'),
      p('ownedBy', 'owner_id', 'uri'),
      p('text', 'text', 'string'),
      p('done', 'done', 'boolean'),
      p('sortOrder', 'sort_order', 'integer'),
      p('startDate', 'start_date', 'string'),
      p('dueDate', 'due_date', 'string'),
      p('durationDays', 'duration_days', 'integer'),
    ],
  },
  {
    ddl: 'workflows',
    kebab: 'workflow',
    pascal: 'Workflow',
    predicates: [p('name', 'name', 'string'), p('description', 'description', 'string')],
  },
  {
    ddl: 'workflow_links',
    kebab: 'workflow-link',
    pascal: 'WorkflowLink',
    predicates: [
      p('workflow', 'workflow_id', 'uri'),
      p('system', 'system_id', 'uri'),
      p('role', 'role', 'string'),
    ],
  },
  {
    ddl: 'outcomes',
    kebab: 'outcome',
    pascal: 'Outcome',
    predicates: [
      p('workflow', 'workflow_id', 'uri'),
      p('text', 'text', 'string'),
      p('achieved', 'achieved', 'boolean'),
      p('sortOrder', 'sort_order', 'integer'),
    ],
  },
  {
    ddl: 'trades',
    kebab: 'trade',
    pascal: 'Trade',
    predicates: [
      p('name', 'name', 'string'),
      p('tradeRationale', 'description', 'string'),
      p('winner', 'winner_id', 'uri'),
    ],
  },
  {
    ddl: 'trade_links',
    kebab: 'trade-link',
    pascal: 'TradeLink',
    predicates: [p('trade', 'trade_id', 'uri'), p('system', 'system_id', 'uri')],
  },
  {
    ddl: 'constraints',
    kebab: 'constraint',
    pascal: 'Constraint',
    predicates: [p('name', 'name', 'string'), p('description', 'description', 'string')],
  },
  {
    ddl: 'constraint_links',
    kebab: 'constraint-link',
    pascal: 'ConstraintLink',
    predicates: [
      p('constraint', 'constraint_id', 'uri'),
      p('target', 'target_id', 'uri'),
      p('note', 'note', 'string'),
    ],
  },
  {
    ddl: 'sources',
    kebab: 'source',
    pascal: 'Source',
    predicates: [
      p('ownedBy', 'owner_id', 'uri'),
      p('sourceCitation', 'text', 'string'),
      p('sortOrder', 'sort_order', 'integer'),
    ],
  },
  {
    ddl: 'edges',
    kebab: 'edge',
    pascal: 'Edge',
    predicates: [
      p('sourceNode', 'source_id', 'uri'),
      p('targetNode', 'target_id', 'uri'),
      p('label', 'label', 'string'),
    ],
  },
  {
    ddl: 'deps',
    kebab: 'dependency',
    pascal: 'Dependency',
    predicates: [p('predecessor', 'predecessor_id', 'uri'), p('successor', 'successor_id', 'uri')],
  },
]
