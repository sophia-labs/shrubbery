/**
 * Whiteboard presence over the room's awareness (as `crdt-presence.ts` publishes the editor's): where each person's
 * pointer is, as Excalidraw's `collaborators`, and the one-line "who drew what just now".
 */
import type { WbToolWrite } from './whiteboard-binding.js'

export interface AwarenessLike {
  readonly clientID: number
  getStates(): Map<number, Record<string, unknown>>
  setLocalStateField(field: string, value: unknown): void
  on(event: 'change', callback: () => void): void
  off(event: 'change', callback: () => void): void
}

export interface CollaboratorView {
  readonly pointer?: { x: number; y: number; tool: 'pointer' | 'laser' }
  readonly username: string
  readonly color: { background: string; stroke: string }
  readonly id: string
}

const FIELD = 'whiteboard'

/** Everyone else in the room: Excalidraw's `collaborators` map (keyed by a stable per-client id). */
export function collaboratorsOf(awareness: AwarenessLike): Map<string, CollaboratorView> {
  const out = new Map<string, CollaboratorView>()
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue
    const user = (state.user ?? {}) as { name?: unknown; color?: unknown; type?: unknown }
    const wb = (state[FIELD] ?? {}) as { pointer?: { x?: unknown; y?: unknown; tool?: unknown } }
    const name = typeof user.name === 'string' && user.name ? user.name : 'Someone'
    const color = typeof user.color === 'string' && user.color ? user.color : '#868e96'
    const p = wb.pointer
    out.set(`client-${clientId}`, {
      id: `client-${clientId}`,
      username: name,
      color: { background: color, stroke: color },
      ...(p && typeof p.x === 'number' && typeof p.y === 'number'
        ? { pointer: { x: p.x, y: p.y, tool: p.tool === 'laser' ? 'laser' as const : 'pointer' as const } }
        : {}),
    })
  }
  return out
}

/** Publish this client's pointer (scene coordinates), throttled by the caller. */
export function publishPointer(awareness: AwarenessLike, pointer: { x: number; y: number; tool: 'pointer' | 'laser' } | null): void {
  awareness.setLocalStateField(FIELD, pointer ? { pointer } : {})
}

/** The smallest client id in the room leads (writes corrected sizes back); alone, you lead. */
export function isLeader(awareness: AwarenessLike): boolean {
  let min = awareness.clientID
  for (const clientId of awareness.getStates().keys()) if (clientId < min) min = clientId
  return min === awareness.clientID
}

/** A name for who drew: only what is known. */
export function drawerName(by: string): string {
  if (by === 'tool' || by === 'owner') return 'Sophia'
  if (by.startsWith('agent:')) return by.slice('agent:'.length) || 'An agent'
  if (by.startsWith('service:')) return by.slice('service:'.length) || 'A service'
  return by
}

/** "Sophia drew 2 shapes". */
export function toolDrewLine(write: WbToolWrite, shapes: number): string {
  return `${drawerName(write.by)} drew ${shapes} ${shapes === 1 ? 'shape' : 'shapes'}`
}
