import type { DomainDirectTool } from '../agent-bundle.js'
import type { DomainNamedQueryDefinition } from '../types.js'

export const DOMAIN_SEED_EPOCH = Date.parse('2026-08-03T00:00:00.000Z')
export const PLATFORM_STEWARD = 'user:platform-steward'

export const GRAPH_READER_TOOLS: readonly DomainDirectTool[] = [
  {
    name: 'recall',
    title: 'Recall',
    description: 'Read durable Geist memory from earlier embodiments of this agent.',
    capability: 'mnemosyne',
    access: 'read',
    risk: 'low',
    required: true,
  },
  {
    name: 'search_documents',
    title: 'Search documents',
    description: 'Find graph documents by grounded text search.',
    capability: 'mnemosyne',
    access: 'read',
    risk: 'low',
    required: true,
  },
  {
    name: 'sparql_query',
    title: 'SPARQL query',
    description: 'Run read-only SPARQL against the bound graph.',
    capability: 'mnemosyne',
    access: 'read',
    risk: 'low',
    required: true,
  },
]

export function standardDomainQueries(domain: string): readonly DomainNamedQueryDefinition[] {
  const prefix = `urn:sophia:query:${domain}`
  return [
    {
      name: `${prefix}.claims.summary`,
      readerQuestion: 'How many capability claims does this domain declare?',
      description: 'Counts projected capability claims as one scalar in the current domain graph.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT (COUNT(?claim) AS ?value) WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> {
    ?claim a domain:CapabilityClaim .
  }
}`,
    },
    {
      name: `${prefix}.verdicts.current`,
      readerQuestion: 'Which scoped claims currently pass, fail, or remain blocked?',
      description: 'Lists the latest content-addressed verdict records served by the domain.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT ?item ?capabilityId ?tier ?mode ?role ?targetSha256 ?outcome ?reason ?asOf WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> {
    ?claim a domain:CapabilityClaim ;
      domain:stableId ?capabilityId ;
      domain:tier ?tierNode .
    ?tierNode domain:stableId ?tier .
  }
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
    ?item a domain:Verdict ;
      domain:capabilityId ?capabilityId ;
      domain:modeId ?mode ;
      domain:roleId ?role ;
      domain:targetSha256 ?targetSha256 ;
      domain:outcome ?outcome ;
      domain:asOf ?asOf .
    OPTIONAL { ?item domain:reason ?reason }
    FILTER NOT EXISTS {
      ?newer a domain:Verdict ;
        domain:capabilityId ?capabilityId ;
        domain:modeId ?mode ;
        domain:roleId ?role ;
        domain:asOf ?newerAsOf .
      FILTER (?newerAsOf > ?asOf)
    }
  }
}
ORDER BY DESC(?asOf)`,
      opensGroundingGap: 'Verdict projection remains UNKNOWN until at least one real evidence-bearing run has written it.',
    },
    {
      name: `${prefix}.verdicts.coverage`,
      readerQuestion: 'What fraction of declared claims has a current verdict?',
      description: 'Reports scoped capability-mode-role verdict coverage as a scalar suitable for the shared dashboard.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT ((?coveredCount * 100.0) / ?scopeCount AS ?value) WHERE {
  {
    SELECT (COUNT(DISTINCT ?scope) AS ?scopeCount) WHERE {
      GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> {
        ?claim a domain:CapabilityClaim ;
          domain:stableId ?capabilityId ;
          domain:mode ?modeNode ;
          domain:role ?roleNode .
        ?modeNode domain:stableId ?mode .
        ?roleNode domain:stableId ?role .
      }
      BIND(CONCAT(?capabilityId, "|", ?mode, "|", ?role) AS ?scope)
    }
  }
  {
    SELECT (COUNT(DISTINCT ?scope) AS ?coveredCount) WHERE {
      GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> {
        ?claim a domain:CapabilityClaim ;
          domain:stableId ?capabilityId ;
          domain:mode ?modeNode ;
          domain:role ?roleNode .
        ?modeNode domain:stableId ?mode .
        ?roleNode domain:stableId ?role .
      }
      GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
        ?verdict a domain:Verdict ;
          domain:capabilityId ?capabilityId ;
          domain:modeId ?mode ;
          domain:roleId ?role .
      }
      BIND(CONCAT(?capabilityId, "|", ?mode, "|", ?role) AS ?scope)
    }
  }
}`,
      opensGroundingGap: 'Coverage is not completion: stale, failed, and blocked verdicts remain visible.',
    },
    {
      name: `${prefix}.claims.untested`,
      readerQuestion: 'Which declared capability-mode-role scopes have no verdict yet?',
      description: 'Lists the honest untested queue over the manifest scope rather than claim IDs alone.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT ?item ?capabilityId ?title ?tier ?mode ?role WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> {
    ?item a domain:CapabilityClaim ;
      domain:stableId ?capabilityId ;
      domain:title ?title ;
      domain:tier ?tierNode ;
      domain:mode ?modeNode ;
      domain:role ?roleNode .
    ?tierNode domain:stableId ?tier .
    ?modeNode domain:stableId ?mode .
    ?roleNode domain:stableId ?role .
  }
  FILTER NOT EXISTS {
    GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
      ?verdict a domain:Verdict ;
        domain:capabilityId ?capabilityId ;
        domain:modeId ?mode ;
        domain:roleId ?role .
    }
  }
}
ORDER BY ?tier ?capabilityId ?mode ?role`,
      opensGroundingGap: 'An empty untested queue says only that every declared scope has testimony; it does not imply that every scope passes.',
    },
    {
      name: `${prefix}.verdicts.attention`,
      readerQuestion: 'Which current scoped verdicts require attention?',
      description: 'Lists only the newest FAIL or BLOCKED verdict for each capability-mode-role scope.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT ?item ?capabilityId ?mode ?role ?targetSha256 ?outcome ?reason ?asOf WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
    ?item a domain:Verdict ;
      domain:capabilityId ?capabilityId ;
      domain:modeId ?mode ;
      domain:roleId ?role ;
      domain:targetSha256 ?targetSha256 ;
      domain:outcome ?outcome ;
      domain:asOf ?asOf .
    VALUES ?outcome { domain:FAIL domain:BLOCKED }
    OPTIONAL { ?item domain:reason ?reason }
    FILTER NOT EXISTS {
      ?newer a domain:Verdict ;
        domain:capabilityId ?capabilityId ;
        domain:modeId ?mode ;
        domain:roleId ?role ;
        domain:asOf ?newerAsOf .
      FILTER (?newerAsOf > ?asOf)
    }
  }
}
ORDER BY DESC(?asOf)`,
      opensGroundingGap: 'FAIL and BLOCKED remain first-class testimony; the dashboard must not collapse them into missing data.',
    },
    {
      name: `${prefix}.verdicts.attention-count`,
      readerQuestion: 'How many current scoped verdicts require attention?',
      description: 'Counts the newest FAIL or BLOCKED verdict for every capability-mode-role scope as one scalar.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT (COUNT(?item) AS ?value) WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
    ?item a domain:Verdict ;
      domain:capabilityId ?capabilityId ;
      domain:modeId ?mode ;
      domain:roleId ?role ;
      domain:outcome ?outcome ;
      domain:asOf ?asOf .
    VALUES ?outcome { domain:FAIL domain:BLOCKED }
    FILTER NOT EXISTS {
      ?newer a domain:Verdict ;
        domain:capabilityId ?capabilityId ;
        domain:modeId ?mode ;
        domain:roleId ?role ;
        domain:asOf ?newerAsOf .
      FILTER (?newerAsOf > ?asOf)
    }
  }
}`,
      opensGroundingGap: 'A zero attention count does not imply full coverage; untested scopes remain a separate queue.',
    },
    {
      name: `${prefix}.evidence.recent`,
      readerQuestion: 'Which recent browser beats have content-addressed Observatory evidence?',
      description: 'Returns the bounded test.beat coordinates consumed by the private obs.filmstrip evidence resolver.',
      text: `PREFIX obs: <http://mnemosyne.dev/observatory#>
SELECT ?capturedAt ?graphId ?payloadJson WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:obs:raw> {
    ?item a obs:CaptureEvent ;
      obs:kind "test.beat" ;
      obs:capturedAt ?capturedAt ;
      obs:graphId ?graphId ;
      obs:payloadJson ?payloadJson .
  }
}
ORDER BY DESC(?capturedAt)
LIMIT 24`,
      opensGroundingGap: 'The evidence query exposes only thin coordinates; the host still authorizes and verifies every private artifact fetch.',
    },
    {
      name: `${prefix}.agent.sessions`,
      readerQuestion: 'Which durable sessions record this domain agent\'s otherwise disposable activity waves?',
      description: 'Lists graph-projected agent sessions and their latest turn time from the stronger Garden session projection seam.',
      text: `PREFIX agt: <http://mnemosyne.dev/agent#>
SELECT ?item ?agent ?model ?turnCount (MAX(?turnTime) AS ?latestTurn) WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:session> {
    ?item a agt:Session ;
      agt:ofAgent ?agent ;
      agt:turnCount ?turnCount .
    OPTIONAL { ?item agt:model ?model }
    OPTIONAL {
      ?turn a agt:Turn ;
        agt:inSession ?item ;
        agt:turnTime ?turnTime .
    }
  }
}
GROUP BY ?item ?agent ?model ?turnCount
ORDER BY DESC(?latestTurn)`,
      opensGroundingGap: 'No session row means no witnessed activity wave; a dormant agent is not inferred to be running.',
    },
    {
      name: `${prefix}.freshness`,
      readerQuestion: 'When was this domain last evidenced?',
      description: 'Returns the newest verdict time; missing data is deliberately UNKNOWN.',
      text: `PREFIX domain: <http://sophia.ai/domain#>
SELECT (MAX(?asOf) AS ?value) WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> {
    ?verdict a domain:Verdict ; domain:asOf ?asOf .
  }
}`,
      opensGroundingGap: 'A missing maximum means no evidence-bearing verdict exists; it must not render as fresh.',
    },
  ]
}

export const DOMAIN_AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'status', 'evidenceRefs'],
  properties: {
    summary: { type: 'string' },
    status: { enum: ['complete', 'needs-attention', 'blocked', 'no-op'] },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
    nextTrigger: { type: ['object', 'null'] },
  },
} as const
