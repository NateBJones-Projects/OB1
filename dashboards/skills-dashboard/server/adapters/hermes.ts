import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import { emptyResult, type AdapterResult } from './shared.ts'

// Pre-wired to Hermes' standard home. Hermes nests skills by category
// (e.g. optional-skills/<category>/<name>/SKILL.md), so the recursive walk
// picks them up the moment Hermes is installed — no code changes needed.
const root = () => process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')

export function scanHermes(): AdapterResult {
  const dir = root()
  if (!existsSync(dir)) return emptyResult('Hermes not installed')
  const installs: SkillInstall[] = []
  for (const md of findSkillMds(dir)) {
    const install = installFromSkillMd(md, 'hermes', 'personal')
    if (install) installs.push(install)
  }
  return { installs, available: true, roots: [dir] }
}
