/**
 * property.test.ts — acceptance gate (a), design §9.2 Phase 1:
 *
 *   "No operation sequence can produce zero roots, cycles, duplicate
 *    parents, dangling children, duplicate node IDs, out-of-range ratios,
 *    or an unregistered/ill-shaped descriptor — prove via a property test
 *    over random op sequences that re-validates the tree after every step."
 *
 * `fast-check` is not a devDependency of this package (verified against
 * pnpm-lock.yaml before writing this), so per the handoff this uses a small
 * SEEDED in-repo generator (`seeded-random.ts`, mulberry32) instead of
 * unseeded `Math.random()` — every run is exactly reproducible from its seed.
 *
 * `applyOperation`/`validateLayoutDocument` calls in THIS file go through a
 * local shim that injects `TEST_VALIDATE_OPTIONS` (fixtures.ts) by default —
 * production's `defaultFaceRegistrationPredicate` is a MANDATORY, closed
 * allow-list (validate.ts), so the property's own face-id generator must use
 * ONE explicit registry consistently for every applyOperation call AND every
 * per-step re-validation, and must generate BOTH registered and genuinely
 * UNREGISTERED face ids so "cannot produce an unregistered descriptor" is an
 * actually-exercised claim, not a vacuous one.
 *
 * The generator deliberately produces a mix of well-formed AND malformed
 * operations (bogus ids, invalid enums, colliding ids, out-of-range/NaN
 * ratios, malformed descriptors, unregistered face ids, and — design §9.2
 * Phase 1 diff-review r2 — correct/stale/malformed mandatory preconditions)
 * — the property under test is that `applyOperation` either produces a valid
 * document or leaves the previous (already-valid) document completely
 * untouched, for EVERY draw, forever. A frozen node graph additionally
 * proves no reducer ever mutates its input in place (a mutation would throw
 * under `Object.freeze`, not silently succeed) — and now that
 * `finalizeCandidate` deep-freezes its own output too, this is doubly
 * guaranteed.
 *
 * Further describe blocks (below the two original ones) cover what r1's
 * review found MISSING (a survivor-ID-preservation oracle, negative
 * controls proving it has teeth) AND what r2's recheck found still missing
 * from r1's version of that oracle (design §9.2 Phase 1 diff-review r2,
 * finding on "the survivor-ID property... checks only untouched leaves and
 * leaf-count delta. A no-op replace_descriptor/set_ratio/swap_nodes/
 * move_node has delta zero and satisfies this oracle. Untouched split re-ID/
 * reconstruction is also invisible."):
 *
 *   - `assertSurvivorIdsPreserved` is generalized to cover EVERY node kind
 *     (splits too, not just leaves) via `structurallyTouchedIds`, which
 *     computes EXACTLY which existing nodes each operation is allowed to
 *     remove/mutate (the operation's named ids, plus the specific ancestor
 *     splits each reducer's `detachPromoteSibling`/`spliceBesideLeaf`/
 *     `swapNodes` is documented to rewire) — everything else must survive by
 *     reference.
 *   - `assertOperationPostcondition` adds a POSITIVE, operation-specific
 *     check for every verb (not just leaf-count delta) — set_ratio's stored
 *     ratio actually changed, replace_descriptor's descriptor/revision
 *     actually changed, swap_nodes's two nodes actually exchanged positions,
 *     move_node's new split actually contains both operands — so a no-op
 *     mutant for ANY of these (zero leaf-count delta, perfectly valid
 *     output) is still caught.
 *   - negative-control mutants now cover ALL FIVE zero/nonzero-delta verbs
 *     (not just split_leaf), plus a dedicated "validator-clean SPLIT re-ID"
 *     control (r1's control only covered a re-ID'd LEAF).
 */
import { describe, expect, it } from 'vitest'
import type { Axis, LayoutDocument, LayoutNode, ViewDescriptor } from '../types.js'
import { createSophiaHomeDescriptor, SOPHIA_HOME_FACE_ID } from '../types.js'
import type { LayoutOperation, OperationResult, ParentLocation, Side } from '../operations.js'
import { applyOperation as applyOperationRaw, locateParent } from '../operations.js'
import type { ValidateOptions, ValidationResult } from '../validate.js'
import { validateLayoutDocument as validateLayoutDocumentRaw } from '../validate.js'
import { TEST_FACE_IDS, TEST_VALIDATE_OPTIONS, makeDescriptor, singleLeafDoc, twoLeafDoc } from './fixtures.js'
import { createSeededRandom, type SeededRandom } from './seeded-random.js'

function applyOperation(doc: LayoutDocument, op: LayoutOperation, options?: ValidateOptions): OperationResult {
  return applyOperationRaw(doc, op, options ?? TEST_VALIDATE_OPTIONS)
}

function validateLayoutDocument(doc: LayoutDocument, options?: ValidateOptions): ValidationResult {
  return validateLayoutDocumentRaw(doc, options ?? TEST_VALIDATE_OPTIONS)
}

/** Recursively Object.freeze a plain object graph (test-local; catches any in-place mutation). */
function deepFreezeForTest<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const key of Object.keys(value as object)) {
    deepFreezeForTest((value as Record<string, unknown>)[key])
  }
  return value
}

const AXES: readonly (Axis | 'diagonal')[] = ['horizontal', 'vertical', 'diagonal']
const SIDES: readonly (Side | 'middle')[] = ['start', 'end', 'middle']

/** Deliberately off the test registry — see fixtures.ts's TEST_FACE_IDS header. */
const UNREGISTERED_FACE_IDS = ['unregistered.probe-a', 'unregistered.probe-b', 'totally.not.registered']

function randomDescriptor(rng: SeededRandom): ViewDescriptor {
  if (rng.chance(0.12)) {
    // Deliberately malformed: empty faceId.
    return { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'urn:malformed' } }
  }
  if (rng.chance(0.2)) {
    // Deliberately well-SHAPED but genuinely UNREGISTERED — this is what
    // proves LAY003_UNREGISTERED_FACE rejection is real, not vacuous. The
    // run-level assertion below ("LAY003_UNREGISTERED_FACE rejection is
    // exercised at least once") confirms this branch actually reaches a
    // rejection, not just a draw.
    return {
      schemaVersion: 1,
      faceId: rng.pick(UNREGISTERED_FACE_IDS),
      resource: { kind: 'iri', iri: `urn:test:${rng.nextInt(100000)}` },
    }
  }
  return {
    schemaVersion: 1,
    faceId: rng.pick(TEST_FACE_IDS),
    resource: { kind: 'iri', iri: `urn:test:${rng.nextInt(100000)}` },
  }
}

function randomRatio(rng: SeededRandom): number | undefined {
  const r = rng.next()
  if (r < 0.15) return undefined
  if (r < 0.25) return Number.NaN
  if (r < 0.4) return rng.nextInt(40000) - 15000 // frequently out of [1,9999]
  return rng.nextInt(9999) + 1
}

