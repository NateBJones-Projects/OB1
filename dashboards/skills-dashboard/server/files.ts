import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { TreeNode } from './types.ts'

const MAX_DEPTH = 6
const MAX_ENTRIES = 200
const MAX_FILE_BYTES = 512 * 1024

/**
 * Path guard for the file-browser endpoints: the requested path must resolve
 * (through symlinks) to somewhere inside one of the roots the adapters scanned.
 * Symlinked entries themselves are rejected so a link inside a skill dir can't
 * lead the tree/viewer outside the allowlist.
 */
export function guardPath(requested: string, allowedRoots: string[]): string | null {
  let real: string
  try {
    real = realpathSync(requested)
  } catch {
    return null
  }
  for (const root of allowedRoots) {
    let realRoot: string
    try {
      realRoot = realpathSync(root)
    } catch {
      continue
    }
    const rel = path.relative(realRoot, real)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return real
  }
  return null
}

export function buildTree(dirPath: string): TreeNode {
  let budget = MAX_ENTRIES
  const walk = (dir: string, depth: number): TreeNode => {
    const node: TreeNode = { name: path.basename(dir), path: dir, type: 'dir', size: 0, children: [] }
    if (depth > MAX_DEPTH) {
      node.truncated = true
      return node
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    } catch {
      return node
    }
    for (const entry of entries) {
      if (budget <= 0) {
        node.truncated = true
        break
      }
      const full = path.join(dir, entry.name)
      let stat
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) continue // symlinks are excluded outright
      budget--
      if (stat.isDirectory()) {
        node.children!.push(walk(full, depth + 1))
      } else if (stat.isFile()) {
        node.children!.push({ name: entry.name, path: full, type: 'file', size: stat.size })
      }
    }
    return node
  }
  return walk(dirPath, 0)
}

export interface FileContent {
  content: string
  binary: boolean
  truncated: boolean
  size: number
}

export function readFileCapped(filePath: string): FileContent | null {
  let stat
  try {
    stat = lstatSync(filePath)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  const buf = readFileSync(filePath).subarray(0, MAX_FILE_BYTES)
  const binary = buf.includes(0)
  return {
    content: binary ? '' : buf.toString('utf8'),
    binary,
    truncated: stat.size > MAX_FILE_BYTES,
    size: stat.size,
  }
}
