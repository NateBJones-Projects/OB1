'use client'

import { getMonday } from '@/lib/queries/meal-plans'

type WeekNavProps = {
  weekStart: Date
  onPrev: () => void
  onNext: () => void
  onReset: () => void
}

function formatWeekLabel(monday: Date): string {
  const today = getMonday(new Date())
  if (monday.getTime() === today.getTime()) return 'This week'

  return monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .replace(',', '')
    .replace(/(\w+ \d+)/, 'Week of $1')
}

export function WeekNav({ weekStart, onPrev, onNext, onReset }: WeekNavProps) {
  const label = formatWeekLabel(weekStart)
  const isCurrentWeek = label === 'This week'

  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 dark:bg-gray-800">
      <button
        onClick={onPrev}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 active:bg-gray-200 dark:text-gray-300 dark:active:bg-gray-700"
        aria-label="Previous week"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="11 4 6 9 11 14" />
        </svg>
      </button>

      <button
        onClick={onReset}
        className={`text-sm font-medium ${isCurrentWeek ? 'text-gray-900 dark:text-gray-100' : 'text-blue-600 dark:text-blue-400'}`}
      >
        {label}
      </button>

      <button
        onClick={onNext}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 active:bg-gray-200 dark:text-gray-300 dark:active:bg-gray-700"
        aria-label="Next week"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="7 4 12 9 7 14" />
        </svg>
      </button>
    </div>
  )
}
