'use client'

import { AuthGuard } from '@/components/AuthGuard'

export default function AgentFeedPage() {
  return (
    <AuthGuard>
      <div className="pt-8">
        <h1 className="text-2xl font-bold">Agent feed</h1>
        <p className="mt-2 text-gray-500">Coming soon</p>
      </div>
    </AuthGuard>
  )
}