function pickIdOrGhost(rng: SeededRandom, candidates: readonly string[], ghostChance = 0.18): string {
  if (candidates.length === 0 || rng.chance(ghostChance)) return `ghost-${rng.nextInt(1_000_000)}`
  return rng.pick(candidates)
}

function freshOrCollidingId(rng: SeededRandom, existing: readonly string[], prefix: string): string {
  if (existing.length > 0 && rng.chance(0.2)) return rng.pick(existing) // deliberately colliding
  return `${prefix}-${rng.nextInt(1_000_000)}`
}

/**
 * A mandatory `expectedParent`/`expectedTargetParent` precondition value
 * (design §9.2 Phase 1 diff-review r2) — deliberately mixes the CORRECT
 * current location, a plausible-but-WRONG location, and a structurally
 * malformed shape, so both `applyOperation`'s stale-precondition rejection
 * AND its decoder's malformed-shape rejection are exercised by this
 * adversarial generator. Typed `unknown` on purpose: some draws are
 * deliberately not a legal `ParentLocation` at all.
 */
function randomParentLocationValue(rng: SeededRandom, doc: LayoutDocument, id: string): unknown {
  const roll = rng.next()
  if (roll < 0.5) {
    const actual = locateParent(doc, id)
    if (actual) return actual
  }
  if (roll < 0.8) {
    return rng.chance()
      ? { kind: 'root' }
      : { kind: 'child', splitId: `ghost-split-${rng.nextInt(100000)}`, side: rng.chance() ? 'start' : 'end' }
  }
  return rng.pick([
    null,
    undefined,
    'not-an-object',
    42,
    [],
    { kind: 'diagonal' },
    { kind: 'child' },
    { kind: 'root', extra: true },
  ])
}

/** Same idea as `randomParentLocationValue`, for `replace_descriptor`'s `expectedDescriptorRevision`. */
function randomDescriptorRevisionValue(rng: SeededRandom, doc: LayoutDocument, leafId: string): unknown {
  const node = doc.nodes[leafId]
  const actual = node && node.kind === 'leaf' ? node.descriptorRevision : 0
  const roll = rng.next()
  if (roll < 0.5) return actual
  if (roll < 0.8) return actual + 1 + rng.nextInt(5)
  return rng.pick([undefined, null, -1, 1.5, Number.NaN, 'zero', {}])
}

/** Draw one random `LayoutOperation` against the current document's id set. */
function randomOperation(doc: LayoutDocument, rng: SeededRandom): LayoutOperation {
  const allIds = Object.keys(doc.nodes)
  const leafIds = allIds.filter((id) => doc.nodes[id].kind === 'leaf')

  const opType = rng.pick([
    'split_leaf',
    'close_leaf',
    'set_ratio',
    'replace_descriptor',
    'swap_nodes',
    'move_node',
  ] as const)

  switch (opType) {
    case 'split_leaf': {
      const leafId = pickIdOrGhost(rng, allIds)
      return {
        op: 'split_leaf',
        leafId,
        axis: rng.pick(AXES) as Axis,
        side: rng.pick(SIDES) as Side,
        newLeafId: freshOrCollidingId(rng, allIds, 'new-leaf'),
        splitId: freshOrCollidingId(rng, allIds, 'new-split'),
        descriptor: randomDescriptor(rng),
        startBasisPoints: randomRatio(rng),
        expectedParent: randomParentLocationValue(rng, doc, leafId) as unknown as ParentLocation,
      }
    }
    case 'close_leaf': {
      const leafId = pickIdOrGhost(rng, allIds)
      return {
        op: 'close_leaf',
        leafId,
        expectedParent: randomParentLocationValue(rng, doc, leafId) as unknown as ParentLocation,
      }
    }
    case 'set_ratio':
      return { op: 'set_ratio', splitId: pickIdOrGhost(rng, allIds), startBasisPoints: randomRatio(rng) ?? 5000 }
    case 'replace_descriptor': {
      const leafId = pickIdOrGhost(rng, allIds)
      return {
        op: 'replace_descriptor',
        leafId,
        descriptor: randomDescriptor(rng),
        expectedDescriptorRevision: randomDescriptorRevisionValue(rng, doc, leafId) as unknown as number,
      }
    }
    case 'swap_nodes':
      return {
        op: 'swap_nodes',
        firstNodeId: pickIdOrGhost(rng, allIds),
        secondNodeId: pickIdOrGhost(rng, allIds),
      }
    case 'move_node': {
      const nodeId = pickIdOrGhost(rng, allIds)
      const targetLeafId = pickIdOrGhost(rng, leafIds.length > 0 ? leafIds : allIds)
      return {
        op: 'move_node',
        nodeId,
        targetLeafId,
        side: rng.pick(SIDES) as Side,
        axis: rng.pick(AXES) as Axis,
        splitId: freshOrCollidingId(rng, allIds, 'move-split'),
        startBasisPoints: randomRatio(rng),
        expectedParent: randomParentLocationValue(rng, doc, nodeId) as unknown as ParentLocation,
        expectedTargetParent: randomParentLocationValue(rng, doc, targetLeafId) as unknown as ParentLocation,
      }
    }
  }
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 13)
const STEPS_PER_SEED = 300

