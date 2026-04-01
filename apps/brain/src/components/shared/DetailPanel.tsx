'use client'

import { useEffect } from 'react'

export type DetailPanelProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  onEdit?: () => void
  onDelete?: () => void
}

export function DetailPanel({
  isOpen,
  onClose,
  title,
  children,
  onEdit,
  onDelete,
}: DetailPanelProps) {
  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  return (
    <div
      className={`absolute inset-0 z-40 transition-visibility ${
        isOpen ? 'visible' : 'invisible'
      }`}
    >
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`absolute bottom-0 left-0 right-0 flex flex-col rounded-t-2xl bg-white shadow-xl transition-transform duration-200 ease-out dark:bg-gray-900 ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height: '85vh' }}
      >
        {/* Header */}
        <div className="flex h-14 flex-shrink-0 items-center border-b border-gray-200 px-4 dark:border-gray-700">
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400"
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
          <h2 className="flex-1 text-center text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          {onEdit ? (
            <button
              onClick={onEdit}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-blue-600 dark:text-blue-400"
              aria-label="Edit"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13.5 2.5a2.121 2.121 0 0 1 3 3L5.5 16.5l-4 1 1-4Z" />
              </svg>
            </button>
          ) : (
            <div className="w-11" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {/* Delete button */}
        {onDelete && (
          <div className="flex-shrink-0 border-t border-gray-200 p-4 dark:border-gray-700">
            <button
              onClick={onDelete}
              className="min-h-[44px] w-full text-sm font-medium text-red-600 dark:text-red-400"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
