/**
 * The workflow-graph plan (`graph-plan-v1`), read in the browser: a workflow whose definition is a named RDF graph.
 *
 * This is the same closed grammar and the same compiler as Choreograph's `src/workflow/graph-plan.ts` (2026-10-18),
 * so the main pane can draw exactly what will run and show the digest a person approves. If the two ever drift, the
 * digests differ and Choreograph refuses the run: the failure is loud, never a silent mismatch. Extract one shared
 * package when a third consumer appears.
 */
import { sha256Digest } from '@shrubbery/nucleus/web-crypto'

export const GRAPH_PLAN_WORKFLOW_NAME = "graph-plan-v1";
export const GRAPH_PLAN_SCHEMA = "sophia.graph-plan.v1" as const;
export const WF = "http://mnemosyne.dev/workflow#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DCT_TITLE = "http://purl.org/dc/terms/title";

export const GRAPH_PLAN_LIMITS = Object.freeze({
  phases: 6,
  steps: 12,
  sources: 6,
  destinations: 4,
  instructionsChars: 4000,
  schemaChars: 4000,
  itemsPerCollection: 200,
});

export type Term =
  | { readonly kind: "iri"; readonly value: string }
  | { readonly kind: "literal"; readonly value: string; readonly datatype?: string; readonly lang?: string }
  | { readonly kind: "blank"; readonly value: string };

export interface Triple {
  readonly s: string;
  readonly p: string;
  readonly o: Term;
}

export interface GraphPlanStepV1 {
  readonly iri: string;
  readonly id: string;
  readonly label: string;
  readonly job: string;
  readonly instructions: string;
  readonly mode: "once" | "perItem";
  readonly over?: string;
  readonly consumes: readonly string[];
  readonly produces?: string;
  readonly checks?: string;
  readonly itemSchema?: Record<string, unknown>;
  /** The sources (`wf:Source` IRIs) the step reads, sorted; absent when it reads none. */
  readonly reads?: readonly string[];
}

/** What a workflow reads: a document of this workspace, or a run of its blocks. */
export interface GraphPlanSourceV1 {
  readonly iri: string;
  readonly id: string;
  readonly label: string;
  readonly documentId: string;
  readonly fromBlock?: string;
  readonly toBlock?: string;
}

/** Where a workflow's results go when a person publishes them. One kind in v1: comments in a document's margin. */
export interface GraphPlanDestinationV1 {
  readonly iri: string;
  readonly id: string;
  readonly label: string;
  readonly kind: "margin";
  /** The collection it receives. */
  readonly receives: string;
  /** The document whose margin, for findings that name no `documentId` of their own. */
  readonly documentId?: string;
}

export interface GraphPlanPhaseV1 {
  readonly iri: string;
  readonly title: string;
  readonly order: number;
  readonly steps: readonly GraphPlanStepV1[];
}

