/**
 * define-guest-face.test.ts — S1's core face-machinery suite. No mocks: a
 * real `FaceRegistry`, a real hand-written `GuestAppModule` (plain-object
 * call tracking, `fixtures.ts`'s own convention — no spy framework), a real
 * `<div>` mounted into `document.body`.
 */
import type { ViewDescriptor } from '@shrubbery/nucleus/layout'
import { describe, expect, it } from 'vitest'
import { FaceRegistry } from '../../face-registry.js'
import { noFaceParams, type ResourceLease } from '../../types.js'
import {
  defineGuestFace,
  GUEST_CONVERGENCE_RUNGS,
  type DefineGuestFaceOptions,
  type GuestConvergenceRung,
  type GuestFaceView,
} from '../define-guest-face.js'
import type { GuestAppModule, GuestHostContext, GuestMount } from '../guest-app.js'

interface TestGuestHarness {
  readonly guest: GuestAppModule
  readonly mountCalls: GuestHostContext[]
  readonly updateCalls: Array<Partial<GuestHostContext>>
  readonly unmountCount: { count: number }
}

function createTestGuest(): TestGuestHarness {
  const mountCalls: GuestHostContext[] = []
  const updateCalls: Array<Partial<GuestHostContext>> = []
  const unmountCount = { count: 0 }
  const guest: GuestAppModule = {
    id: 'test-guest',
    framework: 'other',
    mount(ctx: GuestHostContext): GuestMount {
      mountCalls.push(ctx)
      const span = document.createElement('span')
      span.textContent = 'hello from guest'
      span.dataset.testGuest = 'mounted'
      span.dataset.base = ctx.base
      ctx.container.appendChild(span)
      return {
        update(next: Partial<GuestHostContext>) {
          updateCalls.push(next)
          if (typeof next.base === 'string') span.dataset.base = next.base
        },
        unmount() {
          unmountCount.count += 1
          span.remove()
        },
      }
    },
  }
  return { guest, mountCalls, updateCalls, unmountCount }
}

function leaseFor(value: unknown): ResourceLease {
  return {
    key: 'test-guest-key',
    shape: 'durable',
    value,
    released: false,
    release() {
      // no-op — nothing this suite needs to observe.
    },
  }
}

function descriptorFor(faceId: string, params?: Record<string, unknown>): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId,
    resource: { kind: 'iri', iri: 'urn:test:guest-face' },
    ...(params ? { params } : {}),
  }
}

function baseOptions(guest: GuestAppModule, convergence: GuestConvergenceRung = 'locally-derived'): DefineGuestFaceOptions {
  return {
    faceId: 'test.guest-face',
    guest,
    convergence,
    cssStrategy: 'light-scoped',
    persistence: 'stamp',
    resourceAdapterId: 'test.guest-adapter',
    accepts: (locator) => locator.kind === 'iri',
    paramsSchema: noFaceParams,
  }
}

function mountedElement(): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  return target
}

