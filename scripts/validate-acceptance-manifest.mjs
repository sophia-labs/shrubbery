#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(root, 'docs/acceptance/garden-capability-manifest.json')
const schemaPaths = [
  'docs/acceptance/schemas/acceptance-manifest.schema.json',
  'docs/acceptance/schemas/verdict.schema.json',
  'docs/acceptance/schemas/defect.schema.json',
]
const errors = []
const warnings = []
const checkGraphIndex = process.argv.indexOf('--check-graph')
const checkGraphArgument = checkGraphIndex >= 0 ? process.argv[checkGraphIndex + 1] : undefined

if (checkGraphIndex >= 0 && (!checkGraphArgument || checkGraphArgument.startsWith('--'))) {
  errors.push('--check-graph requires the path to an N-Triples graph projection')
}

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function present(value, label) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${label}: expected a non-empty string`)
}

function nonEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label}: expected a non-empty array`)
    return []
  }
  if (new Set(value).size !== value.length) errors.push(`${label}: contains duplicate values`)
  return value
}

function uniqueBy(items, key, label) {
  const seen = new Set()
  for (const item of items) {
    const value = item?.[key]
    if (seen.has(value)) errors.push(`${label}: duplicate ${key} ${String(value)}`)
    seen.add(value)
  }
}

const manifest = parseJson(manifestPath)
for (const relative of schemaPaths) parseJson(resolve(root, relative))

