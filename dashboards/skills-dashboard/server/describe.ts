import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * LLM enrichment for skills with no usable description and rows categorized
 * "Other". NEVER called from the /api/skills request path (it's polled every
 * 60s) — scans read the cache only; `npm run enrich` / POST /api/enrich fill it.
 */

const CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.describe-cache.json')

export interface EnrichmentEntry {
  description?: string
  category?: string
}

export type EnrichmentCache = Record<string, EnrichmentEntry>

export const llmAvailable = () => Boolean(process.env.OPENROUTER_API_KEY)

export function sha256File(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex')
  } catch {
    return null
  }
}

export function loadCache(): EnrichmentCache {
  try {
    return existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}
  } catch {
    return {}
  }
}

function saveCache(cache: EnrichmentCache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

/** claude-haiku via OpenRouter wraps JSON in ```json fences — strip before parsing. */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

async function callLlm(
  skillName: string,
  skillMdContent: string,
  categories: readonly string[],
): Promise<EnrichmentEntry | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
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
              `This is an AI-assistant skill file named "${skillName}". ` +
              `Reply with ONLY a JSON object: {"description": <one sentence, max 25 words, saying what the skill does>, ` +
              `"category": <exactly one of ${JSON.stringify(categories)}>}.\n\n` +
              skillMdContent.slice(0, 6000),
          },
        ],
        max_tokens: 200,
      }),
    })
    if (!res.ok) {
      console.warn(`[enrich] OpenRouter ${res.status} for ${skillName}`)
      return null
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = JSON.parse(stripFences(data.choices?.[0]?.message?.content ?? ''))
    const entry: EnrichmentEntry = {}
    if (typeof parsed.description === 'string' && parsed.description.trim())
      entry.description = parsed.description.trim()
    if (typeof parsed.category === 'string' && categories.includes(parsed.category))
      entry.category = parsed.category
    return entry
  } catch (err) {
    console.warn(`[enrich] failed for ${skillName}: ${(err as Error).message}`)
    return null
  }
}

export interface EnrichTarget {
  key: string
  sourcePath: string
  needsDescription: boolean
  needsCategory: boolean
}

/** Fill the cache for the given targets. Returns how many entries were added. */
export async function enrich(
  targets: EnrichTarget[],
  categories: readonly string[],
): Promise<number> {
  const cache = loadCache()
  let added = 0
  for (const target of targets) {
    const hash = sha256File(target.sourcePath)
    if (!hash) continue
    const existing = cache[hash]
    const needs =
      (target.needsDescription && !existing?.description) ||
      (target.needsCategory && !existing?.category)
    if (!needs) continue
    const content = readFileSync(target.sourcePath, 'utf8')
    const entry = await callLlm(target.key, content, categories)
    if (entry && (entry.description || entry.category)) {
      cache[hash] = { ...existing, ...entry }
      added++
      saveCache(cache) // save incrementally so a crash keeps progress
      console.log(`[enrich] ${target.key}: ${JSON.stringify(entry)}`)
    }
  }
  return added
}
