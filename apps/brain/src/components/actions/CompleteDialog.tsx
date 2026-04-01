'use client'

import { useState } from 'react'

type CompleteDialogProps = {
  isOpen: boolean
  actionContent: string
  onComplete: (note: string) => Promise<void>
  onCancel: () => void
}

export function CompleteDialog({
  isOpen,
  actionContent,
  onComplete,
  onCancel,
}: CompleteDialogProps) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  async function handleComplete() {
    if (!note.trim()) return
    setLoading(true)
    try {
      await onComplete(note.trim())
      setNote('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 mx-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Complete action
        </h2>
        <p className="mt-2 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
          {actionContent}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was done?"
          className="mt-4 w-full min-h-[100px] resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="mt-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={!note.trim() || loading}
            className="flex-1 min-h-[44px] rounded-lg bg-green-600 text-sm font-medium text-white disabled:opacity-50 dark:bg-green-500"
          >
            {loading ? 'Completing…' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  )
}
