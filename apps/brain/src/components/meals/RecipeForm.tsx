'use client'

import { useState } from 'react'
import { IngredientList } from './IngredientList'
import { InstructionList } from './InstructionList'
import type { Recipe, Ingredient } from '@/lib/queries/recipes'

type RecipeFormProps = {
  initialRecipe?: Recipe
  onSave: (recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>
  onCancel: () => void
}

export function RecipeForm({ initialRecipe, onSave, onCancel }: RecipeFormProps) {
  const [name, setName] = useState(initialRecipe?.name ?? '')
  const [cuisine, setCuisine] = useState(initialRecipe?.cuisine ?? '')
  const [servings, setServings] = useState(String(initialRecipe?.servings ?? ''))
  const [prepTime, setPrepTime] = useState(String(initialRecipe?.prep_time_minutes ?? ''))
  const [cookTime, setCookTime] = useState(String(initialRecipe?.cook_time_minutes ?? ''))
  const [rating, setRating] = useState(String(initialRecipe?.rating ?? ''))
  const [tags, setTags] = useState((initialRecipe?.tags ?? []).join(', '))
  const [notes, setNotes] = useState(initialRecipe?.notes ?? '')
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initialRecipe?.ingredients?.length ? initialRecipe.ingredients : [{ name: '', quantity: '', unit: '' }],
  )
  const [instructions, setInstructions] = useState<string[]>(
    initialRecipe?.instructions?.length ? initialRecipe.instructions : [''],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setError('Recipe name is required.')
      return
    }

    const validIngredients = ingredients.filter((i) => i.name.trim())
    if (validIngredients.length === 0) {
      setError('At least one ingredient is required.')
      return
    }

    const validInstructions = instructions.filter((s) => s.trim())
    if (validInstructions.length === 0) {
      setError('At least one instruction step is required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        cuisine: cuisine.trim() || null,
        servings: servings ? parseInt(servings, 10) : null,
        prep_time_minutes: prepTime ? parseInt(prepTime, 10) : null,
        cook_time_minutes: cookTime ? parseInt(cookTime, 10) : null,
        rating: rating ? parseInt(rating, 10) : null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: notes.trim() || null,
        ingredients: validIngredients,
        instructions: validInstructions,
      })
    } catch {
      setError('Failed to save recipe. Please try again.')
      setSaving(false)
    }
  }

  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
  const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
  const sectionClass = 'text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2'

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Name */}
      <div>
        <label className={labelClass}>Recipe name *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g., Chicken tikka masala" />
      </div>

      {/* Cuisine */}
      <div>
        <label className={labelClass}>Cuisine</label>
        <input type="text" value={cuisine} onChange={(e) => setCuisine(e.target.value)} className={inputClass} placeholder="e.g., Italian, Mexican, Thai" />
      </div>

      {/* Servings + times */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelClass}>Servings</label>
          <input type="number" value={servings} onChange={(e) => setServings(e.target.value)} min="1" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Prep (min)</label>
          <input type="number" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} min="0" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Cook (min)</label>
          <input type="number" value={cookTime} onChange={(e) => setCookTime(e.target.value)} min="0" className={inputClass} />
        </div>
      </div>

      {/* Rating */}
      <div>
        <label className={labelClass}>Rating</label>
        <select value={rating} onChange={(e) => setRating(e.target.value)} className={inputClass}>
          <option value="">No rating</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{'★'.repeat(n)} {n}/5</option>
          ))}
        </select>
      </div>

      {/* Tags */}
      <div>
        <label className={labelClass}>Tags</label>
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} placeholder="quick, weeknight, vegetarian (comma-separated)" />
      </div>

      {/* Notes */}
      <div>
        <label className={labelClass}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} placeholder="Any tips or variations..." />
      </div>

      {/* Ingredients */}
      <div>
        <p className={sectionClass}>Ingredients *</p>
        <IngredientList ingredients={ingredients} onChange={setIngredients} />
      </div>

      {/* Instructions */}
      <div>
        <p className={sectionClass}>Instructions *</p>
        <InstructionList instructions={instructions} onChange={setInstructions} />
      </div>

      {/* Save / Cancel */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="min-h-[44px] w-full rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Saving...' : initialRecipe ? 'Save changes' : 'Create recipe'}
      </button>

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
