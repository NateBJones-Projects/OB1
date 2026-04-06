'use client'

import { useCallback, useEffect, useState } from 'react'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuth } from '@/contexts/AuthContext'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { FAB } from '@/components/shared/FAB'
import { DetailPanel } from '@/components/shared/DetailPanel'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

import { MaintenanceCard } from '@/components/household/MaintenanceCard'
import { MaintenanceDetail } from '@/components/household/MaintenanceDetail'
import { MaintenanceForm } from '@/components/household/MaintenanceForm'
import { LogMaintenanceDialog } from '@/components/household/LogMaintenanceDialog'
import { ItemCard } from '@/components/household/ItemCard'
import { ItemDetail } from '@/components/household/ItemDetail'
import { ItemForm } from '@/components/household/ItemForm'
import { VendorCard } from '@/components/household/VendorCard'
import { VendorDetail } from '@/components/household/VendorDetail'
import { VendorForm } from '@/components/household/VendorForm'

import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  logCompletion,
  type MaintenanceTask,
  type MaintenanceLogEntry,
} from '@/lib/queries/maintenance'
import {
  getItems,
  createItem,
  updateItem,
  deleteItem,
  searchItems,
  type HouseholdItem,
} from '@/lib/queries/household-items'
import {
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  getServiceTypes,
  type Vendor,
} from '@/lib/queries/vendors'

type HouseholdTab = 'maintenance' | 'items' | 'vendors'
type PanelMode = 'detail' | 'edit' | 'create' | null

const TABS: { label: string; value: HouseholdTab }[] = [
  { label: 'Maintenance', value: 'maintenance' },
  { label: 'Items', value: 'items' },
  { label: 'Vendors', value: 'vendors' },
]

// ── Date helpers ──────────────────────────────────────────────────────────────

function getLocalToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / msPerDay)
}

// ── Maintenance grouping ──────────────────────────────────────────────────────

type UrgencyGroup = {
  label: string
  urgencyLabel: (task: MaintenanceTask) => string
  urgencyVariant: 'red' | 'amber' | 'green' | 'blue' | 'gray'
  tasks: MaintenanceTask[]
}

function groupTasksByUrgency(tasks: MaintenanceTask[]): UrgencyGroup[] {
  const today = getLocalToday()
  const week = addDays(today, 7)
  const month = addDays(today, 30)

  const overdue: MaintenanceTask[] = []
  const dueThisWeek: MaintenanceTask[] = []
  const upcoming: MaintenanceTask[] = []
  const later: MaintenanceTask[] = []
  const noSchedule: MaintenanceTask[] = []

  for (const task of tasks) {
    if (!task.next_due && task.frequency_days == null) {
      noSchedule.push(task)
      continue
    }
    if (!task.next_due) {
      noSchedule.push(task)
      continue
    }
    const due = task.next_due.slice(0, 10)
    if (due < today) {
      overdue.push(task)
    } else if (due <= week) {
      dueThisWeek.push(task)
    } else if (due <= month) {
      upcoming.push(task)
    } else {
      later.push(task)
    }
  }

  const groups: UrgencyGroup[] = []

  if (overdue.length > 0) {
    groups.push({
      label: 'Overdue',
      urgencyLabel: (t) => {
        const days = daysBetween(t.next_due!.slice(0, 10), today)
        return `${days}d overdue`
      },
      urgencyVariant: 'red',
      tasks: overdue,
    })
  }

  if (dueThisWeek.length > 0) {
    groups.push({
      label: 'Due this week',
      urgencyLabel: (t) => {
        const days = daysBetween(today, t.next_due!.slice(0, 10))
        return days === 0 ? 'Today' : `${days}d`
      },
      urgencyVariant: 'amber',
      tasks: dueThisWeek,
    })
  }

  if (upcoming.length > 0) {
    groups.push({
      label: 'Upcoming',
      urgencyLabel: (t) => {
        const days = daysBetween(today, t.next_due!.slice(0, 10))
        const weeks = Math.round(days / 7)
        return weeks <= 1 ? `${days}d` : `${weeks}w`
      },
      urgencyVariant: 'green',
      tasks: upcoming,
    })
  }

  if (later.length > 0) {
    groups.push({
      label: 'Later',
      urgencyLabel: (t) => {
        const due = new Date(t.next_due!.slice(0, 10) + 'T00:00:00')
        return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      },
      urgencyVariant: 'blue',
      tasks: later,
    })
  }

  if (noSchedule.length > 0) {
    groups.push({
      label: 'No schedule',
      urgencyLabel: () => 'No date',
      urgencyVariant: 'gray',
      tasks: noSchedule,
    })
  }

  return groups
}

