import { describe, expect, it } from 'vitest'

import { buildAgentFloor } from '@shrubbery/nucleus'

const worldBase = {
  worldDoc: {
    control: {
      driverLease: null,
      steeringQueue: [],
    },
  },
}

describe('buildAgentFloor', () => {
  it('renders an open floor with the earned claim affordance', () => {
    expect(buildAgentFloor({ world: worldBase, clientId: 'greenhouse-v1' })).toEqual({
      floor: { state: 'open' },
      affordances: [{ label: 'take the controls', intent: 'claim' }],
      steeringQueue: { count: 0 },
      skeletonFindings: [],
    })
  })

  it('recognizes a held floor owned by this client from live lease identity', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: {
              holder: 'greenhouse-v1',
              clientId: 'greenhouse-v1',
              claimTs: 1783177200000,
              claimedAt: 1783177200000,
              epoch: 4,
            },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse-v1',
    })

    expect(floor.floor).toEqual({
      state: 'held',
      holder: { id: 'greenhouse-v1', isSelf: true },
      testimony: { since: 1783177200000 },
    })
    expect(floor.affordances).toEqual([{ label: 'release', intent: 'release' }])
    expect(floor.skeletonFindings).toEqual([])
  })

  it('recognizes a held floor owned by another client and offers steering', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: {
              holder: 'vehicle-web',
              clientId: 'vehicle-web',
              claimedAt: 1783177300000,
              epoch: 5,
            },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse-v1',
    })

    expect(floor.floor).toEqual({
      state: 'held',
      holder: { id: 'vehicle-web', isSelf: false },
      testimony: { since: 1783177300000 },
    })
    expect(floor.affordances).toEqual([{ label: 'steer...', intent: 'steer' }])
  })

  it('populates claim observer testimony from the latest matching driver-claimed event', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: {
              holder: 'vehicle-web',
              clientId: 'vehicle-web',
              claimTs: 1783177300000,
              epoch: 5,
            },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse-v1',
      events: [
        {
          ts: 1783177200000,
          type: 'control.driver-claimed',
          payload: {
            driverLease: { holder: 'other-client', clientId: 'other-client' },
            observer: 'wrong-observer',
          },
        },
        {
          ts: 1783177300000,
          type: 'control.driver-claimed',
          payload: {
            driverLease: { holder: 'vehicle-web', clientId: 'vehicle-web' },
            observer: 'greenhouse-observer',
          },
        },
      ],
    })

    expect(floor.floor.testimony?.observer).toBe('greenhouse-observer')
  })

  it('omits claim observer testimony when no driver-claimed event matches the holder', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: {
              holder: 'vehicle-web',
              clientId: 'vehicle-web',
              claimTs: 1783177300000,
              epoch: 5,
            },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse-v1',
      events: [
        {
          ts: 1783177300000,
          type: 'control.driver-claimed',
          payload: {
            driverLease: { holder: 'other-client', clientId: 'other-client' },
            observer: 'wrong-observer',
          },
        },
      ],
    })

    expect(floor.floor.testimony).toEqual({ since: 1783177300000 })
    expect(floor.floor.testimony?.observer).toBeUndefined()
  })

  it('counts the live steering queue and preserves latest text', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: null,
            steeringQueue: [
              { id: 'steer:1', clientId: 'vera', text: 'open the notes', ts: 1783177100000 },
              { id: 'steer:2', clientId: 'vera', text: 'compare the leases', ts: 1783177200000 },
            ],
          },
        },
      },
      clientId: 'greenhouse-v1',
    })

    expect(floor.steeringQueue).toEqual({ count: 2, latestText: 'compare the leases' })
  })

  it('omits absent since-when testimony and records the skeleton finding', () => {
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: { holder: 'vehicle-web', clientId: 'vehicle-web', epoch: 6 },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse-v1',
    })

    expect(floor.floor).toEqual({
      state: 'held',
      holder: { id: 'vehicle-web', isSelf: false },
    })
    expect(floor.skeletonFindings).toEqual([
      {
        kind: 'testimony',
        finding: 'driverLease omitted claimTs and claimedAt, so Greenhouse omitted since-when floor testimony.',
      },
    ])
  })
})
