import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import { emptyResult, type AdapterResult } from './shared.ts'

const root = () => path.join(os.homedir(), '.grok', 'skills')

export function scanGrok(): AdapterResult {
  const dir = root()
  if (!existsSync(dir)) return emptyResult('Grok not installed')
  const installs: SkillInstall[] = []
  for (const md of findSkillMds(dir)) {
    const install = installFromSkillMd(md, 'grok', 'personal')
    if (install) installs.push(install)
  }
  return { installs, available: true, roots: [dir] }
}
