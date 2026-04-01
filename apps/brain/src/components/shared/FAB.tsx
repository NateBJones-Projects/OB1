'use client'

export type FABProps = {
  onTap: () => void
  label?: string
}

export function FAB({ onTap, label = 'Add new' }: FABProps) {
  return (
    <button
      onClick={onTap}
      aria-label={label}
      className="absolute bottom-4 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg active:scale-95 transition-transform dark:bg-blue-500"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  )
}
