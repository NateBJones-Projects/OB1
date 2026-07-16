import type { HarnessMeta } from '../types.ts'
import type { VisibleRow } from '../App.tsx'

interface Props {
  harness: HarnessMeta
  rows: VisibleRow[]
}

/**
 * Column header with the signature coverage strip: n installed / total visible
 * skills, so coverage gaps read at a glance.
 */
export function HarnessHeader({ harness, rows }: Props) {
  const installed = rows.filter((r) => r.visibleInstalls[harness.id]?.length).length
  const total = rows.length || 1
  const pct = Math.round((installed / total) * 100)

  return (
    <th className="col-harness" title={harness.note ?? `${installed} of ${rows.length} skills`}>
      <span className="harness-label">{harness.label}</span>
      {harness.available ? (
        <>
          <span className="harness-count">
            {installed}/{rows.length}
          </span>
          <span className="coverage-strip" aria-hidden="true">
            <span className="coverage-fill" style={{ width: `${pct}%` }} />
          </span>
        </>
      ) : (
        <span className="harness-badge">{harness.note}</span>
      )}
    </th>
  )
}