describe('property: no operation sequence produces an invalid document (gate a)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS_PER_SEED} random (well-formed + adversarial) ops keep the document valid at every step`, () => {
      const rng = createSeededRandom(seed)
      let doc = singleLeafDoc(`root-${seed}`)
      expect(validateLayoutDocument(doc)).toEqual({ ok: true })

      for (let step = 0; step < STEPS_PER_SEED; step++) {
        const op = randomOperation(doc, rng)
        // Freeze the actual pre-op tree in place; if any reducer ever
        // mutated shared state in place (rather than spreading), this would
        // throw instead of the op returning cleanly. Frozen node objects
        // carried forward unchanged into the next document stay frozen —
        // harmless, since nothing here ever needs to mutate them again.
        deepFreezeForTest(doc)

        const result = applyOperation(doc, op)

        if (result.ok) {
          doc = result.doc
        }
        // Whether accepted or rejected, the current document is ALWAYS valid —
        // an operation sequence never leaves a half-mutated or invalid tree.
        const verdict = validateLayoutDocument(doc)
        if (!verdict.ok) {
          throw new Error(
            `step ${step}: document became invalid after op ${JSON.stringify(op)}: ${JSON.stringify(
              verdict.diagnostics,
            )}`,
          )
        }
        // No duplicate node ids: every key still maps to a node whose own id
        // matches (validateLayoutDocument's LAY-002 check already covers
        // this, re-asserted here for a sharper failure message).
        for (const [key, node] of Object.entries(doc.nodes)) {
          expect(node.id).toBe(key)
        }
      }
    })
  }

  it('across the full 25-seed run, LAY003_UNREGISTERED_FACE rejection is exercised at least once (proves gate (a) is not vacuous)', () => {
    let totalUnregisteredRejections = 0
    for (const seed of SEEDS) {
      const rng = createSeededRandom(seed)
      let doc = singleLeafDoc(`unreg-probe-${seed}`)
      for (let step = 0; step < STEPS_PER_SEED; step++) {
        const op = randomOperation(doc, rng)
        const result = applyOperation(doc, op)
        if (result.ok) {
          doc = result.doc
        } else if (result.diagnostic.code === 'LAY003_UNREGISTERED_FACE') {
          totalUnregisteredRejections += 1
        }
      }
    }
    expect(totalUnregisteredRejections).toBeGreaterThan(0)
  })

  it('across the full 25-seed run, both LAYOP_STALE_PARENT/LAYOP_STALE_DESCRIPTOR_REVISION AND LAYOP_MALFORMED_OPERATION rejections are exercised at least once (design §9.2 Phase 1 r2: mandatory-precondition coverage is not vacuous)', () => {
    let staleRejections = 0
    let malformedRejections = 0
    for (const seed of SEEDS) {
      const rng = createSeededRandom(seed)
      let doc = singleLeafDoc(`precond-probe-${seed}`)
      for (let step = 0; step < STEPS_PER_SEED; step++) {
        const op = randomOperation(doc, rng)
        const result = applyOperation(doc, op)
        if (result.ok) {
          doc = result.doc
        } else if (
          result.diagnostic.code === 'LAYOP_STALE_PARENT' ||
          result.diagnostic.code === 'LAYOP_STALE_DESCRIPTOR_REVISION'
        ) {
          staleRejections += 1
        } else if (result.diagnostic.code === 'LAYOP_MALFORMED_OPERATION') {
          malformedRejections += 1
        }
      }
    }
    expect(staleRejections).toBeGreaterThan(0)
    expect(malformedRejections).toBeGreaterThan(0)
  })

  it('a targeted adversarial run that only ever attempts split_leaf/move_node with colliding or in-subtree targets never corrupts the tree', () => {
    const rng = createSeededRandom(424242)
    let doc = singleLeafDoc('root')
    // Grow a modest tree first so there are real subtrees to target.
    for (let i = 0; i < 6; i++) {
      const leaves = Object.keys(doc.nodes).filter((id) => doc.nodes[id].kind === 'leaf')
      const target = rng.pick(leaves)
      const result = applyOperation(doc, {
        op: 'split_leaf',
        leafId: target,
        axis: rng.chance() ? 'horizontal' : 'vertical',
        side: rng.chance() ? 'start' : 'end',
        newLeafId: `grown-leaf-${i}`,
        splitId: `grown-split-${i}`,
        descriptor: randomDescriptor(rng),
        expectedParent: locateParent(doc, target)!,
      })
      if (result.ok) doc = result.doc
    }
    expect(validateLayoutDocument(doc)).toEqual({ ok: true })

    for (let step = 0; step < 200; step++) {
      const nodes: readonly LayoutNode[] = Object.values(doc.nodes)
      const splits = nodes.filter((n): n is Extract<LayoutNode, { kind: 'split' }> => n.kind === 'split')
      const op: LayoutOperation =
        splits.length > 0 && rng.chance(0.5)
          ? (() => {
              const nodeId = rng.pick(splits).id
              const targetLeafId = pickIdOrGhost(rng, Object.keys(doc.nodes), 0.3)
              return {
                op: 'move_node',
                nodeId,
                targetLeafId,
                side: rng.chance() ? 'start' : 'end',
                axis: rng.chance() ? 'horizontal' : 'vertical',
                splitId: freshOrCollidingId(rng, Object.keys(doc.nodes), 'adversarial-split'),
                expectedParent: randomParentLocationValue(rng, doc, nodeId) as unknown as ParentLocation,
                expectedTargetParent: randomParentLocationValue(rng, doc, targetLeafId) as unknown as ParentLocation,
              }
            })()
          : randomOperation(doc, rng)
      const result = applyOperation(doc, op)
      if (result.ok) doc = result.doc
      const verdict = validateLayoutDocument(doc)
      if (!verdict.ok) {
        throw new Error(`adversarial step ${step} corrupted the tree: ${JSON.stringify(verdict.diagnostics)}`)
      }
    }
  })
})

// ── survivor preservation oracle (design LAY-002, §2.5; §9.2 Phase 1 r1/r2) ──

/**
 * Every id-shaped argument an operation names. The survivor oracle below
 * makes NO claim about these ids — they are the operation's legitimate
 * targets, free to be created, removed, or rebuilt. Combined with
 * `structurallyTouchedIds`'s ancestor computation, it DOES claim something
 * about every OTHER node — see `assertSurvivorIdsPreserved`.
 */
function namedIds(op: LayoutOperation): ReadonlySet<string> {
  switch (op.op) {
    case 'split_leaf':
      return new Set([op.leafId, op.newLeafId, op.splitId])
    case 'close_leaf':
      return new Set([op.leafId])
    case 'set_ratio':
      return new Set([op.splitId])
    case 'replace_descriptor':
      return new Set([op.leafId])
    case 'swap_nodes':
      return new Set([op.firstNodeId, op.secondNodeId])
    case 'move_node':
      return new Set([op.nodeId, op.targetLeafId, op.splitId])
    default:
      return new Set()
  }
}

/** `id`'s immediate parent SPLIT id in `doc`, or `null` if `id` is the root (or does not exist). */
function parentSplitOf(doc: LayoutDocument, id: string): string | null {
  const loc = locateParent(doc, id)
  return loc && loc.kind === 'child' ? loc.splitId : null
}

/**
 * Every existing node id `op` is STRUCTURALLY entitled to remove or mutate,
 * beyond its own named arguments (design §9.2 Phase 1 diff-review r2: r1's
 * oracle only exempted `namedIds`, which is correct for `set_ratio`/
 * `replace_descriptor` — exactly one node's OWN fields change, nothing else —
 * but incomplete for the tree-surgery ops, whose `detachPromoteSibling`/
 * `spliceBesideLeaf`/`swapNodes` helpers rewire ONE ancestor SPLIT's child
 * pointer (mutating it, same id, new object) and, for a detach, additionally
 * REMOVE the immediate parent split entirely:
 *
 *   split_leaf(leafId):        leafId's immediate parent (if any) is MUTATED.
 *   close_leaf(leafId):        leafId's immediate parent P is REMOVED; P's
 *                              own parent (if any) is MUTATED. (If leafId IS
 *                              root, leafId itself is named — the LAY-010
 *                              rebind case — and there is no parent.)
 *   move_node(nodeId,target):  nodeId's immediate parent P1 is REMOVED; P1's
 *                              own parent (if any) is MUTATED. targetLeafId's
 *                              immediate parent (if any) is MUTATED.
 *   swap_nodes(A,B):           A's immediate parent is MUTATED; B's immediate
 *                              parent is MUTATED (may be the same split).
 *
 * Every OTHER node — including every split not on one of these specific
 * paths — MUST survive by reference.
 */
