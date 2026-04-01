'use client'

import { useCallback, useEffect, useState } from 'react'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuth } from '@/contexts/AuthContext'
import { FilterTabs } from '@/components/shared/FilterTabs'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { FAB } from '@/components/shared/FAB'
import { DetailPanel } from '@/components/shared/DetailPanel'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

import { WeekNav } from '@/components/meals/WeekNav'
import { WeekView } from '@/components/meals/WeekView'
import { MealSlotForm } from '@/components/meals/MealSlotForm'
import { RecipeCard } from '@/components/meals/RecipeCard'
import { RecipeDetail } from '@/components/meals/RecipeDetail'
import { RecipeForm } from '@/components/meals/RecipeForm'
import { ShoppingList } from '@/components/meals/ShoppingList'

import {
  getMealPlanWeek,
  addMeal,
  updateMeal,
  deleteMeal,
  getMonday,
  formatWeekStart,
  type MealPlanRow,
} from '@/lib/queries/meal-plans'
import {
  getRecipes,
  searchRecipes,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  type Recipe,
  type Ingredient,
} from '@/lib/queries/recipes'
import {
  getShoppingList,
  upsertShoppingList,
  aggregateIngredients,
  type ShoppingList as ShoppingListType,
  type ShoppingItem,
} from '@/lib/queries/shopping-lists'

type MealsTab = 'week' | 'recipes' | 'shopping'
type RecipePanelMode = 'detail' | 'edit' | 'create' | null

const TABS: { label: string; value: MealsTab }[] = [
  { label: 'This week', value: 'week' },
  { label: 'Recipes', value: 'recipes' },
  { label: 'Shopping', value: 'shopping' },
]

