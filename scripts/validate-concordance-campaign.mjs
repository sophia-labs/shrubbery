#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const campaignPath = resolve(root, 'docs/acceptance/concordance-campaign.json')
const surfaceLedgerPath = resolve(root, 'docs/acceptance/concordance-surface-ledger.json')
const statusPath = resolve(root, 'docs/acceptance/CONCORDANCE_STATUS.md')
const errors = []

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`${relative(root, path)}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    errors.push(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
    return ''
  }
  return result.stdout
}

function collectTsFiles(path, output = []) {
  if (!existsSync(path)) return output
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) continue
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) collectTsFiles(absolute, output)
    else if (/\.[cm]?tsx?$/.test(entry.name)) output.push(absolute)
  }
  return output
}

function tagsFromText(text) {
  const tags = new Set()
  const pattern = /@customElement\(['"]([^'"]+)['"]\)/g
  for (const match of text.matchAll(pattern)) tags.add(match[1])
  return [...tags].sort()
}

function tagsAtCommit(repository, commit, path) {
  const files = run('git', ['-C', repository, 'ls-tree', '-r', '--name-only', commit, '--', path])
    .split('\n')
    .filter((file) => /\.[cm]?tsx?$/.test(file))
  const tags = new Set()
  for (const file of files) {
    const text = run('git', ['-C', repository, 'show', `${commit}:${file}`])
    for (const tag of tagsFromText(text)) tags.add(tag)
  }
  return [...tags].sort()
}

function classify(tag, rules) {
  const matches = rules.filter((rule) => rule.prefixes.some((prefix) => tag.startsWith(prefix)))
  if (matches.length !== 1) {
    errors.push(`custom element ${tag}: expected exactly one lane rule, found ${matches.map((item) => item.lane).join(', ') || 'none'}`)
    return null
  }
  return matches[0].lane
}

function fingerprintWorktree(repository, excludedPaths = []) {
  const head = run('git', ['-C', repository, 'rev-parse', 'HEAD']).trim()
  const pathspec = ['--', '.', ...excludedPaths.map((path) => `:(exclude)${path}`)]
  const status = run('git', [
    '-C', repository, 'status', '--porcelain=v1', '--untracked-files=all', ...pathspec,
  ])
  const diff = run('git', ['-C', repository, 'diff', '--binary', 'HEAD', ...pathspec])
  const untracked = run('git', [
    '-C', repository, 'ls-files', '--others', '--exclude-standard', ...pathspec,
  ])
    .split('\n')
    .filter(Boolean)
    .sort()
  const fingerprint = createHash('sha256')
    .update(head)
    .update('\n')
    .update(status)
    .update('\n')
    .update(diff)
  // `git diff HEAD` intentionally omits untracked contents. Include their paths
  // and bytes so a dirty campaign fingerprint names one exact testable tree,
  // rather than every possible version of its untracked files.
  for (const path of untracked) {
    const absolute = resolve(repository, path)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
    fingerprint.update('\nuntracked\0').update(path).update('\0').update(readFileSync(absolute))
  }
  return {
    head,
    dirty: status.trimEnd().length > 0,
    statusLines: status.trimEnd() ? status.trimEnd().split('\n') : [],
    untrackedFiles: untracked,
    excludedGeneratedFiles: excludedPaths,
    fingerprint: fingerprint.digest('hex'),
  }
}

function validatePath(path, label) {
  const wildcardIndex = path.indexOf('*')
  const check = wildcardIndex >= 0 ? path.slice(0, wildcardIndex) : path
  const absolute = resolve(root, check)
  if (!existsSync(absolute) && !existsSync(dirname(absolute))) errors.push(`${label}: missing path ${path}`)
}

const campaign = readJson(campaignPath)
if (!campaign) process.exit(1)
const manifest = readJson(resolve(root, campaign.baselines.capabilityOracle.manifest))
if (!manifest) process.exit(1)

const laneIds = new Set()
const capabilityAssignments = new Map()
for (const lane of campaign.lanes ?? []) {
  if (laneIds.has(lane.id)) errors.push(`duplicate lane ${lane.id}`)
  laneIds.add(lane.id)
  if (!campaign.allowedPriorities.includes(lane.priority)) errors.push(`${lane.id}: invalid priority ${lane.priority}`)
  if (!campaign.allowedStatuses.includes(lane.status)) errors.push(`${lane.id}: invalid status ${lane.status}`)
  if (!Array.isArray(lane.requiredEvidence) || lane.requiredEvidence.length === 0) errors.push(`${lane.id}: requiredEvidence is empty`)
  for (const path of lane.paths ?? []) validatePath(path, lane.id)
  for (const capability of lane.capabilities ?? []) {
    if (capabilityAssignments.has(capability)) errors.push(`${capability}: assigned to both ${capabilityAssignments.get(capability)} and ${lane.id}`)
    capabilityAssignments.set(capability, lane.id)
  }
}

const manifestCapabilities = new Set((manifest.capabilities ?? []).map((capability) => capability.id))
for (const id of manifestCapabilities) if (!capabilityAssignments.has(id)) errors.push(`${id}: no concordance lane`)
for (const id of capabilityAssignments.keys()) if (!manifestCapabilities.has(id)) errors.push(`${id}: not present in capability manifest`)

for (const rule of campaign.elementRules ?? []) {
  if (!laneIds.has(rule.lane)) errors.push(`element rule references unknown lane ${rule.lane}`)
  if (!Array.isArray(rule.prefixes) || rule.prefixes.length === 0) errors.push(`element rule ${rule.lane}: no prefixes`)
}

const uxOracle = campaign.baselines.uxOracle
if (!existsSync(uxOracle.repository)) errors.push(`UX oracle repository missing: ${uxOracle.repository}`)
else if (run('git', ['-C', uxOracle.repository, 'cat-file', '-t', uxOracle.commit]).trim() !== 'commit') errors.push(`UX oracle commit unavailable: ${uxOracle.commit}`)

const ogTags = tagsAtCommit(uxOracle.repository, uxOracle.commit, 'frontend/src')
const targetTags = tagsFromText(
  collectTsFiles(resolve(root, 'packages'))
    .concat(collectTsFiles(resolve(root, 'apps/organism/src')))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n'),
)

const targetSet = new Set(targetTags)
const aliasTargets = new Set(Object.values(campaign.elementAliases ?? {}).flat())
const ogSurfaces = ogTags.map((tag) => {
  const targetMatches = targetSet.has(tag) ? [tag] : (campaign.elementAliases?.[tag] ?? [])
  const disposition = campaign.elementDispositions?.[tag] ?? (targetMatches.length > 0 ? 'synthesize' : 'unmapped')
  if (targetMatches.some((target) => !targetSet.has(target))) errors.push(`${tag}: alias points to missing target element ${targetMatches.find((target) => !targetSet.has(target))}`)
  if (disposition === 'unmapped') errors.push(`${tag}: no exact target, alias, or explicit disposition`)
  return { tag, lane: classify(tag, campaign.elementRules), targetMatches, disposition }
})

const targetSurfaces = targetTags.map((tag) => ({
  tag,
  lane: classify(tag, campaign.elementRules),
  classification: ogTags.includes(tag) || aliasTargets.has(tag) ? 'concordance-surface' : 'target-extension',
}))

const findingIds = new Set()
for (const finding of campaign.findings ?? []) {
  if (findingIds.has(finding.id)) errors.push(`duplicate finding ${finding.id}`)
  findingIds.add(finding.id)
  if (!laneIds.has(finding.lane)) errors.push(`${finding.id}: unknown lane ${finding.lane}`)
  if (!campaign.allowedPriorities.includes(finding.priority)) errors.push(`${finding.id}: invalid priority ${finding.priority}`)
  if (!campaign.allowedStatuses.includes(finding.status)) errors.push(`${finding.id}: invalid status ${finding.status}`)
  if (!Array.isArray(finding.requiredEvidence) || finding.requiredEvidence.length === 0) errors.push(`${finding.id}: requiredEvidence is empty`)
  for (const capability of finding.capabilities ?? []) if (!manifestCapabilities.has(capability)) errors.push(`${finding.id}: unknown capability ${capability}`)
}

const workPackageIds = new Set()
for (const workPackage of campaign.workPackages ?? []) {
  if (workPackageIds.has(workPackage.id)) errors.push(`duplicate work package ${workPackage.id}`)
  workPackageIds.add(workPackage.id)
  if (!laneIds.has(workPackage.lane)) errors.push(`${workPackage.id}: unknown lane ${workPackage.lane}`)
  if (!campaign.allowedPriorities.includes(workPackage.priority)) errors.push(`${workPackage.id}: invalid priority ${workPackage.priority}`)
  if (!campaign.allowedStatuses.includes(workPackage.status)) errors.push(`${workPackage.id}: invalid status ${workPackage.status}`)
  for (const finding of workPackage.findingIds ?? []) if (!findingIds.has(finding)) errors.push(`${workPackage.id}: unknown finding ${finding}`)
  for (const path of workPackage.writeScope ?? []) validatePath(path, workPackage.id)
}

const targetRepository = resolve(campaign.baselines.targetStart.repository)
const generatedFingerprintExclusions = targetRepository === root
  ? [relative(root, surfaceLedgerPath), relative(root, statusPath)]
  : []
const targetState = fingerprintWorktree(targetRepository, generatedFingerprintExclusions)
const surfaceLedger = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  campaignId: campaign.campaignId,
  baselines: campaign.baselines,
  targetState,
  counts: {
    capabilities: manifestCapabilities.size,
    lanes: laneIds.size,
    findings: findingIds.size,
    workPackages: workPackageIds.size,
    ogCustomElements: ogTags.length,
    targetCustomElements: targetTags.length,
  },
  capabilityAssignments: Object.fromEntries([...capabilityAssignments.entries()].sort()),
  ogSurfaces,
  targetSurfaces,
}

const statusCounts = Object.fromEntries(campaign.allowedStatuses.map((status) => [
  status,
  (campaign.findings ?? []).filter((finding) => finding.status === status).length,
]))
const dispatchable = (campaign.workPackages ?? []).filter((workPackage) => ['specified', 'audit-required'].includes(workPackage.status) && !workPackage.owner)
const markdown = `# Shrubbery concordance campaign — generated status\n\n` +
  `Generated from \`concordance-campaign.json\`. Do not hand-edit this file.\n\n` +
  `- UX oracle: \`${uxOracle.commit}\` in \`${uxOracle.repository}\`\n` +
  `- Target HEAD: \`${targetState.head}\` (${targetState.dirty ? 'dirty' : 'clean'})\n` +
  `- Target fingerprint: \`${targetState.fingerprint}\`\n` +
  `- Coverage: ${manifestCapabilities.size}/${manifestCapabilities.size} capabilities; ${ogTags.length}/${ogTags.length} OG custom elements; ${targetTags.length}/${targetTags.length} target custom elements\n` +
  `- Findings by status: ${Object.entries(statusCounts).map(([status, count]) => `${status}=${count}`).join(', ')}\n\n` +
  `## Lanes\n\n| Lane | Priority | Status | Capabilities | Findings | Title |\n|---|---:|---|---:|---:|---|\n` +
  campaign.lanes.map((lane) => `| ${lane.id} | ${lane.priority} | ${lane.status} | ${lane.capabilities.length} | ${campaign.findings.filter((finding) => finding.lane === lane.id).length} | ${lane.title} |`).join('\n') +
  `\n\n## Work packages\n\n| Work package | Wave | Priority | Status | Owner | Findings |\n|---|---:|---:|---|---|---|\n` +
  campaign.workPackages.map((workPackage) => `| ${workPackage.id} | ${workPackage.wave} | ${workPackage.priority} | ${workPackage.status} | ${workPackage.owner ?? 'unassigned'} | ${workPackage.findingIds.join(', ')} |`).join('\n') +
  `\n\n## Dispatchable now\n\n` +
  (dispatchable.length > 0 ? dispatchable.map((workPackage) => `- ${workPackage.id} (${workPackage.lane}): ${workPackage.findingIds.join(', ')}`).join('\n') : '- None') +
  `\n\n## Completion rule\n\nThe campaign is not complete while any applicable finding is not \`proven\` or \`intentional-departure\`, any source surface is unclassified, or any capability lacks tier-appropriate evidence.\n`

if (errors.length === 0 && process.argv.includes('--write')) {
  writeFileSync(surfaceLedgerPath, `${JSON.stringify(surfaceLedger, null, 2)}\n`)
  writeFileSync(statusPath, markdown)
}

const summary = {
  valid: errors.length === 0,
  capabilities: `${capabilityAssignments.size}/${manifestCapabilities.size}`,
  lanes: laneIds.size,
  findings: findingIds.size,
  workPackages: workPackageIds.size,
  ogCustomElements: ogTags.length,
  targetCustomElements: targetTags.length,
  dispatchable: dispatchable.map((workPackage) => workPackage.id),
  target: targetState,
  errors: errors.length,
}
console.log(JSON.stringify(summary, null, 2))
for (const error of errors) console.error(`error: ${error}`)
if (errors.length > 0) process.exitCode = 1
