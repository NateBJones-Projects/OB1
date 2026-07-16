import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import type { AdapterResult } from './shared.ts'

const userRoot = () => path.join(os.homedir(), '.codex', 'skills')
const systemRoot = () => path.join(os.homedir(), '.codex', 'skills', '.system')
const pluginCacheRoot = () => path.join(os.homedir(), '.codex', 'plugins', 'cache')

const listDirs = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * ~/.codex/plugins/cache/<marketplace>/<plugin>/<hash>/skills — no installed-plugins
 * ledger exists for Codex, so dedupe by plugin name: newest hash dir (mtime) wins.
 */
function codexPluginSkillRoots(): { pluginName: string; skillsDir: string }[] {
  const out: { pluginName: string; skillsDir: string }[] = []
  for (const marketplace of listDirs(pluginCacheRoot())) {
    for (const plugin of listDirs(marketplace)) {
      const newestHash = listDirs(plugin)
        .map((dir) => ({ dir, mtime: statSync(dir).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]
      if (!newestHash) continue
      const skillsDir = path.join(newestHash.dir, 'skills')
      if (existsSync(skillsDir)) out.push({ pluginName: path.basename(plugin), skillsDir })
    }
  }
  return out
}

export function scanCodex(): AdapterResult {
  const installs: SkillInstall[] = []
  const roots: string[] = []

  const user = userRoot()
  if (existsSync(user)) {
    roots.push(user)
    for (const md of findSkillMds(user)) {
      const install = installFromSkillMd(md, 'codex', 'personal')
      if (install) installs.push(install)
    }
    // findSkillMds skips dot-dirs, so the built-in .system skills need an explicit pass.
    const system = systemRoot()
    if (existsSync(system)) {
      for (const md of findSkillMds(system)) {
        const install = installFromSkillMd(md, 'codex', 'system')
        if (install) installs.push(install)
      }
    }
  }

  for (const { pluginName, skillsDir } of codexPluginSkillRoots()) {
    roots.push(skillsDir)
    for (const md of findSkillMds(skillsDir)) {
      const install = installFromSkillMd(md, 'codex', `plugin:${pluginName}`)
      if (install) installs.push(install)
    }
  }

  return { installs, available: roots.length > 0, roots }
}