function structurallyTouchedIds(before: LayoutDocument, op: LayoutOperation): ReadonlySet<string> {
  const touched = new Set<string>(namedIds(op))
  const addAncestors = (id: string, levels: number): void => {
    let current: string | null = id
    for (let i = 0; i < levels && current; i++) {
      current = parentSplitOf(before, current)
      if (current) touched.add(current)
    }
  }
  switch (op.op) {
    case 'split_leaf':
      addAncestors(op.leafId, 1)
      break
    case 'close_leaf':
      addAncestors(op.leafId, 2)
      break
    case 'move_node':
      addAncestors(op.nodeId, 2)
      addAncestors(op.targetLeafId, 1)
      break
    case 'swap_nodes':
      addAncestors(op.firstNodeId, 1)
      addAncestors(op.secondNodeId, 1)
      break
    case 'set_ratio':
    case 'replace_descriptor':
      break
  }
  return touched
}

/** How many leaves a WELL-FORMED (guaranteed-successful) op of this shape adds/removes. */
function expectedLeafCountDelta(before: LayoutDocument, op: LayoutOperation): number {
  if (op.op === 'split_leaf') return 1
  if (op.op === 'close_leaf') return before.rootNodeId === op.leafId ? 0 : -1 // LAY-010 rebind is not a removal
  return 0
}

/**
 * The GENERALIZED survivor oracle (design §9.2 Phase 1 diff-review r1 finding
 * 9, widened by r2): for every node id present in `before` that
 * `structurallyTouchedIds` does NOT exempt, that EXACT id must (a) still
 * exist in `after` and (b) map to the EXACT SAME node object (`===`) —
 * whether it's a leaf OR a split. It also checks the leaf COUNT moved by
 * exactly the amount a well-formed op of that shape implies. Throws a
 * descriptive `Error` (not a vitest matcher) so both the property loop AND
 * the negative-control tests below can reuse it directly.
 */
function assertSurvivorIdsPreserved(before: LayoutDocument, after: LayoutDocument, op: LayoutOperation): void {
  const touched = structurallyTouchedIds(before, op)

  for (const id of Object.keys(before.nodes)) {
    if (touched.has(id)) continue
    if (!Object.hasOwn(after.nodes, id)) {
      throw new Error(`survivor violation: untouched node '${id}' vanished after op ${JSON.stringify(op)}`)
    }
    if (after.nodes[id] !== before.nodes[id]) {
      throw new Error(
        `survivor violation: untouched node '${id}' was reconstructed (object reference changed) after op ${JSON.stringify(op)}`,
      )
    }
  }

  const beforeLeafIds = Object.keys(before.nodes).filter((id) => before.nodes[id].kind === 'leaf')
  const afterLeafCount = Object.keys(after.nodes).filter((id) => after.nodes[id].kind === 'leaf').length
  const expectedDelta = expectedLeafCountDelta(before, op)
  const actualDelta = afterLeafCount - beforeLeafIds.length
  if (actualDelta !== expectedDelta) {
    throw new Error(
      `survivor violation: leaf count changed by ${actualDelta}, expected ${expectedDelta}, after op ${JSON.stringify(op)}`,
    )
  }
}

/**
 * The OPERATION-SPECIFIC postcondition oracle (design §9.2 Phase 1
 * diff-review r2, finding: "Add operation-specific postcondition oracles for
 * every verb"). Unlike `assertSurvivorIdsPreserved` (which only proves
 * nothing UNRELATED changed — it EXEMPTS every operand named by the op, see
 * `namedIds`), this proves the NAMED node(s) actually changed in the way the
 * operation promises — catching a no-op mutant (zero leaf-count delta,
 * perfectly valid output, nothing unrelated touched) for set_ratio,
 * replace_descriptor, swap_nodes, and move_node, none of which r1's
 * leaf-count-delta-only check could distinguish from "did nothing."
 *
 * Builder P1 hardening finding 5 widens this further: `assertSurvivorIdsPreserved`
 * exempting an operation's own operands is correct for the ones whose
 * CONTENT genuinely changes (replace_descriptor's leaf, set_ratio's split) —
 * but split_leaf's ORIGINAL leaf, swap_nodes's two operands, and move_node's
 * moved node + target leaf are only ever REPOSITIONED by their real reducers
 * (operations.ts's `spliceBesideLeaf`/`detachPromoteSibling` never touch the
 * named node's OWN entry) — a validator-clean mutant that reconstructs one of
 * these into a content-identical but reference-DIFFERENT object was
 * previously invisible to both oracles (the survivor oracle exempts operands
 * entirely; this oracle only checked PLACEMENT, e.g. "is it a child of the
 * right split", never the operand's own object identity). The new
 * `assertOperandIdentityPreserved` calls below close that gap. Separately,
 * close_leaf's root-rebind branch previously checked ONLY `faceId ===
 * SOPHIA_HOME_FACE_ID` — trivially true (and therefore blind to a no-op
 * mutant) when the root was ALREADY sophia.home before the op ran; it now
 * also requires the EXACT sophia.home descriptor (not just a matching
 * faceId) and a `descriptorRevision` increment of exactly 1.
 */
