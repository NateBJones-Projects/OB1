'use client'

export type LoadingSpinnerProps = {
  size?: 'sm' | 'md'
}

export function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  const px = size === 'sm' ? 20 : 32

  return (
    <div className="flex items-center justify-center p-4">
      <div
        className="animate-spin rounded-full border-2 border-gray-200 border-t-gray-500 dark:border-gray-700 dark:border-t-gray-400"
        style={{ width: px, height: px }}
      />
    </div>
  )
}