export interface GraphPlanV1 {
  readonly schema: typeof GRAPH_PLAN_SCHEMA;
  readonly workflow: string;
  readonly name: string;
  readonly title: string;
  readonly phases: readonly GraphPlanPhaseV1[];
  /** Sorted by IRI; absent when there are none. */
  readonly sources?: readonly GraphPlanSourceV1[];
  /** Sorted by IRI; absent when there are none. */
  readonly destinations?: readonly GraphPlanDestinationV1[];
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const BLOCK_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export class GraphPlanError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the workflow graph is not a runnable plan: ${problems.join("; ")}`);
    this.name = "GraphPlanError";
  }
}

/** The one read of a definition: every triple of one named graph, nothing else. */
export function definitionQuery(definitionGraphIri: string): string {
  assertIri(definitionGraphIri, "definition graph");
  return `SELECT ?s ?p ?o WHERE { GRAPH <${definitionGraphIri}> { ?s ?p ?o } }`;
}

export function assertIri(value: string, what: string): void {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(value)) {
    throw new GraphPlanError([`${what} is not an IRI: ${JSON.stringify(value)}`]);
  }
}

/** Parse one N-Triples term as gardend's `sparql_query` rows carry it (`<iri>`, `"lit"^^<dt>`, `"lit"@en`, `_:b`). */
export function parseTerm(raw: string): Term {
  const text = raw.trim();
  if (text.startsWith("<") && text.endsWith(">")) return { kind: "iri", value: text.slice(1, -1) };
  if (text.startsWith("_:")) return { kind: "blank", value: text.slice(2) };
  if (text.startsWith('"')) {
    let i = 1;
    let value = "";
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        const next = text[i + 1];
        const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\", b: "\b", f: "\f", "'": "'" };
        if (next === "u" || next === "U") {
          const len = next === "u" ? 4 : 8;
          value += String.fromCodePoint(Number.parseInt(text.slice(i + 2, i + 2 + len), 16));
          i += 2 + len;
          continue;
        }
        value += simple[next] ?? next;
        i += 2;
        continue;
      }
      value += text[i];
      i += 1;
    }
    const rest = text.slice(i + 1);
    if (rest.startsWith("^^<") && rest.endsWith(">")) return { kind: "literal", value, datatype: rest.slice(3, -1) };
    if (rest.startsWith("@")) return { kind: "literal", value, lang: rest.slice(1) };
    return { kind: "literal", value };
  }
  // A bare token (some SPARQL faces print plain literals unquoted): keep it as a literal.
  return { kind: "literal", value: text };
}

/** Accept the shapes a `sparql_query` tool result arrives in (structuredContent, a text part, or the rows themselves). */
export function triplesFromSparqlResult(result: unknown): Triple[] {
  const rows = findRows(result);
  if (!rows) throw new GraphPlanError(["the graph answered something that is not a SELECT result"]);
  const triples: Triple[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const s = typeof row.s === "string" ? parseTerm(row.s) : undefined;
    const p = typeof row.p === "string" ? parseTerm(row.p) : undefined;
    const o = typeof row.o === "string" ? parseTerm(row.o) : undefined;
    if (!s || !p || !o || s.kind === "literal" || p.kind !== "iri") continue;
    triples.push({ s: s.kind === "blank" ? `_:${s.value}` : s.value, p: p.value, o });
  }
  return triples;
}

function findRows(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.rows)) return value.rows;
  if (isRecord(value.structuredContent)) return findRows(value.structuredContent);
  if (isRecord(value.result)) return findRows(value.result);
  if (Array.isArray(value.content)) {
    for (const part of value.content) {
      if (isRecord(part) && typeof part.text === "string") {
        try {
          const parsed = findRows(JSON.parse(part.text));
          if (parsed) return parsed;
        } catch {
          // not JSON; keep looking
        }
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compile a definition graph's triples into a plan, or refuse with every problem found. */
export function compileGraphPlan(triples: readonly Triple[]): GraphPlanV1 {
  const problems: string[] = [];
  const bySubject = new Map<string, Triple[]>();
  for (const t of triples) {
    if (t.s.startsWith("_:") || t.o.kind === "blank") {
      problems.push("blank nodes are not allowed in a workflow definition; name every subject");
      continue;
    }
    const list = bySubject.get(t.s) ?? [];
    list.push(t);
    bySubject.set(t.s, list);
  }
  const typed = (cls: string) =>
    [...bySubject.entries()]
      .filter(([, ts]) => ts.some((t) => t.p === RDF_TYPE && t.o.kind === "iri" && t.o.value === WF + cls))
      .map(([s]) => s)
      .sort();
  const one = (s: string, p: string, what: string): Term | undefined => {
    const values = (bySubject.get(s) ?? []).filter((t) => t.p === p).map((t) => t.o);
    if (values.length > 1) problems.push(`${short(s)} has ${values.length} ${what}; it needs exactly one`);
    return values[0];
  };
  const literal = (s: string, p: string, what: string, required: boolean): string | undefined => {
    const term = one(s, p, what);
    if (!term) {
      if (required) problems.push(`${short(s)} has no ${what}`);
      return undefined;
    }
    if (term.kind !== "literal") {
      problems.push(`${short(s)}'s ${what} must be text, not ${term.value}`);
      return undefined;
    }
    return term.value;
  };
  const iriOf = (s: string, p: string, what: string, required: boolean): string | undefined => {
    const term = one(s, p, what);
    if (!term) {
      if (required) problems.push(`${short(s)} has no ${what}`);
      return undefined;
    }
    if (term.kind !== "iri") {
      problems.push(`${short(s)}'s ${what} must be an IRI, not "${term.value}"`);
      return undefined;
    }
    return term.value;
  };
  const iris = (s: string, p: string): string[] =>
    (bySubject.get(s) ?? []).filter((t) => t.p === p && t.o.kind === "iri").map((t) => t.o.value).sort();

  const workflows = typed("Workflow");
  if (workflows.length !== 1) {
    problems.push(`a definition holds exactly one wf:Workflow; this one holds ${workflows.length}`);
    throw new GraphPlanError(problems);
  }
  const workflow = workflows[0];
  const name = literal(workflow, `${WF}name`, "wf:name", true) ?? "";
  const title = literal(workflow, DCT_TITLE, "dcterms:title", false) ?? name;

  const phaseIris = typed("Phase").filter((p) => iris(p, `${WF}partOfWorkflow`).includes(workflow));
  for (const orphan of typed("Phase").filter((p) => !phaseIris.includes(p))) {
    problems.push(`${short(orphan)} is a phase of no workflow here (wf:partOfWorkflow)`);
  }
  if (phaseIris.length === 0) problems.push("the workflow has no phases");
  if (phaseIris.length > GRAPH_PLAN_LIMITS.phases) problems.push(`at most ${GRAPH_PLAN_LIMITS.phases} phases`);
  const phases = phaseIris.map((p) => {
    const orderText = literal(p, `${WF}order`, "wf:order", true);
    const order = orderText === undefined ? Number.NaN : Number(orderText);
    if (orderText !== undefined && !Number.isInteger(order)) problems.push(`${short(p)}'s wf:order must be a whole number`);
    return { iri: p, title: literal(p, DCT_TITLE, "dcterms:title", false) ?? short(p), order };
  });
  const orders = phases.map((p) => p.order).filter((o) => Number.isInteger(o));
  if (new Set(orders).size !== orders.length) problems.push("two phases share a wf:order");
  phases.sort((a, b) => a.order - b.order);
  const phaseIndex = new Map(phases.map((p, i) => [p.iri, i]));

  const stepIris = typed("AgentNode");
  if (stepIris.length === 0) problems.push("the workflow has no steps (wf:AgentNode)");
  if (stepIris.length > GRAPH_PLAN_LIMITS.steps) problems.push(`at most ${GRAPH_PLAN_LIMITS.steps} steps`);
  const producedBy = new Map<string, { step: string; phase: number }>();
  const steps = stepIris.map((s) => {
    const phase = iriOf(s, `${WF}inPhase`, "wf:inPhase", true);
    if (phase && !phaseIndex.has(phase)) problems.push(`${short(s)} is in ${short(phase)}, which is not a phase of this workflow`);
    const label = literal(s, `${WF}label`, "wf:label", true) ?? short(s);
    const job = literal(s, `${WF}agentType`, "wf:agentType", false) ?? "agent";
    const instructions = literal(s, `${WF}instructions`, "wf:instructions", true) ?? "";
    if (instructions.length > GRAPH_PLAN_LIMITS.instructionsChars) {
      problems.push(`${short(s)}'s instructions are longer than ${GRAPH_PLAN_LIMITS.instructionsChars} characters`);
    }
    const checks = iriOf(s, `${WF}checks`, "wf:checks", false);
    const modeText = literal(s, `${WF}mode`, "wf:mode", false) ?? (checks ? "perItem" : "once");
    if (modeText !== "once" && modeText !== "perItem") problems.push(`${short(s)}'s wf:mode is "${modeText}"; use "once" or "perItem"`);
    const mode: "once" | "perItem" = modeText === "perItem" ? "perItem" : "once";
    let over = iriOf(s, `${WF}over`, "wf:over", false);
    if (checks) {
      if (mode !== "perItem") problems.push(`${short(s)} checks a collection, so it runs once per item`);
      if (over && over !== checks) problems.push(`${short(s)} checks ${short(checks)} but runs over ${short(over)}`);
      over = checks;
    }
    if (mode === "perItem" && !over) problems.push(`${short(s)} runs per item but names no collection (wf:over)`);
    const consumes = iris(s, `${WF}consumes`);
    const reads = iris(s, `${WF}reads`);
    const produces = iriOf(s, `${WF}produces`, "wf:produces", !checks);
    const schemaText = literal(s, `${WF}itemSchema`, "wf:itemSchema", !checks);
    let itemSchema: Record<string, unknown> | undefined;
    if (schemaText !== undefined) {
      if (schemaText.length > GRAPH_PLAN_LIMITS.schemaChars) problems.push(`${short(s)}'s item schema is too long`);
      try {
        const parsed: unknown = JSON.parse(schemaText);
        if (!isRecord(parsed)) throw new Error("not an object");
        itemSchema = parsed;
      } catch {
        problems.push(`${short(s)}'s wf:itemSchema is not a JSON Schema object`);
      }
    }
    if (produces) {
      const prior = producedBy.get(produces);
      if (prior) problems.push(`${short(produces)} is produced by both ${short(prior.step)} and ${short(s)}`);
      producedBy.set(produces, { step: s, phase: phase ? (phaseIndex.get(phase) ?? -1) : -1 });
    }
    return {
      iri: s,
      id: localId(s),
      label,
      job,
      instructions,
      mode,
      ...(over ? { over } : {}),
      consumes,
      ...(produces ? { produces } : {}),
      ...(checks ? { checks } : {}),
      ...(itemSchema ? { itemSchema } : {}),
      ...(reads.length > 0 ? { reads } : {}),
      phase: phase ?? "",
    };
  });
  for (const step of steps) {
    const at = phaseIndex.get(step.phase) ?? -1;
    for (const read of [...(step.over ? [step.over] : []), ...step.consumes]) {
      const source = producedBy.get(read);
      if (!source) problems.push(`${short(step.iri)} reads ${short(read)}, which no step produces`);
      else if (source.phase >= at) problems.push(`${short(step.iri)} reads ${short(read)} before an earlier phase has produced it`);
    }
  }
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) problems.push("two steps share a local name; give each step its own IRI fragment");

  const sourceIris = typed("Source");
  if (sourceIris.length > GRAPH_PLAN_LIMITS.sources) problems.push(`at most ${GRAPH_PLAN_LIMITS.sources} sources`);
  const sources: GraphPlanSourceV1[] = sourceIris.map((s) => {
    const label = literal(s, `${WF}label`, "wf:label", true) ?? short(s);
    const documentId = literal(s, `${WF}documentId`, "wf:documentId", true);
    if (documentId !== undefined && !DOCUMENT_ID.test(documentId)) problems.push(`${short(s)}'s wf:documentId is not a document id`);
    const block = (name: "fromBlock" | "toBlock"): string | undefined => {
      const value = literal(s, `${WF}${name}`, `wf:${name}`, false);
      if (value !== undefined && !BLOCK_ID.test(value)) problems.push(`${short(s)}'s wf:${name} is not a block id`);
      return value;
    };
    const fromBlock = block("fromBlock");
    const toBlock = block("toBlock");
    return { iri: s, id: localId(s), label, documentId: documentId ?? "", ...(fromBlock ? { fromBlock } : {}), ...(toBlock ? { toBlock } : {}) };
  });
  for (const step of steps) {
    for (const read of step.reads ?? []) {
      if (!sourceIris.includes(read)) problems.push(`${short(step.iri)} reads ${short(read)}, which is not a source of this workflow (wf:Source)`);
    }
  }

  const destinationIris = typed("Destination");
  if (destinationIris.length > GRAPH_PLAN_LIMITS.destinations) problems.push(`at most ${GRAPH_PLAN_LIMITS.destinations} destinations`);
  const destinations: GraphPlanDestinationV1[] = destinationIris.map((d) => {
    const label = literal(d, `${WF}label`, "wf:label", true) ?? short(d);
    const kind = literal(d, `${WF}kind`, "wf:kind", true);
    if (kind !== undefined && kind !== "margin") problems.push(`${short(d)}'s wf:kind is "${kind}"; use "margin"`);
    const receives = iriOf(d, `${WF}receives`, "wf:receives", true);
    if (receives && !producedBy.has(receives)) problems.push(`${short(d)} receives ${short(receives)}, which no step produces`);
    const documentId = literal(d, `${WF}documentId`, "wf:documentId", false);
    if (documentId !== undefined && !DOCUMENT_ID.test(documentId)) problems.push(`${short(d)}'s wf:documentId is not a document id`);
    return { iri: d, id: localId(d), label, kind: "margin" as const, receives: receives ?? "", ...(documentId ? { documentId } : {}) };
  });
  if (problems.length > 0) throw new GraphPlanError([...new Set(problems)]);

  return {
    schema: GRAPH_PLAN_SCHEMA,
    workflow,
    name,
    title,
    phases: phases.map((p) => ({
      iri: p.iri,
      title: p.title,
      order: p.order,
      steps: steps
        .filter((s) => s.phase === p.iri)
        .map(({ phase: _phase, ...step }) => step)
        .sort((a, b) => a.iri.localeCompare(b.iri)),
    })),
    ...(sources.length > 0 ? { sources } : {}),
    ...(destinations.length > 0 ? { destinations } : {}),
  };
}

