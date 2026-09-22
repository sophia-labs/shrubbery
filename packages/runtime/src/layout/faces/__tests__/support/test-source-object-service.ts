/**
 * test-source-object-service.ts — TEST-ONLY, minimal REAL `SourceObjectService`
 * over a spawned gardend cell's real MCP `source_pull` tool (no mocks).
 *
 * Deliberately NOT a copy of `apps/organism/src/cell/source-object-runtime.ts`
 * (`packages/runtime` cannot depend on `apps/organism`, D-4) and deliberately
 * scoped to exactly what `card-object-face.integration.test.ts` needs: the
 * MIRROR path only (a real `source_pull`, real `currentState` fold lookup) —
 * mirrors `test-rest-client.ts`'s own "TEST-ONLY, minimal REAL ..." scoping
 * in this same directory. The authority path and the two-path parity proof
 * are `source-object-runtime.integration.test.ts`'s job (apps/organism, G4b).
 */
import { McpClient, McpSourceSyncTransport } from '@shrubbery/source'
import { objectKeyOf, type ObjectKeyParts, type SourceObjectRead, type SourceObjectService } from '../../../source-object-service.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** A REAL, small, fully working SourceObjectService over one fresh `source_pull` per read. */
export class TestSourceObjectService implements SourceObjectService {
  private readonly transport: McpSourceSyncTransport

  constructor(mcp: McpClient) {
    this.transport = new McpSourceSyncTransport(mcp)
  }

  async read(graphId: string, key: ObjectKeyParts): Promise<SourceObjectRead | null> {
    const bundle = await this.transport.pull(graphId)
    const objectKey = objectKeyOf(key)
    const currentState = Array.isArray((bundle as Record<string, unknown>).currentState)
      ? ((bundle as Record<string, unknown>).currentState as readonly Record<string, unknown>[])
      : []
    const face = currentState.find((candidate) => candidate.objectKey === objectKey)
    if (!face || !isRecord(face.record)) return null
    const sourceVersion = stringField(face, 'sourceVersion')
    const reconciliationStrategy = stringField(face, 'reconciliationStrategy')
    return {
      provenance: 'mirror',
      graphId,
      objectKey,
      vocab: stringField(face, 'vocab') ?? key.vocab,
      class: stringField(face, 'class') ?? key.class,
      objectId: stringField(face, 'objectId') ?? key.objectId,
      record: face.record,
      ...(sourceVersion !== undefined ? { sourceVersion } : {}),
      ...(reconciliationStrategy !== undefined ? { reconciliationStrategy } : {}),
      unavailable: ['lastWriter'],
      epoch: typeof (bundle as Record<string, unknown>).epoch === 'string' ? ((bundle as Record<string, unknown>).epoch as string) : '',
    }
  }
}