function assertOperationPostcondition(before: LayoutDocument, after: LayoutDocument, op: LayoutOperation): void {
  switch (op.op) {
    case 'split_leaf': {
      const newLeaf = after.nodes[op.newLeafId]
      if (!newLeaf || newLeaf.kind !== 'leaf') {
        throw new Error(`split_leaf postcondition: newLeafId '${op.newLeafId}' is not a leaf in the result`)
      }
      if (newLeaf.descriptorRevision !== 0) {
        throw new Error(`split_leaf postcondition: newLeafId must start at descriptorRevision 0`)
      }
      const split = after.nodes[op.splitId]
      if (!split || split.kind !== 'split') {
        throw new Error(`split_leaf postcondition: splitId '${op.splitId}' is not a split in the result`)
      }
      const children = [split.startNodeId, split.endNodeId]
      if (!children.includes(op.leafId) || !children.includes(op.newLeafId)) {
        throw new Error(`split_leaf postcondition: new split does not contain both the original and new leaf`)
      }
      // The ORIGINAL leaf is only re-parented, never rebuilt — its own node
      // object must survive by reference (Builder P1 hardening finding 5).
      if (after.nodes[op.leafId] !== before.nodes[op.leafId]) {
        throw new Error(
          `split_leaf postcondition: leafId '${op.leafId}' own object was reconstructed, not preserved by reference (no-op-shaped re-ID mutant would trip this)`,
        )
      }
      break
    }
    case 'close_leaf': {
      if (before.rootNodeId === op.leafId) {
        const beforeLeaf = before.nodes[op.leafId]
        const afterLeaf = after.nodes[op.leafId]
        if (!afterLeaf || afterLeaf.kind !== 'leaf') {
          throw new Error(`close_leaf postcondition: root rebind did not produce a leaf at the same id`)
        }
        // Builder P1 hardening finding 5: checking ONLY faceId is trivially
        // true (and blind to a no-op mutant) when the root was ALREADY
        // sophia.home before this op ran — require the EXACT descriptor
        // AND a revision increment of exactly 1, every time.
        if (JSON.stringify(afterLeaf.descriptor) !== JSON.stringify(createSophiaHomeDescriptor())) {
          throw new Error(`close_leaf postcondition: root rebind did not produce the exact sophia.home descriptor`)
        }
        const beforeRevision = beforeLeaf && beforeLeaf.kind === 'leaf' ? beforeLeaf.descriptorRevision : -1
        if (afterLeaf.descriptorRevision !== beforeRevision + 1) {
          throw new Error(
            `close_leaf postcondition: root rebind descriptorRevision was not incremented by exactly 1 (no-op mutant on an ALREADY-sophia.home root would trip this)`,
          )
        }
      } else if (Object.hasOwn(after.nodes, op.leafId)) {
        throw new Error(`close_leaf postcondition: leafId '${op.leafId}' still present after closing a non-root leaf`)
      }
      break
    }
    case 'set_ratio': {
      const split = after.nodes[op.splitId]
      if (!split || split.kind !== 'split') {
        throw new Error(`set_ratio postcondition: splitId is not a split in the result`)
      }
      const clamped = Math.min(9999, Math.max(1, Math.round(op.startBasisPoints)))
      if (split.startBasisPoints !== clamped) {
        throw new Error(`set_ratio postcondition: startBasisPoints was not actually updated (no-op mutant would trip this)`)
      }
      break
    }
    case 'replace_descriptor': {
      const beforeLeaf = before.nodes[op.leafId]
      const afterLeaf = after.nodes[op.leafId]
      if (!afterLeaf || afterLeaf.kind !== 'leaf') {
        throw new Error(`replace_descriptor postcondition: leafId is not a leaf in the result`)
      }
      if (JSON.stringify(afterLeaf.descriptor) !== JSON.stringify(op.descriptor)) {
        throw new Error(`replace_descriptor postcondition: descriptor was not actually updated (no-op mutant would trip this)`)
      }
      const beforeRevision = beforeLeaf && beforeLeaf.kind === 'leaf' ? beforeLeaf.descriptorRevision : -1
      if (afterLeaf.descriptorRevision !== beforeRevision + 1) {
        throw new Error(`replace_descriptor postcondition: descriptorRevision was not incremented by exactly 1`)
      }
      break
    }
    case 'swap_nodes': {
      if (op.firstNodeId === op.secondNodeId) break // documented benign no-op
      const firstNowAt = JSON.stringify(locateParent(after, op.secondNodeId))
      const firstWasAt = JSON.stringify(locateParent(before, op.firstNodeId))
      const secondNowAt = JSON.stringify(locateParent(after, op.firstNodeId))
      const secondWasAt = JSON.stringify(locateParent(before, op.secondNodeId))
      if (firstNowAt !== firstWasAt || secondNowAt !== secondWasAt) {
        throw new Error(`swap_nodes postcondition: nodes did not actually exchange positions (no-op mutant would trip this)`)
      }
      // A swap rewires PARENT pointers only — each operand's own node object
      // must survive by reference (Builder P1 hardening finding 5).
      if (after.nodes[op.firstNodeId] !== before.nodes[op.firstNodeId]) {
        throw new Error(
          `swap_nodes postcondition: firstNodeId '${op.firstNodeId}' own object was reconstructed, not preserved by reference`,
        )
      }
      if (after.nodes[op.secondNodeId] !== before.nodes[op.secondNodeId]) {
        throw new Error(
          `swap_nodes postcondition: secondNodeId '${op.secondNodeId}' own object was reconstructed, not preserved by reference`,
        )
      }
      break
    }
    case 'move_node': {
      const split = after.nodes[op.splitId]
      if (!split || split.kind !== 'split') {
        throw new Error(`move_node postcondition: splitId is not a split in the result`)
      }
      const children = [split.startNodeId, split.endNodeId]
      if (!children.includes(op.nodeId) || !children.includes(op.targetLeafId)) {
        throw new Error(`move_node postcondition: new split does not contain both the moved node and the target`)
      }
      // The moved node and the target leaf are only ever re-parented, never
      // rebuilt — both must survive by reference (Builder P1 hardening
      // finding 5: a moved SUBTREE's own root object, and the target leaf,
      // previously escaped both oracles).
      if (after.nodes[op.nodeId] !== before.nodes[op.nodeId]) {
        throw new Error(
          `move_node postcondition: nodeId '${op.nodeId}' own object was reconstructed, not preserved by reference (moved-subtree re-ID mutant would trip this)`,
        )
      }
      if (after.nodes[op.targetLeafId] !== before.nodes[op.targetLeafId]) {
        throw new Error(
          `move_node postcondition: targetLeafId '${op.targetLeafId}' own object was reconstructed, not preserved by reference`,
        )
      }
      break
    }
  }
}

/**
 * Draw ONE operation guaranteed to succeed against `doc` (never a ghost id, a
 * malformed descriptor, an unregistered face, an out-of-range ratio, a stale/
 * malformed precondition, or an ancestor/descendant violation) — deliberately
 * restricted to LEAF-to-LEAF swap/move (never a split subtree) so this
 * generator's own correctness is easy to see: a leaf has no children, so it
 * can never be its own ancestor, and it is always safe to name as a
 * swap/move operand.
 */
