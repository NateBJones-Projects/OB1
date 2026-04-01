'use client'

export type BadgeProps = {
  label: string
  variant: 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray'
}

const variantClasses: Record<BadgeProps['variant'], string> = {
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export function Badge({ label, variant }: BadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight ${variantClasses[variant]}`}
    >
      {label}
    </span>
  )
}
