'use client'

import type { Ingredient } from '@/lib/queries/recipes'

type IngredientListProps = {
  ingredients: Ingredient[]
  onChange: (ingredients: Ingredient[]) => void
}

export function IngredientList({ ingredients, onChange }: IngredientListProps) {
  function update(index: number, field: keyof Ingredient, value: string) {
    const next = ingredients.map((ing, i) =>
      i === index ? { ...ing, [field]: value } : ing,
    )
    onChange(next)
  }

  function remove(index: number) {
    onChange(ingredients.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...ingredients, { name: '', quantity: '', unit: '' }])
  }

  const inputClass = 'rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'

  return (
    <div className="flex flex-col gap-2">
      {ingredients.map((ing, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={ing.name}
              onChange={(e) => update(i, 'name', e.target.value)}
              placeholder="Ingredient name"
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={() => remove(i)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-red-500 dark:text-gray-500"
              aria-label="Remove ingredient"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={ing.quantity}
              onChange={(e) => update(i, 'quantity', e.target.value)}
              placeholder="Qty"
              className={`${inputClass} w-16`}
            />
            <input
              type="text"
              value={ing.unit}
              onChange={(e) => update(i, 'unit', e.target.value)}
              placeholder="Unit"
              className={`${inputClass} w-20`}
            />
          </div>
        </div>
      ))}

      <button
        onClick={add}
        className="mt-1 text-sm font-medium text-blue-600 dark:text-blue-400"
      >
        + Add ingredient
      </button>
    </div>
  )
}
