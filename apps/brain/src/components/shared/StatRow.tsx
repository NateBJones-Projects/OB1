'use client'

export type StatProps = {
  value: number | string
  label: string
}

export type StatRowProps = {
  stats: StatProps[]
}

export function StatRow({ stats }: StatRowProps) {
  return (
    <div className="flex gap-2">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-800"
        >
          <span className="text-xl font-medium text-gray-900 dark:text-gray-100">
            {stat.value}
          </span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {stat.label}
          </span>
        </div>
      ))}
    </div>
  )
}
