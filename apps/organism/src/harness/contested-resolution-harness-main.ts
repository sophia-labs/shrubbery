/**
 * contested-resolution-harness-main.ts — REAL entry point wiring the FULL
 * resolution journey (MO object-face integration spec, master §3 Slice 6,
 * WS2 §6.6-6.7, gate G11) through the REAL production surface: the
 * contested centre route (Slice 5), `<sh-object-card-view>`'s real
 * `sh-object-intent` emitter, the REAL `mn-context-menu` /
 * `mn-confirmation-dialog` singletons, and `SourceMirrorRuntime.
 * resolveCurrent()` — against a REAL spawned gardend cell.
 *
 * Mirrors `contested-query-service-harness-main.ts`'s own shape; adds the
 * menu/dialog singletons and the `sh-object-intent` listener that
 * `apps/organism/src/main.ts` itself owns in production. Every function
 * driving the menu/dialog IS `apps/organism`'s real `resolution-flow.ts` —
 * nothing here re-implements the journey, it only wires it to real DOM.
 *
 * NO MOCKS: `createGardendContract` builds the REAL `SourceMirrorRuntime`
 * (real IndexedDB, real MCP round-trips); `resolveCurrent` is the real
 * client-authored ResolveCurrent path.
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { applySkinTheme } from '@shrubbery/tokens'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderWorkspace,
  workspaceSurfaceReady,
  setWorkspaceNamedQueryRegistry,
  OBJECT_INTENT_EVENT,
  type SubjectRowActivateDetail,
  type ObjectCardIntent,
  type ObjectIntentDetail,
} from '@shrubbery/runtime'
import type { MnConfirmationDialog, MnContextMenu } from '@shrubbery/components'
import type { MenuSelectDetail } from '@shrubbery/nucleus'
import type { ResolveCurrentIntent, SourceOutboxRecord } from '@shrubbery/source'
import { createGardendContract, type GardendContract } from '../cell/gardend-contract.js'
import { createSourceObjectService } from '../cell/source-object-runtime.js'
import { createShellNamedQueryRegistry } from './shell-named-query-registry.js'
import { SYNC_QUERY } from './source-sync-query-catalog.js'
import {
  contestedSelectionFrom,
  reconcileContestedSelection,
  type ContestedSurfaceState,
} from '../cell/contested-surface.js'
import {
  resolutionMenuModel,
  pickResolution,
  pickComposedRecord,
  showLostRaceDialog,
  type ResolutionMenuInput,
  type ResolutionMenuProposal,
} from '../cell/resolution-flow.js'

export const GRAPH_ID = 'contested-resolution-harness-proof'

interface ContestedResolutionHarnessBridge {
  refresh(): Promise<void>
  currentSelection(): ContestedSurfaceState['selection']
  /** Every `resolveCurrent` outbox row for this graph, for cold-reload and
   *  status-transition assertions the DOM alone cannot cheaply expose. */
  resolveOutboxRows(): readonly SourceOutboxRecord[]
  /** `resolving`/`awaitingEpoch`/`contestedObjects` straight off the real
   *  `SourceMirrorState` — the non-optimistic-window proof needs these. */
  mirrorState(): { readonly resolving: readonly string[]; readonly awaitingEpoch: readonly { readonly conflictId: string; readonly remainingConflictId: string | null }[]; readonly contestedObjects: number }
  /** Re-open a FRESH `SourceMirrorRuntime` over the SAME IndexedDB — the
   *  cold-reload proof (a real second contract, the same pattern
   *  `card-object-harness-main.ts`'s `readAuthority` already uses). */
  reopenColdAndListOutbox(): Promise<readonly SourceOutboxRecord[]>
  lastError(): string | null
}

declare global {
  interface Window {
    __contestedResolutionHarness?: ContestedResolutionHarnessBridge
  }
}

const OBJECT_KEY_SEPARATOR = String.fromCharCode(0x1f)

function objectKeyPartsForLabel(objectKey: string): { readonly className: string; readonly objectId: string } | null {
  const parts = objectKey.split(OBJECT_KEY_SEPARATOR)
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null
  return { className: parts[1], objectId: parts[2] }
}

