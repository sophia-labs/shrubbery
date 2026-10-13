// Use happy-dom's actual Storage implementation in a fresh instance per test
// environment. Node's global Web Storage shadows the window under Vitest 3;
// the CLI file option is not forwarded to this fork. No hand-written fake store.
import { Storage } from 'happy-dom'
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new Storage() })
if (typeof localStorage.getItem !== 'function' || typeof localStorage.removeItem !== 'function') {
  throw new Error('CSS test admission requires real DOM Storage')
}
