import { describe, expect, it } from 'vitest'
import produced from './fixtures/agent-status-css-native-148c463.json'
import { decodeAgentStatus } from '../agent-status-read.js'
import { decodeCustomCss } from '../custom-css.js'

// Exact native test outputs, independently compared with unique retained log
// markers by Sophia. This is a producer/decoder seam, not signed HTTP or UI.
describe('actual native status and CSS producer outputs', () => {
  it.each(['recent', 'expired'] as const)('accepts the native %s snapshot at the exact millisecond expiry boundary', kind => {
    const value = decodeAgentStatus(produced[kind], 'lab')
    expect(value.graphIncarnation).toBe('inc-1')
    expect(value.agents).toHaveLength(1)
    const report = value.agents[0].reports[0]
    expect(report.expiresAtMs - value.asOfMs).toBe(kind === 'recent' ? 1 : 0)
    expect(report.expiresAtMs - report.reportedAtMs).toBe(60_000)
    expect(report.attribution).toBe('operator-reported')
    expect(report.reporterPrincipal).toBeNull()
  })
  it('refuses the same real output under another graph identity', () => {
    expect(() => decodeAgentStatus(produced.recent, 'other')).toThrow()
  })
  it('accepts native revision3 CSS after real in-process reset and cold Y.Doc decode', async () => {
    const value = await decodeCustomCss(produced.cssWitness.current, 'css-native')
    expect(value.revision).toBe(3)
    expect(value.cssText).toBe('')
    expect(produced.cssWitness.coldYDocRead).toBe(true)
    expect(produced.cssWitness.physicalRestart).toBe(false)
  })
})
