export interface KochActor {
  /** Stable authenticated subject (Cognito sub in hosted mode; explicit dev id locally). */
  readonly id: string
  /** Graph-visible name used in graph performance views. Never used as identity. */
  readonly displayName: string
}

export function normalizeActorId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160) {
    throw new Error('A Koch actor id must contain between 1 and 160 characters.')
  }
  return normalized
}

export function normalizeDisplayName(value: string, actorId: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 48)
  if (normalized) return normalized
  return actorId === 'local' ? 'Local learner' : `Learner ${actorId.slice(0, 6)}`
}

export function actorKey(actorId: string): string {
  return encodeURIComponent(normalizeActorId(actorId))
}
