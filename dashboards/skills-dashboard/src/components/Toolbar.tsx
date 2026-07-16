import { useEffect, useState } from 'react'
import { runEnrich } from '../api.ts'
import type { Mode } from '../api.ts'
import type { MatrixPayload } from '../types.ts'

interface Props {
  payload: MatrixPayload
  mode: Mode
  error: string | null
  lastFetched: number | null
  search: string
  onSearch: (value: string) => void
  showPlugins: boolean
  onTogglePlugins: (value: boolean) => void
  pluginRowCount: number
  onCollapseAll: () => void
  onExpandAll: () => void
  onRefresh: () => void
}

function AgoLabel({ lastFetched }: { lastFetched: number | null }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  if (!lastFetched) return null
  // Before the first tick, "just now" is accurate by definition.
  const seconds = now === null ? 0 : Math.max(0, Math.round((now - lastFetched) / 1000))
  return <>scanned {seconds < 5 ? 'just now' : `${seconds}s ago`}</>
}

export function Toolbar(props: Props) {
  const [enriching, setEnriching] = useState(false)
  const [enrichNote, setEnrichNote] = useState<string | null>(null)

  const enrich = async () => {
    setEnriching(true)
    setEnrichNote(null)
    try {
      const result = await runEnrich()
      setEnrichNote(`enriched ${result.enriched}/${result.candidates}`)
      props.onRefresh()
    } catch (err) {
      setEnrichNote(`enrich failed: ${(err as Error).message}`)
    } finally {
      setEnriching(false)
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <h1>Skills Dashboard</h1>
        <span className="toolbar-status">
          {props.mode === 'live' ? (
            <>
              <span className="status-dot live" aria-hidden="true" /> live ·{' '}
              <AgoLabel lastFetched={props.lastFetched} />
            </>
          ) : (
            <>
              <span className="status-dot snapshot" aria-hidden="true" /> snapshot from{' '}
              {new Date(props.payload.scannedAt).toLocaleString()}
            </>
          )}
          {props.error && <span className="toolbar-error"> · refresh failed: {props.error}</span>}
        </span>
      </div>
      <div className="toolbar-controls">
        <input
          type="search"
          placeholder="Search skills…"
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          aria-label="Search skills"
        />
        <label className="plugin-toggle">
          <input
            type="checkbox"
            checked={props.showPlugins}
            onChange={(e) => props.onTogglePlugins(e.target.checked)}
          />
          plugin skills ({props.pluginRowCount})
        </label>
        <button type="button" onClick={props.onExpandAll}>Expand all</button>
        <button type="button" onClick={props.onCollapseAll}>Collapse all</button>
        <button type="button" onClick={props.onRefresh}>Refresh</button>
        {props.payload.llmAvailable && props.mode === 'live' && (
          <button type="button" onClick={enrich} disabled={enriching}>
            {enriching ? 'Enriching…' : 'Enrich'}
          </button>
        )}
        {enrichNote && <span className="enrich-note">{enrichNote}</span>}
      </div>
    </header>
  )
}
