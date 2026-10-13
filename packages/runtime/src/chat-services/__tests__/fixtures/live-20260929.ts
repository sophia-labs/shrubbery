/**
 * What the LIVE host and gateway answered on 2026-09-29/30 to the designated probe account (two
 * read-only GETs, recorded outside this repository). Real data,
 * trimmed to what the SPA reads: the fields of the two chat workflows' registry entries it looks at
 * (name, uri, digest, inputs, outputs; not their phases or descriptions), and the first three rows
 * of what the gateway's `/chat/models?view=chat` answers TODAY (its old projection: `{ health,
 * models }`, snake_case, per-token prices, no `schema`), with `health` left out.
 *
 * What they say, and the SPA is held to it: `workspace-chat-v1` lists `trigger`, `contextRefs` and
 * `interactionMode` and NOTHING else (`additionalProperties: false`), so no voice can be chosen and
 * no conversation picked up; and the catalogue route answers with something that is not the catalogue.
 */

export const LIVE_DOMAIN_AGENT_ENTRY = {
  "name": "domain-agent-activity-loop-v1",
  "workflowUri": "urn:sophia:wf:domain-agent-activity-loop-v1",
  "definitionDigest": "c13475753388ee95e43d397d6c822b31b85ba8da9fb17956d80caf019b069424",
  "inputs": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "definitionDocumentId",
      "trigger",
      "contextRefs"
    ],
    "properties": {
      "definitionDocumentId": {
        "type": "string",
        "minLength": 1
      },
      "trigger": {
        "type": "object",
        "required": [
          "kind"
        ]
      },
      "contextRefs": {
        "type": "array",
        "maxItems": 1000,
        "items": {
          "type": "string"
        }
      },
      "inference": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider",
          "model"
        ],
        "properties": {
          "provider": {
            "enum": [
              "openrouter",
              "openai-codex"
            ]
          },
          "model": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "interactionMode": {
        "enum": [
          "headless",
          "headed"
        ]
      }
    }
  },
  "outputs": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "response",
      "proposedEffects",
      "delegated",
      "emanations",
      "programInvocation",
      "failure"
    ],
    "properties": {
      "response": {},
      "failure": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "schema",
              "code"
            ],
            "properties": {
              "schema": {
                "const": "sophia.domain-agent-activity-failure.v1"
              },
              "code": {
                "const": "activity_execution_failed"
              }
            }
          }
        ]
      },
      "proposedEffects": {
        "type": "array",
        "items": {
          "type": "object"
        }
      },
      "delegated": {
        "type": "boolean"
      },
      "programInvocation": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "programId",
              "workflowName",
              "invocationId",
              "status"
            ],
            "properties": {
              "programId": {
                "type": "string"
              },
              "workflowName": {
                "type": "string"
              },
              "invocationId": {
                "type": "string"
              },
              "status": {
                "enum": [
                  "completed",
                  "failed",
                  "stopped",
                  "paused"
                ]
              },
              "output": {}
            }
          }
        ]
      },
      "emanations": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "label",
            "output"
          ],
          "properties": {
            "label": {
              "type": "string"
            },
            "output": {
              "type": "string"
            }
          }
        }
      }
    }
  }
} as const

export const LIVE_WORKSPACE_CHAT_ENTRY = {
  "name": "workspace-chat-v1",
  "workflowUri": "urn:sophia:wf:workspace-chat-v1",
  "definitionDigest": "90aaea4b7a26cbd90a724f033e1460e7972ad2e4974d33109ee637f3b240e654",
  "inputs": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "trigger"
    ],
    "properties": {
      "trigger": {
        "type": "object",
        "required": [
          "kind",
          "text"
        ],
        "properties": {
          "kind": {
            "type": "string"
          },
          "text": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "contextRefs": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string"
        }
      },
      "interactionMode": {
        "enum": [
          "headed"
        ]
      }
    }
  },
  "outputs": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "response"
    ],
    "properties": {
      "response": {}
    }
  }
} as const

export const LIVE_CATALOGUE_ROUTE_TODAY = { models: [
  {
    "availability": {
      "available": true,
      "catalog_available": true,
      "checked_at": "2026-09-30T05:51:53.547Z",
      "configured": true,
      "health_probed": false,
      "provider_available": true,
      "source": "provider_catalog",
      "status": "available"
    },
    "canonical_id": null,
    "completion_price": 5e-05,
    "context_length": 1000000,
    "created": 1781029944,
    "description": "This model always redirects to the latest model in the Claude Fable family.",
    "id": "~anthropic/claude-fable-latest",
    "image_price": null,
    "input_modalities": [
      "text",
      "image",
      "file"
    ],
    "max_completion_tokens": 128000,
    "name": "Anthropic: Claude Fable Latest",
    "output_modalities": [
      "text"
    ],
    "prompt_price": 1e-05,
    "provider": "openrouter",
    "reasoning": true,
    "request_price": null,
    "supported_parameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "stop",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "supports_tools": true
  },
  {
    "availability": {
      "available": true,
      "catalog_available": true,
      "checked_at": "2026-09-30T05:51:53.547Z",
      "configured": true,
      "health_probed": false,
      "provider_available": true,
      "source": "provider_catalog",
      "status": "available"
    },
    "canonical_id": null,
    "completion_price": 5e-06,
    "context_length": 200000,
    "created": 1777318492,
    "description": "This model always redirects to the latest model in the Claude Haiku family.",
    "id": "~anthropic/claude-haiku-latest",
    "image_price": null,
    "input_modalities": [
      "text",
      "image",
      "file"
    ],
    "max_completion_tokens": 64000,
    "name": "Anthropic: Claude Haiku Latest",
    "output_modalities": [
      "text"
    ],
    "prompt_price": 1e-06,
    "provider": "openrouter",
    "reasoning": true,
    "request_price": null,
    "supported_parameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "response_format",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ],
    "supports_tools": true
  },
  {
    "availability": {
      "available": true,
      "catalog_available": true,
      "checked_at": "2026-09-30T05:51:53.547Z",
      "configured": true,
      "health_probed": false,
      "provider_available": true,
      "source": "provider_catalog",
      "status": "available"
    },
    "canonical_id": null,
    "completion_price": 2e-05,
    "context_length": 1000000,
    "created": 1776795361,
    "description": "This model always redirects to the latest model in the Claude Opus family.",
    "id": "~anthropic/claude-opus-latest",
    "image_price": null,
    "input_modalities": [
      "text",
      "image",
      "file"
    ],
    "max_completion_tokens": 128000,
    "name": "Anthropic: Claude Opus Latest",
    "output_modalities": [
      "text"
    ],
    "prompt_price": 4e-06,
    "provider": "openrouter",
    "reasoning": true,
    "request_price": null,
    "supported_parameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "supports_tools": true
  }
] } as const
