import type {
  SourceBundle,
  SourceOperation,
  SourcePushResult,
  SourceSyncTransport,
} from './source-mirror.js'

/**
 * The narrow MCP capability source sync needs. Both local-loopback and hosted
 * gateway shells can provide this without exposing credentials to the mirror.
 */
export interface SourceSyncToolCaller {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

function objectPayload(value: unknown, tool: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`SourceSyncTransport: ${tool} returned a non-object payload`)
  }
  return value as Record<string, unknown>
}

/**
 * Source-aware protocol adapter over an already-authenticated MCP caller.
 * Parsing JSON-RPC/content envelopes belongs to the caller; this adapter owns
 * only the stable source_pull/source_push contract.
 */
export class McpSourceSyncTransport implements SourceSyncTransport {
  constructor(private readonly caller: SourceSyncToolCaller) {}

  async pull(graphId: string, graphIncarnation?: string): Promise<SourceBundle> {
    const payload = objectPayload(await this.caller.callTool('source_pull', {
      graphId,
      ...(graphIncarnation ? { graphIncarnation } : {}),
    }), 'source_pull')
    return payload as unknown as SourceBundle
  }

  async push(
    graphId: string,
    graphIncarnation: string,
    operations: readonly SourceOperation[],
  ): Promise<SourcePushResult> {
    const payload = objectPayload(await this.caller.callTool('source_push', {
      graphId,
      graphIncarnation,
      operations,
    }), 'source_push')
    return payload as unknown as SourcePushResult
  }
}
