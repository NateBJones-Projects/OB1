import type { HarnessMeta } from '../types.ts'
import type { VisibleRow } from '../App.tsx'
import { SkillRow } from './SkillRow.tsx'

interface Props {
  category: string
  rows: VisibleRow[]
  harnesses: HarnessMeta[]
  now: number
  isCollapsed: boolean
  onToggle: () => void
  onOpenPopup: (row: VisibleRow) => void
}

export function CategoryGroup({ category, rows, harnesses, now, isCollapsed, onToggle, onOpenPopup }: Props) {
  return (
    <tbody className="category-group">
      <tr className="category-row">
        <td colSpan={3 + harnesses.length}>
          <button
            type="button"
            className="category-toggle"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
          >
            <span className="category-caret" aria-hidden="true">
              {isCollapsed ? '▸' : '▾'}
            </span>
            <span className="category-name">{category}</span>
            <span className="category-count">{rows.length}</span>
          </button>
        </td>
      </tr>
      {!isCollapsed &&
        rows.map((row) => (
          <SkillRow key={row.key} row={row} harnesses={harnesses} now={now} onOpenPopup={onOpenPopup} />
        ))}
    </tbody>
  )
}
