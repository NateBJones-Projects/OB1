'use client'

import { AuthGuard } from '@/components/AuthGuard'

export default function HouseholdPage() {
  return (
    <AuthGuard>
      <div className="pt-8">
        <h1 className="text-2xl font-bold">Household</h1>
        <p className="mt-2 text-gray-500">Coming soon</p>
      </div>
    </AuthGuard>
  )
}
