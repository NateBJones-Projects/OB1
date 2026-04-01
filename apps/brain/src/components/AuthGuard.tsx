'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

const OWNER_ONLY_ROUTES = ['/agent-feed', '/thoughts']

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isOwner, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return

    if (!user) {
      router.replace('/login')
      return
    }

    if (!isOwner && OWNER_ONLY_ROUTES.some((r) => pathname.startsWith(r))) {
      router.replace('/')
    }
  }, [user, isOwner, loading, pathname, router])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  if (!user) return null
  if (!isOwner && OWNER_ONLY_ROUTES.some((r) => pathname.startsWith(r))) return null

  return <>{children}</>
}
