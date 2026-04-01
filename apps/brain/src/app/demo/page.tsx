'use client'

import { useState } from 'react'
import { StatRow } from '@/components/shared/StatRow'
import { FilterTabs } from '@/components/shared/FilterTabs'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { CardList } from '@/components/shared/CardList'
import { Card } from '@/components/shared/Card'
import { DetailPanel } from '@/components/shared/DetailPanel'
import { EditForm, type FieldConfig } from '@/components/shared/EditForm'
import { FAB } from '@/components/shared/FAB'
import { Badge } from '@/components/shared/Badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

const sampleCards = [
  {
    title: 'Replace HVAC filter',
    subtitle: 'Last done 3 months ago',
    badges: [
      { label: 'Overdue', variant: 'red' as const },
      { label: 'Maintenance', variant: 'gray' as const },
    ],
  },
  {
    title: 'Review meal plan for next week',
    subtitle: 'Assigned to Jamie',
    badges: [{ label: 'Due today', variant: 'amber' as const }],
  },
  {
    title: 'Schedule dentist appointments',
    badges: [{ label: 'Upcoming', variant: 'blue' as const }],
  },
  {
    title: 'Reorganize pantry',
    subtitle: 'Completed last Tuesday',
    badges: [{ label: 'Done', variant: 'green' as const }],
    rightContent: (
      <span className="text-xs text-gray-400">Mar 25</span>
    ),
  },
]

const sampleFields: FieldConfig[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Enter title' },
  { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Add notes…' },
  { name: 'due_date', label: 'Due date', type: 'date' },
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    required: true,
    options: [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
  { name: 'estimate', label: 'Time estimate (min)', type: 'number', placeholder: '30' },
]

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState('active')
  const [detailOpen, setDetailOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="relative mx-auto max-w-lg pb-24">
      <h1 className="mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">
        Component Demo
      </h1>

      {/* StatRow */}
      <SectionHeader label="Stat Row" />
      <StatRow
        stats={[
          { value: 5, label: 'Overdue' },
          { value: 12, label: 'This week' },
          { value: 38, label: 'Total' },
        ]}
      />

      {/* FilterTabs */}
      <SectionHeader label="Filter Tabs" />
      <FilterTabs
        tabs={[
          { label: 'Active', value: 'active' },
          { label: 'Upcoming', value: 'upcoming' },
          { label: 'Done', value: 'done' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      <p className="mt-2 text-xs text-gray-400">
        Selected: {activeTab}
      </p>

      {/* CardList */}
      <SectionHeader label="Card List" />
      <CardList
        items={sampleCards.map((card) => ({
          ...card,
          onTap: () => setDetailOpen(true),
        }))}
      />

      {/* Badge gallery */}
      <SectionHeader label="Badge Variants" />
      <div className="flex flex-wrap gap-2">
        <Badge label="Overdue" variant="red" />
        <Badge label="Due today" variant="amber" />
        <Badge label="Complete" variant="green" />
        <Badge label="Upcoming" variant="blue" />
        <Badge label="Agent" variant="purple" />
        <Badge label="Default" variant="gray" />
      </div>

      {/* EmptyState */}
      <SectionHeader label="Empty State" />
      <EmptyState
        message="No actions due today"
        actionLabel="Create one"
        onAction={() => setEditOpen(true)}
      />

      {/* LoadingSpinner */}
      <SectionHeader label="Loading Spinner" />
      <div className="flex items-center gap-6">
        <LoadingSpinner size="sm" />
        <LoadingSpinner size="md" />
      </div>

      {/* EditForm */}
      <SectionHeader label="Edit Form" />
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <EditForm
          fields={sampleFields}
          onSave={async (vals) => {
            await new Promise((r) => setTimeout(r, 1000))
            alert('Saved: ' + JSON.stringify(vals, null, 2))
          }}
          onCancel={() => alert('Cancelled')}
        />
      </div>

      {/* Confirm dialog trigger */}
      <SectionHeader label="Confirm Dialog" />
      <button
        onClick={() => setConfirmOpen(true)}
        className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
      >
        Show confirm dialog
      </button>

      {/* FAB */}
      <FAB onTap={() => setEditOpen(true)} />

      {/* DetailPanel — view mode */}
      <DetailPanel
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="Replace HVAC filter"
        onEdit={() => {
          setDetailOpen(false)
          setEditOpen(true)
        }}
        onDelete={() => {
          setDetailOpen(false)
          setConfirmOpen(true)
        }}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            The HVAC filter should be replaced every 3 months. The current filter
            was installed on January 15.
          </p>
          <div className="flex gap-1">
            <Badge label="Overdue" variant="red" />
            <Badge label="Maintenance" variant="gray" />
          </div>
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last completed: January 15, 2026
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Frequency: Every 3 months
            </p>
          </div>
        </div>
      </DetailPanel>

      {/* DetailPanel — edit mode */}
      <DetailPanel
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="New Action"
      >
        <EditForm
          fields={sampleFields}
          onSave={async (vals) => {
            await new Promise((r) => setTimeout(r, 1000))
            setEditOpen(false)
          }}
          onCancel={() => setEditOpen(false)}
        />
      </DetailPanel>

      {/* ConfirmDialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Delete this action?"
        message="This can't be undone."
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 800))
          setConfirmOpen(false)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
