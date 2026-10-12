import { useEffect, useState } from 'react'
import { fetchFile } from '../api.ts'
import type { FileContentPayload } from '../types.ts'

export function FileViewer({ path }: { path: string }) {
  const [file, setFile] = useState<FileContentPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Parent remounts this component via key={path}, so no reset-in-effect needed.
  useEffect(() => {
    fetchFile(path)
      .then(setFile)
      .catch((err) => setError((err as Error).message))
  }, [path])

  if (error) return <p className="popup-note">Could not load file: {error}</p>
  if (!file) return <p className="popup-note">loading…</p>
  if (file.binary) return <p className="popup-note">binary — not displayable</p>

  return (
    <div className="file-viewer">
      <div className="file-viewer-path">{path}</div>
      <pre>{file.content}</pre>
      {file.truncated && <p className="popup-note">…truncated at 512 KB</p>}
    </div>
  )
}
