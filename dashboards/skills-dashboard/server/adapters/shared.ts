import type { SkillInstall } from '../types.ts'

export interface AdapterResult {
  installs: SkillInstall[]
  available: boolean
  note?: string
  /** Directories this adapter scanned — the allowlist for the file-browser endpoints. */
  roots: string[]
}

export const emptyResult = (note?: string): AdapterResult => ({
  installs: [],
  available: false,
  note,
  roots: [],
})
