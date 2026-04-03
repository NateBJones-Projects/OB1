'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/shared/Card'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SectionHeader } from '@/components/shared/SectionHeader'
import type { Action } from '@/lib/queries/actions'

type StaleSectionProps = {
  loading: boolean
  actions: Action[]
}

function formatStaleLabel(action: Action): string {
  const now = Date.now()

  if (action.status === 'in_progress') {
    const updatedDays = Math.floor((now - new Date(action.updated_at).getTime()) / (1000 * 60 * 60 * 24))
    return `No update for ${updatedDays} day${updatedDays === 1 ? '' : 's'}`
  }

  const createdDays = Math.floor((now - new Date(action.created_at).getTime()) / (1000 * 60 * 60 * 24))
  return `Created ${createdDays} day${createdDays === 1 ? '' : 's'} ago`
}

export function StaleSection({ loading, actions }: StaleSectionProps) {
  const router = useRouter()

  if (loading) {
    return (
      <section>
        <SectionHeader label="Needs attention" />
        <LoadingSpinner size="sm" />
      </section>
    )
  }

  if (actions.length === 0) return null

  return (
    <section>
      <SectionHeader label="Needs attention" />
      <div className="flex flex-col gap-2">
        {actions.slice(0, 3).map((action) => (
          <Card
            key={action.id}
            title={action.content}
            subtitle={formatStaleLabel(action)}
            badges={[{ label: 'Stale', variant: 'gray' }]}
            onTap={() => router.push('/actions')}
          />
        ))}
      </div>
    </section>
  )
}
