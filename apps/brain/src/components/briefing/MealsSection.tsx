'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { MealSlot } from '@/components/meals/MealSlot'
import {
  getMealPlanWeek,
  getMonday,
  formatWeekStart,
  type MealPlanRow,
  type MealType,
} from '@/lib/queries/meal-plans'
import { getRecipes, type Recipe } from '@/lib/queries/recipes'

const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function getTodayKey(): string {
  return DAY_ORDER[new Date().getDay()]
}

export function MealsSection() {
  const router = useRouter()
  const [meals, setMeals] = useState<MealPlanRow[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadMeals() {
      try {
        const weekStart = formatWeekStart(getMonday(new Date()))
        const [weekMeals, recipeRows] = await Promise.all([
          getMealPlanWeek(weekStart),
          getRecipes(),
        ])

        if (!cancelled) {
          setMeals(weekMeals)
          setRecipes(recipeRows)
        }
      } catch (error) {
        console.error('[MealsSection] failed to load meals', error)
        if (!cancelled) {
          setMeals([])
          setRecipes([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadMeals()

    return () => {
      cancelled = true
    }
  }, [])

  const todayMeals = meals
    .filter((meal) => meal.day_of_week === getTodayKey())
    .sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type))

  const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]))

  return (
    <section>
      <SectionHeader label="Today's meals" />

      {loading ? (
        <LoadingSpinner size="sm" />
      ) : todayMeals.length === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-500 dark:text-gray-400">No meals planned today.</p>
          <button
            onClick={() => router.push('/meals')}
            className="self-start text-sm font-medium text-blue-600 dark:text-blue-400"
          >
            Plan meals -&gt;
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {todayMeals.map((meal) => {
            const recipe = meal.recipe_id ? recipeMap.get(meal.recipe_id) : undefined
            return (
              <MealSlot
                key={meal.id}
                id={meal.id}
                mealType={meal.meal_type}
                recipeName={recipe?.name ?? null}
                customMeal={meal.custom_meal}
                recipeId={meal.recipe_id}
                onTap={() => router.push('/meals')}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