function drawWellFormedOperation(doc: LayoutDocument, rng: SeededRandom, idCounter: { n: number }): LayoutOperation {
  const allIds = Object.keys(doc.nodes)
  const leaves = allIds.filter((id) => doc.nodes[id].kind === 'leaf')
  const splits = allIds.filter((id) => doc.nodes[id].kind === 'split')
  const nonRootLeaves = leaves.filter((id) => id !== doc.rootNodeId)

  const freshId = (prefix: string): string => {
    let id: string
    do {
      idCounter.n += 1
      id = `${prefix}-${idCounter.n}`
    } while (doc.nodes[id])
    return id
  }
  const registeredDescriptor = (): ViewDescriptor => ({
    schemaVersion: 1,
    faceId: rng.pick(TEST_FACE_IDS),
    resource: { kind: 'iri', iri: `urn:wf:${idCounter.n}:${rng.nextInt(1_000_000)}` },
  })

  const kinds: string[] = ['split_leaf', 'replace_descriptor']
  if (splits.length > 0) kinds.push('set_ratio')
  if (leaves.length >= 2) kinds.push('swap_nodes')
  if (nonRootLeaves.length >= 1 && leaves.length >= 2) kinds.push('move_node', 'close_leaf')

  switch (rng.pick(kinds)) {
    case 'split_leaf': {
      const leafId = rng.pick(leaves)
      return {
        op: 'split_leaf',
        leafId,
        axis: rng.chance() ? 'horizontal' : 'vertical',
        side: rng.chance() ? 'start' : 'end',
        newLeafId: freshId('wf-leaf'),
        splitId: freshId('wf-split'),
        descriptor: registeredDescriptor(),
        startBasisPoints: rng.nextInt(9999) + 1,
        expectedParent: locateParent(doc, leafId)!,
      }
    }
    case 'replace_descriptor': {
      const leafId = rng.pick(leaves)
      const node = doc.nodes[leafId]
      return {
        op: 'replace_descriptor',
        leafId,
        descriptor: registeredDescriptor(),
        expectedDescriptorRevision: node.kind === 'leaf' ? node.descriptorRevision : 0,
      }
    }
    case 'set_ratio':
      return { op: 'set_ratio', splitId: rng.pick(splits), startBasisPoints: rng.nextInt(9999) + 1 }
    case 'swap_nodes': {
      const first = rng.pick(leaves)
      const second = rng.pick(leaves.filter((id) => id !== first))
      return { op: 'swap_nodes', firstNodeId: first, secondNodeId: second }
    }
    case 'move_node': {
      const nodeId = rng.pick(nonRootLeaves)
      const target = rng.pick(leaves.filter((id) => id !== nodeId))
      return {
        op: 'move_node',
        nodeId,
        targetLeafId: target,
        side: rng.chance() ? 'start' : 'end',
        axis: rng.chance() ? 'horizontal' : 'vertical',
        splitId: freshId('wf-move-split'),
        startBasisPoints: rng.nextInt(9999) + 1,
        expectedParent: locateParent(doc, nodeId)!,
        expectedTargetParent: locateParent(doc, target)!,
      }
    }
    case 'close_leaf': {
      const leafId = rng.pick(nonRootLeaves)
      return { op: 'close_leaf', leafId, expectedParent: locateParent(doc, leafId)! }
    }
    default:
      // Always reachable: split_leaf/replace_descriptor are unconditionally
      // in `kinds`.
      throw new Error('unreachable: kinds is never empty')
  }
}

const SURVIVOR_SEEDS = Array.from({ length: 10 }, (_, i) => i * 5051 + 3)
const SURVIVOR_STEPS_PER_SEED = 150

describe('property: survivor preservation + operation-specific postconditions across well-formed operation sequences (design LAY-002, §2.5, §9.2 Phase 1 r1/r2)', () => {
  for (const seed of SURVIVOR_SEEDS) {
    it(`seed ${seed}: every node NOT structurally touched by an operation survives by reference; each op's own postcondition holds`, () => {
      const rng = createSeededRandom(seed)
      let doc = singleLeafDoc(`survivor-root-${seed}`)
      const idCounter = { n: 0 }
      for (let step = 0; step < SURVIVOR_STEPS_PER_SEED; step++) {
        const op = drawWellFormedOperation(doc, rng, idCounter)
        const before = doc
        const result = applyOperation(before, op)
        if (!result.ok) {
          throw new Error(
            `step ${step}: well-formed generator produced a REJECTED op (generator bug, not necessarily a reducer bug): ${JSON.stringify(op)} -> ${JSON.stringify(result.diagnostic)}`,
          )
        }
        assertSurvivorIdsPreserved(before, result.doc, op)
        assertOperationPostcondition(before, result.doc, op)
        doc = result.doc
      }
    })
  }
})

// ── negative control: prove the survivor + postcondition oracles have teeth ─

/** A deliberately broken "reducer": silently drops every operation. */
function noOpMutantReducer(doc: LayoutDocument, _op: LayoutOperation): OperationResult {
  void _op
  return { ok: true, doc }
}

/**
 * A deliberately broken "reducer": performs the REAL operation, then quietly
 * reconstructs one UNTOUCHED LEAF's node object (same content, new object
 * identity) — simulating a re-ID / re-materialization bug that keeps the
 * tree perfectly valid.
 */
function reIdLeafMutantReducer(doc: LayoutDocument, op: LayoutOperation): OperationResult {
  const real = applyOperation(doc, op)
  if (!real.ok) return real
  const touched = structurallyTouchedIds(doc, op)
  const untouchedLeafId = Object.keys(real.doc.nodes).find(
    (id) => real.doc.nodes[id].kind === 'leaf' && !touched.has(id) && doc.nodes[id] !== undefined,
  )
  if (untouchedLeafId === undefined) return real // nothing available to corrupt this round
  const original = real.doc.nodes[untouchedLeafId]
  const corruptedNodes = { ...real.doc.nodes, [untouchedLeafId]: { ...original } } // structurally identical, NEW object
  return { ok: true, doc: { ...real.doc, nodes: corruptedNodes } }
}

/**
 * A deliberately broken "reducer": performs the REAL operation, then quietly
 * reconstructs one UNTOUCHED SPLIT's node object (design §9.2 Phase 1
 * diff-review r2 finding: "Add... a validator-clean split-ID mutation
 * control" — r1's control only ever exercised a re-ID'd LEAF).
 */
function reIdSplitMutantReducer(doc: LayoutDocument, op: LayoutOperation): OperationResult {
  const real = applyOperation(doc, op)
  if (!real.ok) return real
  const touched = structurallyTouchedIds(doc, op)
  const untouchedSplitId = Object.keys(real.doc.nodes).find(
    (id) => real.doc.nodes[id].kind === 'split' && !touched.has(id) && doc.nodes[id] !== undefined,
  )
  if (untouchedSplitId === undefined) return real
  const original = real.doc.nodes[untouchedSplitId]
  const corruptedNodes = { ...real.doc.nodes, [untouchedSplitId]: { ...original } }
  return { ok: true, doc: { ...real.doc, nodes: corruptedNodes } }
}

/**
 * A deliberately broken "reducer": performs the REAL operation, then quietly
 * reconstructs the node at `getTargetId(op)` — one of the op's OWN NAMED
 * operands (`namedIds` EXEMPTS these from `assertSurvivorIdsPreserved`,
 * correctly, since e.g. replace_descriptor's leaf really is supposed to
 * change) — into a structurally-identical but reference-DIFFERENT object.
 * For split_leaf/swap_nodes/move_node this is a real, previously-invisible
 * bug class (Builder P1 hardening finding 5): their real reducers only ever
 * REPARENT these operands, never rebuild the operand's own node entry, so a
 * mutant that does rebuild it is exactly the "validator-clean re-ID of an
 * operand that must survive" the finding names — caught now by
 * `assertOperationPostcondition`'s new reference-identity checks, not by
 * `assertSurvivorIdsPreserved` (which stays silent by design: the id is a
 * named operand).
 */
