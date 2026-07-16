export type HarnessId =
  | 'claude-code'
  | 'codex'
  | 'grok'
  | 'hermes'
  | 'claude-desktop'
  | 'chatgpt-desktop'

export interface HarnessMeta {
  id: HarnessId
  label: string
  available: boolean
  note?: string
  count: number
}

/** One SKILL.md found on disk. A harness may hold several installs of the same skill. */
export interface SkillInstall {
  harness: HarnessId
  /** Normalized identity key: frontmatter name, lowercased/trimmed; dir name fallback. */
  skillName: string
  displayName: string
  description: string | null
  /** Where the description came from, for provenance in the UI. */
  descriptionSource: 'frontmatter' | 'manifest' | 'heuristic' | 'llm' | null
  mtimeMs: number
  /** Absolute path to the SKILL.md (live mode only; stripped from snapshots). */
  sourcePath: string
  /** Absolute path to the skill directory (live mode only; stripped from snapshots). */
  dirPath: string
  /** 'personal' | 'system' | 'plugin:<name>' */
  source: string
  /** Claude Desktop manifest enabled flag; undefined elsewhere. */
  enabled?: boolean
}

export interface InstallDetail {
  mtimeMs: number
  sourcePath: string
  dirPath: string
  source: string
  enabled?: boolean
}

export interface MatrixRow {
  key: string
  displayName: string
  description: string
  descriptionSource: 'frontmatter' | 'manifest' | 'heuristic' | 'llm' | 'none'
  category: string
  /** Max mtime across every install — the "Updated" column. */
  latestMtimeMs: number
  /** Newest-first install list per harness. */
  installs: Partial<Record<HarnessId, InstallDetail[]>>
}

export interface MatrixPayload {
  scannedAt: string
  /** True when the server can enrich descriptions via LLM (OPENROUTER_API_KEY set). */
  llmAvailable: boolean
  harnesses: HarnessMeta[]
  categories: string[]
  rows: MatrixRow[]
}

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  truncated?: boolean
  children?: TreeNode[]
}
