import type {
  CrdtProviderLifecycle,
  ReactiveSource,
} from './contract.js'

const SYNCHRONIZED: CrdtProviderLifecycle = Object.freeze({
  connection: 'connected',
  synchronized: true,
  shouldConnect: true,
})

/**
 * Immutable lifecycle source for in-process providers whose local Y.Doc is the
 * authority. Network providers must expose their real event-driven lifecycle.
 */
export function synchronizedCrdtProviderLifecycle(): ReactiveSource<CrdtProviderLifecycle> {
  return {
    get: () => SYNCHRONIZED,
    subscribe: () => () => {},
  }
}