function reIdOperandMutantReducer(
  doc: LayoutDocument,
  op: LayoutOperation,
  getTargetId: (op: LayoutOperation) => string,
): OperationResult {
  const real = applyOperation(doc, op)
  if (!real.ok) return real
  const targetId = getTargetId(op)
  const original = real.doc.nodes[targetId]
  if (original === undefined) return real
  const corruptedNodes = { ...real.doc.nodes, [targetId]: { ...original } }
  return { ok: true, doc: { ...real.doc, nodes: corruptedNodes } }
}

/**
 * A deliberately broken "reducer" for close_leaf specifically: when the
 * target IS the root (the LAY-010 sophia.home rebind branch), performs the
 * REAL operation only if the root was NOT already sophia.home; if it WAS
 * already sophia.home, silently returns the untouched input instead —
 * exactly the "close_leaf-on-already-home-root no-op mutant" Builder P1
 * hardening finding 5 names (a naive postcondition that checks only
 * `faceId === SOPHIA_HOME_FACE_ID` cannot distinguish this from the real
 * reducer, since the faceId was ALREADY correct beforehand).
 */
function noOpOnAlreadyHomeRootMutantReducer(doc: LayoutDocument, op: LayoutOperation): OperationResult {
  if (op.op === 'close_leaf' && doc.rootNodeId === op.leafId) {
    const existing = doc.nodes[op.leafId]
    if (existing && existing.kind === 'leaf' && existing.descriptor.faceId === SOPHIA_HOME_FACE_ID) {
      return { ok: true, doc }
    }
  }
  return applyOperation(doc, op)
}

