'use client'

import { useCallback, useEffect, useState } from 'react'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuth } from '@/contexts/AuthContext'
import { FilterTabs } from '@/components/shared/FilterTabs'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { FAB } from '@/components/shared/FAB'
import { StatRow } from '@/components/shared/StatRow'
import { DetailPanel } from '@/components/shared/DetailPanel'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ActionCard } from '@/components/actions/ActionCard'
import { ActionDetail } from '@/components/actions/ActionDetail'
import { ActionForm } from '@/components/actions/ActionForm'
import { ActionSearch } from '@/components/actions/ActionSearch'
import { CompleteDialog } from '@/components/actions/CompleteDialog'
import {
  getActions,
  createAction,
  updateAction,
  deleteAction,
  completeAction,
  type Action,
} from '@/lib/queries/actions'

type Tab = 'active' | 'done' | 'cancelled'
type PanelMode = 'detail' | 'edit' | 'create' | null

const TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
]

function getLocalToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDistinctTags(actions: Action[]): string[] {
  const seen = new Set<string>()
  for (const action of actions) {
    for (const tag of action.tags ?? []) {
      seen.add(tag)
    }
  }
  return Array.from(seen).sort()
}

export default function ActionsPage() {
  const { isOwner } = useAuth()

  const [tab, setTab] = useState<Tab>('active')
  const [actions, setActions] = useState<Action[]>([])
  const [activeActions, setActiveActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [panelMode, setPanelMode] = useState<PanelMode>(null)
  const [selectedAction, setSelectedAction] = useState<Action | null>(null)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadList = useCallback(async (currentTab: Tab) => {
    setLoading(true)
    setError(null)
    try {
      const data = await getActions(currentTab)
      setActions(data)
    } catch {
      setError('Failed to load actions.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActiveStats = useCallback(async () => {
    try {
      const data = await getActions('active')
      setActiveActions(data)
    } catch {
      // stats are non-critical
    }
  }, [])

  useEffect(() => {
    loadList(tab)
    loadActiveStats()
  }, [tab, loadList, loadActiveStats])

  async function refresh() {
    await Promise.all([loadList(tab), loadActiveStats()])
  }

  function closePanel() {
    setPanelMode(null)
    setSelectedAction(null)
    setShowCompleteDialog(false)
    setShowDeleteConfirm(false)
  }

  function openDetail(action: Action) {
    setSelectedAction(action)
    setPanelMode('detail')
  }

  function openCreate() {
    setSelectedAction(null)
    setPanelMode('create')
  }

  // Stats derived from active actions
  const today = getLocalToday()
  const overdueCnt = activeActions.filter((a) => a.due_date && a.due_date < today).length
  const todayCnt = activeActions.filter((a) => a.due_date === today).length
  const openCnt = activeActions.length

  // Tag pills (active tab only, derived from current list)
  const distinctTags = getDistinctTags(tab === 'active' ? actions : [])

  // Filtered list
  const filtered =
    tab === 'active' && activeTag
      ? actions.filter((a) => a.tags?.includes(activeTag))
      : actions

  // Groups (active tab)
  const overdue = filtered.filter((a) => a.due_date && a.due_date < today)
  const dueToday = filtered.filter((a) => a.due_date === today)
  const upcoming = filtered.filter((a) => a.due_date && a.due_date > today)
  const noDate = filtered.filter((a) => !a.due_date)

  const panelTitle =
    panelMode === 'create'
      ? 'New Action'
      : panelMode === 'edit'
        ? 'Edit Action'
        : (selectedAction?.content.slice(0, 40) ?? 'Action')

  async function handleSaveCreate(payload: Partial<Action>) {
    await createAction(payload)
    closePanel()
    await refresh()
  }

  async function handleSaveEdit(payload: Partial<Action>) {
    if (!selectedAction) return
    const updated = await updateAction(selectedAction.id, payload)
    setSelectedAction(updated)
    setPanelMode('detail')
    await refresh()
  }

  async function handleComplete(note: string) {
    if (!selectedAction) return
    await completeAction(selectedAction, note)
    setShowCompleteDialog(false)
    closePanel()
    await refresh()
  }

  async function handleDelete() {
    if (!selectedAction) return
    await deleteAction(selectedAction.id)
    closePanel()
    await refresh()
  }

  const isPanelOpen = panelMode !== null

  return (
    <AuthGuard>
      <div
        className="relative -mx-4 -my-4 flex flex-col overflow-hidden"
        style={{ minHeight: 'calc(100dvh - 3.5rem)' }}
      >
        {/* Scrollable content */}
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-24 pt-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Actions</h1>

          <ActionSearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSelect={openDetail}
          />

          {!searchQuery && (
            <>
              <StatRow
                stats={[
                  { value: overdueCnt, label: 'Overdue' },
                  { value: todayCnt, label: 'Due today' },
                  { value: openCnt, label: 'Open' },
                ]}
              />

              <FilterTabs
                tabs={TABS}
                activeTab={tab}
                onChange={(v) => {
                  setTab(v as Tab)
                  setActiveTag(null)
                }}
              />

              {tab === 'active' && distinctTags.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setActiveTag(null)}
                    className={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
                      activeTag === null
                        ? 'bg-blue-600 text-white dark:bg-blue-500'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    All
                  </button>
                  {distinctTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      className={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
                        activeTag === tag
                          ? 'bg-blue-600 text-white dark:bg-blue-500'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </p>
              )}

              {loading ? (
                <LoadingSpinner />
              ) : tab === 'active' ? (
                filtered.length === 0 ? (
                  <EmptyState
                    message={
                      activeTag
                        ? `No actions tagged "${activeTag}"`
                        : 'No actions yet. Tap + to create one.'
                    }
                    actionLabel={activeTag ? 'Clear filter' : undefined}
                    onAction={activeTag ? () => setActiveTag(null) : undefined}
                  />
                ) : (
                  <>
                    {overdue.length > 0 && (
                      <>
                        <SectionHeader label="Overdue" />
                        {overdue.map((a) => (
                          <ActionCard key={a.id} action={a} onTap={openDetail} />
                        ))}
                      </>
                    )}
                    {dueToday.length > 0 && (
                      <>
                        <SectionHeader label="Today" />
                        {dueToday.map((a) => (
                          <ActionCard key={a.id} action={a} onTap={openDetail} />
                        ))}
                      </>
                    )}
                    {upcoming.length > 0 && (
                      <>
                        <SectionHeader label="Upcoming" />
                        {upcoming.map((a) => (
                          <ActionCard key={a.id} action={a} onTap={openDetail} />
                        ))}
                      </>
                    )}
                    {noDate.length > 0 && (
                      <>
                        <SectionHeader label="No date" />
                        {noDate.map((a) => (
                          <ActionCard key={a.id} action={a} onTap={openDetail} />
                        ))}
                      </>
                    )}
                  </>
                )
              ) : filtered.length === 0 ? (
                <EmptyState
                  message={tab === 'done' ? 'No completed actions' : 'No cancelled actions'}
                />
              ) : (
                filtered.map((a) => <ActionCard key={a.id} action={a} onTap={openDetail} />)
              )}
            </>
          )}
        </div>

        {/* FAB — hidden during search */}
        {!searchQuery && <FAB onTap={openCreate} label="Create action" />}

        {/* Detail / Form panel */}
        <DetailPanel
          isOpen={isPanelOpen}
          onClose={closePanel}
          title={panelTitle}
          onEdit={panelMode === 'detail' ? () => setPanelMode('edit') : undefined}
          onDelete={
            panelMode === 'detail' && isOwner ? () => setShowDeleteConfirm(true) : undefined
          }
        >
          {panelMode === 'detail' && selectedAction && (
            <ActionDetail
              action={selectedAction}
              onComplete={() => setShowCompleteDialog(true)}
            />
          )}
          {panelMode === 'edit' && selectedAction && (
            <ActionForm
              mode="edit"
              initialAction={selectedAction}
              onSave={handleSaveEdit}
              onCancel={() => setPanelMode('detail')}
            />
          )}
          {panelMode === 'create' && (
            <ActionForm mode="create" onSave={handleSaveCreate} onCancel={closePanel} />
          )}
        </DetailPanel>

        {/* Complete dialog */}
        {selectedAction && (
          <CompleteDialog
            isOpen={showCompleteDialog}
            actionContent={selectedAction.content}
            onComplete={handleComplete}
            onCancel={() => setShowCompleteDialog(false)}
          />
        )}

        {/* Delete confirm */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete this action?"
          message="This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
    </AuthGuard>
  )
}
