'use client'

import { useEffect, useState } from 'react'
import { AuthGuard } from '@/components/AuthGuard'
import { Greeting } from '@/components/briefing/Greeting'
import { BriefingStats } from '@/components/briefing/BriefingStats'
import { ActionsSection } from '@/components/briefing/ActionsSection'
import { AgentSection } from '@/components/briefing/AgentSection'
import { MealsSection } from '@/components/briefing/MealsSection'
import { StaleSection } from '@/components/briefing/StaleSection'
import { MaintenanceSection } from '@/components/briefing/MaintenanceSection'
import { useAuth } from '@/contexts/AuthContext'
import { getActions, type Action } from '@/lib/queries/actions'

function getLocalToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getFirstName(user: { user_metadata?: { full_name?: string }; email?: string } | null): string {
  if (!user) return ''
  const fullName = user.user_metadata?.full_name?.trim()
  if (fullName) return fullName.split(/\s+/)[0]
  return user.email?.split('@')[0] ?? ''
}

function isDueToday(action: Action, today: string): boolean {
  return action.due_date === today
}

function isOverdue(action: Action, today: string): boolean {
  return Boolean(action.due_date && action.due_date < today)
}

function getTimeValue(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  return new Date(value).getTime()
}

function sortByAttention(actions: Action[], today: string): Action[] {
  return [...actions].sort((a, b) => {
    const aBucket = isOverdue(a, today) ? 0 : isDueToday(a, today) ? 1 : 2
    const bBucket = isOverdue(b, today) ? 0 : isDueToday(b, today) ? 1 : 2
    if (aBucket !== bBucket) return aBucket - bBucket

    if (aBucket === 0 || aBucket === 1) {
      return getTimeValue(a.due_date) - getTimeValue(b.due_date)
    }

    return getTimeValue(a.updated_at) - getTimeValue(b.updated_at)
  })
}

function sortStaleActions(actions: Action[]): Action[] {
  return [...actions].sort((a, b) => getTimeValue(a.updated_at) - getTimeValue(b.updated_at))
}

function HomeContent() {
  const { user, isOwner } = useAuth()
  const [activeActions, setActiveActions] = useState<Action[]>([])
  const [actionsLoading, setActionsLoading] = useState(true)
  const [actionsError, setActionsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadActions() {
      setActionsLoading(true)
      setActionsError(null)

      try {
        const data = await getActions('active')
        if (!cancelled) {
          setActiveActions(data)
        }
      } catch (error) {
        console.error('[HomePage] failed to load active actions', error)
        if (!cancelled) {
          setActionsError('Failed to load actions.')
          setActiveActions([])
        }
      } finally {
        if (!cancelled) {
          setActionsLoading(false)
        }
      }
    }

    loadActions()

    return () => {
      cancelled = true
    }
  }, [])

  const today = getLocalToday()
  const firstName = getFirstName(user)

  const overdueCount = activeActions.filter((action) => isOverdue(action, today)).length
  const dueTodayCount = activeActions.filter((action) => isDueToday(action, today)).length
  const openCount = activeActions.length

  const todayActions = sortByAttention(
    activeActions.filter(
      (action) => isOverdue(action, today) || isDueToday(action, today) || (action.status === 'in_progress' && !action.due_date),
    ),
    today,
  )

  const staleActions = sortStaleActions(
    activeActions.filter((action) => {
      const createdAgeMs = Date.now() - new Date(action.created_at).getTime()
      const updatedAgeMs = Date.now() - new Date(action.updated_at).getTime()
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

      return (!action.due_date && createdAgeMs > fourteenDaysMs) || (action.status === 'in_progress' && updatedAgeMs > sevenDaysMs)
    }),
  )

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-6">
      <Greeting firstName={firstName} />

      <BriefingStats
        loading={actionsLoading}
        overdueCount={overdueCount}
        dueTodayCount={dueTodayCount}
        openCount={openCount}
      />

      <ActionsSection
        loading={actionsLoading}
        error={actionsError}
        actions={todayActions}
        totalCount={todayActions.length}
      />

      {isOwner && <AgentSection />}

      <MealsSection />

      <StaleSection loading={actionsLoading} actions={staleActions} />

      <MaintenanceSection />
    </div>
  )
}

export default function HomePage() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  )
}
