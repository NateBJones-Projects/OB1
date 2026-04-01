'use client'

import type { MealType } from '@/lib/queries/meal-plans'

const MEAL_TYPE_COLORS: Record<MealType, string> = {
  breakfast: 'bg-amber-400',
  lunch: 'bg-blue-400',
  dinner: 'bg-teal-400',
  snack: 'bg-gray-400',
}

type MealSlotProps = {
  id: string
  mealType: MealType
  recipeName?: string | null
  customMeal?: string | null
  servings?: number | null
  notes?: string | null
  recipeId?: string | null
  onTap: () => void
  onViewRecipe?: () => void
}

export function MealSlot({ mealType, recipeName, customMeal, recipeId, onTap, onViewRecipe }: MealSlotProps) {
  const name = recipeName ?? customMeal ?? 'Unnamed meal'
  const accentColor = MEAL_TYPE_COLORS[mealType]

  return (
    <button
      onClick={onTap}
      className="flex w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className={`w-1 flex-shrink-0 ${accentColor}`} />
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        <span className="text-xs font-medium capitalize text-gray-400 dark:text-gray-500">
          {mealType}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{name}</span>
        {recipeId && onViewRecipe && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onViewRecipe()
            }}
            className="mt-0.5 text-left text-xs text-blue-600 dark:text-blue-400"
          >
            View recipe →
          </button>
        )}
      </div>
    </button>
  )
}
