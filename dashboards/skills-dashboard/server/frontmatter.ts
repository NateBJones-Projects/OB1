import { readFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

export interface ParsedSkillMd {
  name: string
  description: string | null
  body: string
}

/**
 * Parse a SKILL.md, tolerating malformed or missing YAML frontmatter.
 * Identity falls back to the containing directory name so a broken file
 * still appears on the dashboard rather than vanishing.
 */
export function parseSkillMd(absPath: string): ParsedSkillMd {
  const dirName = path.basename(path.dirname(absPath))
  let raw = ''
  try {
    raw = readFileSync(absPath, 'utf8')
  } catch {
    return { name: dirName, description: null, body: '' }
  }
  try {
    const parsed = matter(raw)
    const fm = parsed.data ?? {}
    const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : dirName
    const description =
      typeof fm.description === 'string' && fm.description.trim() ? fm.description.trim() : null
    return { name, description, body: parsed.content ?? '' }
  } catch (err) {
    console.warn(`[frontmatter] malformed YAML in ${absPath}: ${(err as Error).message}`)
    return lenientParse(raw, dirName)
  }
}

/**
 * Recover name/description from a frontmatter block YAML refuses to parse
 * (typically an unquoted description containing ": "). Identity via frontmatter
 * name matters for cross-harness merging (e.g. dir `claudeception` declares
 * `name: aiception`), so dir-name fallback is a last resort.
 */
function lenientParse(raw: string, dirName: string): ParsedSkillMd {
  const fenceMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const body = fenceMatch ? raw.slice(fenceMatch[0].length) : raw
  const fence = fenceMatch?.[1] ?? ''
  const grab = (key: string): string | null => {
    // Value on the key's line, plus indented continuation lines (covers `key: |` blocks).
    const m = fence.match(new RegExp(`^${key}:[ \\t]*([^\\n]*)((?:\\n[ \\t]+[^\\n]*)*)`, 'm'))
    if (!m) return null
    const value = [m[1] === '|' || m[1] === '>' ? '' : m[1], m[2] ?? '']
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    return value || null
  }
  return { name: grab('name') ?? dirName, description: grab('description'), body }
}

/** First non-empty prose paragraph of the body, truncated — the no-frontmatter fallback. */
export function heuristicDescription(body: string, maxLen = 200): string | null {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block
      .replace(/^#+\s*/gm, '')
      .replace(/[*_`>|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length >= 20) {
      return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
    }
  }
  return null
}
