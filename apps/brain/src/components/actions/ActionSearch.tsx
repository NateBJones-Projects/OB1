'use client'

import { useEffect, useRef, useState } from 'react'
import { ActionCard } from './ActionCard'
import { searchActions, type Action } from '@/lib/queries/actions'

type ActionSearchProps = {
  query: string
  onQueryChange: (q: string) => void
  onSelect: (action: Action) => void
}

export function ActionSearch({ query, onQueryChange, onSelect }: ActionSearchProps) {
  const [results, setResults] = useState<Action[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await searchActions(query.trim())
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search actions…"
          className="w-full min-h-[44px] rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-base text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="flex flex-col gap-2">
          {searching ? (
            <p className="py-4 text-center text-sm text-gray-400">Searching…</p>
          ) : results.length > 0 ? (
            results.map((action) => (
              <ActionCard key={action.id} action={action} onTap={onSelect} />
            ))
          ) : (
            <p className="py-4 text-center text-sm text-gray-400">No results</p>
          )}
        </div>
      )}
    </div>
  )
}
