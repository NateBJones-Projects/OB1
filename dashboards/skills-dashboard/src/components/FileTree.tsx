import { useEffect, useState } from 'react'
import { fetchTree } from '../api.ts'
import type { TreeNode } from '../types.ts'

interface Props {
  dirPath: string
  onOpenFile: (path: string) => void
}

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`

function Node({ node, onOpenFile, depth }: { node: TreeNode; onOpenFile: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  if (node.type === 'file') {
    return (
      <li>
        <button type="button" className="tree-file" onClick={() => onOpenFile(node.path)}>
          {node.name} <span className="tree-size">{fmtSize(node.size)}</span>
        </button>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        className="tree-dir"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {node.name}/
      </button>
      {open && (
        <ul className="tree-children">
          {node.children?.map((child) => (
            <Node key={child.path} node={child} onOpenFile={onOpenFile} depth={depth + 1} />
          ))}
          {node.truncated && <li className="tree-truncated">…truncated</li>}
        </ul>
      )}
    </li>
  )
}

export function FileTree({ dirPath, onOpenFile }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Parent remounts this component via key={dirPath}, so no reset-in-effect needed.
  useEffect(() => {
    fetchTree(dirPath)
      .then(setTree)
      .catch((err) => setError((err as Error).message))
  }, [dirPath])

  if (error) return <p className="popup-note">Could not load tree: {error}</p>
  if (!tree) return <p className="popup-note">loading…</p>
  return (
    <ul className="tree-root">
      <Node node={tree} onOpenFile={onOpenFile} depth={0} />
    </ul>
  )
}
