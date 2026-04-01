'use client'

import { Badge } from '@/components/shared/Badge'
import type { Recipe } from '@/lib/queries/recipes'

type RecipeDetailProps = {
  recipe: Recipe
  onAddToMealPlan: () => void
}

function formatTime(minutes: number | null): string | null {
  if (!minutes) return null
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function RecipeDetail({ recipe, onAddToMealPlan }: RecipeDetailProps) {
  const totalTime = formatTime(
    (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0),
  )

  const metaItems = [
    recipe.cuisine ? { label: 'Cuisine', value: recipe.cuisine } : null,
    recipe.prep_time_minutes ? { label: 'Prep', value: formatTime(recipe.prep_time_minutes) } : null,
    recipe.cook_time_minutes ? { label: 'Cook', value: formatTime(recipe.cook_time_minutes) } : null,
    totalTime ? { label: 'Total', value: totalTime } : null,
    recipe.servings ? { label: 'Serves', value: String(recipe.servings) } : null,
    recipe.rating ? { label: 'Rating', value: `★ ${recipe.rating}` } : null,
  ].filter(Boolean) as { label: string; value: string | null }[]

  return (
    <div className="flex flex-col gap-5">
      {/* Meta row */}
      {metaItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {metaItems.map(({ label, value }) => (
            <div
              key={label}
              className="flex flex-col items-center rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-gray-800"
            >
              <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {recipe.tags && recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recipe.tags.map((tag) => (
            <Badge key={tag} label={tag} variant="gray" />
          ))}
        </div>
      )}

      {/* Ingredients */}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Ingredients</h3>
          <ul className="flex flex-col gap-1 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="text-sm text-gray-700 dark:text-gray-300">
                {[ing.quantity, ing.unit, ing.name].filter(Boolean).join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Instructions */}
      {recipe.instructions && recipe.instructions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Instructions</h3>
          <ol className="flex flex-col gap-3">
            {recipe.instructions.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Notes */}
      {recipe.notes && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Notes</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{recipe.notes}</p>
        </div>
      )}

      {/* Add to meal plan */}
      <button
        onClick={onAddToMealPlan}
        className="min-h-[44px] w-full rounded-lg bg-blue-600 text-sm font-medium text-white"
      >
        Add to meal plan
      </button>
    </div>
  )
}
