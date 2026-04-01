'use client'

export type SectionHeaderProps = {
  label: string
}

export function SectionHeader({ label }: SectionHeaderProps) {
  return (
    <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-gray-400 dark:text-gray-500">
      {label}
    </h3>
  )
}
