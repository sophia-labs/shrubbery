import { arrayAt, firstNonBlankString, numberAt, stringAt, valueAt } from './json.js'

export type AgentFloorState = 'open' | 'held'
export type AgentFloorIntent = 'claim' | 'release' | 'steer'

export interface AgentAffordance {
  readonly label: string
  readonly intent: AgentFloorIntent
}

export interface AgentFloorTestimony {
  readonly since?: number
  readonly observer?: string
}

export interface AgentFloor {
  readonly state: AgentFloorState
  readonly holder?: {
    readonly id: string
    readonly isSelf: boolean
  }
  readonly testimony?: AgentFloorTestimony
}

export interface SteeringQueue {
  readonly count: number
  readonly latestText?: string
}

export interface AgentFloorSkeletonFinding {
  readonly kind: 'testimony'
  readonly finding: string
}

export interface AgentFloorEvent {
  readonly ts: number
  readonly type: string
  readonly payload?: unknown
}

export interface AgentFloorInput {
  readonly world?: unknown
  readonly lease?: unknown
  readonly events?: readonly AgentFloorEvent[]
  readonly clientId: string
}

export interface AgentFloorViewModel {
  readonly floor: AgentFloor
  readonly affordances: readonly AgentAffordance[]
  readonly steeringQueue: SteeringQueue
  readonly skeletonFindings: readonly AgentFloorSkeletonFinding[]
}

function worldControl(world: unknown): unknown {
  return valueAt(world, ['worldDoc', 'control']) ?? valueAt(world, ['control'])
}

function leaseFromInput(input: AgentFloorInput): unknown {
  return input.lease ?? valueAt(worldControl(input.world), ['driverLease'])
}

function latestClaimObserver(holderId: string, events: readonly AgentFloorEvent[]): string | null {
  const event = [...events]
    .filter((item) => item.type === 'control.driver-claimed')
    .sort((left, right) => right.ts - left.ts)
    .find((item) => {
      const lease = valueAt(item.payload, ['driverLease'])
      const eventHolder = firstNonBlankString(stringAt(lease, ['clientId']), stringAt(lease, ['holder']))
      return eventHolder === holderId
    })
  return event
    ? firstNonBlankString(
        stringAt(event.payload, ['observer']),
        stringAt(event.payload, ['authorId']),
        stringAt(event.payload, ['clientId']),
      )
    : null
}

function buildSteeringQueue(world: unknown): SteeringQueue {
  const queue = arrayAt(worldControl(world), ['steeringQueue'])
  const latest = queue.at(-1)
  const latestText = firstNonBlankString(stringAt(latest, ['text']))
  return {
    count: queue.length,
    ...(latestText ? { latestText } : {}),
  }
}

export function buildAgentFloor(input: AgentFloorInput): AgentFloorViewModel {
  const lease = leaseFromInput(input)
  const holderId = firstNonBlankString(stringAt(lease, ['clientId']), stringAt(lease, ['holder']))
  const selfId = input.clientId.trim()
  const steeringQueue = buildSteeringQueue(input.world)
  const skeletonFindings: AgentFloorSkeletonFinding[] = []

  if (!holderId) {
    return {
      floor: { state: 'open' },
      affordances: [{ label: 'take the controls', intent: 'claim' }],
      steeringQueue,
      skeletonFindings,
    }
  }

  const since = numberAt(lease, ['claimTs']) ?? numberAt(lease, ['claimedAt'])
  const observer = latestClaimObserver(holderId, input.events ?? [])
  if (since === null) {
    skeletonFindings.push({
      kind: 'testimony',
      finding: 'driverLease omitted claimTs and claimedAt, so Greenhouse omitted since-when floor testimony.',
    })
  }

  const isSelf =
    !!selfId &&
    [holderId, stringAt(lease, ['clientId']), stringAt(lease, ['holder'])]
      .map((value) => value?.trim())
      .some((value) => value === selfId)

  return {
    floor: {
      state: 'held',
      holder: {
        id: holderId,
        isSelf,
      },
      ...(since !== null || observer ? { testimony: { ...(since !== null ? { since } : {}), ...(observer ? { observer } : {}) } } : {}),
    },
    affordances: [isSelf ? { label: 'release', intent: 'release' } : { label: 'steer...', intent: 'steer' }],
    steeringQueue,
    skeletonFindings,
  }
}
