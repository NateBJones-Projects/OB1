'use client'

type BriefingStatsProps = {
  loading: boolean
  overdueCount: number
  dueTodayCount: number
  openCount: number
}

type StatCardProps = {
  label: string
  value: number
  loading: boolean
  tone: 'neutral' | 'danger' | 'warning'
}

function StatCard({ label, value, loading, tone }: StatCardProps) {
  const valueClasses =
    tone === 'danger' && value > 0
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning' && value > 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-900 dark:text-gray-100'

  return (
    <div className="flex flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
      <span className={`text-xl font-medium ${valueClasses}`}>{loading ? '...' : value}</span>
      <span className="text-[11px] text-gray-400 dark:text-gray-500">{label}</span>
    </div>
  )
}

export function BriefingStats({
  loading,
  overdueCount,
  dueTodayCount,
  openCount,
}: BriefingStatsProps) {
  return (
    <div className="flex gap-2">
      <StatCard label="Overdue" value={overdueCount} loading={loading} tone="danger" />
      <StatCard label="Due today" value={dueTodayCount} loading={loading} tone="warning" />
      <StatCard label="Open" value={openCount} loading={loading} tone="neutral" />
    </div>
  )
}