describe('defineGuestFace — the full story: register, seal, mount, update, dispose', () => {
  it('registers in a real FaceRegistry, survives seal(), mounts into a real element, forwards update() to the guest, and dispose() empties the target and unmounts exactly once', async () => {
    const harness = createTestGuest()
    const registration = defineGuestFace(baseOptions(harness.guest, 'room-projected'))

    const registry = new FaceRegistry()
    expect(() => registry.register(registration)).not.toThrow()
    expect(() => registry.seal()).not.toThrow()
    expect(registry.has('test.guest-face')).toBe(true)
    expect(registry.get('test.guest-face')).toBe(registration)

    const target = mountedElement()
    const backendValue = { marker: 'backend-value' }
    const descriptor = descriptorFor('test.guest-face', { base: '/flow/' })

    const view = (await registration.mount({
      target,
      descriptor,
      lease: leaseFor(backendValue),
      constraints: { minWidth: 0, minHeight: 0, overflow: 'scroll' },
    })) as GuestFaceView

    // The guest received a real GuestHostContext, sourced from the mount context.
    expect(harness.mountCalls).toHaveLength(1)
    expect(harness.mountCalls[0].base).toBe('/flow/')
    expect(harness.mountCalls[0].backend).toBe(backendValue)
    expect(harness.mountCalls[0].container).toBeInstanceOf(HTMLElement)
    expect(harness.mountCalls[0].signal.aborted).toBe(false)

    // Mounted into a real element — the DOM shows the guest's own output.
    const rendered = target.querySelector('[data-test-guest="mounted"]')
    expect(rendered).toBeTruthy()
    expect(rendered?.textContent).toBe('hello from guest')
    expect((rendered as HTMLElement).dataset.base).toBe('/flow/')

    // update() reaches the guest.
    expect(harness.updateCalls).toHaveLength(0)
    view.update({ base: '/next/' })
    expect(harness.updateCalls).toHaveLength(1)
    expect(harness.updateCalls[0].base).toBe('/next/')
    expect((target.querySelector('[data-test-guest="mounted"]') as HTMLElement).dataset.base).toBe('/next/')

    // dispose (interpreter-facing "unmount"): the target ends up empty, the
    // guest's own unmount() is called exactly once, and the abort signal fires.
    const [{ signal }] = harness.mountCalls
    view.dispose('closed')
    expect(target.childElementCount).toBe(0)
    expect(harness.unmountCount.count).toBe(1)
    expect(signal.aborted).toBe(true)

    // dispose is idempotent — a second call must not call the guest's unmount again.
    view.dispose('closed')
    expect(harness.unmountCount.count).toBe(1)

    target.remove()
  })

  it('defaults base to "/" when the descriptor carries no params.base', async () => {
    const harness = createTestGuest()
    const registration = defineGuestFace(baseOptions(harness.guest))
    const target = mountedElement()

    const view = (await registration.mount({
      target,
      descriptor: descriptorFor('test.guest-face'),
      lease: leaseFor({}),
      constraints: { minWidth: 0, minHeight: 0, overflow: 'scroll' },
    })) as GuestFaceView

    expect(harness.mountCalls[0].base).toBe('/')
    view.dispose('closed')
    target.remove()
  })

  it('serialize() returns the descriptor it was mounted with', async () => {
    const harness = createTestGuest()
    const registration = defineGuestFace(baseOptions(harness.guest))
    const target = mountedElement()
    const descriptor = descriptorFor('test.guest-face')

    const view = (await registration.mount({
      target,
      descriptor,
      lease: leaseFor({}),
      constraints: { minWidth: 0, minHeight: 0, overflow: 'scroll' },
    })) as GuestFaceView

    expect(view.serialize()).toBe(descriptor)
    view.dispose('closed')
    target.remove()
  })
})

describe('defineGuestFace — FLOW-EF-10: the four closed convergence rungs, enforced at definition time', () => {
  it('accepts every ratified rung (room-projected | store-queried | artifact-backed | locally-derived)', () => {
    expect(GUEST_CONVERGENCE_RUNGS).toEqual(['room-projected', 'store-queried', 'artifact-backed', 'locally-derived'])
    for (const convergence of GUEST_CONVERGENCE_RUNGS) {
      const harness = createTestGuest()
      expect(() => defineGuestFace(baseOptions(harness.guest, convergence))).not.toThrow()
    }
  })

  it('throws synchronously, at definition time, for an unknown convergence rung — not deferred to mount', () => {
    const harness = createTestGuest()
    const options = { ...baseOptions(harness.guest), convergence: 'not-a-real-rung' } as unknown as DefineGuestFaceOptions
    expect(() => defineGuestFace(options)).toThrow(/convergence/i)
    // Never reached mount — this is a boot-time rejection (FLOW-EF-10: "rejected at boot, not at paint").
    expect(harness.mountCalls).toHaveLength(0)
  })

  it('throws synchronously, at definition time, for a MISSING convergence rung', () => {
    const harness = createTestGuest()
    const options = { ...baseOptions(harness.guest), convergence: undefined } as unknown as DefineGuestFaceOptions
    expect(() => defineGuestFace(options)).toThrow(/convergence/i)
  })
})

describe('defineGuestFace — guest module validation at definition time', () => {
  it('rejects a guest module missing a mount function', () => {
    const options = {
      ...baseOptions(createTestGuest().guest),
      guest: { id: 'no-mount-fn', framework: 'other' } as unknown as GuestAppModule,
    }
    expect(() => defineGuestFace(options)).toThrow(/validateGuestModule/)
  })

  it('rejects a guest module with an empty id', () => {
    const options = {
      ...baseOptions(createTestGuest().guest),
      guest: { id: '', framework: 'other', mount: () => ({ unmount() {} }) } as unknown as GuestAppModule,
    }
    expect(() => defineGuestFace(options)).toThrow(/validateGuestModule/)
  })

  it('rejects a guest module with an unrecognized framework', () => {
    const options = {
      ...baseOptions(createTestGuest().guest),
      guest: { id: 'x', framework: 'svelte', mount: () => ({ unmount() {} }) } as unknown as GuestAppModule,
    }
    expect(() => defineGuestFace(options)).toThrow(/validateGuestModule/)
  })
})
