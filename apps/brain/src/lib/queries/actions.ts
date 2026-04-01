import { createClient } from '@/lib/supabase/client'

export type Action = {
  id: string
  thought_id: string | null
  content: string
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  due_date: string | null
  completed_at: string | null
  completion_note: string | null
  blocked_by: string | null
  unblocks: string | null
  tags: string[]
  created_at: string
  updated_at: string
  recurrence: 'daily' | 'weekly' | 'monthly' | null
  recurrence_source_id: string | null
  user_id: string | null
}

export async function getActions(tab: 'active' | 'done' | 'cancelled'): Promise<Action[]> {
  const supabase = createClient()
  const statuses = tab === 'active' ? ['open', 'in_progress'] : [tab]

  const { data, error } = await supabase
    .from('actions')
    .select('*')
    .in('status', statuses)
    .order('due_date', { ascending: true, nullsLast: true })

  if (error) throw error
  return (data ?? []) as Action[]
}

export async function createAction(payload: Partial<Action>): Promise<Action> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('actions')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Action
}

export async function updateAction(id: string, payload: Partial<Action>): Promise<Action> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('actions')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Action
}

export async function deleteAction(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('actions').delete().eq('id', id)
  if (error) throw error
}

function calculateNextDue(
  dueDate: string | null,
  recurrence: 'daily' | 'weekly' | 'monthly',
): string {
  const base = dueDate ? new Date(dueDate + 'T00:00:00') : new Date()
  if (recurrence === 'daily') base.setDate(base.getDate() + 1)
  else if (recurrence === 'weekly') base.setDate(base.getDate() + 7)
  else if (recurrence === 'monthly') base.setMonth(base.getMonth() + 1)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function completeAction(action: Action, note: string): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase
    .from('actions')
    .update({
      status: 'done',
      completion_note: note,
      completed_at: new Date().toISOString(),
    })
    .eq('id', action.id)

  if (error) throw error

  if (action.recurrence) {
    const nextDue = calculateNextDue(action.due_date, action.recurrence)
    const { error: spawnError } = await supabase.from('actions').insert({
      content: action.content,
      tags: action.tags,
      recurrence: action.recurrence,
      blocked_by: action.blocked_by,
      unblocks: action.unblocks,
      thought_id: action.thought_id,
      due_date: nextDue,
      recurrence_source_id: action.recurrence_source_id ?? action.id,
      status: 'open',
    })
    if (spawnError) throw spawnError
  }
}

export async function searchActions(query: string): Promise<Action[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('actions')
    .select('*')
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return (data ?? []) as Action[]
}
