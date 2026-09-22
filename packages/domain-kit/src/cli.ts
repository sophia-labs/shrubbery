#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { parseNT } from '@shrubbery/nucleus'
import {
  buildPhanesDomainInstance,
  buildPlatformDomainInstance,
  buildShrubberyDomainInstance,
} from './instances/index.js'
import { checkManifestProjection, manifestToNt, parseCapabilityManifest } from './manifest.js'
import { parseDomainVerdict, verdictToNt } from './verdict.js'

const [command, ...arguments_] = process.argv.slice(2)

try {
  if (command === 'manifest-to-rdf') {
    const [sourcePath, targetPath] = arguments_
    const [source, target] = requirePaths(sourcePath, targetPath)
    const manifest = parseCapabilityManifest(JSON.parse(await readFile(source, 'utf8')))
    await writeFile(target, manifestToNt(manifest), 'utf8')
    process.stdout.write(`${target}\n`)
  } else if (command === 'verdict-to-rdf') {
    const [sourcePath, targetPath] = arguments_
    const [source, target] = requirePaths(sourcePath, targetPath)
    const verdict = parseDomainVerdict(JSON.parse(await readFile(source, 'utf8')))
    await writeFile(target, verdictToNt(verdict), 'utf8')
    process.stdout.write(`${target}\n`)
  } else if (command === 'check-graph') {
    const [sourcePath, targetPath] = arguments_
    const [source, target] = requirePaths(sourcePath, targetPath)
    const manifest = parseCapabilityManifest(JSON.parse(await readFile(source, 'utf8')))
    const check = checkManifestProjection(manifest, parseNT(await readFile(target, 'utf8')))
    process.stdout.write(`${JSON.stringify(check, null, 2)}\n`)
    if (!check.ok) process.exitCode = 1
  } else if (command === 'emit-instance') {
    const [name, firstPath, secondPath, ...extra] = arguments_
    if (extra.length > 0) throw new Error('too many emit-instance arguments')
    const [instance, target] = await buildNamedInstance(name, firstPath, secondPath)
    await writeFile(target, `${JSON.stringify(instance, null, 2)}\n`, 'utf8')
    process.stdout.write(`${target}\n`)
  } else {
    usage()
    process.exitCode = 2
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

function requirePaths(source: string | undefined, target: string | undefined): [string, string] {
  if (!source || !target) throw new Error('source and target paths are required')
  return [source, target]
}

async function buildNamedInstance(
  name: string | undefined,
  firstPath: string | undefined,
  secondPath: string | undefined,
) {
  if (name === 'phanes') {
    if (!firstPath || secondPath) throw new Error('emit-instance phanes requires one target path')
    return [buildPhanesDomainInstance(), firstPath] as const
  }
  if (name === 'platform') {
    if (!firstPath || secondPath) throw new Error('emit-instance platform requires one target path')
    return [buildPlatformDomainInstance(), firstPath] as const
  }
  if (name === 'shrubbery') {
    const [source, target] = requirePaths(firstPath, secondPath)
    return [buildShrubberyDomainInstance(JSON.parse(await readFile(source, 'utf8'))), target] as const
  }
  throw new Error("instance name must be 'phanes', 'platform', or 'shrubbery'")
}

function usage(): void {
  process.stderr.write(
    [
      'Usage:',
      '  domain-kit manifest-to-rdf <manifest.json> <projection.nt>',
      '  domain-kit verdict-to-rdf <verdict.json> <verdict.nt>',
      '  domain-kit check-graph <manifest.json> <graph.nt>',
      '  domain-kit emit-instance phanes <seed.json>',
      '  domain-kit emit-instance platform <seed.json>',
      '  domain-kit emit-instance shrubbery <manifest.json> <seed.json>',
      '',
    ].join('\n'),
  )
}