export default function MealsPage() {
  const { isOwner } = useAuth()

  // ── Tab ───────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<MealsTab>('week')

  // ── This week tab ─────────────────────────────────────────────────────────────
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()))
  const [weekMeals, setWeekMeals] = useState<MealPlanRow[]>([])
  const [weekLoading, setWeekLoading] = useState(false)
  const [weekError, setWeekError] = useState<string | null>(null)

  // Meal slot form state
  const [slotPanelOpen, setSlotPanelOpen] = useState(false)
  const [slotInitialDay, setSlotInitialDay] = useState<string | undefined>()
  const [editingMeal, setEditingMeal] = useState<MealPlanRow | null>(null)

  // ── Recipes tab ───────────────────────────────────────────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeError, setRecipeError] = useState<string | null>(null)

  const [recipePanelMode, setRecipePanelMode] = useState<RecipePanelMode>(null)
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [showRecipeDelete, setShowRecipeDelete] = useState(false)

  // "Add to meal plan" from recipe detail — opens slot form
  const [addToMealPlanRecipe, setAddToMealPlanRecipe] = useState<Recipe | null>(null)

  // ── Shopping tab ──────────────────────────────────────────────────────────────
  const [shoppingList, setShoppingList] = useState<ShoppingListType | null>(null)
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [shoppingLoading, setShoppingLoading] = useState(false)

  // ── Load: week meals ──────────────────────────────────────────────────────────
  const loadWeekMeals = useCallback(async (monday: Date) => {
    setWeekLoading(true)
    setWeekError(null)
    try {
      const data = await getMealPlanWeek(formatWeekStart(monday))
      setWeekMeals(data)
    } catch {
      setWeekError('Failed to load meal plan.')
    } finally {
      setWeekLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'week') loadWeekMeals(weekStart)
  }, [activeTab, weekStart, loadWeekMeals])

  // ── Load: recipes ─────────────────────────────────────────────────────────────
  const loadRecipes = useCallback(async (query: string) => {
    setRecipeLoading(true)
    setRecipeError(null)
    try {
      const data = query.trim() ? await searchRecipes(query.trim()) : await getRecipes()
      setRecipes(data)
    } catch {
      setRecipeError('Failed to load recipes.')
    } finally {
      setRecipeLoading(false)
    }
  }, [])

  // Load recipes on both 'week' and 'recipes' tabs (week tab needs names for meal slots)
  useEffect(() => {
    if (activeTab !== 'recipes' && activeTab !== 'week') return
    if (activeTab === 'week' && recipes.length > 0) return // already loaded
    const timer = setTimeout(() => loadRecipes(recipeSearch), recipeSearch ? 300 : 0)
    return () => clearTimeout(timer)
  }, [activeTab, recipeSearch, loadRecipes])

  // ── Load: shopping list ───────────────────────────────────────────────────────
  const loadShoppingList = useCallback(async (monday: Date) => {
    setShoppingLoading(true)
    try {
      const list = await getShoppingList(formatWeekStart(monday))
      setShoppingList(list)
      setShoppingItems(list?.items ?? [])
    } catch {
      // non-critical
    } finally {
      setShoppingLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'shopping') loadShoppingList(weekStart)
  }, [activeTab, weekStart, loadShoppingList])

  // ── Week navigation ───────────────────────────────────────────────────────────
  function prevWeek() {
    setWeekStart((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() - 7)
      return next
    })
  }

  function nextWeek() {
    setWeekStart((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + 7)
      return next
    })
  }

  function resetToCurrentWeek() {
    setWeekStart(getMonday(new Date()))
  }

  // ── Meal slot handlers ────────────────────────────────────────────────────────
  function openAddMeal(day?: string) {
    setEditingMeal(null)
    setSlotInitialDay(day)
    setAddToMealPlanRecipe(null)
    setSlotPanelOpen(true)
  }

  function openEditMeal(meal: MealPlanRow) {
    setEditingMeal(meal)
    setSlotInitialDay(undefined)
    setAddToMealPlanRecipe(null)
    setSlotPanelOpen(true)
  }

  function closeSlotPanel() {
    setSlotPanelOpen(false)
    setEditingMeal(null)
    setSlotInitialDay(undefined)
    setAddToMealPlanRecipe(null)
  }

  async function handleSaveMeal(payload: Omit<MealPlanRow, 'id' | 'user_id' | 'created_at'>) {
    if (editingMeal) {
      await updateMeal(editingMeal.id, payload)
    } else {
      await addMeal(payload)
    }
    closeSlotPanel()
    await loadWeekMeals(weekStart)
  }

  async function handleDeleteMeal() {
    if (!editingMeal) return
    await deleteMeal(editingMeal.id)
    closeSlotPanel()
    await loadWeekMeals(weekStart)
  }

  // ── View recipe from week tab ─────────────────────────────────────────────────
  function handleViewRecipeFromWeek(recipeId: string) {
    const recipe = recipes.find((r) => r.id === recipeId)
    if (recipe) {
      setSelectedRecipe(recipe)
      setRecipePanelMode('detail')
    } else {
      // Switch to recipes tab and find it
      setActiveTab('recipes')
    }
  }

  // ── Recipe handlers ───────────────────────────────────────────────────────────
  function openRecipeDetail(recipe: Recipe) {
    setSelectedRecipe(recipe)
    setRecipePanelMode('detail')
  }

  function closeRecipePanel() {
    setRecipePanelMode(null)
    setSelectedRecipe(null)
    setShowRecipeDelete(false)
  }

  async function handleSaveRecipe(payload: Omit<Recipe, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    if (recipePanelMode === 'edit' && selectedRecipe) {
      const updated = await updateRecipe(selectedRecipe.id, payload)
      setSelectedRecipe(updated)
      setRecipePanelMode('detail')
    } else {
      await createRecipe(payload)
      closeRecipePanel()
    }
    await loadRecipes(recipeSearch)
  }

  async function handleDeleteRecipe() {
    if (!selectedRecipe) return
    await deleteRecipe(selectedRecipe.id)
    closeRecipePanel()
    await loadRecipes(recipeSearch)
  }

  function handleAddToMealPlan(recipe: Recipe) {
    setAddToMealPlanRecipe(recipe)
    closeRecipePanel()
    setActiveTab('week')
    setSlotPanelOpen(true)
  }

  // ── Shopping list handlers ────────────────────────────────────────────────────
  async function handleGenerateShoppingList() {
    setGenerating(true)
    try {
      const weekMealData = await getMealPlanWeek(formatWeekStart(weekStart))
      const seen = new Set<string>()
      const recipeIds = (weekMealData.map((m) => m.recipe_id).filter(Boolean) as string[]).filter(
        (id) => (seen.has(id) ? false : (seen.add(id), true)),
      )

      // Use cached recipes; fall back to a fresh fetch if not yet loaded
      const allRecipes = recipes.length > 0 ? recipes : await getRecipes()

      const recipeIngredients = recipeIds.map((id) => {
        const recipe = allRecipes.find((r) => r.id === id)
        return recipe ? { recipeId: id, ingredients: recipe.ingredients } : null
      }).filter(Boolean) as Array<{ recipeId: string; ingredients: Ingredient[] }>

      const aggregated = aggregateIngredients(recipeIngredients)

      const saved = await upsertShoppingList(
        formatWeekStart(weekStart),
        aggregated,
        shoppingList?.id,
      )
      setShoppingList(saved)
      setShoppingItems(saved.items)
    } catch {
      // keep existing list if any
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggleItem(index: number) {
    const next = shoppingItems.map((item, i) =>
      i === index ? { ...item, purchased: !item.purchased } : item,
    )
    setShoppingItems(next)

    if (shoppingList) {
      try {
        await upsertShoppingList(formatWeekStart(weekStart), next, shoppingList.id)
      } catch {
        // revert on failure
        setShoppingItems(shoppingItems)
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const recipePanelTitle =
    recipePanelMode === 'create'
      ? 'New recipe'
      : recipePanelMode === 'edit'
        ? 'Edit recipe'
        : selectedRecipe?.name ?? 'Recipe'

  const slotPanelTitle = editingMeal ? 'Edit meal' : 'Add meal'

  return (
    <AuthGuard>
      <div
        className="relative -mx-4 -my-4 flex flex-col overflow-hidden"
        style={{ minHeight: 'calc(100dvh - 3.5rem)' }}
      >
        {/* Scrollable content */}
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-24 pt-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Meals</h1>

          <FilterTabs tabs={TABS} activeTab={activeTab} onChange={(v) => setActiveTab(v as MealsTab)} />

          {/* ── This week ── */}
          {activeTab === 'week' && (
            <div className="flex flex-col gap-4">
              <WeekNav
                weekStart={weekStart}
                onPrev={prevWeek}
                onNext={nextWeek}
                onReset={resetToCurrentWeek}
              />
              {weekLoading ? (
                <LoadingSpinner />
              ) : weekError ? (
                <p className="text-sm text-red-500">{weekError}</p>
              ) : (
                <WeekView
                  weekStart={weekStart}
                  meals={weekMeals}
                  recipes={recipes}
                  onAddMeal={openAddMeal}
                  onEditMeal={openEditMeal}
                  onViewRecipe={handleViewRecipeFromWeek}
                />
              )}
            </div>
          )}

          {/* ── Recipes ── */}
          {activeTab === 'recipes' && (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Search recipes..."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {recipeLoading ? (
                <LoadingSpinner />
              ) : recipeError ? (
                <p className="text-sm text-red-500">{recipeError}</p>
              ) : recipes.length === 0 ? (
                <EmptyState
                  message="No recipes saved yet."
                  actionLabel="Add recipe"
                  onAction={() => setRecipePanelMode('create')}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {recipes.map((r) => (
                    <RecipeCard key={r.id} recipe={r} onTap={() => openRecipeDetail(r)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Shopping ── */}
          {activeTab === 'shopping' && (
            shoppingLoading ? (
              <LoadingSpinner />
            ) : (
              <ShoppingList
                weekStart={weekStart}
                shoppingList={shoppingList}
                items={shoppingItems}
                generating={generating}
                onGenerate={handleGenerateShoppingList}
                onToggleItem={handleToggleItem}
                onSwitchToWeek={() => setActiveTab('week')}
              />
            )
          )}
        </div>

        {/* FAB */}
        {activeTab !== 'shopping' && (
          <FAB
            onTap={() => {
              if (activeTab === 'week') openAddMeal()
              else setRecipePanelMode('create')
            }}
            label={activeTab === 'week' ? 'Add meal' : 'Add recipe'}
          />
        )}

        {/* ── Meal slot panel ── */}
        <DetailPanel
          isOpen={slotPanelOpen}
          onClose={closeSlotPanel}
          title={slotPanelTitle}
        >
          <MealSlotForm
            weekStart={formatWeekStart(weekStart)}
            initialDay={slotInitialDay}
            initialMeal={editingMeal ?? undefined}
            preselectedRecipe={
              addToMealPlanRecipe
                ? { id: addToMealPlanRecipe.id, name: addToMealPlanRecipe.name }
                : undefined
            }
            onSave={handleSaveMeal}
            onDelete={editingMeal ? handleDeleteMeal : undefined}
            onCancel={closeSlotPanel}
          />
        </DetailPanel>

        {/* ── Recipe panel ── */}
        <DetailPanel
          isOpen={recipePanelMode !== null}
          onClose={closeRecipePanel}
          title={recipePanelTitle}
          onEdit={
            recipePanelMode === 'detail' && selectedRecipe
              ? () => setRecipePanelMode('edit')
              : undefined
          }
          onDelete={
            recipePanelMode === 'detail' && selectedRecipe && isOwner
              ? () => setShowRecipeDelete(true)
              : undefined
          }
        >
          {recipePanelMode === 'detail' && selectedRecipe && (
            <RecipeDetail
              recipe={selectedRecipe}
              onAddToMealPlan={() => handleAddToMealPlan(selectedRecipe)}
            />
          )}
          {(recipePanelMode === 'edit' || recipePanelMode === 'create') && (
            <RecipeForm
              initialRecipe={recipePanelMode === 'edit' ? (selectedRecipe ?? undefined) : undefined}
              onSave={handleSaveRecipe}
              onCancel={() =>
                selectedRecipe ? setRecipePanelMode('detail') : closeRecipePanel()
              }
            />
          )}
        </DetailPanel>

        {/* ── Delete recipe confirm ── */}
        <ConfirmDialog
          isOpen={showRecipeDelete}
          title="Delete recipe"
          message={`Delete "${selectedRecipe?.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={handleDeleteRecipe}
          onCancel={() => setShowRecipeDelete(false)}
        />
      </div>
    </AuthGuard>
  )
}
