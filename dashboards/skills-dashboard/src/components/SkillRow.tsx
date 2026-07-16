import { useState } from 'react'
import type { HarnessMeta, InstallDetail } from '../types.ts'
import type { VisibleRow } from '../App.tsx'

interface Props {
  row: VisibleRow
  harnesses: HarnessMeta[]
  /** Reference timestamp for freshness (the last fetch time) — keeps render pure. */
  now: number
  onOpenPopup: (row: VisibleRow) => void
}

const DAY_MS = 86_400_000
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function cellTitle(details: InstallDetail[]): string {
  return details
    .map((d) => `${d.source} · ${fmtDate(d.mtimeMs)}\n${d.sourcePath}`)
    .join('\n\n')
}

export function SkillRow({ row, harnesses, now, onOpenPopup }: Props) {
  const [expanded, setExpanded] = useState(false)
  const fresh = now - row.visibleLatestMtimeMs < 7 * DAY_MS
  const pluginOnly = Object.values(row.visibleInstalls).every((list) =>
    list.every((d) => d.source.startsWith('plugin:')),
  )

  return (
    <>
      <tr className="skill-row">
        <td className="col-skill">
          <button type="button" className="skill-name" onClick={() => onOpenPopup(row)}>
            {row.displayName}
          </button>
          {pluginOnly && <span className="chip">plugin</span>}
          <button
            type="button"
            className="expand-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} install details for ${row.displayName}`}
          >
            {expanded ? '−' : '+'}
          </button>
        </td>
        <td className="col-desc" title={row.description}>
          {row.description ? (
            <span className="desc-clamp">{row.description}</span>
          ) : (
            <span className="no-desc">(no description)</span>
          )}
        </td>
        <td className={`col-date${fresh ? ' fresh' : ''}`}>{fmtDate(row.visibleLatestMtimeMs)}</td>
        {harnesses.map((h) => {
          const details = row.visibleInstalls[h.id]
          if (!details?.length) return <td key={h.id} className="col-harness cell-absent" />
          const newest = details[0]
          const disabled = newest.enabled === false
          return (
            <td
              key={h.id}
              className={`col-harness cell-present${disabled ? ' cell-disabled' : ''}`}
              title={cellTitle(details) + (disabled ? '\n(disabled in Claude Desktop)' : '')}
            >
              ×
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={3 + harnesses.length}>
            {row.description && <p className="detail-desc">{row.description}</p>}
            <ul className="install-list">
              {harnesses.flatMap((h) =>
                (row.visibleInstalls[h.id] ?? []).map((d) => (
                  <li key={`${h.id}:${d.sourcePath}`}>
                    <span className="install-harness">{h.label}</span>
                    <span className="install-source">{d.source}</span>
                    <span className="install-date">{fmtDate(d.mtimeMs)}</span>
                    {d.enabled === false && <span className="install-disabled">disabled</span>}
                    <span className="install-path">{d.sourcePath}</span>
                  </li>
                )),
              )}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}
