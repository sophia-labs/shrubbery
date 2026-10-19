/**
 * The workflow-graph plan (`graph-plan-v1`), read in the browser: a workflow whose definition is a named RDF graph.
 *
 * This is the same closed grammar and the same compiler as Choreograph's `src/workflow/graph-plan.ts` (2026-10-18),
 * so the main pane can draw exactly what will run and show the digest a person approves. If the two ever drift, the
 * digests differ and Choreograph refuses the run: the failure is loud, never a silent mismatch. Extract one shared
 * package when a third consumer appears.
 */
export const GRAPH_PLAN_WORKFLOW_NAME = "graph-plan-v1";
export const GRAPH_PLAN_SCHEMA = "sophia.graph-plan.v1" as const;
export const WF = "http://mnemosyne.dev/workflow#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DCT_TITLE = "http://purl.org/dc/terms/title";

export const GRAPH_PLAN_LIMITS = Object.freeze({
  phases: 6,
  steps: 12,
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
}

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
  };
}

/** The digest a run pins: sha256 over the canonical JSON of the compiled plan (Choreograph computes the same). */
export async function graphPlanDigest(plan: GraphPlanV1): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(plan))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
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
}

export async function readGraphPlanRun(service: GraphPlanService, runId: string): Promise<GraphPlanRunProgress> {
  const response = await fetch(`${service.origin}${service.mount}/api/workflows/runs/${encodeURIComponent(runId)}`, {
    headers: serviceHeaders(service),
  })
  if (!response.ok) throw new Error(`the run could not be read: HTTP ${response.status}`)
  const body = (await response.json()) as { header?: { status?: string }; events?: { type?: string; label?: string | null }[] }
  const byLabel = new Map<string, { done: number; failed: number; started: number }>()
  for (const event of body.events ?? []) {
    if (!event.label || !['node_started', 'node_done', 'error'].includes(event.type ?? '')) continue
    const label = event.label.replace(/ #\d+$/, '')
    const counts = byLabel.get(label) ?? { done: 0, failed: 0, started: 0 }
    if (event.type === 'node_started') counts.started += 1
    else if (event.type === 'node_done') counts.done += 1
    else counts.failed += 1
    byLabel.set(label, counts)
  }
  return { status: body.header?.status ?? 'unknown', byLabel }
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
