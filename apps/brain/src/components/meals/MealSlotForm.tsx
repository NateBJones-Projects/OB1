'use client'

import { useState } from 'react'
import { RecipePicker } from './RecipePicker'
import type { MealPlanRow, MealType } from '@/lib/queries/meal-plans'

type MealSlotFormProps = {
  weekStart: string
  initialDay?: string
  initialMeal?: MealPlanRow
  preselectedRecipe?: { id: string; name: string }
  onSave: (payload: Omit<MealPlanRow, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export function MealSlotForm({ weekStart, initialDay, initialMeal, preselectedRecipe, onSave, onDelete, onCancel }: MealSlotFormProps) {
  const [day, setDay] = useState(initialMeal?.day_of_week ?? initialDay ?? 'monday')
  const [mealType, setMealType] = useState<MealType>(initialMeal?.meal_type ?? 'dinner')
  const [mode, setMode] = useState<'recipe' | 'custom'>(
    initialMeal?.recipe_id ? 'recipe' : 'custom',
  )
  const [selectedRecipe, setSelectedRecipe] = useState<{ id: string; name: string } | null>(
    preselectedRecipe ??
    (initialMeal?.recipe_id ? { id: initialMeal.recipe_id, name: '' } : null),
  )
  const [customMeal, setCustomMeal] = useState(initialMeal?.custom_meal ?? '')
  const [servings, setServings] = useState(String(initialMeal?.servings ?? ''))
  const [notes, setNotes] = useState(initialMeal?.notes ?? '')
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (mode === 'custom' && !customMeal.trim()) {
      setError('Please enter a meal name.')
      return
    }
    if (mode === 'recipe' && !selectedRecipe) {
      setError('Please pick a recipe or switch to custom meal.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        week_start: weekStart,
        day_of_week: day,
        meal_type: mealType,
        recipe_id: mode === 'recipe' ? (selectedRecipe?.id ?? null) : null,
        custom_meal: mode === 'custom' ? customMeal.trim() : null,
        servings: servings ? parseInt(servings, 10) : null,
        notes: notes.trim() || null,
      })
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setSaving(true)
    try {
      await onDelete()
    } catch {
      setError('Failed to remove meal.')
      setSaving(false)
    }
  }

  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
  const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'

  if (showPicker) {
    return (
      <RecipePicker
        onSelect={(r) => {
          setSelectedRecipe(r)
          setMode('recipe')
          setShowPicker(false)
        }}
        onCancel={() => setShowPicker(false)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      {/* Day */}
      <div>
        <label className={labelClass}>Day</label>
        <select value={day} onChange={(e) => setDay(e.target.value)} className={inputClass}>
          {DAYS.map((d) => (
            <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Meal type */}
      <div>
        <label className={labelClass}>Meal type</label>
        <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)} className={inputClass}>
          {MEAL_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Recipe or custom toggle */}
      <div>
        <div className="mb-2 flex gap-2">
          <button
            onClick={() => setMode('recipe')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${mode === 'recipe' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
          >
            Pick a recipe
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${mode === 'custom' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
          >
            Custom meal
          </button>
        </div>

        {mode === 'recipe' ? (
          <div className="flex items-center gap-2">
            {selectedRecipe ? (
              <>
                <span className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                  {selectedRecipe.name || 'Selected recipe'}
                </span>
                <button
                  onClick={() => setShowPicker(true)}
                  className="text-xs text-blue-600 dark:text-blue-400"
                >
                  Change
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowPicker(true)}
                className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm text-blue-600 dark:border-gray-600 dark:text-blue-400"
              >
                Browse recipes...
              </button>
            )}
          </div>
        ) : (
          <input
            type="text"
            value={customMeal}
            onChange={(e) => setCustomMeal(e.target.value)}
            placeholder="e.g., Takeout pizza, Leftovers"
            className={inputClass}
          />
        )}
      </div>

      {/* Servings */}
      <div>
        <label className={labelClass}>Servings (optional)</label>
        <input
          type="number"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          min="1"
          className={inputClass}
        />
      </div>

      {/* Notes */}
      <div>
        <label className={labelClass}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g., Make extra for lunches"
          rows={2}
          className={inputClass}
        />
      </div>

      {/* Actions */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="min-h-[44px] w-full rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save meal'}
      </button>

      {onDelete && (
        <button
          onClick={handleDelete}
          disabled={saving}
          className="min-h-[44px] w-full text-sm font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
        >
          Remove meal
        </button>
      )}

      <button
        onClick={onCancel}
        disabled={saving}
        className="min-h-[44px] w-full text-sm text-gray-500 dark:text-gray-400"
      >
        Cancel
      </button>
    </div>
  )
}
