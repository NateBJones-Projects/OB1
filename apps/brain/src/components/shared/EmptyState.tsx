'use client'

export type EmptyStateProps = {
  message: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <p className="text-sm text-gray-400 dark:text-gray-500">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-3 min-h-[44px] text-sm font-medium text-blue-600 dark:text-blue-400"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
