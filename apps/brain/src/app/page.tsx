'use client'

import { useAuth } from '@/contexts/AuthContext'
import { AuthGuard } from '@/components/AuthGuard'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function getFirstName(user: { user_metadata?: { full_name?: string }; email?: string } | null): string {
  if (!user) return ''
  const fullName = user.user_metadata?.full_name
  if (fullName) return fullName.split(' ')[0]
  return user.email?.split('@')[0] ?? ''
}

function HomeContent() {
  const { user } = useAuth()
  const firstName = getFirstName(user)

  return (
    <div className="pt-8">
      <h1 className="text-3xl font-bold">
        {getGreeting()}, {firstName}
      </h1>
      <p className="mt-2 text-lg text-gray-500">Here&apos;s your day.</p>
      <p className="mt-1 text-sm text-gray-400">{formatDate()}</p>
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
