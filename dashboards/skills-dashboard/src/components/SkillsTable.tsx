import type { MatrixPayload } from '../types.ts'
import type { VisibleRow } from '../App.tsx'
import { CategoryGroup } from './CategoryGroup.tsx'
import { HarnessHeader } from './HarnessHeader.tsx'

interface Props {
  payload: MatrixPayload
  rows: VisibleRow[]
  now: number
  collapsed: Set<string>
  searchActive: boolean
  onToggleCategory: (category: string) => void
  onOpenPopup: (row: VisibleRow) => void
}

export function SkillsTable({ payload, rows, now, collapsed, searchActive, onToggleCategory, onOpenPopup }: Props) {
  const byCategory = new Map<string, VisibleRow[]>()
  for (const category of payload.categories) byCategory.set(category, [])
  for (const row of rows) {
    const bucket = byCategory.get(row.category) ?? byCategory.get('Other')!
    bucket.push(row)
  }

  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th className="col-skill">Skill</th>
            <th className="col-desc">Description</th>
            <th className="col-date">Updated</th>
            {payload.harnesses.map((h) => (
              <HarnessHeader key={h.id} harness={h} rows={rows} />
            ))}
          </tr>
        </thead>
        {payload.categories.map((category) => {
          const categoryRows = byCategory.get(category) ?? []
          if (categoryRows.length === 0) return null
          return (
            <CategoryGroup
              key={category}
              category={category}
              rows={categoryRows}
              harnesses={payload.harnesses}
              now={now}
              // A live search always shows its matches; collapse applies when browsing.
              isCollapsed={!searchActive && collapsed.has(category)}
              onToggle={() => onToggleCategory(category)}
              onOpenPopup={onOpenPopup}
            />
          )
        })}
      </table>
      {rows.length === 0 && <p className="empty-note">No skills match. Clear the search or enable plugin skills.</p>}
    </div>
  )
}
