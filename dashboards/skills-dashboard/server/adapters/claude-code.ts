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
 * Several plugins can share one repo checkout (e.g. the anthropic-agent-skills
 * marketplace installs the same commit for document-skills, claude-api and
 * example-skills), with each plugin scoped to a SUBSET of ./skills via the
 * marketplace manifest. Honor that scoping — globbing the shared checkout
 * would report every skill once per plugin (phantom duplicates).
 */
function declaredSkillDirs(marketplace: string, pluginName: string): string[] | null {
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          os.homedir(),
          '.claude',
          'plugins',
          'marketplaces',
          marketplace,
          '.claude-plugin',
          'marketplace.json',
        ),
        'utf8',
      ),
    )
    const entry = (manifest.plugins ?? []).find(
      (p: { name?: string }) => p.name === pluginName,
    )
    return Array.isArray(entry?.skills) ? entry.skills : null
  } catch {
    return null
  }
}

/**
 * Enabled plugins resolved to their exact installPath via installed_plugins.json.
 * Never scans the plugin cache directly — it holds stale versions and
 * temp_subdir_*.clone junk that would double-count skills.
 */
function enabledPluginSkillRoots(): { pluginName: string; skillDirs: string[] }[] {
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

  const out: { pluginName: string; skillDirs: string[] }[] = []
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
    const [pluginName, marketplace] = key.split('@')
    const declared = declaredSkillDirs(marketplace, pluginName)
    const skillDirs = declared
      ? declared.map((rel) => path.resolve(newest.installPath!, rel)).filter(existsSync)
      : existsSync(path.join(newest.installPath, 'skills'))
        ? [path.join(newest.installPath, 'skills')]
        : []
    if (skillDirs.length) out.push({ pluginName, skillDirs })
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

  for (const { pluginName, skillDirs } of enabledPluginSkillRoots()) {
    for (const skillDir of skillDirs) {
      roots.push(skillDir)
      for (const md of findSkillMds(skillDir)) {
        const install = installFromSkillMd(md, 'claude-code', `plugin:${pluginName}`)
        if (install) installs.push(install)
      }
    }
  }

  return { installs, available: roots.length > 0, roots }
}