if (!manifest) process.exitCode = 1
else {
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion: expected 1')
  if (manifest.programId !== 'shrubbery-garden-fidelity') errors.push('programId: unexpected value')
  present(manifest.title, 'title')

  const tierIds = new Set(Object.keys(manifest.tiers ?? {}))
  const modes = new Set(nonEmptyArray(manifest.modes, 'modes'))
  const roles = new Set(nonEmptyArray(manifest.roles, 'roles'))
  const requiredDomains = new Set(nonEmptyArray(manifest.requiredDomains, 'requiredDomains'))
  const capabilities = nonEmptyArray(manifest.capabilities, 'capabilities')
  const journeys = nonEmptyArray(manifest.journeys, 'journeys')
  uniqueBy(capabilities, 'id', 'capabilities')
  uniqueBy(journeys, 'id', 'journeys')
  uniqueBy(journeys, 'order', 'journeys')

  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]))
  const journeyById = new Map(journeys.map((journey) => [journey.id, journey]))
  const capabilityIdPattern = /^ACC-CAP-[A-Z0-9]+-[0-9]{3}$/
  const journeyIdPattern = /^ACC-J[0-9]{3}$/
  const coveredDomains = new Set()

  for (const capability of capabilities) {
    const label = capability.id ?? '<missing capability id>'
    if (!capabilityIdPattern.test(label)) errors.push(`${label}: invalid capability id`)
    present(capability.domain, `${label}.domain`)
    present(capability.title, `${label}.title`)
    coveredDomains.add(capability.domain)
    if (!tierIds.has(capability.tier)) errors.push(`${label}.tier: unknown tier ${String(capability.tier)}`)
    for (const mode of nonEmptyArray(capability.modes, `${label}.modes`)) {
      if (!modes.has(mode)) errors.push(`${label}.modes: unknown mode ${mode}`)
    }
    for (const role of nonEmptyArray(capability.roles, `${label}.roles`)) {
      if (!roles.has(role)) errors.push(`${label}.roles: unknown role ${role}`)
    }
    nonEmptyArray(capability.oracle?.paths, `${label}.oracle.paths`)
    nonEmptyArray(capability.oracle?.signals, `${label}.oracle.signals`)
    nonEmptyArray(capability.target?.paths, `${label}.target.paths`)
    nonEmptyArray(capability.target?.surfaces, `${label}.target.surfaces`)
    present(capability.target?.support, `${label}.target.support`)
    nonEmptyArray(capability.contracts, `${label}.contracts`)
    if (typeof capability.stateful !== 'boolean') errors.push(`${label}.stateful: expected boolean`)

    const refs = nonEmptyArray(capability.journeys, `${label}.journeys`)
    let hasProductJourney = false
    let hasStateEvidence = false
    for (const journeyId of refs) {
      const journey = journeyById.get(journeyId)
      if (!journey) {
        errors.push(`${label}.journeys: unknown journey ${journeyId}`)
        continue
      }
      if (!journey.capabilities?.includes(label)) {
        errors.push(`${label} references ${journeyId}, but the journey does not reference ${label}`)
      }
      if (journey.tier !== 'T0-component') hasProductJourney = true
      const evidence = (journey.steps ?? []).flatMap((step) => step.evidence ?? [])
      if (evidence.some((item) => /state|hash|graph|artifact|effect|download|audit/.test(item))) {
        hasStateEvidence = true
      }
    }
    if (label !== 'ACC-CAP-DESIGN-001' && !hasProductJourney) {
      errors.push(`${label}: production capability is covered only by T0 component evidence`)
    }
    if (capability.stateful && !hasStateEvidence) {
      warnings.push(`${label}: no associated step names authoritative state/hash/effects evidence`)
    }
    if (/^T[45]-/.test(capability.tier) && !capability.blocker) {
      errors.push(`${label}: ${capability.tier} capability requires an explicit blocker`)
    }
  }

  for (const domain of requiredDomains) {
    if (!coveredDomains.has(domain)) errors.push(`requiredDomains: no capability covers ${domain}`)
  }

  let lastOrder = -Infinity
  for (const journey of [...journeys].sort((left, right) => left.order - right.order)) {
    const label = journey.id ?? '<missing journey id>'
    if (!journeyIdPattern.test(label)) errors.push(`${label}: invalid journey id`)
    if (!Number.isInteger(journey.order)) errors.push(`${label}.order: expected integer`)
    if (journey.order <= lastOrder) errors.push(`${label}.order: ordered catalog is not strictly increasing`)
    lastOrder = journey.order
    present(journey.title, `${label}.title`)
    present(journey.fixture, `${label}.fixture`)
    present(journey.command, `${label}.command`)
    if (!tierIds.has(journey.tier)) errors.push(`${label}.tier: unknown tier ${String(journey.tier)}`)
    for (const mode of nonEmptyArray(journey.modes, `${label}.modes`)) {
      if (!modes.has(mode)) errors.push(`${label}.modes: unknown mode ${mode}`)
    }
    for (const role of nonEmptyArray(journey.roles, `${label}.roles`)) {
      if (!roles.has(role)) errors.push(`${label}.roles: unknown role ${role}`)
    }
    nonEmptyArray(journey.pairwiseDimensions, `${label}.pairwiseDimensions`)
    for (const capabilityId of nonEmptyArray(journey.capabilities, `${label}.capabilities`)) {
      const capability = capabilityById.get(capabilityId)
      if (!capability) {
        errors.push(`${label}.capabilities: unknown capability ${capabilityId}`)
      } else if (!capability.journeys.includes(label)) {
        errors.push(`${label} references ${capabilityId}, but the capability does not reference ${label}`)
      }
    }
    const steps = nonEmptyArray(journey.steps, `${label}.steps`)
    uniqueBy(steps, 'id', `${label}.steps`)
    for (const step of steps) {
      const stepLabel = `${label}.${step?.id ?? '<missing step id>'}`
      present(step?.id, `${stepLabel}.id`)
      present(step?.action, `${stepLabel}.action`)
      present(step?.expected, `${stepLabel}.expected`)
      nonEmptyArray(step?.evidence, `${stepLabel}.evidence`)
    }
  }

  const oracleRoot = manifest.oracle?.repository
  const oracleRepositoryPath = typeof oracleRoot === 'string' ? resolve(root, oracleRoot) : undefined
  const oracleCommit = manifest.oracle?.commit
  const shouldCheckSources = process.argv.includes('--check-sources') || (
    oracleRepositoryPath !== undefined && existsSync(oracleRepositoryPath)
  )
  if (shouldCheckSources) {
    if (!oracleRepositoryPath || !existsSync(oracleRepositoryPath)) {
      errors.push(`oracle.repository: unavailable for source check: ${String(oracleRoot)}`)
    } else {
      for (const capability of capabilities) {
        for (const path of capability.oracle.paths) {
          const check = spawnSync('git', ['-C', oracleRepositoryPath, 'cat-file', '-e', `${oracleCommit}:${path}`])
          if (check.status !== 0) errors.push(`${capability.id}.oracle.paths: missing at oracle commit: ${path}`)
        }
      }
    }
    for (const capability of capabilities) {
      for (const path of capability.target.paths) {
        const absolute = resolve(root, path)
        if (!existsSync(absolute)) errors.push(`${capability.id}.target.paths: missing: ${path}`)
        else if (statSync(absolute).isSymbolicLink()) warnings.push(`${capability.id}.target.paths: symlinked path: ${path}`)
      }
    }
  }

  if (checkGraphArgument && !checkGraphArgument.startsWith('--')) {
    const graphPath = resolve(checkGraphArgument)
    if (!existsSync(graphPath)) {
      errors.push(`--check-graph: unavailable projection: ${graphPath}`)
    } else {
      const check = spawnSync(
        'pnpm',
        [
          '--dir',
          resolve(root, 'packages/domain-kit'),
          'domain-kit',
          'check-graph',
          manifestPath,
          graphPath,
        ],
        { encoding: 'utf8' },
      )
      if (check.stdout) process.stdout.write(check.stdout)
      if (check.stderr) process.stderr.write(check.stderr)
      if (check.error) errors.push(`--check-graph: could not run Domain Kit validator: ${check.error.message}`)
      else if (check.status !== 0) errors.push(`--check-graph: projection is missing or stale (${graphPath})`)
    }
  }

  const summary = {
    capabilities: capabilities.length,
    journeys: journeys.length,
    domains: coveredDomains.size,
    capabilityTiers: Object.fromEntries(
      [...tierIds].map((tier) => [tier, capabilities.filter((capability) => capability.tier === tier).length]),
    ),
    journeyTiers: Object.fromEntries(
      [...tierIds].map((tier) => [tier, journeys.filter((journey) => journey.tier === tier).length]),
    ),
    warnings: warnings.length,
    errors: errors.length,
  }
  console.log(JSON.stringify(summary, null, 2))
}

for (const warning of warnings) console.warn(`warning: ${warning}`)
for (const error of errors) console.error(`error: ${error}`)
if (errors.length > 0) process.exitCode = 1
