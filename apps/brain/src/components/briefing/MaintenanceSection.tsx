'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { MaintenanceCard } from '@/components/household/MaintenanceCard'
import { getTasks, type MaintenanceTask } from '@/lib/queries/maintenance'

function getLocalToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getUrgency(task: MaintenanceTask): { label: string; variant: 'red' | 'amber' | 'green' } {
  const today = getLocalToday()

  if (!task.next_due) {
    return { label: 'No date', variant: 'green' }
  }

  if (task.next_due < today) {
    const diff = Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(task.next_due + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
    return { label: `${diff}d overdue`, variant: 'red' }
  }

  if (task.next_due === today) {
    return { label: 'Today', variant: 'amber' }
  }

  const diff = Math.floor((new Date(task.next_due + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
  return { label: `In ${diff}d`, variant: 'green' }
}

export function MaintenanceSection() {
  const router = useRouter()
  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadTasks() {
      try {
        const data = await getTasks()
        if (!cancelled) setTasks(data)
      } catch (error) {
        console.error('[MaintenanceSection] failed to load maintenance tasks', error)
        if (!cancelled) setTasks([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTasks()

    return () => {
      cancelled = true
    }
  }, [])

  const today = getLocalToday()
  const upcomingLimit = addDays(today, 14)
  const relevantTasks = tasks
    .filter((task) => task.next_due && task.next_due <= upcomingLimit)
    .sort((a, b) => (a.next_due ?? '').localeCompare(b.next_due ?? ''))
    .slice(0, 3)

  if (loading) {
    return (
      <section>
        <SectionHeader label="Upcoming maintenance" />
        <LoadingSpinner size="sm" />
      </section>
    )
  }

  if (relevantTasks.length === 0) return null

  return (
    <section>
      <SectionHeader label="Upcoming maintenance" />
      <div className="flex flex-col gap-2">
        {relevantTasks.map((task) => {
          const urgency = getUrgency(task)
          return (
            <MaintenanceCard
              key={task.id}
              task={task}
              urgencyLabel={urgency.label}
              urgencyVariant={urgency.variant}
              onTap={() => router.push('/household')}
            />
          )
        })}
      </div>
    </section>
  )
}
