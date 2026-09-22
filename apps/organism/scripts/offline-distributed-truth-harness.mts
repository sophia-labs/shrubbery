/**
 * Top-level fully-offline distributed-truth acceptance harness.
 *
 * It composes three real proofs/audits:
 *
 *   1. persistent Chromium + Node Yjs + MCP + Gardend mirror/document activation;
 *   2. source-aware Meaningful Object convergence, lifecycle, rebuild, and recovery.
 *   3. a residual-capability audit for durable authorities and product paths
 *      outside that replicated source core.
 *
 * Both child reports are release claims: this harness is GO only when both
 * functional proofs are GO.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type JsonObject = Record<string, unknown>

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-distributed-truth.'))
const documentReportPath = join(runRoot, 'document-report.json')
const documentWebKitReportPath = join(runRoot, 'document-webkit-report.json')
const sourceAuthorityReportPath = join(runRoot, 'source-authority-report.json')
const sourceChaosReportPath = join(runRoot, 'source-chaos-report.json')
const indexedDbReportPath = join(runRoot, 'indexeddb-report.json')
const residualReportPath = join(runRoot, 'residual-report.json')
// master §3 Slice 9, §8.1/§10.4 — the four new runChild proofs.
const contestedResolutionReportPath = join(runRoot, 'contested-resolution-report.json')
const graphFenceParkedReportPath = join(runRoot, 'graph-fence-parked-report.json')
const graphFenceParkedWebKitReportPath = join(runRoot, 'graph-fence-parked-webkit-report.json')
const parkedWorkReapplyReportPath = join(runRoot, 'parked-work-reapply-report.json')
const requireGo = process.argv.includes('--require-go')
  || process.env.SHRUBBERY_OFFLINE_REQUIRE_GO === '1'
const requireDataPlaneGo = process.argv.includes('--require-data-plane-go')
  || process.env.SHRUBBERY_OFFLINE_REQUIRE_DATA_PLANE_GO === '1'
const requestedReportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT

function object(value: unknown, label: string): JsonObject {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value as JsonObject
}

async function runChild(
  label: string,
  script: string,
  reportPath: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<JsonObject> {
  const env = { ...process.env, ...extraEnv }
  delete env.SHRUBBERY_OFFLINE_REQUIRE_GO
  delete env.SHRUBBERY_OFFLINE_REQUIRE_DATA_PLANE_GO
  env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT = reportPath
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(appDir, 'scripts', script)],
      {
        cwd: appDir,
        env,
        stdio: 'inherit',
      },
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }
      reject(new Error(
        `${label} exited code=${String(code)} signal=${String(signal)}`,
      ))
    })
  })
  return object(
    JSON.parse(readFileSync(reportPath, 'utf8')),
    `${label} report`,
  )
}

try {
  const document = await runChild(
    'complete-mirror Chromium proof',
    'offline-sync-later-gardend-browser.mts',
    documentReportPath,
  )
  const documentWebKit = await runChild(
    'complete-mirror WebKit proof',
    'offline-sync-later-gardend-browser.mts',
    documentWebKitReportPath,
    { SHRUBBERY_BROWSER_ENGINE: 'webkit' },
  )
  const sourceAuthority = await runChild(
    'source-aware Meaningful Objects proof',
    'source-sync-distributed-truth-gardend.mts',
    sourceAuthorityReportPath,
  )
  const sourceChaos = await runChild(
    'seeded multi-client source chaos',
    'source-sync-chaos-gardend.mts',
    sourceChaosReportPath,
  )
  const indexedDb = await runChild(
    'cross-engine IndexedDB atomicity proof',
    'source-mirror-indexeddb-chaos-browser.mts',
    indexedDbReportPath,
  )
  const residual = await runChild(
    'interesting-behavior residual audit',
    'offline-interesting-behavior-gardend.mts',
    residualReportPath,
  )
  // master §3 Slice 9, §8.1/§10.4 — four new runChild proofs: the full Law
  // IV resolution journey (Slice 6), graph-lifetime fence visibility +
  // parked-work (Slice 7/8, both engines), and the reapply pipeline
  // (Slice 9 itself).
  const contestedResolution = await runChild(
    'Law IV resolution journey proof',
    'contested-resolution-browser.mts',
    contestedResolutionReportPath,
  )
  const graphFenceParked = await runChild(
    'graph-fence and parked-work proof',
    'graph-fence-parked-browser.mts',
    graphFenceParkedReportPath,
  )
  const graphFenceParkedWebKit = await runChild(
    'graph-fence WebKit parity proof',
    'graph-fence-parked-browser.mts',
    graphFenceParkedWebKitReportPath,
    { SHRUBBERY_BROWSER_ENGINE: 'webkit' },
  )
  const parkedWorkReapply = await runChild(
    'parked-work reapply proof',
    'parked-work-reapply-browser.mts',
    parkedWorkReapplyReportPath,
  )
  if (document.ok !== true) throw new Error('complete-mirror browser child report is not ok')
  if (documentWebKit.ok !== true) {
    throw new Error('complete-mirror WebKit child report is not ok')
  }
  if (sourceAuthority.ok !== true) throw new Error('source-authority child report is not ok')
  if (sourceChaos.ok !== true) throw new Error('source-chaos child report is not ok')
  if (indexedDb.ok !== true) throw new Error('IndexedDB child report is not ok')
  if (residual.ok !== true) throw new Error('residual-capability child report is not ok')
  if (contestedResolution.ok !== true) throw new Error('contested-resolution child report is not ok')
  if (graphFenceParked.ok !== true) throw new Error('graph-fence-parked child report is not ok')
  if (graphFenceParkedWebKit.ok !== true) throw new Error('graph-fence-parked WebKit child report is not ok')
  if (parkedWorkReapply.ok !== true) throw new Error('parked-work-reapply child report is not ok')

  const childGardendProvenance = [
    ['documentChromium', document],
    ['documentWebKit', documentWebKit],
    ['sourceAuthority', sourceAuthority],
    ['sourceChaos', sourceChaos],
    ['residual', residual],
    ['contestedResolution', contestedResolution],
    ['graphFenceParked', graphFenceParked],
    ['graphFenceParkedWebKit', graphFenceParkedWebKit],
    ['parkedWorkReapply', parkedWorkReapply],
  ].map(([label, child]) => {
    const provenance = object(
      object(child, `${String(label)} report`).provenance,
      `${String(label)} provenance`,
    )
    const gardend = object(provenance.gardend, `${String(label)} Gardend provenance`)
    if (typeof gardend.path !== 'string' || typeof gardend.sha256 !== 'string') {
      throw new Error(`${String(label)} Gardend provenance is incomplete`)
    }
    return {
      child: String(label),
      path: gardend.path,
      sha256: gardend.sha256,
    }
  })
  const provedBinary = childGardendProvenance[0]!
  if (childGardendProvenance.some(candidate =>
    candidate.path !== provedBinary.path || candidate.sha256 !== provedBinary.sha256)) {
    throw new Error(
      `child proofs did not use one immutable Gardend binary: ${JSON.stringify(childGardendProvenance)}`,
    )
  }

  const documentEvidence = object(document.evidence, 'document evidence')
  const documentWebKitEvidence = object(
    documentWebKit.evidence,
    'WebKit document evidence',
  )
  const mirrorCompleteness = object(
    documentEvidence.mirrorCompleteness,
    'document mirror-completeness evidence',
  )
  const webKitMirrorCompleteness = object(
    documentWebKitEvidence.mirrorCompleteness,
    'WebKit mirror-completeness evidence',
  )
  const completeMirror = mirrorCompleteness.completeMirrorManifest === true
  const completeWebKitMirror = webKitMirrorCompleteness.completeMirrorManifest === true
  const offlineMutationRouting = object(
    documentEvidence.offlineMutationRouting,
    'offline mutation-routing evidence',
  )
  const webKitOfflineMutationRouting = object(
    documentWebKitEvidence.offlineMutationRouting,
    'WebKit mutation-routing evidence',
  )
  const productReadYourWrites = offlineMutationRouting.offlineRenameQueued === true
    && offlineMutationRouting.coldRestartReadYourWrites === true
    && offlineMutationRouting.canonicalWitness != null
  const webKitProductReadYourWrites =
    webKitOfflineMutationRouting.offlineRenameQueued === true
    && webKitOfflineMutationRouting.coldRestartReadYourWrites === true
    && webKitOfflineMutationRouting.canonicalWitness != null
  // master §3 Slice 9, §8.1/§10.4 — the four new proofs' own evidence.
  const contestedResolutionEvidence = object(contestedResolution.evidence, 'contested-resolution evidence')
  const contestedResolutionOk = object(
    contestedResolutionEvidence.resolution, 'contested-resolution resolution evidence',
  ).appliedNeverConflict === true
  const graphFenceParkedEvidence = object(graphFenceParked.evidence, 'graph-fence-parked evidence')
  const fenceVisible = object(graphFenceParkedEvidence.fenceVisibility, 'fence-visibility evidence').bannerPresent === true
  const parkedRecoverable = object(graphFenceParkedEvidence.parkedEnumeration, 'parked-enumeration evidence').coldRestartIdentical === true
  const graphFenceParkedWebKitEvidence = object(graphFenceParkedWebKit.evidence, 'graph-fence-parked WebKit evidence')
  const webKitFenceVisible = object(graphFenceParkedWebKitEvidence.fenceVisibility, 'WebKit fence-visibility evidence').bannerPresent === true
  const parkedWorkReapplyEvidence = object(parkedWorkReapply.evidence, 'parked-work-reapply evidence')
  const reapplyOk = object(parkedWorkReapplyEvidence.reapply, 'reapply evidence').synthesizedSnapshotReachedReplacement === true
    && object(parkedWorkReapplyEvidence.reapply, 'reapply evidence').currentStateContestedNotOverwritten === true
    && object(parkedWorkReapplyEvidence.reapply, 'reapply evidence').drainThenRefuseHeldOneAtATime === true

  const replicatedDataPlaneGo = completeMirror
    && completeWebKitMirror
    && productReadYourWrites
    && webKitProductReadYourWrites
    && document.verdict === 'GO'
    && documentWebKit.verdict === 'GO'
    && sourceAuthority.verdict === 'GO'
    && sourceChaos.verdict === 'GO'
    && indexedDb.verdict === 'GO'
    && residual.replicatedDataPlaneVerdict === 'GO'
    && contestedResolution.verdict === 'GO'
    && graphFenceParked.verdict === 'GO'
    && graphFenceParkedWebKit.verdict === 'GO'
    && parkedWorkReapply.verdict === 'GO'
  const residualBlockers = Array.isArray(residual.blockers)
    ? residual.blockers
    : []
  const blockers = [
    ...(!completeMirror ? [{
      id: 'OFFLINE-MIRROR-INCOMPLETE',
      invariant: 'A cold offline client has an explicit, epoch-bound complete mirror of every authorable source in scope.',
      witness: mirrorCompleteness.finding,
      required: 'Background-fetch all source authorities and commit a completeness manifest only after every member is locally durable and identity-fenced.',
    }] : []),
    ...(!completeWebKitMirror ? [{
      id: 'WEBKIT-OFFLINE-MIRROR-INCOMPLETE',
      invariant: 'The WKWebView-relevant engine cold-opens the same explicit complete mirror as Chromium.',
      witness: webKitMirrorCompleteness.finding,
      required: 'Repair WebKit-specific IndexedDB/cache hydration and rerun the complete offline browser proof.',
    }] : []),
    ...(productReadYourWrites ? [] : [{
      id: 'PRODUCT-MUTATION-NOT-OUTBOX-ROUTED',
      invariant: 'A user-facing authoring intent is locally durable, cold-read-your-writes visible, and later witnessed by canonical truth.',
      witness: offlineMutationRouting.finding,
      required: 'Route mediated authoring through the source mirror outbox, project pending source into Surfaces after a cold restart, and require a canonical reconciliation witness.',
    }]),
    ...(webKitProductReadYourWrites ? [] : [{
      id: 'WEBKIT-PRODUCT-MUTATION-NOT-OUTBOX-ROUTED',
      invariant: 'WebKit cold-reconstructs pending user-facing mutations from its durable outbox.',
      witness: webKitOfflineMutationRouting.finding,
      required: 'Repair WebKit-specific outbox durability/projection and require a canonical reconciliation witness.',
    }]),
    ...(contestedResolutionOk ? [] : [{
      id: 'LAW-IV-RESOLUTION-UNAVAILABLE',
      invariant: 'A client can author a Law IV resolution against a real contest and the receipt lands applied, never conflict, honouring the non-optimistic window.',
      witness: object(contestedResolutionEvidence.resolution, 'contested-resolution resolution evidence').finding,
      required: 'Ship the client-authored ResolveCurrent path and the receipt-classifier fix (master §3 Slice 6).',
    }]),
    ...(fenceVisible ? [] : [{
      id: 'FENCE-INVISIBLE',
      invariant: 'A client fenced by a graph recreation says so, keeps the graph listed, and can enumerate every piece of work it still holds.',
      witness: object(graphFenceParkedEvidence.fenceVisibility, 'fence-visibility evidence').finding,
      required: 'Publish fenced/parked state from the mirror, reverse the offline graph-list filter, and enumerate recoveries joined with parked operations.',
    }]),
    ...(webKitFenceVisible ? [] : [{
      id: 'WEBKIT-FENCE-INVISIBLE',
      invariant: 'The WKWebView-relevant engine discovers and confesses the same durable fence as Chromium.',
      witness: object(graphFenceParkedWebKitEvidence.fenceVisibility, 'WebKit fence-visibility evidence').finding,
      required: 'Repair WebKit-specific fence detection/IndexedDB durability and rerun the fence + parked-work browser proof under WebKit.',
    }]),
    ...(parkedRecoverable ? [] : [{
      id: 'PARKED-WORK-UNRECOVERABLE',
      invariant: 'Parked work survives logout and cold restart, exports losslessly, and can be reapplied with per-operation truth about what landed.',
      witness: object(graphFenceParkedEvidence.parkedEnumeration, 'parked-enumeration evidence').finding,
      required: 'Retain recoveries per user across logout, ship the export artifact, and drive reapply one operation at a time with an honest terminal state.',
    }]),
    ...(reapplyOk ? [] : [{
      id: 'REAPPLY-UNSAFE-OR-LOSSY',
      invariant: 'Reapplying parked work delivers the parked Y.Doc snapshot into the replacement document, never silently overwrites a genuinely concurrent object write, and never co-batches an unrelated live edit with a refused run.',
      witness: object(parkedWorkReapplyEvidence.reapply, 'reapply evidence').finding,
      required: 'Synthesize the documentUpdate snapshot per reapplied recovery, leave a reapplied currentState\'s baseVersion unchanged, and drain-then-refuse before the first push (master §3 Slice 9).',
    }]),
    ...residualBlockers,
  ]
  const verdict = blockers.length === 0
    && document.verdict === 'GO'
    && documentWebKit.verdict === 'GO'
    && sourceAuthority.verdict === 'GO'
    && sourceChaos.verdict === 'GO'
    && indexedDb.verdict === 'GO'
    && contestedResolution.verdict === 'GO'
    && graphFenceParked.verdict === 'GO'
    && graphFenceParkedWebKit.verdict === 'GO'
    && parkedWorkReapply.verdict === 'GO'
    && residual.verdict === 'GO'
    ? 'GO'
    : 'NO-GO'

  const report = {
    ok: true,
    verdict,
    replicatedDataPlaneVerdict: replicatedDataPlaneGo ? 'GO' : 'NO-GO',
    unqualifiedVerdict: verdict,
    scope: 'true fully-offline, cold-start, multi-client, sync-later distributed truth',
    provenance: {
      gardend: {
        path: provedBinary.path,
        sha256: provedBinary.sha256,
        childAgreement: true,
      },
    },
    acceptanceDimensions: [
      'cold renderer with no network or surviving JavaScript state',
      'persistent Chromium and WebKit engine parity',
      'real IndexedDB abort atomicity in Chromium and WebKit',
      'complete local mirror, not opportunistic cache hits',
      'two independent persistent browser profiles per engine',
      'Node Yjs document and workspace replicas',
      'MCP agent writes and at-least-once replay',
      'both reconnect delivery orders and repeated reconnects',
      'current-state, event-log, derived, CRDT, valuation, and observer-relative sources',
      'object create/delete/recreate and graph/document incarnation',
      'presence isolation while partitioned',
      'SIGKILL, random port/token restart, and same-disk recovery',
      'projection/lifecycle identity boundaries',
      'cold read-your-writes for mediated product commands',
      'client-minted graph and document lifetimes',
      'source-derived local semantic retrieval',
      'seeded 5-client schedule, receipt-fault, batch-atomicity, and SIGKILL chaos',
      'explicit non-local authority/effect boundary',
      'graph-lifetime fencing made visible rather than filtered away',
      'parked work enumerated across two independent durable stores',
      'per-operation reapply with append-only-honest rollback semantics',
    ],
    boundedGo: {
      scope: 'replicated graph data plane: Meaningful Object sources, projections, resources, history, workspace/doc CRDT, semantic retrieval, and lifecycle intents',
      verdict: replicatedDataPlaneGo ? 'GO' : 'NO-GO',
      scenarios: {
        ...object(document.scenarios, 'document scenarios'),
        webKitDocument: documentWebKit.verdict === 'GO',
        crossEngineIndexedDb: indexedDb.verdict === 'GO',
        seededSourceChaos: sourceChaos.verdict === 'GO',
        sourceAuthority: sourceAuthority.verdict === 'GO',
        residualDataPlane: residual.replicatedDataPlaneVerdict === 'GO',
        lawIVResolution: contestedResolution.verdict === 'GO',
        graphFenceAndParkedWork: graphFenceParked.verdict === 'GO',
        graphFenceAndParkedWorkWebKit: graphFenceParkedWebKit.verdict === 'GO',
        parkedWorkReapply: parkedWorkReapply.verdict === 'GO',
      },
    },
    blockers,
    nonLocalBoundaries: Array.isArray(residual.nonLocalBoundaries)
      ? residual.nonLocalBoundaries
      : [],
    sourceAuthority: {
      sourceKindCounts: object(
        object(sourceAuthority.evidence, 'source-authority evidence').sourceKindCounts,
        'source-kind counts',
      ),
    },
    reports: {
      documentChromium: document,
      documentWebKit,
      sourceAuthority,
      sourceChaos,
      indexedDb,
      residual,
      contestedResolution,
      graphFenceParked,
      graphFenceParkedWebKit,
      parkedWorkReapply,
    },
  }
  if (requestedReportPath) {
    writeFileSync(requestedReportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
  if (requireGo && verdict !== 'GO') process.exitCode = 2
  if (requireDataPlaneGo && !replicatedDataPlaneGo) process.exitCode = 3
} catch (error) {
  const failure = {
    ok: false,
    verdict: 'HARNESS-ERROR',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  if (requestedReportPath) {
    writeFileSync(requestedReportPath, `${JSON.stringify(failure, null, 2)}\n`)
  }
  console.error('[offline-distributed-truth] FAILED')
  console.error(JSON.stringify(failure, null, 2))
  throw error
} finally {
  rmSync(runRoot, { recursive: true, force: true })
}
