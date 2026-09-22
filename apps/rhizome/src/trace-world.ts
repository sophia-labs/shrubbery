/**
 * trace-world.ts — the WALK data layer over the REAL agentic-run TRACE files.
 *
 * The WALK is the ONE divergence from the Plot's SPARQL data layer: its source is
 * JSONL FILES (the agentic-run traces at lme-bench/out/runs/agentic-*.trace.jsonl),
 * not the gardend cell. This module is the Node-side reader — it lists the runs and
 * parses one run's trace into the pure @shrubbery/render WALK resource shapes
 * (WalkIndexResource / WalkResource). NO MOCK: it reads the actual trace bytes.
 *
 * The per-line trace shape (one JSON object per line):
 *   line 1   {kind:'run_start', graphId, questionId, question, gold, maxTurns}
 *   turn …   {kind:'turn', label, turn, systemPrompt, messages[], rawAssistant,
 *             toolCalls[]({type,id,name,arguments}),
 *             toolResults[]({toolCallId,toolName,result,isError}),
 *             usage{inputTokens,outputTokens,totalTokens,costUsd}, stopReason}
 *   last     {kind:'run_end', supersessionEdges[]({newUrn,oldUrn}), finalAnswer, gold}
 *
 * The runs DIR is configurable (env RHIZOME_RUNS_DIR; default the lme-bench path).
 * The run id is the trace file's numeric stamp (agentic-{graph}-{stamp}.trace.jsonl).
 *
 * App/tooling level — the pure @shrubbery/render package never touches the FS.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  WalkEdge,
  WalkIndexResource,
  WalkIndexRun,
  WalkResource,
  WalkToolCall,
  WalkToolResult,
  WalkTurn,
  WalkUsage,
} from '@shrubbery/render'

/** The default runs directory — the lme-bench durable cell's trace output. */
const DEFAULT_RUNS_DIR = '/Users/vera/dev/lme-bench/out/runs'

/** The runs directory (env-overridable). */
export function runsDir(): string {
  return process.env.RHIZOME_RUNS_DIR ?? DEFAULT_RUNS_DIR
}

/** Match an agentic trace file → capture its run id (the numeric stamp). */
const TRACE_RE = /^agentic-.+-(\d+)\.trace\.jsonl$/

/** The short bed-key of a record IRI — the last `:record:<sha>`, first 12 (mirrors MemoryWorld.shortId). */
function recordShortId(iri: string): string | null {
  const parts = iri.split(':record:')
  const sha = parts[parts.length - 1]
  return sha ? sha.slice(0, 12) : null
}

/**
 * The Plot bed rootIds a run MINTED — the short lineage-root id of each
 * supersession edge's OLD record (the bed the run "met its past self" in). The
 * OLD record is the bed's lineage root; its short id is the bed's URL key. Distinct,
 * in first-seen order. Empty when the run superseded nothing.
 */
function supersededRootsOf(edges: readonly WalkEdge[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const e of edges) {
    const root = recordShortId(e.oldUrn)
    if (root && !seen.has(root)) {
      seen.add(root)
      roots.push(root)
    }
  }
  return roots
}

/** The full path to a run's trace file, or null if no such run id is on disk. */
async function traceFileFor(runId: string, dir = runsDir()): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[])
  for (const f of files) {
    const m = TRACE_RE.exec(f)
    if (m && m[1] === runId) return join(dir, f)
  }
  return null
}

// ── Raw line shapes (what the trace serializes) ────────────────────────────────

interface RawRunStart {
  kind: 'run_start'
  graphId?: string
  questionId?: string
  question?: string
  gold?: string
  maxTurns?: number
}
interface RawToolCall {
  type?: string
  id: string
  name: string
  arguments?: Record<string, unknown>
}
interface RawToolResult {
  toolCallId: string
  toolName: string
  result: string
  isError?: boolean
}
interface RawTurn {
  kind: 'turn'
  label: string
  turn: number
  systemPrompt?: string
  messages?: unknown[]
  rawAssistant?: string
  toolCalls?: RawToolCall[]
  toolResults?: RawToolResult[]
  usage?: WalkUsage
  stopReason?: string
}
interface RawRunEnd {
  kind: 'run_end'
  supersessionEdges?: WalkEdge[]
  finalAnswer?: string
  gold?: string
}
type RawLine = RawRunStart | RawTurn | RawRunEnd | { kind: string }

/** Parse one JSONL trace text into its (runStart, turns[], runEnd). */
export function parseTrace(text: string): {
  runStart: RawRunStart
  turns: RawTurn[]
  runEnd: RawRunEnd | null
} {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  let runStart: RawRunStart | null = null
  let runEnd: RawRunEnd | null = null
  const turns: RawTurn[] = []
  for (const line of lines) {
    const d = JSON.parse(line) as RawLine
    if (d.kind === 'run_start') runStart = d as RawRunStart
    else if (d.kind === 'turn') turns.push(d as RawTurn)
    else if (d.kind === 'run_end') runEnd = d as RawRunEnd
  }
  if (!runStart) throw new Error('trace has no run_start line')
  return { runStart, turns, runEnd }
}

/** Best-effort parse of a JSON tool result → its `subject` / `supersededSubject`. */
function resultJoins(result: string): { subject?: string; supersededSubject?: string } {
  try {
    const d = JSON.parse(result) as { subject?: string; supersededSubject?: string }
    return { subject: d.subject, supersededSubject: d.supersededSubject }
  } catch {
    return {}
  }
}

