import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMatrix, type Mode } from './api.ts'
import type { HarnessId, InstallDetail, MatrixPayload, MatrixRow } from './types.ts'
import { isPluginSource } from './types.ts'
import { Toolbar } from './components/Toolbar.tsx'
import { SkillsTable } from './components/SkillsTable.tsx'
import { SkillPopup } from './components/SkillPopup.tsx'

const POLL_MS = 60_000
const COLLAPSED_KEY = 'skills-dashboard:collapsed'

/** A row after the plugin toggle has been applied at the install level. */
export interface VisibleRow extends MatrixRow {
  visibleInstalls: Partial<Record<HarnessId, InstallDetail[]>>
  visibleLatestMtimeMs: number
}

function applyToggle(rows: MatrixRow[], showPlugins: boolean): VisibleRow[] {
  const out: VisibleRow[] = []
  for (const row of rows) {
    const visibleInstalls: VisibleRow['visibleInstalls'] = {}
    let latest = 0
    for (const [harness, list] of Object.entries(row.installs) as [HarnessId, InstallDetail[]][]) {
      const kept = showPlugins ? list : list.filter((d) => !isPluginSource(d.source))
      if (kept.length) {
        visibleInstalls[harness] = kept
        latest = Math.max(latest, kept[0].mtimeMs)
      }
    }
    if (Object.keys(visibleInstalls).length) {
      out.push({ ...row, visibleInstalls, visibleLatestMtimeMs: latest })
    }
  }
  return out
}

const loadCollapsed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export default function App() {
  const [payload, setPayload] = useState<MatrixPayload | null>(null)
  const [mode, setMode] = useState<Mode>('live')
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showPlugins, setShowPlugins] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [popupRow, setPopupRow] = useState<VisibleRow | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await fetchMatrix(controller.signal)
      setPayload(result.payload)
      setMode(result.mode)
      setError(null)
      setLastFetched(Date.now())
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    // False positive: refresh() only sets state after `await fetchMatrix` resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [refresh])

  const persistCollapsed = (next: Set<string>) => {
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
  }

  const toggleCategory = (category: string) => {
    const next = new Set(collapsed)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    persistCollapsed(next)
  }

  const visibleRows = useMemo(() => {
    if (!payload) return []
    let rows = applyToggle(payload.rows, showPlugins)
    const query = search.trim().toLowerCase()
    if (query) {
      rows = rows.filter(
        (r) =>
          r.key.includes(query) ||
          r.displayName.toLowerCase().includes(query) ||
          r.description.toLowerCase().includes(query),
      )
    }
    return rows
  }, [payload, showPlugins, search])

  const pluginRowCount = useMemo(() => {
    if (!payload) return 0
    const withPlugins = applyToggle(payload.rows, true).length
    const withoutPlugins = applyToggle(payload.rows, false).length
    return withPlugins - withoutPlugins
  }, [payload])

  if (error && !payload) {
    return (
      <div className="boot-error">
        <h1>Skills Dashboard</h1>
        <p>Could not load skill data: {error}</p>
        <p>Start the scanner with <code>npm run dev</code>, or bake a snapshot with <code>npm run export</code>.</p>
      </div>
    )
  }
  if (!payload) return <div className="boot-loading">scanning…</div>

  return (
    <>
      <Toolbar
        payload={payload}
        mode={mode}
        error={error}
        lastFetched={lastFetched}
        search={search}
        onSearch={setSearch}
        showPlugins={showPlugins}
        onTogglePlugins={setShowPlugins}
        pluginRowCount={pluginRowCount}
        onCollapseAll={() => persistCollapsed(new Set(payload.categories))}
        onExpandAll={() => persistCollapsed(new Set())}
        onRefresh={refresh}
      />
      <SkillsTable
        payload={payload}
        rows={visibleRows}
        now={lastFetched ?? 0}
        collapsed={collapsed}
        searchActive={search.trim().length > 0}
        onToggleCategory={toggleCategory}
        onOpenPopup={setPopupRow}
      />
      {popupRow && (
        <SkillPopup row={popupRow} live={mode === 'live'} onClose={() => setPopupRow(null)} />
      )}
    </>
  )
}
