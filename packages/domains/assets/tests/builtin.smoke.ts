import { readAssetRepository } from '../src/reader.ts'

import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../builtin/', import.meta.url))
const repo = await readAssetRepository(root)
if (repo.environmentCatalogs.length !== 5) throw new Error('expected 5 catalogs, got ' + repo.environmentCatalogs.length)
if (repo.environmentPackages.length < 70) throw new Error('expected >=70 packages, got ' + repo.environmentPackages.length)
if (repo.environmentProfiles.length !== 3) throw new Error('expected 3 profiles, got ' + repo.environmentProfiles.length)
if (repo.agents.length !== 1 || repo.agents[0].name !== 'rin-base') throw new Error('expected rin-base agent')
if (repo.agents[0].resources.environmentProfileId !== 'scientific-base') throw new Error('agent env ref wrong')
console.log('BUILTIN-SMOKE-OK', repo.environmentPackages.length, 'packages')
