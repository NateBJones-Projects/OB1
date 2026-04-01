'use client'

import { Card, type CardProps } from './Card'
import { EmptyState } from './EmptyState'
import { LoadingSpinner } from './LoadingSpinner'

export type CardListProps = {
  items: CardProps[]
  emptyMessage?: string
  loading?: boolean
}

export function CardList({
  items,
  emptyMessage = 'Nothing here yet',
  loading,
}: CardListProps) {
  if (loading) return <LoadingSpinner />

  if (items.length === 0) return <EmptyState message={emptyMessage} />

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <Card key={i} {...item} />
      ))}
    </div>
  )
}
