'use client'

import type { ShoppingList as ShoppingListType, ShoppingItem } from '@/lib/queries/shopping-lists'

type ShoppingListProps = {
  weekStart: Date
  shoppingList: ShoppingListType | null
  items: ShoppingItem[]
  generating: boolean
  onGenerate: () => Promise<void>
  onToggleItem: (index: number) => void
  onSwitchToWeek: () => void
}

export function ShoppingList({
  weekStart,
  shoppingList,
  items,
  generating,
  onGenerate,
  onToggleItem,
  onSwitchToWeek,
}: ShoppingListProps) {
  const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const unpurchased = items.filter((i) => !i.purchased)
  const purchased = items.filter((i) => i.purchased)

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Week of {weekLabel}
        </p>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {generating ? 'Generating...' : shoppingList ? 'Refresh list' : 'Generate list'}
        </button>
      </div>

      {/* No list yet */}
      {!shoppingList && !generating && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No shopping list for this week yet.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Plan some meals first, then tap "Generate list" above.
          </p>
          <button
            onClick={onSwitchToWeek}
            className="text-sm font-medium text-blue-600 dark:text-blue-400"
          >
            Go to This Week →
          </button>
        </div>
      )}

      {/* Items */}
      {shoppingList && items.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No items in this list. Add meals with recipes to generate ingredients.
        </p>
      )}

      {unpurchased.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {unpurchased.map((item, i) => {
            const realIndex = items.indexOf(item)
            return (
              <button
                key={i}
                onClick={() => onToggleItem(realIndex)}
                className="flex items-center gap-3 py-2.5 text-left"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 border-gray-300 dark:border-gray-600" />
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  {[item.quantity, item.unit, item.name].filter(Boolean).join(' ')}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {purchased.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            In cart ({purchased.length})
          </p>
          {purchased.map((item, i) => {
            const realIndex = items.indexOf(item)
            return (
              <button
                key={i}
                onClick={() => onToggleItem(realIndex)}
                className="flex items-center gap-3 py-2.5 text-left"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                </span>
                <span className="text-sm text-gray-400 line-through dark:text-gray-500">
                  {[item.quantity, item.unit, item.name].filter(Boolean).join(' ')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
