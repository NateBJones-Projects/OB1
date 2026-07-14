export type RepoLearningConfig = {
  slug: string
  title: string
  description: string
  audience: string
  researchDirectory: string[]
  lessonDirectory: string[]
  track: {
    slug: string
    title: string
    description: string
  }
  brainIntegration: {
    sourceTag: string
    relatedThoughtLimit: number
  }
}

export const REPO_LEARNING_CONFIG: RepoLearningConfig = {
  slug: 'open-brain-architecture',
  title: 'Open Brain: Architecture & Mental Model',
  description:
    'A guided path through the Open Brain codebase: the thoughts data model, the canonical write and retrieval paths, the entity/edge knowledge graph, provenance, and the remote MCP + cron runtime.',
  audience:
    'Engineers and contributors who want an accurate mental model of how Open Brain stores, links, and resurfaces memory before extending or operating it.',
  researchDirectory: ['research'],
  lessonDirectory: ['curriculum', 'lessons'],
  track: {
    slug: 'open-brain-architecture',
    title: 'Open Brain Architecture',
    description:
      'How a persistent AI memory system is built on Supabase + pgvector: one durable thoughts table, a fingerprinted write path, a typed knowledge graph, provenance links, and a remote MCP + scheduled-synthesis runtime.',
  },
  brainIntegration: {
    sourceTag: 'open-brain-architecture',
    relatedThoughtLimit: 5,
  },
}
