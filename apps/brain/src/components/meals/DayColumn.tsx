'use client'

import { MealSlot } from './MealSlot'
import type { MealPlanRow, MealType } from '@/lib/queries/meal-plans'
import type { Recipe } from '@/lib/queries/recipes'

type DayColumnProps = {
  dayOfWeek: string
  date: Date
  meals: MealPlanRow[]
  recipes: Recipe[]
  onAddMeal: (dayOfWeek: string) => void
  onEditMeal: (meal: MealPlanRow) => void
  onViewRecipe: (recipeId: string) => void
}

function formatDayHeader(dayOfWeek: string, date: Date): string {
  const dayName = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${dayName}, ${dateStr}`
}

const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export function DayColumn({ dayOfWeek, date, meals, recipes, onAddMeal, onEditMeal, onViewRecipe }: DayColumnProps) {
  const sortedMeals = [...meals].sort(
    (a, b) => MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type),
  )

  const recipeMap = new Map(recipes.map((r) => [r.id, r]))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {formatDayHeader(dayOfWeek, date)}
        </span>
        <button
          onClick={() => onAddMeal(dayOfWeek)}
          className="text-xs font-medium text-blue-600 dark:text-blue-400"
        >
          + Add
        </button>
      </div>

      {sortedMeals.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">No meals planned</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sortedMeals.map((meal) => {
            const recipe = meal.recipe_id ? recipeMap.get(meal.recipe_id) : undefined
            return (
              <MealSlot
                key={meal.id}
                id={meal.id}
                mealType={meal.meal_type}
                recipeName={recipe?.name ?? null}
                customMeal={meal.custom_meal}
                servings={meal.servings}
                notes={meal.notes}
                recipeId={meal.recipe_id}
                onTap={() => onEditMeal(meal)}
                onViewRecipe={meal.recipe_id ? () => onViewRecipe(meal.recipe_id!) : undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
