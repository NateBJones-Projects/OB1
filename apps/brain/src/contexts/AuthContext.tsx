'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { User, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

type AuthState = {
  user: User | null
  role: 'owner' | 'member' | null
  householdId: string | null
  isOwner: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  householdId: null,
  isOwner: false,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function getSupabase(ref: React.MutableRefObject<SupabaseClient | null>) {
  if (!ref.current) {
    ref.current = createClient()
  }
  return ref.current
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<'owner' | 'member' | null>(null)
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef<SupabaseClient | null>(null)

  useEffect(() => {
    const supabase = getSupabase(supabaseRef)

    async function fetchHouseholdInfo(userId: string) {
      const { data } = await supabase
        .from('household_members')
        .select('household_id, role')
        .eq('user_id', userId)
        .single()

      if (data) {
        setRole(data.role as 'owner' | 'member')
        setHouseholdId(data.household_id)
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        fetchHouseholdInfo(currentUser.id).then(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        fetchHouseholdInfo(currentUser.id).then(() => setLoading(false))
      } else {
        setRole(null)
        setHouseholdId(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    const supabase = getSupabase(supabaseRef)
    await supabase.auth.signOut()
    setUser(null)
    setRole(null)
    setHouseholdId(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        householdId,
        isOwner: role === 'owner',
        loading,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
