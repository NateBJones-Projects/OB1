import { scanClaudeCode } from './adapters/claude-code.ts'
import { scanCodex } from './adapters/codex.ts'
import { scanGrok } from './adapters/grok.ts'
import { scanHermes } from './adapters/hermes.ts'
import { scanClaudeDesktop } from './adapters/claude-desktop.ts'
import { scanChatGPTDesktop } from './adapters/chatgpt-desktop.ts'
import type { AdapterResult } from './adapters/shared.ts'
import { CATEGORIES, categorize } from './categories.ts'
import { findDuplicates } from './dedup.ts'
import { loadCache, llmAvailable, sha256File, type EnrichTarget } from './describe.ts'
import type {
  HarnessId,
  InstallDetail,
  MatrixPayload,
  MatrixRow,
  SkillInstall,
} from './types.ts'

const HARNESSES: { id: HarnessId; label: string; scan: () => AdapterResult }[] = [
  { id: 'claude-code', label: 'Claude Code', scan: scanClaudeCode },
  { id: 'codex', label: 'Codex', scan: scanCodex },
  { id: 'grok', label: 'Grok Build', scan: scanGrok },
  { id: 'hermes', label: 'Hermes', scan: scanHermes },
  { id: 'claude-desktop', label: 'Claude Desktop', scan: scanClaudeDesktop },
  { id: 'chatgpt-desktop', label: 'ChatGPT Desktop', scan: scanChatGPTDesktop },
]

export interface ScanResult {
  payload: MatrixPayload
  /** Allowlisted roots for the file-browser endpoints. */
  roots: string[]
  /** Rows that would benefit from LLM enrichment. */
  enrichTargets: EnrichTarget[]
}

const isPlugin = (source: string) => source.startsWith('plugin:')

/** Prefer non-plugin installs' descriptions; manifest beats heuristic; LLM cache last. */
function resolveDescription(
  installs: SkillInstall[],
  cachedDescription: string | undefined,
): { description: string; source: MatrixRow['descriptionSource'] } {
  const ranked = [...installs].sort((a, b) => Number(isPlugin(a.source)) - Number(isPlugin(b.source)))
  for (const priority of ['frontmatter', 'manifest'] as const) {
    const hit = ranked.find((i) => i.descriptionSource === priority && i.description)
    if (hit) return { description: hit.description!, source: priority }
  }
  if (cachedDescription) return { description: cachedDescription, source: 'llm' }
  const heuristic = ranked.find((i) => i.descriptionSource === 'heuristic' && i.description)
  if (heuristic) return { description: heuristic.description!, source: 'heuristic' }
  return { description: '', source: 'none' }
}

export function scanAll(): ScanResult {
  const rowsByKey = new Map<string, SkillInstall[]>()
  const roots: string[] = []
  const harnesses = HARNESSES.map(({ id, label, scan }) => {
    let result: AdapterResult
    try {
      result = scan()
    } catch (err) {
      console.warn(`[scanner] ${id} adapter failed: ${(err as Error).message}`)
      result = { installs: [], available: false, note: 'scan failed', roots: [] }
    }
    roots.push(...result.roots)
    for (const install of result.installs) {
      const list = rowsByKey.get(install.skillName) ?? []
      list.push(install)
      rowsByKey.set(install.skillName, list)
    }
    return { id, label, available: result.available, note: result.note, count: result.installs.length }
  })

  const cache = loadCache()
  const enrichTargets: EnrichTarget[] = []

  const rows: MatrixRow[] = [...rowsByKey.entries()]
    .map(([key, installs]) => {
      // Newest install first within each harness; the client renders cell state from [0].
      const byHarness: Partial<Record<HarnessId, InstallDetail[]>> = {}
      for (const install of installs) {
        const details = (byHarness[install.harness] ??= [])
        details.push({
          mtimeMs: install.mtimeMs,
          sourcePath: install.sourcePath,
          dirPath: install.dirPath,
          source: install.source,
          ...(install.enabled !== undefined ? { enabled: install.enabled } : {}),
        })
      }
      for (const details of Object.values(byHarness)) details.sort((a, b) => b.mtimeMs - a.mtimeMs)

      // LLM cache lookup is keyed by content hash of a representative SKILL.md.
      const representative = [...installs].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
      const hasRealDescription = installs.some(
        (i) => i.descriptionSource === 'frontmatter' || i.descriptionSource === 'manifest',
      )
      const cached = hasRealDescription ? undefined : cache[sha256File(representative.sourcePath) ?? '']

      const { description, source } = resolveDescription(installs, cached?.description)
      const category = cached?.category ?? categorize(key, description)

      if (!hasRealDescription || category === 'Other') {
        enrichTargets.push({
          key,
          sourcePath: representative.sourcePath,
          needsDescription: !hasRealDescription,
          needsCategory: category === 'Other',
        })
      }

      return {
        key,
        displayName: representative.displayName,
        description,
        descriptionSource: source,
        category,
        latestMtimeMs: Math.max(...installs.map((i) => i.mtimeMs)),
        installs: byHarness,
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    payload: {
      scannedAt: new Date().toISOString(),
      llmAvailable: llmAvailable(),
      harnesses,
      categories: [...CATEGORIES],
      rows,
      duplicates: findDuplicates(rows),
    },
    roots,
    enrichTargets,
  }
}
