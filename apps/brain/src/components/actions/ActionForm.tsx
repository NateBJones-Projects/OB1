'use client'

import { useState } from 'react'
import { EditForm, type FieldConfig } from '@/components/shared/EditForm'
import type { Action } from '@/lib/queries/actions'

type ActionFormProps = {
  mode: 'create' | 'edit'
  initialAction?: Action
  onSave: (payload: Partial<Action>) => Promise<void>
  onCancel: () => void
}

const BASE_FIELDS: FieldConfig[] = [
  {
    name: 'content',
    label: 'What needs to be done?',
    type: 'textarea',
    required: true,
    placeholder: 'What needs to be done?',
  },
  {
    name: 'due_date',
    label: 'Due date',
    type: 'date',
  },
  {
    name: 'recurrence',
    label: 'Recurrence',
    type: 'select',
    placeholder: 'None',
    options: [
      { label: 'Daily', value: 'daily' },
      { label: 'Weekly', value: 'weekly' },
      { label: 'Monthly', value: 'monthly' },
    ],
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'text',
    placeholder: 'home, work, urgent (comma-separated)',
  },
  {
    name: 'blocked_by',
    label: 'Blocked by',
    type: 'text',
    placeholder: "What's blocking this?",
  },
  {
    name: 'unblocks',
    label: 'Unblocks',
    type: 'text',
    placeholder: 'What does completing this unblock?',
  },
]

const EDIT_FIELDS: FieldConfig[] = [
  ...BASE_FIELDS,
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Open', value: 'open' },
      { label: 'In progress', value: 'in_progress' },
      { label: 'Done', value: 'done' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
  },
]

function buildPayload(values: Record<string, any>, mode: 'create' | 'edit'): Partial<Action> {
  const tags = values.tags
    ? values.tags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
    : []

  return {
    content: values.content?.trim(),
    due_date: values.due_date || null,
    recurrence: (values.recurrence as Action['recurrence']) || null,
    tags,
    blocked_by: values.blocked_by?.trim() || null,
    unblocks: values.unblocks?.trim() || null,
    ...(mode === 'edit' && values.status ? { status: values.status as Action['status'] } : {}),
  }
}

export function ActionForm({ mode, initialAction, onSave, onCancel }: ActionFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null)

  const fields = mode === 'edit' ? EDIT_FIELDS : BASE_FIELDS

  const initialValues: Record<string, any> = {
    content: initialAction?.content ?? '',
    due_date: initialAction?.due_date ?? '',
    recurrence: initialAction?.recurrence ?? '',
    tags: initialAction?.tags?.join(', ') ?? '',
    blocked_by: initialAction?.blocked_by ?? '',
    unblocks: initialAction?.unblocks ?? '',
    ...(mode === 'edit' ? { status: initialAction?.status ?? 'open' } : {}),
  }

  async function handleSave(values: Record<string, any>) {
    setValidationError(null)
    if (values.recurrence && !values.due_date) {
      setValidationError('Due date is required when recurrence is set.')
      throw new Error('validation')
    }
    await onSave(buildPayload(values, mode))
  }

  return (
    <div>
      {validationError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {validationError}
        </p>
      )}
      <EditForm
        fields={fields}
        initialValues={initialValues}
        onSave={handleSave}
        onCancel={onCancel}
        saveLabel={mode === 'create' ? 'Create action' : 'Save changes'}
      />
    </div>
  )
}
