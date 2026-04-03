'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/shared/Card'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SectionHeader } from '@/components/shared/SectionHeader'
import {
  getRecentAgentActivity,
  type AgentActivityItem,
} from '@/lib/queries/agent-events'

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return diffDays === 1 ? 'Yesterday' : `${diffDays}d ago`
}

function getStatusVariant(status: AgentActivityItem['status']) {
  if (status === 'new') return 'purple'
  if (status === 'complete') return 'green'
  if (status === 'needs_review') return 'amber'
  return 'gray'
}

export function AgentSection() {
  const router = useRouter()
  const [items, setItems] = useState<AgentActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadAgentActivity() {
      try {
        const data = await getRecentAgentActivity(5)
        if (!cancelled) setItems(data)
      } catch (error) {
        console.error('[AgentSection] failed to load agent activity', error)
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAgentActivity()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <SectionHeader label="Agent activity" />

      {loading ? (
        <LoadingSpinner size="sm" />
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Agent pipeline coming soon.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Card
              key={item.id}
              title={item.title}
              subtitle={`${item.summary} · ${formatRelativeTime(item.created_at)}`}
              badges={[{ label: item.status.replace('_', ' '), variant: getStatusVariant(item.status) }]}
              onTap={() => router.push('/agent-feed')}
            />
          ))}
        </div>
      )}
    </section>
  )
}
