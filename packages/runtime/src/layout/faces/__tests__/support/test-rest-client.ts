/**
 * test-rest-client.ts — TEST-ONLY, minimal REAL `RestClient` over a spawned
 * gardend cell's real MCP `sparql_query`/`sparql_update` tools (no mocks).
 *
 * Deliberately NOT a copy of `apps/organism/src/cell/gardend-contract.ts`'s
 * production `LoopbackRestClient` (`packages/runtime` cannot depend on
 * `apps/organism`) and deliberately NOT reimplementing that class's
 * `graphs()` catalog parsing or wire-writer concerns — this is scoped to
 * exactly what the query-backed face integration tests in this directory
 * need: real `query`/`update` over a real `McpClient` (mirrors
 * `loopback-crdt-backend.ts`'s own "TEST-ONLY, minimal REAL ..." scoping in
 * this same directory, for the CRDT side).
 */
import type { RestClient } from '@shrubbery/nucleus'
import { McpClient, mcpText } from '@shrubbery/source'

export class TestRestClient implements RestClient {
  constructor(private readonly mcp: McpClient) {}

  async graphs(): Promise<unknown> {
    throw new Error('TestRestClient.graphs() is not needed by the query-backed face integration tests')
  }

  /** POST /graphs/query equivalent → sparql_query tools/call. Returns the parsed envelope `makeQueryBlockService` expects. */
  async query(graphId: string, sparql: string): Promise<unknown> {
    const result = await this.mcp.toolsCall('sparql_query', { graphId, query: sparql })
    return JSON.parse(mcpText(result))
  }

  async update(graphId: string, sparql: string): Promise<void> {
    await this.mcp.toolsCall('sparql_update', { graphId, update: sparql })
  }
}
