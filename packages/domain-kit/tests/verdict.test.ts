import { parseNT } from '@shrubbery/nucleus'
import { describe, expect, it } from 'vitest'
import {
  buildDomainVerdict,
  parseDomainVerdict,
  verdictFromTriples,
  verdictToNt,
  verdictToProjectionRecords,
} from '../src/verdict.js'

const SHA = 'a'.repeat(64)
const EVIDENCE_SHA = 'b'.repeat(64)

describe('Domain Kit verdict contract', () => {
  it('round-trips a content-addressed, session-attributed verdict', () => {
    const verdict = buildDomainVerdict({
      domain: 'shrub',
      capabilityId: 'ACC-CAP-EDIT-001',
      mode: 'local-cell',
      role: 'local-owner',
      targetSha256: SHA,
      outcome: 'PASS',
      evidence: [
        {
          uri: 's3://sophia-evidence/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sha256: EVIDENCE_SHA,
          mediaType: 'application/zip',
        },
      ],
      asOf: '2026-08-03T12:00:00.000Z',
      agentSessionUri: 'urn:sophia:agent:agent-deadbeefdeadbeef:session:wfr-1',
    })
    const recovered = verdictFromTriples(parseNT(verdictToNt(verdict)))
    expect(recovered).toEqual(verdict)
    expect(verdict.verdictId).toMatch(/^urn:sophia:domain:shrub:verdict:[0-9a-f]{64}$/)
    expect(verdictToProjectionRecords(verdict)).toEqual([
      expect.objectContaining({
        kind: 'Verdict',
        localId: verdict.verdictId,
        outcome: 'http://sophia.ai/domain#PASS',
        evidence: [expect.stringMatching(/^urn:sophia:domain:evidence:[0-9a-f]{64}$/)],
      }),
      expect.objectContaining({
        kind: 'EvidenceRef',
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        contentUri: 's3://sophia-evidence/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        contentSha256: EVIDENCE_SHA,
      }),
    ])
  })

  it('makes unaddressed evidence and unscoped outcomes unrepresentable', () => {
    expect(() =>
      buildDomainVerdict({
        domain: 'shrub',
        capabilityId: 'ACC-CAP-EDIT-001',
        mode: 'local-cell',
        role: 'local-owner',
        targetSha256: SHA,
        outcome: 'FAIL',
        evidence: [],
        asOf: '2026-08-03T12:00:00.000Z',
        agentSessionUri: 'urn:sophia:agent:agent-deadbeefdeadbeef:session:wfr-1',
      }),
    ).toThrow(/requires at least one/)
    expect(() => parseDomainVerdict({ schema: 'sophia.domain-verdict.v1' })).toThrow()
    const valid = buildDomainVerdict({
      domain: 'shrub',
      capabilityId: 'ACC-CAP-EDIT-001',
      mode: 'local-cell',
      role: 'local-owner',
      targetSha256: SHA,
      outcome: 'PASS',
      evidence: [{ uri: 'urn:sophia:evidence:one', sha256: EVIDENCE_SHA }],
      asOf: '2026-08-03T12:00:00.000Z',
      agentSessionUri: 'urn:sophia:agent:agent-deadbeefdeadbeef:session:wfr-1',
    })
    expect(() => parseDomainVerdict({ ...valid, apply: true })).toThrow(/unsupported fields: apply/)
  })
})
