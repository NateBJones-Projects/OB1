import type {
  BootstrapData,
  CaptureResult,
  LearningArtifactKind,
  LessonDetail,
  LessonStatus,
  QuizResult,
  ResearchDocumentDetail,
  UnderstandingState,
} from './types'

const requestJson = async <T>(input: RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(payload?.error ?? 'Request failed.')
  }

  return (await response.json()) as T
}

export const fetchBootstrap = () => requestJson<BootstrapData>('/api/bootstrap')

export const fetchLessonDetail = (slug: string) =>
  requestJson<LessonDetail>(`/api/lessons/${slug}`)

export const fetchResearchDocument = (slug: string) =>
  requestJson<ResearchDocumentDetail>(`/api/research/${slug}`)

export const saveLessonProgress = (
  slug: string,
  status: LessonStatus,
  confidence: number,
) =>
  requestJson<LessonDetail>(`/api/lessons/${slug}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status, confidence }),
  })

export const addLessonComment = (
  slug: string,
  body: string,
  understandingState: UnderstandingState,
) =>
  requestJson<LessonDetail>(`/api/lessons/${slug}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, understandingState }),
  })

export const captureLessonArtifact = (
  slug: string,
  kind: LearningArtifactKind,
  content: string,
) =>
  requestJson<CaptureResult>(`/api/lessons/${slug}/capture`, {
    method: 'POST',
    body: JSON.stringify({ kind, content }),
  })

export const submitQuiz = (
  quizId: string,
  answers: Array<{ questionId: string; selectedOption: string }>,
) =>
  requestJson<QuizResult>(`/api/quizzes/${quizId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
