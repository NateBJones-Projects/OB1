import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import type { AdapterResult } from './shared.ts'

const userRoot = () => path.join(os.homedir(), '.codex', 'skills')
const systemRoot = () => path.join(os.homedir(), '.codex', 'skills', '.system')
const pluginCacheRoot = () => path.join(os.homedir(), '.codex', 'plugins', 'cache')
const configPath = () => path.join(os.homedir(), '.codex', 'config.toml')

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
 * Codex's authoritative plugin ledger: [plugins."name@marketplace"] sections in
 * ~/.codex/config.toml. This pins each plugin to ONE marketplace — the cache
 * often holds the same plugin under several (e.g. openai-curated AND
 * openai-curated-remote), which must not each contribute an install.
 * Returns null if the config has no plugin entries (fall back to a cache scan).
 */
function enabledPluginsFromConfig(): Map<string, string> | null {
  let toml: string
  try {
    toml = readFileSync(configPath(), 'utf8')
  } catch {
    return null
  }
  const map = new Map<string, string>()
  let found = false
  const sectionRe = /^\[plugins\."([^@"]+)@([^"]+)"\]([^[]*)/gm
  for (let m = sectionRe.exec(toml); m; m = sectionRe.exec(toml)) {
    found = true
    if (!/^\s*enabled\s*=\s*false/m.test(m[3])) map.set(m[1], m[2])
  }
  return found ? map : null
}

/** Newest version/hash dir inside a cached plugin dir → its skills/ subdir. */
function skillsDirOfPlugin(pluginDir: string): string | null {
  const newest = listDirs(pluginDir)
    .map((dir) => ({ dir, mtime: statSync(dir).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]
  if (!newest) return null
  const skillsDir = path.join(newest.dir, 'skills')
  return existsSync(skillsDir) ? skillsDir : null
}

function codexPluginSkillRoots(): { pluginName: string; skillsDir: string }[] {
  const out: { pluginName: string; skillsDir: string }[] = []
  const enabled = enabledPluginsFromConfig()

  if (enabled) {
    for (const [pluginName, marketplace] of enabled) {
      const skillsDir = skillsDirOfPlugin(path.join(pluginCacheRoot(), marketplace, pluginName))
      if (skillsDir) out.push({ pluginName, skillsDir })
    }
    return out
  }

  // No ledger — scan the cache, deduping the same plugin name across
  // marketplaces (newest chosen dir wins).
  const byName = new Map<string, { skillsDir: string; mtime: number }>()
  for (const marketplace of listDirs(pluginCacheRoot())) {
    for (const plugin of listDirs(marketplace)) {
      const skillsDir = skillsDirOfPlugin(plugin)
      if (!skillsDir) continue
      const mtime = statSync(path.dirname(skillsDir)).mtimeMs
      const name = path.basename(plugin)
      const existing = byName.get(name)
      if (!existing || mtime > existing.mtime) byName.set(name, { skillsDir, mtime })
    }
  }
  for (const [pluginName, { skillsDir }] of byName) out.push({ pluginName, skillsDir })
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
