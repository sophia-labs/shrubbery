import {
  DEFAULT_FILE_PANE_GROUPING,
  DEFAULT_FILE_PANE_SORT,
  type FilePaneColumnPathChangeDetail,
  type FilePaneGrouping,
  type FilePaneSelectionDetail,
  type FilePaneSort,
} from '@shrubbery/nucleus'

export interface FilePaneStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface FilePaneSessionState {
  readonly sort: FilePaneSort
  readonly grouping: FilePaneGrouping
  readonly selectedIds: readonly string[]
  readonly selectionAnchorId: string | null
  readonly columnPaths: Readonly<Record<string, readonly string[]>>
}

const STORAGE_PREFIX = 'shrubbery:file-pane:v1'

function defaultState(): FilePaneSessionState {
  return {
    sort: { ...DEFAULT_FILE_PANE_SORT },
    grouping: { ...DEFAULT_FILE_PANE_GROUPING },
    selectedIds: [],
    selectionAnchorId: null,
    columnPaths: {},
  }
}

function storageKey(graphId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(graphId)}`
}

function isSortCriterion(value: unknown): value is FilePaneSort['criterion'] {
  return value === 'manual'
    || value === 'alphabetical'
    || value === 'created'
    || value === 'last-accessed'
    || value === 'connectivity'
}

function normalizedState(value: unknown): FilePaneSessionState {
  if (!value || typeof value !== 'object') return defaultState()
  const record = value as Record<string, unknown>
  const sortRecord = record.sort && typeof record.sort === 'object'
    ? record.sort as Record<string, unknown>
    : {}
  const groupingRecord = record.grouping && typeof record.grouping === 'object'
    ? record.grouping as Record<string, unknown>
    : {}
  const rawPaths = record.columnPaths && typeof record.columnPaths === 'object'
    ? record.columnPaths as Record<string, unknown>
    : {}
  const columnPaths: Record<string, readonly string[]> = {}
  for (const [sectionId, ids] of Object.entries(rawPaths)) {
    if (!Array.isArray(ids)) continue
    columnPaths[sectionId] = [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
  }
  const selectedIds = Array.isArray(record.selectedIds)
    ? [...new Set(record.selectedIds.filter((id): id is string => typeof id === 'string'))]
    : []
  return {
    sort: {
      criterion: isSortCriterion(sortRecord.criterion) ? sortRecord.criterion : DEFAULT_FILE_PANE_SORT.criterion,
      direction: sortRecord.direction === 'desc' ? 'desc' : 'asc',
      foldersFirst: sortRecord.foldersFirst !== false,
    },
    grouping: {
      separateArtifacts: groupingRecord.separateArtifacts !== false,
      showFolders: groupingRecord.showFolders !== false,
    },
    selectedIds,
    selectionAnchorId: typeof record.selectionAnchorId === 'string' ? record.selectionAnchorId : null,
    columnPaths,
  }
}

function cloneState(state: FilePaneSessionState): FilePaneSessionState {
  return {
    sort: { ...state.sort },
    grouping: { ...state.grouping },
    selectedIds: [...state.selectedIds],
    selectionAnchorId: state.selectionAnchorId,
    columnPaths: Object.fromEntries(
      Object.entries(state.columnPaths).map(([sectionId, ids]) => [sectionId, [...ids]]),
    ),
  }
}

/**
 * Per-graph, per-tab presentation authority for the controlled file pane.
 * Canonical document/folder data never enters this controller.
 */
export class FilePaneController {
  private readonly states = new Map<string, FilePaneSessionState>()

  constructor(private readonly storage: FilePaneStorageLike | null) {}

  snapshot(graphId: string): FilePaneSessionState {
    const existing = this.states.get(graphId)
    if (existing) return cloneState(existing)
    let initial = defaultState()
    const raw = this.storage?.getItem(storageKey(graphId))
    if (raw) {
      try {
        initial = normalizedState(JSON.parse(raw))
      } catch {
        initial = defaultState()
      }
    }
    this.states.set(graphId, initial)
    return cloneState(initial)
  }

  setSort(graphId: string, sort: FilePaneSort): FilePaneSessionState {
    return this.update(graphId, { sort: normalizedState({ sort }).sort })
  }

  setGrouping(graphId: string, grouping: FilePaneGrouping): FilePaneSessionState {
    return this.update(graphId, { grouping: normalizedState({ grouping }).grouping })
  }

  setSelection(graphId: string, detail: FilePaneSelectionDetail): FilePaneSessionState {
    return this.update(graphId, {
      selectedIds: [...new Set(detail.ids)],
      selectionAnchorId: detail.anchorId,
    })
  }

  setColumnPath(graphId: string, detail: FilePaneColumnPathChangeDetail): FilePaneSessionState {
    const current = this.snapshot(graphId)
    return this.update(graphId, {
      columnPaths: {
        ...current.columnPaths,
        [detail.sectionId]: [...new Set(detail.folderIds)],
      },
    })
  }

  clearTransientSelection(graphId: string): FilePaneSessionState {
    return this.update(graphId, { selectedIds: [], selectionAnchorId: null })
  }

  private update(graphId: string, patch: Partial<FilePaneSessionState>): FilePaneSessionState {
    const next = normalizedState({ ...this.snapshot(graphId), ...patch })
    this.states.set(graphId, next)
    this.storage?.setItem(storageKey(graphId), JSON.stringify(next))
    return cloneState(next)
  }
}
