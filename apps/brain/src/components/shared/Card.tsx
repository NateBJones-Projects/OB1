'use client'

import { Badge, type BadgeProps } from './Badge'

export type CardProps = {
  title: string
  subtitle?: string
  badges?: BadgeProps[]
  rightContent?: React.ReactNode
  onTap?: () => void
  className?: string
}

export function Card({
  title,
  subtitle,
  badges,
  rightContent,
  onTap,
  className = '',
}: CardProps) {
  const Wrapper = onTap ? 'button' : 'div'

  return (
    <Wrapper
      onClick={onTap}
      className={`flex w-full min-h-[48px] items-start rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors dark:border-gray-700 dark:bg-gray-900 ${
        onTap ? 'cursor-pointer hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-800 dark:active:bg-gray-700' : ''
      } ${className}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        )}
        {badges && badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {badges.map((badge, i) => (
              <Badge key={i} {...badge} />
            ))}
          </div>
        )}
      </div>
      {rightContent && (
        <div className="ml-3 flex-shrink-0">{rightContent}</div>
      )}
    </Wrapper>
  )
}
