import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import type { AdapterResult } from './shared.ts'

const personalRoot = () => path.join(os.homedir(), '.claude', 'skills')
const settingsPath = () => path.join(os.homedir(), '.claude', 'settings.json')
const installedPluginsPath = () =>
  path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')

interface PluginInstallRecord {
  installPath?: string
  installedAt?: string
  lastUpdated?: string
}

/**
 * Enabled plugins resolved to their exact installPath via installed_plugins.json.
 * Never scans the plugin cache directly — it holds stale versions and
 * temp_subdir_*.clone junk that would double-count skills.
 */
function enabledPluginSkillRoots(): { pluginName: string; skillsDir: string }[] {
  let enabled: Set<string>
  let plugins: Record<string, PluginInstallRecord[] | PluginInstallRecord>
  try {
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    enabled = new Set(
      Object.entries(settings.enabledPlugins ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    )
    plugins = JSON.parse(readFileSync(installedPluginsPath(), 'utf8')).plugins ?? {}
  } catch (err) {
    console.warn(`[claude-code] plugin discovery failed: ${(err as Error).message}`)
    return []
  }

  const out: { pluginName: string; skillsDir: string }[] = []
  for (const [key, records] of Object.entries(plugins)) {
    if (!enabled.has(key)) continue
    const list = Array.isArray(records) ? records : [records]
    // Values are arrays of install records — newest lastUpdated wins.
    const newest = [...list].sort(
      (a, b) =>
        Date.parse(b.lastUpdated ?? b.installedAt ?? '0') -
        Date.parse(a.lastUpdated ?? a.installedAt ?? '0'),
    )[0]
    if (!newest?.installPath) continue
    const skillsDir = path.join(newest.installPath, 'skills')
    if (!existsSync(skillsDir)) continue
    out.push({ pluginName: key.split('@')[0], skillsDir })
  }
  return out
}

export function scanClaudeCode(): AdapterResult {
  const installs: SkillInstall[] = []
  const roots: string[] = []

  const personal = personalRoot()
  if (existsSync(personal)) {
    roots.push(personal)
    for (const md of findSkillMds(personal)) {
      const install = installFromSkillMd(md, 'claude-code', 'personal')
      if (install) installs.push(install)
    }
  }

  for (const { pluginName, skillsDir } of enabledPluginSkillRoots()) {
    roots.push(skillsDir)
    for (const md of findSkillMds(skillsDir)) {
      const install = installFromSkillMd(md, 'claude-code', `plugin:${pluginName}`)
      if (install) installs.push(install)
    }
  }

  return { installs, available: roots.length > 0, roots }
}
