import type { FileContentPayload, MatrixPayload, TreeNode } from './types.ts'

export type Mode = 'live' | 'snapshot'

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? ''
  // A static SPA host answers unknown routes with index.html + 200 — treat as failure.
  if (!res.ok || !contentType.includes('application/json')) {
    throw new Error(`unexpected response (${res.status}, ${contentType})`)
  }
  return res.json()
}

export async function fetchMatrix(
  signal?: AbortSignal,
): Promise<{ payload: MatrixPayload; mode: Mode }> {
  try {
    const res = await fetch('/api/skills', { signal })
    return { payload: await jsonOrThrow<MatrixPayload>(res), mode: 'live' }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const res = await fetch('/skills.json', { signal })
    return { payload: await jsonOrThrow<MatrixPayload>(res), mode: 'snapshot' }
  }
}

export async function fetchTree(dirPath: string): Promise<TreeNode> {
  const res = await fetch(`/api/skill-tree?path=${encodeURIComponent(dirPath)}`)
  return jsonOrThrow<TreeNode>(res)
}

export async function fetchFile(filePath: string): Promise<FileContentPayload> {
  const res = await fetch(`/api/skill-file?path=${encodeURIComponent(filePath)}`)
  return jsonOrThrow<FileContentPayload>(res)
}

export async function runEnrich(): Promise<{ enriched: number; candidates: number }> {
  const res = await fetch('/api/enrich', { method: 'POST' })
  return jsonOrThrow(res)
}
