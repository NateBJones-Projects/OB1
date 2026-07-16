import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSkillMds, installFromSkillMd, normalizeKey } from '../walk.ts'
import type { SkillInstall } from '../types.ts'
import { emptyResult, type AdapterResult } from './shared.ts'

// Hard-scoped to the skills-plugin tree. The sibling rpm/ tree holds ~155
// plugin-bundle SKILL.md files that are NOT the user's installed skills.
const skillsPluginRoot = () =>
  path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
    'skills-plugin',
  )

interface ManifestSkill {
  name?: string
  description?: string
  updatedAt?: string
  enabled?: boolean
}

interface SessionDir {
  skillsDir: string
  manifestByName: Map<string, ManifestSkill>
  lastUpdated: number
}

const listDirs = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

/** Discover <uuidA>/<uuidB>/ session dirs by glob — UUIDs vary per machine/session. */
function sessionDirs(): SessionDir[] {
  const out: SessionDir[] = []
  for (const uuidA of listDirs(skillsPluginRoot())) {
    for (const uuidB of listDirs(uuidA)) {
      const skillsDir = path.join(uuidB, 'skills')
      if (!existsSync(skillsDir)) continue
      const manifestByName = new Map<string, ManifestSkill>()
      let lastUpdated = 0
      try {
        const manifest = JSON.parse(readFileSync(path.join(uuidB, 'manifest.json'), 'utf8'))
        lastUpdated = Date.parse(manifest.lastUpdated ?? '') || 0
        for (const skill of manifest.skills ?? []) {
          if (skill?.name) manifestByName.set(normalizeKey(skill.name), skill)
        }
      } catch {
        // No/unreadable manifest — SKILL.md frontmatter still carries the row.
      }
      out.push({ skillsDir, manifestByName, lastUpdated })
    }
  }
  // Newest session first: if several sessions ship the same skill, the newest wins
  // (older duplicates are dropped in scanClaudeDesktop below).
  return out.sort((a, b) => b.lastUpdated - a.lastUpdated)
}

export function scanClaudeDesktop(): AdapterResult {
  const sessions = sessionDirs()
  if (sessions.length === 0) return emptyResult('No Claude Desktop skills found')

  const installs: SkillInstall[] = []
  const seen = new Set<string>()
  for (const session of sessions) {
    for (const md of findSkillMds(session.skillsDir)) {
      const install = installFromSkillMd(md, 'claude-desktop', 'personal')
      if (!install || seen.has(install.skillName)) continue
      seen.add(install.skillName)
      const manifest = session.manifestByName.get(install.skillName)
      if (manifest) {
        // Frontmatter description wins; manifest is the fallback.
        if (!install.description && manifest.description) {
          install.description = manifest.description
          install.descriptionSource = 'manifest'
        }
        const updatedAt = Date.parse(manifest.updatedAt ?? '') || 0
        install.mtimeMs = Math.max(install.mtimeMs, updatedAt)
        install.enabled = manifest.enabled
      }
      installs.push(install)
    }
  }

  return { installs, available: true, roots: sessions.map((s) => s.skillsDir) }
}
