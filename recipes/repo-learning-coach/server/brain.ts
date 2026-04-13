import { REPO_LEARNING_CONFIG } from '../repo-learning.config.js'

import { APP_ENV, supabase } from './supabase.js'

export type BrainBridgeState = {
  enabled: boolean
  reason: string | null
}

export type LearningArtifactKind = 'takeaway' | 'confusion' | 'summary'

export type RelatedThoughtSummary = {
  id: string
  content: string
  createdAt: string
  similarity: number
  metadata: Record<string, unknown>
}

type LessonThoughtContext = {
  slug: string
  title: string
  summary: string
  goals: string[]
}

type CaptureArtifactInput = {
  kind: LearningArtifactKind
  content: string
  lesson: LessonThoughtContext & {
    status: string
    confidence: number
  }
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const getBrainBridgeState = (): BrainBridgeState =>
  APP_ENV.openrouterApiKey
    ? { enabled: true, reason: null }
    : {
        enabled: false,
        reason:
          'Set OPENROUTER_API_KEY to enable related-thought retrieval and capture into thoughts.',
      }

const ensureBrainBridge = () => {
  const state = getBrainBridgeState()

  if (!state.enabled) {
    throw new Error(state.reason ?? 'Open Brain bridge is disabled.')
  }
}

const getEmbedding = async (text: string): Promise<number[]> => {
  ensureBrainBridge()

  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${APP_ENV.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: APP_ENV.openrouterEmbeddingModel,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `OpenRouter embeddings failed: ${response.status} ${errorText}`.trim(),
    )
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>
  }

  const embedding = payload.data?.[0]?.embedding

  if (!embedding) {
    throw new Error('OpenRouter did not return an embedding vector.')
  }

  return embedding
}

const buildSearchQuery = (
  lesson: LessonThoughtContext,
  relatedResearchTitles: string[],
) =>
  [
    lesson.title,
    lesson.summary,
    `Goals: ${lesson.goals.join('; ')}`,
    relatedResearchTitles.length
      ? `Related research: ${relatedResearchTitles.join('; ')}`
      : '',
    'Search for prior thoughts that would help someone understand, apply, or remember this lesson.',
  ]
    .filter(Boolean)
    .join('\n')

const buildArtifactContent = ({ kind, content, lesson }: CaptureArtifactInput) => {
  const trimmed = content.trim()

  if (kind === 'summary' && trimmed.length === 0) {
    return [
      `Learning summary for ${lesson.title}.`,
      lesson.summary,
      `Status: ${lesson.status}. Confidence: ${lesson.confidence}/5.`,
      lesson.goals.length ? `Goals covered: ${lesson.goals.join('; ')}` : '',
      `Source: ${REPO_LEARNING_CONFIG.title}.`,
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (trimmed.length === 0) {
    throw new Error('Artifact content is required for takeaways and confusion notes.')
  }

  if (kind === 'takeaway') {
    return `Learning takeaway from ${lesson.title}: ${trimmed}`
  }

  if (kind === 'confusion') {
    return `Follow-up question from ${lesson.title}: ${trimmed}`
  }

  return `Learning summary from ${lesson.title}: ${trimmed}`
}

export const findRelatedThoughtsForLesson = async (
  lesson: LessonThoughtContext,
  relatedResearchTitles: string[],
): Promise<RelatedThoughtSummary[]> => {
  const state = getBrainBridgeState()

  if (!state.enabled) {
    return []
  }

  const queryEmbedding = await getEmbedding(
    buildSearchQuery(lesson, relatedResearchTitles),
  )

  const { data, error } = await supabase.rpc('match_thoughts', {
    query_embedding: queryEmbedding,
    match_threshold: 0.35,
    match_count: REPO_LEARNING_CONFIG.brainIntegration.relatedThoughtLimit,
    filter: {},
  })

  if (error) {
    throw new Error(`match_thoughts failed: ${error.message}`)
  }

  return (data ?? []).map(
    (row: {
      id: string
      content: string
      created_at: string
      similarity: number
      metadata: Record<string, unknown> | null
    }) => ({
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      similarity: row.similarity,
      metadata: row.metadata ?? {},
    }),
  )
}

export const captureLearningArtifact = async ({
  kind,
  content,
  lesson,
}: CaptureArtifactInput) => {
  const artifactContent = buildArtifactContent({ kind, content, lesson })
  const embedding = await getEmbedding(artifactContent)
  const metadata = {
    source: REPO_LEARNING_CONFIG.brainIntegration.sourceTag,
    type: 'lesson',
    project_slug: REPO_LEARNING_CONFIG.slug,
    project_title: REPO_LEARNING_CONFIG.title,
    lesson_slug: lesson.slug,
    lesson_title: lesson.title,
    artifact_kind: kind,
    topics: [
      REPO_LEARNING_CONFIG.slug,
      lesson.slug,
      kind === 'confusion' ? 'learning-followup' : 'learning-takeaway',
    ],
  }

  const { data, error } = await supabase.rpc('upsert_thought', {
    p_content: artifactContent,
    p_payload: { metadata },
  })

  if (error) {
    throw new Error(`upsert_thought failed: ${error.message}`)
  }

  const thoughtId = (data as { id?: string } | null)?.id

  if (!thoughtId) {
    throw new Error('upsert_thought did not return an id.')
  }

  const { error: embeddingError } = await supabase
    .from('thoughts')
    .update({ embedding })
    .eq('id', thoughtId)

  if (embeddingError) {
    throw new Error(`Failed to store embedding: ${embeddingError.message}`)
  }

  return {
    thoughtId,
    message: `Saved ${kind} to Open Brain.`,
  }
}
