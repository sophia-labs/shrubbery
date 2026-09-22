import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockService } from '../../../editor-services/query-block-service.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'
import {
  createFilmstripResourceAdapter,
  type FilmstripEvidenceService,
  parseFilmstripCoordinates,
} from '../filmstrip-face.js'

const sha = (value: string): string => value.repeat(64)
const manifestUri = `s3://sophia-observatory-evidence/run-1/scenario-1/beat-1/camoufox/manifest-sha256-${sha('a')}.json`
const screenshotUri = `s3://sophia-observatory-evidence/run-1/scenario-1/beat-1/camoufox/screenshot-sha256-${sha('b')}.png`

function result(): QueryBlockResult {
  return {
    resultKind: 'bindings',
    queryKind: 'select',
    durationMs: 1,
    raw: {},
    columns: ['capturedAt', 'graphId', 'payloadJson'],
    rows: [
      {
        capturedAt: { type: 'literal', value: '2026-08-01T12:00:00Z' },
        graphId: { type: 'literal', value: 'obs-hoja-local' },
        payloadJson: {
          type: 'literal',
          value: JSON.stringify({
            run_id: 'run-1',
            scenario_id: 'scenario-1',
            beat_id: 'beat-1',
            engine: 'camoufox',
            operation: 'edit-block',
            evidence_uri: manifestUri,
            evidence_sha256: sha('a'),
          }),
        },
      },
      { payloadJson: { type: 'literal', value: 'private malformed payload' } },
    ],
  }
}

describe('obs.filmstrip', () => {
  it('parses only bounded test.beat coordinates', () => {
    expect(parseFilmstripCoordinates(result())).toEqual([
      {
        capturedAt: '2026-08-01T12:00:00Z',
        graphId: 'obs-hoja-local',
        runId: 'run-1',
        scenarioId: 'scenario-1',
        beatId: 'beat-1',
        engine: 'camoufox',
        operation: 'edit-block',
        manifest: { uri: manifestUri, sha256: sha('a') },
      },
    ])
  })

  it('resolves the thin manifest then its complete PNG ref through the private service', async () => {
    const queryService: QueryBlockService = { async run() { return result() } }
    const calls: Array<{ runId: string; uri: string }> = []
    const screenshot = new Blob(['png'], { type: 'image/png' })
    const evidence: FilmstripEvidenceService = {
      async read(_graphId, runId, ref) {
        calls.push({ runId, uri: ref.uri })
        if (ref.uri === manifestUri) {
          return new Blob([JSON.stringify({
            schema: 'sophia.browser-evidence-beat.v1',
            engine: 'camoufox',
            runId: 'run-1',
            scenarioId: 'scenario-1',
            beatId: 'beat-1',
            evidence: {
              screenshot: {
                uri: screenshotUri,
                sha256: sha('b'),
                bytes: screenshot.size,
                mediaType: 'image/png',
              },
            },
          })], { type: 'application/json' })
        }
        return screenshot
      },
    }
    const adapter = createFilmstripResourceAdapter(queryService, createRawTextQueryResolver(), evidence)
    const resource = await adapter.compute({
      kind: 'query',
      graphId: 'observatory',
      queryId: 'SELECT ?capturedAt ?payloadJson WHERE { }',
    })
    expect(calls).toEqual([
      { runId: 'run-1', uri: manifestUri },
      { runId: 'run-1', uri: screenshotUri },
    ])
    expect(resource.frames).toHaveLength(1)
    expect(resource.frames[0]?.status).toBe('ready')
  })
})
