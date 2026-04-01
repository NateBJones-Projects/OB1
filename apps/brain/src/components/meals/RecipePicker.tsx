'use client'

import { useEffect, useState } from 'react'
import { searchRecipes, getRecipes } from '@/lib/queries/recipes'
import type { Recipe } from '@/lib/queries/recipes'

type RecipePickerProps = {
  onSelect: (recipe: { id: string; name: string }) => void
  onCancel: () => void
}

export function RecipePicker({ onSelect, onCancel }: RecipePickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = query.trim() ? await searchRecipes(query.trim()) : await getRecipes()
        if (!cancelled) setResults(data)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const timer = setTimeout(load, query ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search recipes..."
        autoFocus
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />

      {loading ? (
        <p className="text-sm text-gray-400">Searching...</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-gray-400">No recipes found.</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect({ id: r.id, name: r.name })}
              className="flex flex-col gap-0.5 py-2.5 text-left"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.name}</span>
              {(r.cuisine || (r.tags && r.tags.length > 0)) && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {[r.cuisine, ...(r.tags ?? []).slice(0, 2)].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onCancel}
        className="text-sm text-gray-500 underline dark:text-gray-400"
      >
        Cancel — type a custom meal instead
      </button>
    </div>
  )
}