describe('property: negative control — the survivor + postcondition oracles actually catch broken reducers (design §9.2 Phase 1 r1/r2)', () => {
  it('a no-op mutant reducer (silently drops every operation) is caught by the leaf-count-delta check for split_leaf, even though its output stays perfectly VALID', () => {
    const doc = singleLeafDoc('root')
    const op: LayoutOperation = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor(),
      expectedParent: locateParent(doc, 'root')!,
    }
    const mutantResult = noOpMutantReducer(doc, op)
    expect(mutantResult.ok).toBe(true)
    if (!mutantResult.ok) return
    expect(validateLayoutDocument(mutantResult.doc)).toEqual({ ok: true })
    expect(() => assertSurvivorIdsPreserved(doc, mutantResult.doc, op)).toThrow(/leaf count/)
  })

  it.each([
    [
      'set_ratio',
      (doc: LayoutDocument): LayoutOperation => ({
        op: 'set_ratio',
        splitId: Object.keys(doc.nodes).find((id) => doc.nodes[id].kind === 'split')!,
        startBasisPoints: 7000,
      }),
    ],
    [
      'replace_descriptor',
      (doc: LayoutDocument): LayoutOperation => {
        const leafId = Object.keys(doc.nodes).find((id) => doc.nodes[id].kind === 'leaf')!
        const node = doc.nodes[leafId]
        return {
          op: 'replace_descriptor',
          leafId,
          descriptor: makeDescriptor('new.face', 'urn:new'),
          expectedDescriptorRevision: node.kind === 'leaf' ? node.descriptorRevision : 0,
        }
      },
    ],
    [
      'swap_nodes',
      (doc: LayoutDocument): LayoutOperation => {
        const leaves = Object.keys(doc.nodes).filter((id) => doc.nodes[id].kind === 'leaf')
        return { op: 'swap_nodes', firstNodeId: leaves[0], secondNodeId: leaves[1] }
      },
    ],
  ])(
    'a no-op mutant reducer for %s has ZERO leaf-count delta AND stays validator-clean — the survivor oracle alone is blind to it, but assertOperationPostcondition catches it (design §9.2 Phase 1 r2)',
    (_label, buildOp) => {
      const { doc } = twoLeafDoc()
      const op = buildOp(doc)
      const mutantResult = noOpMutantReducer(doc, op)
      expect(mutantResult.ok).toBe(true)
      if (!mutantResult.ok) return
      expect(validateLayoutDocument(mutantResult.doc)).toEqual({ ok: true })
      // The generalized survivor oracle alone does NOT catch a true no-op for
      // these three ops (zero delta, nothing "touched" actually changed
      // reference because NOTHING changed) — that is exactly r2's finding.
      expect(() => assertSurvivorIdsPreserved(doc, mutantResult.doc, op)).not.toThrow()
      // The per-verb postcondition oracle does catch it.
      expect(() => assertOperationPostcondition(doc, mutantResult.doc, op)).toThrow(/no-op mutant would trip this/)
    },
  )

  it('a no-op mutant reducer for move_node is caught by assertOperationPostcondition (the new split never gets created)', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const op: LayoutOperation = {
      op: 'move_node',
      nodeId: leafAId,
      targetLeafId: leafBId,
      side: 'start',
      axis: 'horizontal',
      splitId: 'never-created',
      expectedParent: locateParent(doc, leafAId)!,
      expectedTargetParent: locateParent(doc, leafBId)!,
    }
    const mutantResult = noOpMutantReducer(doc, op)
    expect(mutantResult.ok).toBe(true)
    if (!mutantResult.ok) return
    expect(() => assertOperationPostcondition(doc, mutantResult.doc, op)).toThrow(/splitId is not a split/)
  })

  it('a re-ID LEAF mutant reducer (silently reconstructs an untouched leaf) is caught even though the tree stays validator-clean', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const op: LayoutOperation = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:new'),
      expectedDescriptorRevision: 0,
    }
    const mutantResult = reIdLeafMutantReducer(doc, op)
    expect(mutantResult.ok).toBe(true)
    if (!mutantResult.ok) return
    expect(validateLayoutDocument(mutantResult.doc)).toEqual({ ok: true })
    expect(mutantResult.doc.nodes[leafBId]).not.toBe(doc.nodes[leafBId])
    expect(() => assertSurvivorIdsPreserved(doc, mutantResult.doc, op)).toThrow(/reconstructed/)
  })

  it('a re-ID SPLIT mutant reducer (silently reconstructs an untouched split) is caught — r1\'s control only ever covered a re-ID\'d LEAF (design §9.2 Phase 1 r2)', () => {
    const { doc, leafAId, rootSplitId, leafCId, midSplitId } = (() => {
      const base = twoLeafDoc()
      const withThirdLeaf = applyOperation(base.doc, {
        op: 'split_leaf',
        leafId: base.leafBId,
        axis: 'vertical',
        side: 'end',
        newLeafId: 'leaf-c',
        splitId: 'mid-split',
        descriptor: makeDescriptor('test.face', 'urn:c'),
        expectedParent: locateParent(base.doc, base.leafBId)!,
      })
      if (!withThirdLeaf.ok) throw new Error('fixture invariant')
      return {
        doc: withThirdLeaf.doc,
        leafAId: base.leafAId,
        rootSplitId: base.splitId,
        leafCId: 'leaf-c',
        midSplitId: 'mid-split',
      }
    })()
    // replace_descriptor on leafA touches ONLY leafA — every split (the root
    // split AND mid-split) is untouched by this op and is exactly the kind
    // of node a re-ID bug could silently corrupt without tripping validity
    // or leaf count. The mutant corrupts the FIRST untouched split it finds
    // in key order (the root split); the assertion below is written against
    // whichever one that actually is, not a specific hardcoded id.
    const op: LayoutOperation = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:new'),
      expectedDescriptorRevision: 0,
    }
    const mutantResult = reIdSplitMutantReducer(doc, op)
    expect(mutantResult.ok).toBe(true)
    if (!mutantResult.ok) return
    expect(validateLayoutDocument(mutantResult.doc)).toEqual({ ok: true })
    // Sanity: SOME split actually got a new object identity (the mutant did
    // its job) — root split and mid-split cannot BOTH still be reference-
    // identical to `doc`.
    const someSplitCorrupted =
      mutantResult.doc.nodes[rootSplitId] !== doc.nodes[rootSplitId] ||
      mutantResult.doc.nodes[midSplitId] !== doc.nodes[midSplitId]
    expect(someSplitCorrupted).toBe(true)
    expect(() => assertSurvivorIdsPreserved(doc, mutantResult.doc, op)).toThrow(/reconstructed/)
    void leafCId
  })

  it.each([
    [
      'split_leaf',
      (doc: LayoutDocument): LayoutOperation => ({
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal' as Axis,
        side: 'start' as Side,
        newLeafId: 'new-leaf',
        splitId: 'new-split',
        descriptor: makeDescriptor(),
        expectedParent: locateParent(doc, 'root')!,
      }),
      (op: LayoutOperation): string => (op.op === 'split_leaf' ? op.leafId : ''),
      () => singleLeafDoc('root'),
    ],
    [
      'swap_nodes (firstNodeId)',
      (doc: LayoutDocument): LayoutOperation => {
        const leaves = Object.keys(doc.nodes).filter((id) => doc.nodes[id].kind === 'leaf')
        return { op: 'swap_nodes', firstNodeId: leaves[0], secondNodeId: leaves[1] }
      },
      (op: LayoutOperation): string => (op.op === 'swap_nodes' ? op.firstNodeId : ''),
      () => twoLeafDoc().doc,
    ],
    [
      'move_node (nodeId)',
      (doc: LayoutDocument): LayoutOperation => {
        const { leafAId, leafBId } = twoLeafDoc()
        return {
          op: 'move_node',
          nodeId: leafAId,
          targetLeafId: leafBId,
          side: 'start' as Side,
          axis: 'horizontal' as Axis,
          splitId: 'moved-split',
          expectedParent: locateParent(doc, leafAId)!,
          expectedTargetParent: locateParent(doc, leafBId)!,
        }
      },
      (op: LayoutOperation): string => (op.op === 'move_node' ? op.nodeId : ''),
      () => twoLeafDoc().doc,
    ],
  ])(
    'a re-ID OPERAND mutant reducer for %s (silently reconstructs the op\'s own named operand into a content-identical, reference-different object) is caught by assertOperationPostcondition even though assertSurvivorIdsPreserved stays silent (Builder P1 hardening finding 5)',
    (_label, buildOp, getTargetId, buildDoc) => {
      const doc = buildDoc()
      const op = buildOp(doc)
      const mutantResult = reIdOperandMutantReducer(doc, op, getTargetId)
      expect(mutantResult.ok).toBe(true)
      if (!mutantResult.ok) return
      expect(validateLayoutDocument(mutantResult.doc)).toEqual({ ok: true })
      // The generalized survivor oracle EXEMPTS the op's own named operands
      // by design (see `namedIds`) — it stays silent here, which is r2's
      // documented, correct behavior, not a gap.
      expect(() => assertSurvivorIdsPreserved(doc, mutantResult.doc, op)).not.toThrow()
      // The per-verb postcondition oracle's new reference-identity checks
      // (finding 5) catch it.
      expect(() => assertOperationPostcondition(doc, mutantResult.doc, op)).toThrow(/own object was reconstructed/)
    },
  )

  it('a no-op-on-already-home-root mutant reducer for close_leaf is caught by assertOperationPostcondition (Builder P1 hardening finding 5: checking only faceId === SOPHIA_HOME_FACE_ID is blind to this)', () => {
    // Root's descriptor is already the EXACT sophia.home descriptor (not
    // just a matching faceId) — isolates the revision-increment check as the
    // ONLY thing that can still distinguish the mutant from the real
    // reducer, which always bumps descriptorRevision even when re-applying
    // the same descriptor value.
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'test-layout',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes: { root: { kind: 'leaf', id: 'root', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 } },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    expect(doc.nodes.root.kind === 'leaf' && doc.nodes.root.descriptor.faceId).toBe(SOPHIA_HOME_FACE_ID)
    const op: LayoutOperation = { op: 'close_leaf', leafId: 'root', expectedParent: locateParent(doc, 'root')! }
    const mutantResult = noOpOnAlreadyHomeRootMutantReducer(doc, op)
    expect(mutantResult.ok).toBe(true)
    if (!mutantResult.ok) return
    // The mutant silently returned the untouched input — a naive check of
    // only `faceId === SOPHIA_HOME_FACE_ID` cannot tell this apart from the
    // real reducer, since the faceId was ALREADY correct beforehand.
    expect(mutantResult.doc).toBe(doc)
    expect(() => assertOperationPostcondition(doc, mutantResult.doc, op)).toThrow(
      /descriptorRevision was not incremented by exactly 1/,
    )
  })

  it('sanity: the REAL applyOperation never trips either oracle for any of the scenarios above', () => {
    const doc1 = singleLeafDoc('root')
    const op1: LayoutOperation = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor(),
      expectedParent: locateParent(doc1, 'root')!,
    }
    const real1 = applyOperation(doc1, op1)
    expect(real1.ok).toBe(true)
    if (real1.ok) {
      expect(() => assertSurvivorIdsPreserved(doc1, real1.doc, op1)).not.toThrow()
      expect(() => assertOperationPostcondition(doc1, real1.doc, op1)).not.toThrow()
    }

    const { doc: doc2, leafAId } = twoLeafDoc()
    const op2: LayoutOperation = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:new'),
      expectedDescriptorRevision: 0,
    }
    const real2 = applyOperation(doc2, op2)
    expect(real2.ok).toBe(true)
    if (real2.ok) {
      expect(() => assertSurvivorIdsPreserved(doc2, real2.doc, op2)).not.toThrow()
      expect(() => assertOperationPostcondition(doc2, real2.doc, op2)).not.toThrow()
    }
  })
})