/** Map a raw tool call → the pure WalkToolCall (lifting the supersedes_ref join). */
function toToolCall(c: RawToolCall): WalkToolCall {
  const args = (c.arguments ?? {}) as Record<string, unknown>
  const ref = args['supersedes_ref']
  return {
    id: c.id,
    name: c.name,
    arguments: args,
    supersedesRef: typeof ref === 'string' && ref.length > 0 ? ref : undefined,
  }
}

/** Map a raw tool result → the pure WalkToolResult (lifting the subject joins). */
function toToolResult(r: RawToolResult): WalkToolResult {
  const { subject, supersededSubject } = resultJoins(r.result)
  return {
    toolCallId: r.toolCallId,
    toolName: r.toolName,
    result: r.result,
    isError: r.isError ?? false,
    subject,
    supersededSubject,
  }
}

/** Map a raw turn → the pure WalkTurn (the observe→think→act + the supersede flag). */
function toTurn(t: RawTurn): WalkTurn {
  const toolCalls = (t.toolCalls ?? []).map(toToolCall)
  const toolResults = (t.toolResults ?? []).map(toToolResult)
  // The supersession MOMENT: a call carries a supersedes_ref, OR a result confirms
  // a superseded subject (the cell minted a new record over an old one).
  const supersedes =
    toolCalls.some((c) => c.supersedesRef) ||
    toolResults.some((r) => r.supersededSubject)
  return {
    turn: t.turn,
    label: t.label,
    reasoning: t.rawAssistant ?? '',
    stopReason: t.stopReason,
    toolCalls,
    toolResults,
    usage: t.usage,
    supersedes,
  }
}

/** A trace still being written (mtime < this) reads as "running…", not "crashed". */
const RUNNING_WINDOW_MS = 90_000

/**
 * The "no run_end" message — DISAMBIGUATED by file freshness (R4): a trace whose
 * file was touched within RUNNING_WINDOW_MS is almost certainly still being written
 * (an in-progress run, e.g. a 47-session full-haystack sweep), NOT a crash. Without
 * this both read identically as "did not complete" and an in-flight run looks dead.
 */
async function incompleteMessage(file: string, turnCount: number): Promise<string> {
  try {
    const { mtimeMs } = await stat(file)
    if (Date.now() - mtimeMs < RUNNING_WINDOW_MS) {
      return `(running… ${turnCount} turn${turnCount === 1 ? '' : 's'} so far — refresh to follow)`
    }
  } catch {
    // stat failed — fall through to the generic message.
  }
  return '(no final answer — run did not complete)'
}

export class TraceWorld {
  constructor(private readonly dir = runsDir()) {}

  /** The WALK INDEX — one row per agentic trace file in the runs dir. */
  async walk(): Promise<WalkIndexResource> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    const runs: WalkIndexRun[] = []
    for (const f of files.sort()) {
      const m = TRACE_RE.exec(f)
      if (!m) continue
      const id = m[1]
      try {
        const path = join(this.dir, f)
        const text = await readFile(path, 'utf8')
        const { runStart, turns, runEnd } = parseTrace(text)
        const edges = runEnd?.supersessionEdges ?? []
        runs.push({
          id,
          question: runStart.question ?? '(no question)',
          gold: runEnd?.gold ?? runStart.gold ?? '',
          turnCount: turns.length,
          supersessionCount: edges.length,
          finalAnswer: runEnd?.finalAnswer ?? (await incompleteMessage(path, turns.length)),
          supersededRoots: supersededRootsOf(edges),
        })
      } catch {
        // A malformed/partial trace is surfaced as honest absence, not faked.
        continue
      }
    }
    // newest run id first (the stamps are monotonic-ish ms timestamps).
    runs.sort((a, b) => b.id.localeCompare(a.id))
    return {
      kind: 'walk-index',
      id: 'walk',
      title: 'The Walk — agentic-run traces',
      summary: `The turn-by-turn agentic sessions in \`${this.dir}\` — each a run that absorbed a session into durable memory then answered. A FILE source (the one divergence from the Plot's live cell). Open a run to walk its turns; the run's supersessions tie back to the Plot's beds.`,
      runs,
    }
  }

  /** ONE run's WALK — parse its trace into the full ribbon of turns. */
  async trace(runId: string, turnCursor: number | null = null): Promise<WalkResource | null> {
    const file = await traceFileFor(runId, this.dir)
    if (!file) return null
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) return null
    const { runStart, turns, runEnd } = parseTrace(text)
    return {
      kind: 'walk-run',
      id: runId,
      title: `Walk — ${runStart.question ?? `run ${runId}`}`,
      graphId: runStart.graphId ?? '',
      question: runStart.question ?? '(no question)',
      gold: runEnd?.gold ?? runStart.gold ?? '',
      finalAnswer: runEnd?.finalAnswer ?? (await incompleteMessage(file, turns.length)),
      turns: turns.map(toTurn),
      supersessionEdges: runEnd?.supersessionEdges ?? [],
      turnCursor,
    }
  }

  /** The list of run ids on disk (for route generation / validation). */
  async runIds(): Promise<string[]> {
    const idx = await this.walk()
    return idx.runs.map((r) => r.id)
  }
}

/** Convenience: a TraceWorld bound to the configured runs dir. */
export function makeTraceWorld(dir = runsDir()): TraceWorld {
  return new TraceWorld(dir)
}
