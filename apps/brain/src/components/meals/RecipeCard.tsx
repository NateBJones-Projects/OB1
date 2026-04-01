'use client'

import { Card } from '@/components/shared/Card'
import type { Recipe } from '@/lib/queries/recipes'

type RecipeCardProps = {
  recipe: Recipe
  onTap: () => void
}

function formatTime(minutes: number | null): string | null {
  if (!minutes) return null
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function buildSubtitle(recipe: Recipe): string {
  const totalTime = formatTime((recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0))
  const parts = [
    recipe.cuisine,
    totalTime,
    recipe.rating ? `★ ${recipe.rating}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function RecipeCard({ recipe, onTap }: RecipeCardProps) {
  return (
    <Card
      title={recipe.name}
      subtitle={buildSubtitle(recipe) || undefined}
      badges={(recipe.tags ?? []).map((t) => ({ label: t, variant: 'gray' as const }))}
      onTap={onTap}
    />
  )
}
