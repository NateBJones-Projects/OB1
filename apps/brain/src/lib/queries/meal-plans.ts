import { createClient } from '@/lib/supabase/client'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export type MealPlanRow = {
  id: string
  user_id: string
  household_id: string
  week_start: string
  day_of_week: string
  meal_type: MealType
  recipe_id: string | null
  custom_meal: string | null
  servings: number | null
  notes: string | null
  created_at: string
}

export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function formatWeekStart(monday: Date): string {
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const d = String(monday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function getMealPlanWeek(weekStart: string): Promise<MealPlanRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('week_start', weekStart)
    .order('day_of_week', { ascending: true })

  if (error) throw error
  return (data ?? []) as MealPlanRow[]
}

export async function addMeal(
  meal: Omit<MealPlanRow, 'id' | 'user_id' | 'household_id' | 'created_at'>,
  householdId: string,
): Promise<MealPlanRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('meal_plans')
    .insert({ ...meal, household_id: householdId })
    .select()
    .single()

  if (error) throw error
  return data as MealPlanRow
}

export async function updateMeal(id: string, updates: Partial<Omit<MealPlanRow, 'id' | 'user_id' | 'created_at'>>): Promise<MealPlanRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('meal_plans')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as MealPlanRow
}

export async function deleteMeal(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('meal_plans').delete().eq('id', id)
  if (error) throw error
}
