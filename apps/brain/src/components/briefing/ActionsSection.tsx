'use client'

import { useRouter } from 'next/navigation'
import { ActionCard } from '@/components/actions/ActionCard'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SectionHeader } from '@/components/shared/SectionHeader'
import type { Action } from '@/lib/queries/actions'

type ActionsSectionProps = {
  loading: boolean
  error: string | null
  actions: Action[]
  totalCount: number
}

export function ActionsSection({
  loading,
  error,
  actions,
  totalCount,
}: ActionsSectionProps) {
  const router = useRouter()
  const visibleActions = actions.slice(0, 5)

  return (
    <section>
      <SectionHeader label="Today's actions" />

      {loading ? (
        <LoadingSpinner size="sm" />
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : visibleActions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing due today. Nice!</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleActions.map((action) => (
            <ActionCard key={action.id} action={action} onTap={() => router.push('/actions')} />
          ))}

          {totalCount > visibleActions.length && (
            <button
              onClick={() => router.push('/actions')}
              className="self-start text-sm font-medium text-blue-600 dark:text-blue-400"
            >
              View all {totalCount} actions -&gt;
            </button>
          )}
        </div>
      )}
    </section>
  )
}
