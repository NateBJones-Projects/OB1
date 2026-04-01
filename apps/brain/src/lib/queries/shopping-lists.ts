import { createClient } from '@/lib/supabase/client'
import type { Ingredient } from './recipes'

export type ShoppingItem = {
  name: string
  quantity: string
  unit: string
  purchased: boolean
  recipe_id?: string | null
}

export type ShoppingList = {
  id: string
  user_id: string
  household_id: string
  week_start: string
  items: ShoppingItem[]
  notes: string | null
  created_at: string
  updated_at: string
}

export async function getShoppingList(weekStart: string): Promise<ShoppingList | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('week_start', weekStart)
    .maybeSingle()

  if (error) throw error
  return data as ShoppingList | null
}

export async function upsertShoppingList(
  weekStart: string,
  items: ShoppingItem[],
  householdId: string,
  existingId?: string,
): Promise<ShoppingList> {
  const supabase = createClient()

  if (existingId) {
    const { data, error } = await supabase
      .from('shopping_lists')
      .update({ items, updated_at: new Date().toISOString() })
      .eq('id', existingId)
      .select()
      .single()

    if (error) throw error
    return data as ShoppingList
  }

  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ week_start: weekStart, items, household_id: householdId })
    .select()
    .single()

  if (error) throw error
  return data as ShoppingList
}

export function aggregateIngredients(
  ingredientsByRecipe: Array<{ recipeId: string; ingredients: Ingredient[] }>,
): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>()

  for (const { recipeId, ingredients } of ingredientsByRecipe) {
    for (const ing of ingredients) {
      const key = `${ing.name.toLowerCase().trim()}__${ing.unit.toLowerCase().trim()}`
      const existing = map.get(key)

      if (existing) {
        const prev = parseFloat(existing.quantity) || 0
        const next = parseFloat(ing.quantity) || 0
        existing.quantity = String(prev + next)
      } else {
        map.set(key, {
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          purchased: false,
          recipe_id: recipeId,
        })
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}