// ── Items grouping ────────────────────────────────────────────────────────────

function groupItemsByCategory(
  items: HouseholdItem[],
): { category: string; items: HouseholdItem[] }[] {
  const map = new Map<string, HouseholdItem[]>()
  for (const item of items) {
    const cat = item.category ?? 'Other'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({ category, items }))
}

// ── Page component ────────────────────────────────────────────────────────────

export default function HouseholdPage() {
  const { isOwner, householdId } = useAuth()

  const [activeTab, setActiveTab] = useState<HouseholdTab>('maintenance')

  // Maintenance state
  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<MaintenanceTask | null>(null)
  const [taskPanelMode, setTaskPanelMode] = useState<PanelMode>(null)
  const [showLogDialog, setShowLogDialog] = useState(false)
  const [showTaskDeleteConfirm, setShowTaskDeleteConfirm] = useState(false)

  // Items state
  const [items, setItems] = useState<HouseholdItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<HouseholdItem[] | null>(null)
  const [selectedItem, setSelectedItem] = useState<HouseholdItem | null>(null)
  const [itemPanelMode, setItemPanelMode] = useState<PanelMode>(null)
  const [showItemDeleteConfirm, setShowItemDeleteConfirm] = useState(false)

  // Vendors state
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [serviceTypes, setServiceTypes] = useState<string[]>([])
  const [activeServiceType, setActiveServiceType] = useState<string | null>(null)
  const [vendorsLoading, setVendorsLoading] = useState(true)
  const [vendorsError, setVendorsError] = useState<string | null>(null)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [vendorPanelMode, setVendorPanelMode] = useState<PanelMode>(null)
  const [showVendorDeleteConfirm, setShowVendorDeleteConfirm] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    setTasksLoading(true)
    setTasksError(null)
    try {
      setTasks(await getTasks())
    } catch (error) {
      console.error('[HouseholdPage] failed to load maintenance tasks', error)
      setTasksError('Failed to load maintenance tasks.')
    } finally {
      setTasksLoading(false)
    }
  }, [])

  const loadItems = useCallback(async () => {
    setItemsLoading(true)
    setItemsError(null)
    try {
      setItems(await getItems())
    } catch (error) {
      console.error('[HouseholdPage] failed to load household items', error)
      setItemsError('Failed to load household items.')
    } finally {
      setItemsLoading(false)
    }
  }, [])

  const loadVendors = useCallback(async () => {
    setVendorsLoading(true)
    setVendorsError(null)
    try {
      const [data, types] = await Promise.all([getVendors(), getServiceTypes()])
      setVendors(data)
      setServiceTypes(types)
    } catch (error) {
      console.error('[HouseholdPage] failed to load vendors', error)
      setVendorsError('Failed to load vendors.')
    } finally {
      setVendorsLoading(false)
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => { loadVendors() }, [loadVendors])

  // ── Search (Items tab) ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    const timeout = setTimeout(async () => {
      try {
        setSearchResults(await searchItems(searchQuery.trim()))
      } catch {
        setSearchResults([])
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQuery])

  // ── Maintenance handlers ────────────────────────────────────────────────────

  function closeTaskPanel() {
    setTaskPanelMode(null)
    setSelectedTask(null)
    setShowLogDialog(false)
    setShowTaskDeleteConfirm(false)
  }

  async function handleCreateTask(payload: Partial<MaintenanceTask>) {
    if (!householdId) return
    await createTask(payload, householdId)
    closeTaskPanel()
    await loadTasks()
  }

  async function handleEditTask(payload: Partial<MaintenanceTask>) {
    if (!selectedTask) return
    const updated = await updateTask(selectedTask.id, payload)
    setSelectedTask(updated)
    setTaskPanelMode('detail')
    await loadTasks()
  }

  async function handleLogCompletion(entry: MaintenanceLogEntry) {
    if (!selectedTask || !householdId) return
    await logCompletion(selectedTask.id, entry, householdId)
    setShowLogDialog(false)
    const refreshed = await getTasks()
    setTasks(refreshed)
    const updatedTask = refreshed.find((t) => t.id === selectedTask.id)
    if (updatedTask) setSelectedTask(updatedTask)
  }

  async function handleDeleteTask() {
    if (!selectedTask) return
    await deleteTask(selectedTask.id)
    closeTaskPanel()
    await loadTasks()
  }

  // ── Item handlers ───────────────────────────────────────────────────────────

  function closeItemPanel() {
    setItemPanelMode(null)
    setSelectedItem(null)
    setShowItemDeleteConfirm(false)
  }

  async function handleCreateItem(payload: Partial<HouseholdItem>) {
    if (!householdId) return
    await createItem(payload, householdId)
    closeItemPanel()
    await loadItems()
  }

  async function handleEditItem(payload: Partial<HouseholdItem>) {
    if (!selectedItem) return
    const updated = await updateItem(selectedItem.id, payload)
    setSelectedItem(updated)
    setItemPanelMode('detail')
    await loadItems()
  }

  async function handleDeleteItem() {
    if (!selectedItem) return
    await deleteItem(selectedItem.id)
    closeItemPanel()
    await loadItems()
  }

  // ── Vendor handlers ─────────────────────────────────────────────────────────

  function closeVendorPanel() {
    setVendorPanelMode(null)
    setSelectedVendor(null)
    setShowVendorDeleteConfirm(false)
  }

  async function handleCreateVendor(payload: Partial<Vendor>) {
    if (!householdId) return
    await createVendor(payload, householdId)
    closeVendorPanel()
    await loadVendors()
  }

  async function handleEditVendor(payload: Partial<Vendor>) {
    if (!selectedVendor) return
    const updated = await updateVendor(selectedVendor.id, payload)
    setSelectedVendor(updated)
    setVendorPanelMode('detail')
    await loadVendors()
  }

  async function handleDeleteVendor() {
    if (!selectedVendor) return
    await deleteVendor(selectedVendor.id)
    closeVendorPanel()
    await loadVendors()
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const taskGroups = groupTasksByUrgency(tasks)
  const displayedItems = searchResults ?? items
  const itemGroups = groupItemsByCategory(displayedItems)
  const filteredVendors = activeServiceType
    ? vendors.filter((v) => v.service_type === activeServiceType)
    : vendors

  const isTaskPanelOpen = taskPanelMode !== null
  const isItemPanelOpen = itemPanelMode !== null
  const isVendorPanelOpen = vendorPanelMode !== null

  const taskPanelTitle =
    taskPanelMode === 'create' ? 'New task' :
    taskPanelMode === 'edit' ? 'Edit task' :
    (selectedTask?.name.slice(0, 40) ?? 'Task')

  const itemPanelTitle =
    itemPanelMode === 'create' ? 'New item' :
    itemPanelMode === 'edit' ? 'Edit item' :
    (selectedItem?.name.slice(0, 40) ?? 'Item')

  const vendorPanelTitle =
    vendorPanelMode === 'create' ? 'New vendor' :
    vendorPanelMode === 'edit' ? 'Edit vendor' :
    (selectedVendor?.name.slice(0, 40) ?? 'Vendor')

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AuthGuard>
      <div
        className="relative -mx-4 -my-4 flex flex-col overflow-hidden"
        style={{ minHeight: 'calc(100dvh - 3.5rem)' }}
      >
        {/* Scrollable content */}
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-24 pt-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Household</h1>

          {/* Top-level tab switcher */}
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.value
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Maintenance tab ─────────────────────────────────────────────── */}
          {activeTab === 'maintenance' && (
            <>
              {tasksError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {tasksError}
                </p>
              )}
              {tasksLoading ? (
                <LoadingSpinner />
              ) : taskGroups.length === 0 ? (
                <EmptyState message="No maintenance tasks. Tap + to add one." />
              ) : (
                taskGroups.map((group) => (
                  <div key={group.label}>
                    <SectionHeader label={group.label} />
                    {group.tasks.map((task) => (
                      <MaintenanceCard
                        key={task.id}
                        task={task}
                        urgencyLabel={group.urgencyLabel(task)}
                        urgencyVariant={group.urgencyVariant}
                        onTap={(t) => {
                          setSelectedTask(t)
                          setTaskPanelMode('detail')
                        }}
                      />
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {/* ── Items tab ───────────────────────────────────────────────────── */}
          {activeTab === 'items' && (
            <>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, category, or location…"
                className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />

              {itemsError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {itemsError}
                </p>
              )}
              {itemsLoading ? (
                <LoadingSpinner />
              ) : itemGroups.length === 0 ? (
                <EmptyState
                  message={
                    searchQuery
                      ? `No items match "${searchQuery}"`
                      : 'No household items recorded. Tap + to add one.'
                  }
                  actionLabel={searchQuery ? 'Clear search' : undefined}
                  onAction={searchQuery ? () => setSearchQuery('') : undefined}
                />
              ) : (
                itemGroups.map((group) => (
                  <div key={group.category}>
                    <SectionHeader
                      label={group.category.charAt(0).toUpperCase() + group.category.slice(1)}
                    />
                    {group.items.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onTap={(i) => {
                          setSelectedItem(i)
                          setItemPanelMode('detail')
                        }}
                      />
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {/* ── Vendors tab ─────────────────────────────────────────────────── */}
          {activeTab === 'vendors' && (
            <>
              {serviceTypes.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setActiveServiceType(null)}
                    className={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
                      activeServiceType === null
                        ? 'bg-blue-600 text-white dark:bg-blue-500'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    All
                  </button>
                  {serviceTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => setActiveServiceType(activeServiceType === type ? null : type)}
                      className={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-medium capitalize ${
                        activeServiceType === type
                          ? 'bg-blue-600 text-white dark:bg-blue-500'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}

              {vendorsError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {vendorsError}
                </p>
              )}
              {vendorsLoading ? (
                <LoadingSpinner />
              ) : filteredVendors.length === 0 ? (
                <EmptyState
                  message={
                    activeServiceType
                      ? `No ${activeServiceType} vendors saved.`
                      : 'No service providers saved. Tap + to add one.'
                  }
                  actionLabel={activeServiceType ? 'Clear filter' : undefined}
                  onAction={activeServiceType ? () => setActiveServiceType(null) : undefined}
                />
              ) : (
                filteredVendors.map((vendor) => (
                  <VendorCard
                    key={vendor.id}
                    vendor={vendor}
                    onTap={(v) => {
                      setSelectedVendor(v)
                      setVendorPanelMode('detail')
                    }}
                  />
                ))
              )}
            </>
          )}
        </div>

        {/* FAB */}
        <FAB
          onTap={() => {
            if (activeTab === 'maintenance') setTaskPanelMode('create')
            else if (activeTab === 'items') setItemPanelMode('create')
            else setVendorPanelMode('create')
          }}
          label={
            activeTab === 'maintenance'
              ? 'Create task'
              : activeTab === 'items'
                ? 'Create item'
                : 'Create vendor'
          }
        />

        {/* ── Maintenance panel ──────────────────────────────────────────────── */}
        <DetailPanel
          isOpen={isTaskPanelOpen}
          onClose={closeTaskPanel}
          title={taskPanelTitle}
          onEdit={taskPanelMode === 'detail' ? () => setTaskPanelMode('edit') : undefined}
          onDelete={
            taskPanelMode === 'detail' && isOwner ? () => setShowTaskDeleteConfirm(true) : undefined
          }
        >
          {taskPanelMode === 'detail' && selectedTask && (
            <MaintenanceDetail
              task={selectedTask}
              onLogCompletion={() => setShowLogDialog(true)}
            />
          )}
          {taskPanelMode === 'edit' && selectedTask && (
            <MaintenanceForm
              mode="edit"
              initialTask={selectedTask}
              onSave={handleEditTask}
              onCancel={() => setTaskPanelMode('detail')}
            />
          )}
          {taskPanelMode === 'create' && (
            <MaintenanceForm mode="create" onSave={handleCreateTask} onCancel={closeTaskPanel} />
          )}
        </DetailPanel>

        {/* ── Items panel ────────────────────────────────────────────────────── */}
        <DetailPanel
          isOpen={isItemPanelOpen}
          onClose={closeItemPanel}
          title={itemPanelTitle}
          onEdit={itemPanelMode === 'detail' ? () => setItemPanelMode('edit') : undefined}
          onDelete={
            itemPanelMode === 'detail' && isOwner ? () => setShowItemDeleteConfirm(true) : undefined
          }
        >
          {itemPanelMode === 'detail' && selectedItem && (
            <ItemDetail item={selectedItem} />
          )}
          {itemPanelMode === 'edit' && selectedItem && (
            <ItemForm
              mode="edit"
              initialItem={selectedItem}
              onSave={handleEditItem}
              onCancel={() => setItemPanelMode('detail')}
            />
          )}
          {itemPanelMode === 'create' && (
            <ItemForm mode="create" onSave={handleCreateItem} onCancel={closeItemPanel} />
          )}
        </DetailPanel>

        {/* ── Vendors panel ──────────────────────────────────────────────────── */}
        <DetailPanel
          isOpen={isVendorPanelOpen}
          onClose={closeVendorPanel}
          title={vendorPanelTitle}
          onEdit={vendorPanelMode === 'detail' ? () => setVendorPanelMode('edit') : undefined}
          onDelete={
            vendorPanelMode === 'detail' && isOwner
              ? () => setShowVendorDeleteConfirm(true)
              : undefined
          }
        >
          {vendorPanelMode === 'detail' && selectedVendor && (
            <VendorDetail vendor={selectedVendor} />
          )}
          {vendorPanelMode === 'edit' && selectedVendor && (
            <VendorForm
              mode="edit"
              initialVendor={selectedVendor}
              onSave={handleEditVendor}
              onCancel={() => setVendorPanelMode('detail')}
            />
          )}
          {vendorPanelMode === 'create' && (
            <VendorForm mode="create" onSave={handleCreateVendor} onCancel={closeVendorPanel} />
          )}
        </DetailPanel>

        {/* ── Log completion dialog ─────────────────────────────────────────── */}
        {selectedTask && (
          <LogMaintenanceDialog
            isOpen={showLogDialog}
            taskName={selectedTask.name}
            onLog={handleLogCompletion}
            onCancel={() => setShowLogDialog(false)}
          />
        )}

        {/* ── Delete confirms ───────────────────────────────────────────────── */}
        <ConfirmDialog
          isOpen={showTaskDeleteConfirm}
          title="Delete this task?"
          message="Delete this task and all its maintenance history? This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={handleDeleteTask}
          onCancel={() => setShowTaskDeleteConfirm(false)}
        />

        <ConfirmDialog
          isOpen={showItemDeleteConfirm}
          title="Delete this item?"
          message="This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={handleDeleteItem}
          onCancel={() => setShowItemDeleteConfirm(false)}
        />

        <ConfirmDialog
          isOpen={showVendorDeleteConfirm}
          title="Delete this vendor?"
          message="This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={handleDeleteVendor}
          onCancel={() => setShowVendorDeleteConfirm(false)}
        />
      </div>
    </AuthGuard>
  )
}