function objectLabelFromKey(objectKey: string): string {
  const parts = objectKeyPartsForLabel(objectKey)
  return parts ? `${parts.className} ${parts.objectId}` : objectKey
}

function objectClassNameFromKey(objectKey: string): string {
  return objectKeyPartsForLabel(objectKey)?.className ?? objectKey
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })
  setWorkspaceNamedQueryRegistry(createShellNamedQueryRegistry())

  const container = document.querySelector<HTMLElement>('#contested-resolution-root')
  if (!container) throw new Error('contested-resolution-harness: #contested-resolution-root is missing')

  const commandMenuEl = document.createElement('mn-context-menu') as MnContextMenu
  const confirmationDialogEl = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
  document.body.append(commandMenuEl, confirmationDialogEl)

  const contract: GardendContract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })
  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)
  const objectService = createSourceObjectService({ runtime: contract.sourceMirror, caller: contract.rawMcp })

  let state: ContestedSurfaceState = { graphId: GRAPH_ID, selection: null }
  let lastError: string | null = null
  let activeResolutionMenu: {
    readonly objectKey: string
    readonly conflictId: string
    readonly className: string
    readonly proposals: readonly ResolutionMenuProposal[]
  } | null = null
  const lostRaceShownFor = new Set<string>()

  function draw(): void {
    renderWorkspace(GARDEN_DEFAULT, {
      container: container!,
      surface: true,
      contested: {
        graphId: GRAPH_ID,
        queryId: SYNC_QUERY.conflictsOpen,
        queryService: contract.sourceMirror.surfaceQueryService(GRAPH_ID),
        objectService,
        maxRows: 200,
        selection: state.selection,
        onSelect: (detail: SubjectRowActivateDetail) => {
          state = {
            graphId: GRAPH_ID,
            selection: contestedSelectionFrom(detail, contract.sourceMirror.bundleFor(GRAPH_ID), GRAPH_ID),
          }
          draw()
        },
        onClose: () => {
          state = { graphId: GRAPH_ID, selection: null }
          draw()
        },
      },
    })
  }

  function menuProposalsFrom(intent: Extract<ObjectCardIntent, { kind: 'resolve' }>): readonly ResolutionMenuProposal[] {
    return intent.proposals.map(proposal => ({
      operationId: proposal.operationId,
      sourceVersion: proposal.sourceVersion,
      observer: proposal.observer ?? null,
      isProjectedHead: proposal.isProjectedHead,
      record: proposal.record,
    }))
  }

  function runResolutionIntent(intent: ResolveCurrentIntent): Promise<void> {
    return contract.sourceMirror.resolveCurrent(GRAPH_ID, intent).then(() => undefined)
  }

  function handleResolveIntent(intent: Extract<ObjectCardIntent, { kind: 'resolve' }>): void {
    const proposals = menuProposalsFrom(intent)
    const input: ResolutionMenuInput = {
      objectKey: intent.objectKey,
      conflictId: intent.conflictId,
      proposals,
      composeAvailable: true,
      pendingResolution: contract.sourceMirror.manager(GRAPH_ID).get().resolving.includes(intent.conflictId),
    }
    activeResolutionMenu = {
      objectKey: intent.objectKey,
      conflictId: intent.conflictId,
      className: objectClassNameFromKey(intent.objectKey),
      proposals,
    }
    commandMenuEl.items = resolutionMenuModel(input)
    commandMenuEl.show(intent.anchor, 'top-left')
  }

  function handleKeepCandidateIntent(intent: Extract<ObjectCardIntent, { kind: 'keep-candidate' }>): void {
    runResolutionIntent({
      kind: 'keep',
      objectKey: intent.objectKey,
      conflictId: intent.conflictId,
      chosenOperationId: intent.chosenOperationId,
    }).catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error)
    })
  }

  function beginResolution(
    objectKey: string,
    conflictId: string,
    defaultChosenOperationId: string,
    className: string,
    proposals: readonly ResolutionMenuProposal[],
  ): void {
    const chosen = proposals.find(proposal => proposal.operationId === defaultChosenOperationId)
    pickResolution({
      dialog: confirmationDialogEl,
      objectLabel: objectLabelFromKey(objectKey),
      proposalLabel: chosen?.observer ?? defaultChosenOperationId,
      onKeep: () => runResolutionIntent({ kind: 'keep', objectKey, conflictId, chosenOperationId: defaultChosenOperationId }),
      onCompose: async () => {
        const record = await pickComposedRecord({
          dialog: confirmationDialogEl,
          objectLabel: objectLabelFromKey(objectKey),
          className,
          proposals,
        })
        if (record === null) return false
        await runResolutionIntent({ kind: 'compose', objectKey, conflictId, record })
        return true
      },
    }).catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error)
    })
  }

  commandMenuEl.addEventListener('mn-select', ((event: CustomEvent<MenuSelectDetail>) => {
    const menu = activeResolutionMenu
    if (!menu) return
    const id = event.detail.id
    if (id === 'copy-key') return
    if (id === 'compose') {
      const head = menu.proposals.find(proposal => proposal.isProjectedHead) ?? menu.proposals[0]
      if (head) beginResolution(menu.objectKey, menu.conflictId, head.operationId, menu.className, menu.proposals)
      return
    }
    if (id.startsWith('keep:')) {
      beginResolution(menu.objectKey, menu.conflictId, id.slice('keep:'.length), menu.className, menu.proposals)
    }
  }) as EventListener)
  commandMenuEl.addEventListener('mn-close', () => { activeResolutionMenu = null })

  container.addEventListener(OBJECT_INTENT_EVENT, ((event: CustomEvent<ObjectIntentDetail>) => {
    const intent = event.detail.intent
    if (intent.kind === 'resolve') handleResolveIntent(intent)
    else if (intent.kind === 'keep-candidate') handleKeepCandidateIntent(intent)
  }) as EventListener)

  function checkForLostResolutionRaces(): void {
    const outbox = contract.sourceMirror.manager(GRAPH_ID).outboxRecords()
    for (const record of outbox) {
      if (record.operation.kind !== 'resolveCurrent') continue
      if (record.status !== 'rejected-permanent' || record.errorCode !== 'stale_sync_conflict') continue
      const conflictId = typeof record.operation.conflictId === 'string' ? record.operation.conflictId : null
      if (!conflictId || lostRaceShownFor.has(conflictId)) continue
      lostRaceShownFor.add(conflictId)
      const objectKey = typeof record.operation.objectKey === 'string' ? record.operation.objectKey : ''
      void showLostRaceDialog({
        dialog: confirmationDialogEl,
        objectLabel: objectLabelFromKey(objectKey),
        testimony: record.error ?? 'sync conflict is not current for this object',
        onLookAgain: () => {
          state = { graphId: GRAPH_ID, selection: { objectKey, conflictId } }
          draw()
        },
      })
    }
  }

  window.__contestedResolutionHarness = {
    async refresh() {
      state = reconcileContestedSelection(state, contract.sourceMirror.bundleFor(GRAPH_ID))
      checkForLostResolutionRaces()
      draw()
    },
    currentSelection: () => state.selection,
    resolveOutboxRows: () =>
      contract.sourceMirror.manager(GRAPH_ID).outboxRecords()
        .filter(record => record.operation.kind === 'resolveCurrent'),
    mirrorState: () => {
      const current = contract.sourceMirror.manager(GRAPH_ID).get()
      return {
        resolving: current.resolving,
        awaitingEpoch: current.awaitingEpoch,
        contestedObjects: current.contestedObjects,
      }
    },
    async reopenColdAndListOutbox() {
      const cold = createGardendContract({ transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' } })
      await cold.sourceMirror.open(GRAPH_ID)
      return cold.sourceMirror.manager(GRAPH_ID).outboxRecords()
        .filter(record => record.operation.kind === 'resolveCurrent')
    },
    lastError: () => lastError,
  }

  draw()
  await workspaceSurfaceReady(container)
  document.body.dataset.contestedResolutionHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.contestedResolutionHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('contested-resolution-harness boot failed:', error)
})
