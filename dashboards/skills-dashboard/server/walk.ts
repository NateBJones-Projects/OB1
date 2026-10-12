import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseSkillMd, heuristicDescription } from './frontmatter.ts'
import type { HarnessId, SkillInstall } from './types.ts'

const SKIP_DIRS = new Set(['.git', 'node_modules', '_template', 'template', 'scratch'])

/** Recursively find every SKILL.md under root (catches nested variants/ trees). */
export function findSkillMds(root: string, maxDepth = 8): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full)
    }
  }
  walk(root, 0)
  return out
}

export function normalizeKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Build a SkillInstall from a SKILL.md path. Returns null if the file is unreadable. */
export function installFromSkillMd(
  skillMdPath: string,
  harness: HarnessId,
  source: string,
): SkillInstall | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(skillMdPath).mtimeMs
  } catch {
    return null
  }
  const parsed = parseSkillMd(skillMdPath)
  const description = parsed.description ?? heuristicDescription(parsed.body)
  return {
    harness,
    skillName: normalizeKey(parsed.name),
    displayName: parsed.name,
    description,
    descriptionSource: parsed.description ? 'frontmatter' : description ? 'heuristic' : null,
    mtimeMs,
    sourcePath: skillMdPath,
    dirPath: path.dirname(skillMdPath),
    source,
  }
}