/** The digest a run pins: sha256 over the canonical JSON of the compiled plan (Choreograph computes the same). */
export async function graphPlanDigest(plan: GraphPlanV1): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(plan))
  const hash = new Uint8Array(await sha256Digest(bytes))
  return `sha256:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Sorted-key JSON, byte for byte as `@sophia-labs/canonical-json` writes it. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined || typeof item === 'function' ? 'null' : canonicalJson(item))).join(',')}]`
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(object).sort()) {
      const item = object[key]
      if (item === undefined || typeof item === 'function') continue
      entries.push(`${JSON.stringify(key)}:${canonicalJson(item)}`)
    }
    return `{${entries.join(',')}}`
  }
  return 'null'
}

/** The output schema a step's agent must answer: an object holding its items, or a check's verdict. */
export function stepOutputSchema(step: GraphPlanStepV1): Record<string, unknown> {
  if (step.checks) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: {
        ok: { type: "boolean" },
        reason: { type: "string" },
        nearest: { type: "string" },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: { type: "array", maxItems: GRAPH_PLAN_LIMITS.itemsPerCollection, items: step.itemSchema ?? { type: "object" } },
    },
  };
}

export function localId(iri: string): string {
  const tail = iri.split(/[#/:]/).filter(Boolean).pop() ?? iri;
  return tail.replace(/[^A-Za-z0-9_-]/g, "_");
}

function short(iri: string): string {
  return localId(iri);
}

// ── The main pane's reads and the one write it starts (a run) ─────────────────────────────────────────────────────

/** What the pane needs of the gardend REST face: `LoopbackRestClient.query`. */
export interface GraphPlanReader {
  query(graphId: string, sparql: string): Promise<unknown>
}

export interface LoadedGraphPlan {
  readonly plan: GraphPlanV1 | null
  readonly problems: readonly string[]
  readonly digest: string | null
  readonly tripleCount: number
}

/** Read one definition graph and compile it. A definition that does not compile comes back with its problems. */
export async function loadGraphPlan(rest: GraphPlanReader, graphId: string, definition: string): Promise<LoadedGraphPlan> {
  const triples = triplesFromSparqlResult(await rest.query(graphId, definitionQuery(definition)))
  if (triples.length === 0) return { plan: null, problems: ['the definition graph is empty'], digest: null, tripleCount: 0 }
  try {
    const plan = compileGraphPlan(triples)
    return { plan, problems: [], digest: await graphPlanDigest(plan), tripleCount: triples.length }
  } catch (error) {
    if (error instanceof GraphPlanError) return { plan: null, problems: error.problems, digest: null, tripleCount: triples.length }
    throw error
  }
}

export interface GraphPlanService {
  readonly origin: string
  readonly token: string | undefined
  /** Where gardend mounts its Choreograph (`/services/choreograph`). */
  readonly mount: string
}

function serviceHeaders(service: GraphPlanService): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (service.token) headers.Authorization = `Bearer ${service.token}`
  return headers
}

/** Start a run of exactly the plan the person approved (its digest). Choreograph refuses any other. */
export async function startGraphPlanRun(
  service: GraphPlanService,
  input: {
    readonly graphId: string
    readonly graphOwner: string
    readonly definition: string
    readonly digest: string
    readonly inputs: Record<string, unknown>
  },
): Promise<string> {
  const response = await fetch(`${service.origin}${service.mount}/api/workflows/run`, {
    method: 'POST',
    headers: serviceHeaders(service),
    body: JSON.stringify({
      workflow_name: GRAPH_PLAN_WORKFLOW_NAME,
      graph_id: input.graphId,
      graph_owner: input.graphOwner,
      workflow_args: { definition: input.definition, digest: input.digest, inputs: input.inputs },
    }),
  })
  const body = (await response.json().catch(() => ({}))) as { runId?: unknown; error?: { message?: unknown } }
  if (!response.ok || typeof body.runId !== 'string') {
    const message = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`
    throw new Error(`the run did not start: ${message}`)
  }
  return body.runId
}

export interface GraphPlanRunProgress {
  readonly status: string
  /** Per step label (without its ` #n` item suffix): finished and failed agent nodes. */
  readonly byLabel: ReadonlyMap<string, { readonly done: number; readonly failed: number; readonly started: number }>
  /** Every agent of the run, in the order they were queued (the full view of a person lists theirs). */
  readonly agents: readonly GraphPlanAgentRun[]
}

export async function readGraphPlanRun(service: GraphPlanService, runId: string): Promise<GraphPlanRunProgress> {
  const response = await fetch(`${service.origin}${service.mount}/api/workflows/runs/${encodeURIComponent(runId)}`, {
    headers: serviceHeaders(service),
  })
  if (!response.ok) throw new Error(`the run could not be read: HTTP ${response.status}`)
  const body = (await response.json()) as { header?: { status?: string }; events?: readonly RunEvent[] }
  const events = body.events ?? []
  return { status: body.header?.status ?? 'unknown', byLabel: stepTallies(events), agents: agentRuns(events) }
}

export interface RunEvent {
  readonly type?: string
  readonly label?: string | null
  /** Milliseconds since the epoch. */
  readonly ts?: number
  readonly payload?: unknown
}

/**
 * One agent of a run, as its events tell it (2026-10-20, the full view of a person): a step's agent for one item
 * (`<step> #<n>`), or a once step's only agent (`<step>`). An agent asked once more (`… again`) is the same agent: its
 * last word counts and its tool calls add up.
 */
export interface GraphPlanAgentRun {
  readonly label: string
  /** The step's label, as the plan names it. */
  readonly step: string
  /** The item it worked, 1-based; null for a once step. */
  readonly n: number | null
  readonly state: 'queued' | 'running' | 'done' | 'failed'
  readonly attempts: number
  readonly queuedAt: number | null
  readonly startedAt: number | null
  readonly endedAt: number | null
  readonly model: string | null
  readonly turns: number | null
  readonly tokens: number | null
  readonly tools: readonly { readonly gate: string; readonly args: unknown; readonly at: number | null }[]
  /** What it handed back: its structured output, else its output text (JSON when it parses). */
  readonly output: unknown
  /** Why it failed, in the runtime's words. */
  readonly error: string | null
}

export function agentRuns(events: readonly RunEvent[]): GraphPlanAgentRun[] {
  type Mutable = { -readonly [K in keyof GraphPlanAgentRun]: GraphPlanAgentRun[K] } & { tools: GraphPlanAgentRun['tools'][number][] }
  const agents = new Map<string, Mutable>()
  for (const event of events) {
    if (!event.label) continue
    const label = event.label.replace(/ again$/, '')
    const payload = isRecord(event.payload) ? event.payload : {}
    const at = typeof event.ts === 'number' ? event.ts : null
    let agent = agents.get(label)
    if (!agent) {
      const n = /#(\d+)$/.exec(label)
      agent = {
        label, step: label.replace(/ #\d+$/, ''), n: n ? Number(n[1]) : null, state: 'queued', attempts: 0,
        queuedAt: null, startedAt: null, endedAt: null, model: null, turns: null, tokens: null, tools: [], output: null, error: null,
      }
      agents.set(label, agent)
    }
    switch (event.type) {
      case 'node_queued':
        agent.queuedAt ??= at
        if (typeof payload.model === 'string') agent.model = payload.model
        break
      case 'node_started':
        agent.attempts += 1
        agent.startedAt ??= at
        agent.state = 'running'
        agent.endedAt = null
        break
      case 'tool_call':
        if (typeof payload.gate === 'string') agent.tools.push({ gate: payload.gate, args: payload.args ?? null, at })
        break
      case 'node_done':
      case 'error': {
        const failed = event.type === 'error' || payload.status === 'error'
        agent.state = failed ? 'failed' : 'done'
        agent.endedAt = at
        if (typeof payload.turns === 'number') agent.turns = (agent.turns ?? 0) + payload.turns
        if (typeof payload.tokens === 'number') agent.tokens = (agent.tokens ?? 0) + payload.tokens
        const text = typeof payload.output === 'string' ? payload.output : null
        agent.error = failed ? (text ?? (typeof payload.message === 'string' ? payload.message : 'It failed.')) : null
        if (!failed) agent.output = payload.structured_output ?? parsedOrText(text)
        break
      }
    }
  }
  return [...agents.values()].filter((agent) => agent.queuedAt !== null || agent.startedAt !== null)
}

function parsedOrText(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Per step, how its items stand, from the run's events in order. An item is one node (`<step> #<n>`); a step that
 * answered without submit() is asked once more as `<step> #<n> again`, and the item's last word is what counts, so a
 * recovered item reads done, not failed.
 */
export function stepTallies(events: readonly RunEvent[]): Map<string, { done: number; failed: number; started: number }> {
  const items = new Map<string, { step: string; state: 'running' | 'done' | 'failed' }>()
  for (const event of events) {
    if (!event.label || !['node_started', 'node_done', 'error'].includes(event.type ?? '')) continue
    const item = event.label.replace(/ again$/, '')
    const state = event.type === 'node_started' ? 'running' : event.type === 'node_done' ? 'done' : 'failed'
    items.set(item, { step: item.replace(/ #\d+$/, ''), state })
  }
  const byLabel = new Map<string, { done: number; failed: number; started: number }>()
  for (const { step, state } of items.values()) {
    const counts = byLabel.get(step) ?? { done: 0, failed: 0, started: 0 }
    counts.started += 1
    if (state === 'done') counts.done += 1
    if (state === 'failed') counts.failed += 1
    byLabel.set(step, counts)
  }
  return byLabel
}

export interface GraphPlanResults {
  readonly items: readonly { readonly collection: string; readonly value: unknown }[]
  readonly refused: readonly { readonly step: string; readonly item: unknown; readonly verdict: unknown }[]
}

/** What a finished run testified, read back from its own named graph. */
export async function loadGraphPlanResults(rest: GraphPlanReader, graphId: string, runGraph: string): Promise<GraphPlanResults> {
  assertIri(runGraph, 'run graph')
  const query = `PREFIX wf: <${WF}> SELECT ?kind ?collection ?json ?verdict ?step ?position WHERE { GRAPH <${runGraph}> { ?x a ?kind . OPTIONAL { ?x wf:inCollection ?collection } OPTIONAL { ?x wf:json ?json } OPTIONAL { ?x wf:verdict ?verdict } OPTIONAL { ?x wf:checkedBy ?step } OPTIONAL { ?x wf:position ?position } } }`
  const rows = findRows(await rest.query(graphId, query)) ?? []
  const items: { collection: string; value: unknown; position: number }[] = []
  const refused: { step: string; item: unknown; verdict: unknown }[] = []
  const text = (raw: unknown): string | undefined => (typeof raw === 'string' ? parseTerm(raw).value : undefined)
  const json = (raw: unknown): unknown => {
    const value = text(raw)
    if (value === undefined) return null
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  for (const row of rows) {
    if (!isRecord(row)) continue
    const kind = text(row.kind)
    if (kind === `${WF}Item`) {
      items.push({ collection: text(row.collection) ?? '', value: json(row.json), position: Number(text(row.position) ?? 0) })
    } else if (kind === `${WF}Refusal`) {
      refused.push({ step: text(row.step) ?? '', item: json(row.json), verdict: json(row.verdict) })
    }
  }
  items.sort((a, b) => a.collection.localeCompare(b.collection) || a.position - b.position)
  return { items, refused }
}

/**
 * A finding a person may publish as a comment on a document: the run found it, the person decides it goes in the
 * margin (Vera, 2026-10-18: findings live in the run's graph until an explicit publish). By convention, not grammar: any
 * item of the plan's last collection that names the `documentId` it is about, the exact `quote` it rests on and the
 * `note` to write beside it (and, when the plan read blocks, the `blockId` that holds the quote).
 */
export interface PublishableFinding {
  readonly documentId: string
  readonly quote: string
  readonly note: string
  readonly blockId?: string
}

export function publishableFindings(values: readonly unknown[]): PublishableFinding[] {
  const out: PublishableFinding[] = []
  for (const value of values) {
    if (!isRecord(value)) continue
    const { documentId, quote, note, blockId } = value as Record<string, unknown>
    if (typeof documentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(documentId)) continue
    if (typeof quote !== 'string' || !quote.trim()) continue
    const text = typeof note === 'string' && note.trim() ? note.trim() : composedNote(value)
    if (!text) continue
    out.push({ documentId, quote: quote.trim(), note: text, ...(typeof blockId === 'string' && blockId ? { blockId } : {}) })
  }
  return out
}

/**
 * The note for a finding that has none (2026-10-19: Sophia's clerks answer `{who, whatDone, dream, quote}`): its other
 * text fields in its own order, "<key as words>: <value>", joined with "; ", at most 600 characters. gardend's
 * `workflow_plan_publish` writes exactly this, so the count here is the count there.
 */
export function composedNote(value: Record<string, unknown>): string {
  const skip = new Set(['quote', 'documentId', 'blockId', 'note'])
  const words = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim()
  const parts = Object.entries(value)
    .filter(([key, v]) => !skip.has(key) && typeof v === 'string' && v.trim())
    .map(([key, v]) => `${words(key)}: ${(v as string).trim()}`)
  return [...parts.join('; ')].slice(0, 600).join('')
}

/** A stable comment id per run and finding: publishing a run twice updates its comments, never doubles them. */
export function findingCommentId(runId: string, index: number): string {
  return `wf-${runId.replace(/[^A-Za-z0-9_-]/g, '_')}-${index + 1}`
}

/**
 * The workflow's latest run, read from the runs' own graphs (each run testifies `wf:GraphPlanRun` with its id and
 * status). Run ids begin with a base-36 clock, so the greatest id is the latest run.
 */
export async function latestGraphPlanRun(
  rest: GraphPlanReader,
  graphId: string,
  workflow: string,
): Promise<{ runId: string; status: string } | null> {
  assertIri(workflow, 'workflow')
  const query = `PREFIX wf: <${WF}> SELECT ?runId ?status WHERE { GRAPH ?g { ?run a wf:GraphPlanRun ; wf:runId ?runId ; wf:status ?status ; wf:workflow <${workflow}> } } ORDER BY DESC(?runId) LIMIT 1`
  const row = (findRows(await rest.query(graphId, query)) ?? []).find(isRecord)
  if (!row) return null
  const text = (raw: unknown): string | undefined => (typeof raw === 'string' ? parseTerm(raw).value : undefined)
  const runId = text(row.runId)
  return runId ? { runId, status: text(row.status) ?? 'completed' } : null
}

// ── The plan as drawn: everything the graph says, runnable or not ─────────────────────────────────────────────────

/**
 * A lenient reading of a definition for the canvas: every source, step, collection and destination the graph names,
 * whether or not it compiles, so an unfinished plan is drawn as far as it goes and its problems sit on the parts they
 * name. What runs, and its digest, is still only ever `compileGraphPlan`'s.
 */
export interface GraphPlanSketch {
  readonly workflow: string | null
  readonly title: string | null
  readonly phases: readonly { readonly iri: string; readonly id: string; readonly title: string; readonly order: number | null }[]
  readonly steps: readonly {
    readonly iri: string
    readonly id: string
    readonly label: string
    readonly job: string
    readonly mode: 'once' | 'perItem'
    readonly instructions: string
    readonly phase: string | null
    readonly over: string | null
    readonly consumes: readonly string[]
    readonly checks: string | null
    readonly produces: string | null
    readonly reads: readonly string[]
    readonly itemSchema: Record<string, unknown> | null
  }[]
  readonly sources: readonly {
    readonly iri: string
    readonly id: string
    readonly label: string
    readonly documentId: string | null
    readonly fromBlock: string | null
    readonly toBlock: string | null
  }[]
  readonly destinations: readonly {
    readonly iri: string
    readonly id: string
    readonly label: string
    readonly kind: string | null
    readonly receives: string | null
    readonly documentId: string | null
  }[]
}

export function sketchGraphPlan(triples: readonly Triple[]): GraphPlanSketch {
  const bySubject = new Map<string, Triple[]>()
  for (const t of triples) {
    const list = bySubject.get(t.s) ?? []
    list.push(t)
    bySubject.set(t.s, list)
  }
  const typed = (cls: string): string[] =>
    [...bySubject.entries()]
      .filter(([, ts]) => ts.some((t) => t.p === RDF_TYPE && t.o.kind === 'iri' && t.o.value === WF + cls))
      .map(([s]) => s)
      .sort()
  const text = (s: string, p: string): string | null => {
    const term = (bySubject.get(s) ?? []).find((t) => t.p === p)?.o
    return term && term.kind === 'literal' ? term.value : null
  }
  const iri = (s: string, p: string): string | null => {
    const term = (bySubject.get(s) ?? []).find((t) => t.p === p)?.o
    return term && term.kind === 'iri' ? term.value : null
  }
  const iris = (s: string, p: string): string[] =>
    (bySubject.get(s) ?? []).filter((t) => t.p === p && t.o.kind === 'iri').map((t) => t.o.value).sort()
  const workflow = typed('Workflow')[0] ?? null
  const phases = typed('Phase')
    .map((p) => {
      const order = Number(text(p, `${WF}order`))
      return { iri: p, id: localId(p), title: text(p, DCT_TITLE) ?? localId(p), order: Number.isInteger(order) ? order : null }
    })
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.iri.localeCompare(b.iri))
  const steps = typed('AgentNode').map((s) => {
    const checks = iri(s, `${WF}checks`)
    let itemSchema: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(text(s, `${WF}itemSchema`) ?? 'null')
      if (isRecord(parsed)) itemSchema = parsed
    } catch {
      /* drawn without a shape; the compiler names the problem */
    }
    return {
      iri: s,
      id: localId(s),
      label: text(s, `${WF}label`) ?? localId(s),
      job: text(s, `${WF}agentType`) ?? 'agent',
      mode: (checks || text(s, `${WF}mode`) === 'perItem' ? 'perItem' : 'once') as 'once' | 'perItem',
      instructions: text(s, `${WF}instructions`) ?? '',
      phase: iri(s, `${WF}inPhase`),
      over: checks ?? iri(s, `${WF}over`),
      consumes: iris(s, `${WF}consumes`),
      checks,
      produces: iri(s, `${WF}produces`),
      reads: iris(s, `${WF}reads`),
      itemSchema,
    }
  })
  const sources = typed('Source').map((s) => ({
    iri: s,
    id: localId(s),
    label: text(s, `${WF}label`) ?? localId(s),
    documentId: text(s, `${WF}documentId`),
    fromBlock: text(s, `${WF}fromBlock`),
    toBlock: text(s, `${WF}toBlock`),
  }))
  const destinations = typed('Destination').map((d) => ({
    iri: d,
    id: localId(d),
    label: text(d, `${WF}label`) ?? localId(d),
    kind: text(d, `${WF}kind`),
    receives: iri(d, `${WF}receives`),
    documentId: text(d, `${WF}documentId`),
  }))
  return { workflow, title: workflow ? text(workflow, DCT_TITLE) ?? text(workflow, `${WF}name`) : null, phases, steps, sources, destinations }
}

/** Read one definition graph: what the canvas draws (the sketch) and, when it compiles, what runs (the plan and its digest). */
export async function loadGraphPlanSketch(
  rest: GraphPlanReader,
  graphId: string,
  definition: string,
): Promise<LoadedGraphPlan & { readonly sketch: GraphPlanSketch }> {
  const triples = triplesFromSparqlResult(await rest.query(graphId, definitionQuery(definition)))
  const sketch = sketchGraphPlan(triples)
  if (triples.length === 0) return { plan: null, problems: ['the definition graph is empty'], digest: null, tripleCount: 0, sketch }
  try {
    const plan = compileGraphPlan(triples)
    return { plan, problems: [], digest: await graphPlanDigest(plan), tripleCount: triples.length, sketch }
  } catch (error) {
    if (error instanceof GraphPlanError) return { plan: null, problems: error.problems, digest: null, tripleCount: triples.length, sketch }
    throw error
  }
}

/** One change to a workflow, from its authoring graph: a composition (who, why) or a publication (how many placed). */
export interface GraphPlanAuthoringEvent {
  readonly kind: 'compose' | 'publish'
  readonly at: string
  readonly actor: string | null
  readonly via: string | null
  readonly rationale: string | null
  readonly placed: number | null
  readonly notFound: number | null
  readonly runId: string | null
  readonly destination: string | null
}

/** The newest changes and publications of a workflow document (`urn:sophia:wf:<documentId>:authoring`), newest first. */
export async function loadGraphPlanAuthoring(
  rest: GraphPlanReader,
  graphId: string,
  authoringGraph: string,
  limit = 12,
): Promise<GraphPlanAuthoringEvent[]> {
  assertIri(authoringGraph, 'authoring graph')
  const query = `PREFIX wf: <${WF}> PREFIX prov: <http://www.w3.org/ns/prov#> SELECT ?kind ?at ?actor ?via ?rationale ?placed ?notFound ?runId ?destination WHERE { GRAPH <${authoringGraph}> { ?e a ?kind ; prov:generatedAtTime ?at . FILTER(?kind IN (wf:CompositionEvent, wf:Publication)) OPTIONAL { ?e wf:actor ?actor } OPTIONAL { ?e wf:actorVia ?via } OPTIONAL { ?e wf:rationale ?rationale } OPTIONAL { ?e wf:placedCount ?placed } OPTIONAL { ?e wf:notFoundCount ?notFound } OPTIONAL { ?e wf:runId ?runId } OPTIONAL { ?e wf:destination ?destination } } } ORDER BY DESC(?at) LIMIT ${Math.max(1, Math.min(50, limit))}`
  const rows = findRows(await rest.query(graphId, query)) ?? []
  const value = (raw: unknown): string | null => (typeof raw === 'string' ? parseTerm(raw).value : null)
  const count = (raw: unknown): number | null => {
    const n = Number(value(raw))
    return value(raw) !== null && Number.isFinite(n) ? n : null
  }
  return rows.filter(isRecord).map((row) => ({
    kind: value(row.kind) === `${WF}Publication` ? 'publish' : 'compose',
    at: value(row.at) ?? '',
    actor: value(row.actor),
    via: value(row.via),
    rationale: value(row.rationale),
    placed: count(row.placed),
    notFound: count(row.notFound),
    runId: value(row.runId),
    destination: value(row.destination),
  }))
}
