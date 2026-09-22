/** Pure scene ↔ workspace-node link helpers, ported from Garden cf0cb960. */

export type SceneLinkKind = 'document' | 'artifact'

export interface SceneLinkTarget {
  readonly kind: SceneLinkKind
  readonly graphId: string
  readonly id: string
}

export interface SceneLinkRecord extends SceneLinkTarget {
  readonly title: string
}

export interface SceneLinkResolution {
  readonly exists: boolean
  readonly title?: string | null
  readonly wireDocumentId?: string | null
  readonly mimeType?: string | null
}

export type SceneLinkResolver = (
  target: SceneLinkTarget,
) => SceneLinkResolution | null | undefined

export interface SceneLinkTitleRefreshResult {
  readonly elements: Record<string, unknown>[]
  readonly updated: number
  readonly missing: number
}

const SCHEME = 'mnemosyne://'

export function buildSceneLink(kind: SceneLinkKind, graphId: string, id: string): string {
  return `${SCHEME}${kind}/${encodeURIComponent(graphId)}/${encodeURIComponent(id)}`
}

export function parseSceneLink(url: string | null | undefined): SceneLinkTarget | null {
  if (!url?.startsWith(SCHEME)) return null
  const parts = url.slice(SCHEME.length).split('/')
  if (parts.length !== 3) return null
  const [kind, graphId, id] = parts
  if ((kind !== 'document' && kind !== 'artifact') || !graphId || !id) return null
  try {
    return { kind, graphId: decodeURIComponent(graphId), id: decodeURIComponent(id) }
  } catch {
    return null
  }
}

export function buildSceneLinkRecord(
  kind: SceneLinkKind,
  graphId: string,
  id: string,
  title: string,
): SceneLinkRecord {
  return { kind, graphId, id, title }
}

export function sceneLinkRecordFromElement(element: unknown): SceneLinkRecord | null {
  if (!isRecord(element)) return null
  const customData = isRecord(element.customData) ? element.customData : null
  const record = isRecord(customData?.mnemosyne) ? customData.mnemosyne : null
  const kind = stringValue(record?.kind)
  const graphId = stringValue(record?.graphId)
  const id = stringValue(record?.id)
  const title = stringValue(record?.title)
  if ((kind !== 'document' && kind !== 'artifact') || !graphId || !id || title === null) return null
  return { kind, graphId, id, title }
}

/** Resolve either canonical customData or the URI fallback used by old scenes. */
export function sceneLinkTargetFromElement(element: unknown): SceneLinkTarget | null {
  const record = sceneLinkRecordFromElement(element)
  if (record) return { kind: record.kind, graphId: record.graphId, id: record.id }
  return isRecord(element) ? parseSceneLink(stringValue(element.link)) : null
}

export function linkSceneElement(
  elements: readonly unknown[],
  elementId: string,
  target: SceneLinkRecord,
): Record<string, unknown>[] {
  const link = buildSceneLink(target.kind, target.graphId, target.id)
  return elements.filter(isRecord).map((element) => {
    if (element.id !== elementId) return element
    const customData = isRecord(element.customData) ? { ...element.customData } : {}
    customData.mnemosyne = target
    return { ...element, link, customData }
  })
}

export function unlinkSceneElement(
  elements: readonly unknown[],
  elementId: string,
): Record<string, unknown>[] {
  return elements.filter(isRecord).map((element) => {
    if (element.id !== elementId) return element
    const customData = isRecord(element.customData) ? { ...element.customData } : {}
    delete customData.mnemosyne
    return { ...element, link: null, customData }
  })
}

export function refreshSceneLinkTitles(
  elements: readonly unknown[],
  resolve: SceneLinkResolver,
): SceneLinkTitleRefreshResult {
  const textUpdates = new Map<string, { previous: string; next: string }>()
  let updated = 0
  let missing = 0

  const refreshed = elements.filter(isRecord).map((element) => {
    const record = sceneLinkRecordFromElement(element)
    if (!record) return element
    const resolution = resolve(record)
    if (!resolution) return element
    if (!resolution.exists) {
      missing += 1
      return element
    }
    const title = resolution.title?.trim()
    if (!title || title === record.title) return element

    updated += 1
    const elementId = stringValue(element.id)
    if (elementId) textUpdates.set(elementId, { previous: record.title, next: title })
    const customData = isRecord(element.customData) ? { ...element.customData } : {}
    customData.mnemosyne = { ...record, title }
    return { ...element, customData }
  })

  if (textUpdates.size === 0) return { elements: refreshed, updated, missing }
  return {
    elements: refreshed.map((element) => {
      const elementId = stringValue(element.id)
      const containerId = stringValue(element.containerId)
      const update = (elementId ? textUpdates.get(elementId) : null)
        ?? (containerId ? textUpdates.get(containerId) : null)
      if (!update || element.type !== 'text') return element
      const currentText = stringValue(element.text)?.trim()
      if (currentText !== update.previous && currentText !== sceneTitleLabel(update.previous)) return element
      const next = sceneTitleLabel(update.next)
      return { ...element, text: next, originalText: next }
    }),
    updated,
    missing,
  }
}

export function sceneTitleLabel(title: string): string {
  return title.length > 40 ? `${title.slice(0, 39)}…` : title
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
