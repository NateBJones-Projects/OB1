import { createClient } from '@/lib/supabase/client'

export type Ingredient = {
  name: string
  quantity: string
  unit: string
}

export type Recipe = {
  id: string
  user_id: string
  household_id: string
  name: string
  cuisine: string | null
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  servings: number | null
  ingredients: Ingredient[]
  instructions: string[]
  tags: string[]
  rating: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export async function getRecipes(): Promise<Recipe[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as Recipe[]
}

export async function getRecipe(id: string): Promise<Recipe> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Recipe
}

export async function createRecipe(
  recipe: Omit<Recipe, 'id' | 'user_id' | 'household_id' | 'created_at' | 'updated_at'>,
  householdId: string,
): Promise<Recipe> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('recipes')
    .insert({ ...recipe, household_id: householdId })
    .select()
    .single()

  if (error) throw error
  return data as Recipe
}

export async function updateRecipe(id: string, updates: Partial<Omit<Recipe, 'id' | 'user_id' | 'created_at'>>): Promise<Recipe> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('recipes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Recipe
}

export async function deleteRecipe(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function searchRecipes(query: string): Promise<Recipe[]> {
  const supabase = createClient()
  const term = `%${query}%`
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .or(`name.ilike.${term},cuisine.ilike.${term}`)
    .order('name', { ascending: true })
    .limit(50)

  if (error) throw error
  return (data ?? []) as Recipe[]
}
