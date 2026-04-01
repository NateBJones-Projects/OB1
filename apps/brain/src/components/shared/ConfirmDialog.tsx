'use client'

import { useState } from 'react'

export type ConfirmDialogProps = {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => Promise<void>
  onCancel: () => void
  destructive?: boolean
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative z-10 mx-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-scale-in dark:bg-gray-900">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {message}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 dark:bg-red-500'
                : 'bg-blue-600 dark:bg-blue-500'
            }`}
          >
            {loading ? 'Loading…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
