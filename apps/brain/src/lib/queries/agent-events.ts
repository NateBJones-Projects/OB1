export type AgentActivityItem = {
  id: string
  title: string
  summary: string
  status: 'new' | 'complete' | 'needs_review' | 'info'
  created_at: string
}

export async function getRecentAgentActivity(_limit: number = 5): Promise<AgentActivityItem[]> {
  return []
}
