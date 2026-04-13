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
  slug: 'repo-learning-coach-sample',
  title: 'Repo Learning Coach',
  description:
    'A Supabase-backed learning workspace that turns repo research into lessons, quizzes, progress tracking, and durable Open Brain captures.',
  audience:
    'Solo builders, maintainers, and collaborators who need a fast way to understand a codebase without losing the reasoning behind it.',
  researchDirectory: ['research'],
  lessonDirectory: ['curriculum', 'lessons'],
  track: {
    slug: 'repo-learning-foundations',
    title: 'Repo Learning Foundations',
    description:
      'A sample path that shows how to separate reusable learning infrastructure from repo-specific research and onboarding content.',
  },
  brainIntegration: {
    sourceTag: 'repo-learning-coach',
    relatedThoughtLimit: 5,
  },
}
