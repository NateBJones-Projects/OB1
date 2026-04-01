'use client'

import { DayColumn } from './DayColumn'
import { DAY_ORDER } from '@/lib/queries/meal-plans'
import type { MealPlanRow } from '@/lib/queries/meal-plans'
import type { Recipe } from '@/lib/queries/recipes'

type WeekViewProps = {
  weekStart: Date
  meals: MealPlanRow[]
  recipes: Recipe[]
  onAddMeal: (dayOfWeek: string) => void
  onEditMeal: (meal: MealPlanRow) => void
  onViewRecipe: (recipeId: string) => void
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function WeekView({ weekStart, meals, recipes, onAddMeal, onEditMeal, onViewRecipe }: WeekViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {DAY_ORDER.map((day, i) => {
        const dayMeals = meals.filter((m) => m.day_of_week === day)
        const date = addDays(weekStart, i)

        return (
          <DayColumn
            key={day}
            dayOfWeek={day}
            date={date}
            meals={dayMeals}
            recipes={recipes}
            onAddMeal={onAddMeal}
            onEditMeal={onEditMeal}
            onViewRecipe={onViewRecipe}
          />
        )
      })}
    </div>
  )
}
