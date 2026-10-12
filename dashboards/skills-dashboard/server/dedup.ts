import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmAvailable } from './describe.ts'
import type { DuplicateGroup, DuplicateVerdict, MatrixRow } from './types.ts'

/**
 * Duplicate detection: any skill with more than one install inside a single
 * harness. Byte-identical copies (same content hash) are confirmed
 * mechanically; groups with differing content are candidates for LLM
 * judgment — same-name skills are sometimes genuinely different (telegram
 * vs discord "access"), sometimes redundant copies or platform variants.
 * Verdicts are cached by the group's content hashes, so a group is only
 * ever judged once until one of its files changes.
 */

const CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.dedup-cache.json')

type VerdictCache = Record<string, DuplicateVerdict>

const fileHash = (absPath: string): string => {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex')
  } catch {
    return `unreadable:${absPath}`
  }
}

function loadCache(): VerdictCache {
  try {
    return existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}
  } catch {
    return {}
  }
}

const IDENTICAL_VERDICT: DuplicateVerdict = {
  verdict: 'same',
  reasoning: 'The SKILL.md files are byte-identical.',
  recommendation:
    'Redundant copies shipped by different sources; any one of them serves the skill.',
  judgedBy: 'content-hash',
}

export function findDuplicates(rows: MatrixRow[]): DuplicateGroup[] {
  const cache = loadCache()
  const groups: DuplicateGroup[] = []
  for (const row of rows) {
    for (const [harness, installs] of Object.entries(row.installs)) {
      if (installs.length < 2) continue
      const hashes = installs.map((d) => fileHash(d.sourcePath))
      const identical = new Set(hashes).size === 1
      const id = createHash('sha256').update([...hashes].sort().join('|')).digest('hex').slice(0, 16)
      groups.push({
        id,
        key: row.key,
        displayName: row.displayName,
        harness: harness as DuplicateGroup['harness'],
        installs,
        identical,
        verdict: identical ? IDENTICAL_VERDICT : cache[id],
      })
    }
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key) || a.harness.localeCompare(b.harness))
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

async function judgeOne(group: DuplicateGroup): Promise<DuplicateVerdict | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const excerpts = group.installs
    .map(
      (d, i) =>
        `--- Copy ${i + 1} (source: ${d.source}, path: ${d.sourcePath}) ---\n` +
        readFileSync(d.sourcePath, 'utf8').slice(0, 2500),
    )
    .join('\n\n')
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          {
            role: 'user',
            content:
              `These ${group.installs.length} SKILL.md files are all installed under the name ` +
              `"${group.displayName}" in the same AI harness, but their contents differ. Decide:\n` +
              `- "same": redundant copies (or older/newer revisions) of one skill\n` +
              `- "variants": deliberate platform/client variants of one skill\n` +
              `- "different": genuinely different skills that merely share a name\n\n` +
              `Reply with ONLY a JSON object: {"verdict": "same"|"variants"|"different", ` +
              `"reasoning": <one sentence>, "recommendation": <one sentence of advice to the user, ` +
              `e.g. which copy looks canonical or whether both should stay>}\n\n` +
              excerpts,
          },
        ],
        max_tokens: 300,
      }),
    })
    if (!res.ok) {
      console.warn(`[dedup] OpenRouter ${res.status} for ${group.key}@${group.harness}`)
      return null
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = JSON.parse(stripFences(data.choices?.[0]?.message?.content ?? ''))
    if (!['same', 'variants', 'different'].includes(parsed.verdict)) return null
    return {
      verdict: parsed.verdict,
      reasoning: String(parsed.reasoning ?? ''),
      recommendation: String(parsed.recommendation ?? ''),
      judgedBy: 'openrouter/claude-haiku-4.5',
    }
  } catch (err) {
    console.warn(`[dedup] judgment failed for ${group.key}@${group.harness}: ${(err as Error).message}`)
    return null
  }
}

/** Judge every non-identical, not-yet-judged group (or a single one by id). */
export async function judgeDuplicates(
  groups: DuplicateGroup[],
  onlyId?: string,
): Promise<{ judged: number; groups: DuplicateGroup[] }> {
  if (!llmAvailable()) return { judged: 0, groups }
  const cache = loadCache()
  let judged = 0
  for (const group of groups) {
    if (group.identical || group.verdict) continue
    if (onlyId && group.id !== onlyId) continue
    const verdict = await judgeOne(group)
    if (verdict) {
      cache[group.id] = verdict
      group.verdict = verdict
      judged++
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2)) // incremental
      console.log(`[dedup] ${group.key}@${group.harness}: ${verdict.verdict}`)
    }
  }
  return { judged, groups }
}
