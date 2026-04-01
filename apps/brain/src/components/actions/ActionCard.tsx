'use client'

import { Card } from '@/components/shared/Card'
import type { BadgeProps } from '@/components/shared/Badge'
import type { Action } from '@/lib/queries/actions'

type ActionCardProps = {
  action: Action
  onTap: (action: Action) => void
}

function getLocalToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysOverdue(dueDate: string): number {
  const today = new Date(getLocalToday() + 'T00:00:00')
  const due = new Date(dueDate + 'T00:00:00')
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dueDate: string): string {
  const d = new Date(dueDate + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildBadges(action: Action, today: string): BadgeProps[] {
  const badges: BadgeProps[] = []

  if (action.due_date && action.due_date < today) {
    badges.push({ label: `Overdue ${daysOverdue(action.due_date)}d`, variant: 'red' })
  } else if (action.due_date === today) {
    badges.push({ label: 'Today', variant: 'amber' })
  }

  if (action.status === 'in_progress') {
    badges.push({ label: 'In progress', variant: 'blue' })
  }

  if (action.recurrence) {
    badges.push({ label: `↻ ${action.recurrence}`, variant: 'gray' })
  }

  if (action.blocked_by) {
    badges.push({ label: 'Blocked', variant: 'gray' })
  }

  for (const tag of action.tags ?? []) {
    badges.push({ label: tag, variant: 'gray' })
  }

  return badges
}

function buildSubtitle(action: Action): string | undefined {
  const parts: string[] = []
  if (action.due_date) parts.push(formatDate(action.due_date))
  if (action.tags && action.tags.length > 0) parts.push(action.tags[0])
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function ActionCard({ action, onTap }: ActionCardProps) {
  const today = getLocalToday()
  return (
    <Card
      title={action.content}
      subtitle={buildSubtitle(action)}
      badges={buildBadges(action, today)}
      onTap={() => onTap(action)}
    />
  )
}
