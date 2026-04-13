import { REPO_LEARNING_CONFIG } from '../repo-learning.config.js'

import {
  captureLearningArtifact,
  findRelatedThoughtsForLesson,
  getBrainBridgeState,
  type LearningArtifactKind,
} from './brain.js'
import { loadLessons, loadResearchDocuments } from './content-loader.js'
import { supabase } from './supabase.js'

export type LessonStatus = 'not_started' | 'in_progress' | 'completed'
export type UnderstandingState =
  | 'clear'
  | 'unsure'
  | 'confused'
  | 'want_more_depth'
  | 'want_examples'

type LessonRow = {
  id: string
  slug: string
  title: string
  stage: string
  difficulty: string
  order_index: number
  estimated_minutes: number
  summary: string
  goals_json: unknown
  content: string
  related_research_json: unknown
}

type ProgressRow = {
  lesson_id: string
  status: LessonStatus
  confidence: number
  quiz_average: number
  quiz_best: number
  last_viewed_at: string | null
  completed_at: string | null
}

type QuizRow = {
  id: string
  lesson_id: string
  title: string
  passing_score: number
  question_count: number
}

type QuestionRow = {
  id: string
  order_index: number
  prompt: string
  options_json: unknown
  correct_option: string
  explanation: string
}

type ProjectRow = {
  id: string
  slug: string
  title: string
  description: string
  audience: string
}

type ResearchDocumentDetailRow = {
  slug: string
  title: string
  summary: string
  category: string
  content: string
  source_path: string
  source_url: string | null
}

type QueryResult<T> = PromiseLike<{
  data: T | null
  error: { message: string } | null
}>

type ErrorOnlyResult = PromiseLike<{
  error: { message: string } | null
}>

const now = () => new Date().toISOString()

const unwrapSingle = async <T>(
  promise: QueryResult<T>,
  fallbackMessage: string,
) => {
  const { data, error } = await promise

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error(fallbackMessage)
  }

  return data
}

const maybeSingle = async <T>(
  promise: QueryResult<T>,
) => {
  const { data, error } = await promise

  if (error) {
    throw new Error(error.message)
  }

  return data
}

const ensureNoError = async (promise: ErrorOnlyResult) => {
  const { error } = await promise

  if (error) {
    throw new Error(error.message)
  }
}

const parseStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} is not a string array.`)
  }

  return value
}

const getProject = async () =>
  unwrapSingle<ProjectRow>(
    supabase
      .from('repo_learning_projects')
      .select('id, slug, title, description, audience')
      .eq('slug', REPO_LEARNING_CONFIG.slug)
      .single(),
    `Project ${REPO_LEARNING_CONFIG.slug} was not found. Run npm run sync first.`,
  )

const getLessonRowBySlug = async (slug: string) =>
  unwrapSingle<LessonRow>(
    supabase
      .from('repo_learning_lessons')
      .select(
        'id, slug, title, stage, difficulty, order_index, estimated_minutes, summary, goals_json, content, related_research_json',
      )
      .eq('slug', slug)
      .single(),
    `Lesson ${slug} was not found.`,
  ) as Promise<LessonRow>

const getProgressByLessonId = async (lessonId: string) =>
  maybeSingle(
    supabase
      .from('repo_learning_lesson_progress')
      .select(
        'lesson_id, status, confidence, quiz_average, quiz_best, last_viewed_at, completed_at',
      )
      .eq('lesson_id', lessonId)
      .single(),
  ) as Promise<ProgressRow | null>

const getQuizByLessonId = async (lessonId: string) =>
  unwrapSingle<QuizRow>(
    supabase
      .from('repo_learning_quizzes')
      .select('id, lesson_id, title, passing_score, question_count')
      .eq('lesson_id', lessonId)
      .single(),
    `Quiz for lesson ${lessonId} was not found.`,
  ) as Promise<QuizRow>

const getQuestionRowsByQuizId = async (quizId: string, questionCount: number) => {
  const { data, error } = await supabase
    .from('repo_learning_quiz_questions')
    .select('id, order_index, prompt, options_json, correct_option, explanation')
    .eq('quiz_id', quizId)
    .lte('order_index', questionCount)
    .order('order_index')

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as QuestionRow[]
}

const getBrainBridgeForLesson = async (
  lesson: {
    slug: string
    title: string
    summary: string
    goals: string[]
  },
  relatedResearchTitles: string[],
) => {
  let brainBridge = getBrainBridgeState()
  let relatedThoughts: Awaited<ReturnType<typeof findRelatedThoughtsForLesson>> = []

  if (!brainBridge.enabled) {
    return { brainBridge, relatedThoughts }
  }

  try {
    relatedThoughts = await findRelatedThoughtsForLesson(lesson, relatedResearchTitles)
  } catch (error) {
    brainBridge = {
      enabled: false,
      reason: error instanceof Error ? error.message : 'Failed to search related thoughts.',
    }
  }

  return { brainBridge, relatedThoughts }
}

export const syncContentToSupabase = async () => {
  const timestamp = now()
  const researchDocuments = loadResearchDocuments()
  const lessons = loadLessons()

  const project = await unwrapSingle<{ id: string }>(
    supabase
      .from('repo_learning_projects')
      .upsert(
        {
          slug: REPO_LEARNING_CONFIG.slug,
          title: REPO_LEARNING_CONFIG.title,
          description: REPO_LEARNING_CONFIG.description,
          audience: REPO_LEARNING_CONFIG.audience,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single(),
    'Failed to create or update the learning project.',
  )

  const track = await unwrapSingle<{ id: string }>(
    supabase
      .from('repo_learning_tracks')
      .upsert(
        {
          project_id: project.id,
          slug: REPO_LEARNING_CONFIG.track.slug,
          title: REPO_LEARNING_CONFIG.track.title,
          description: REPO_LEARNING_CONFIG.track.description,
          order_index: 1,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single(),
    'Failed to create or update the learning track.',
  )

  for (const document of researchDocuments) {
    await unwrapSingle<{ id: string }>(
      supabase
        .from('repo_learning_research_documents')
        .upsert(
          {
            project_id: project.id,
            slug: document.slug,
            title: document.title,
            summary: document.summary,
            category: document.category,
            content: document.content,
            source_path: document.sourcePath,
            source_url: document.sourceUrl,
            content_hash: document.contentHash,
            updated_at: timestamp,
          },
          { onConflict: 'slug' },
        )
        .select('id')
        .single(),
      `Failed to sync research document ${document.slug}.`,
    )
  }

  for (const lesson of lessons) {
    const lessonRow = await unwrapSingle<{ id: string }>(
      supabase
        .from('repo_learning_lessons')
        .upsert(
          {
            project_id: project.id,
            track_id: track.id,
            slug: lesson.slug,
            title: lesson.title,
            stage: lesson.stage,
            difficulty: lesson.difficulty,
            order_index: lesson.orderIndex,
            estimated_minutes: lesson.estimatedMinutes,
            summary: lesson.summary,
            goals_json: lesson.goals,
            content: lesson.content,
            related_research_json: lesson.relatedResearchSlugs,
            updated_at: timestamp,
          },
          { onConflict: 'slug' },
        )
        .select('id')
        .single(),
      `Failed to sync lesson ${lesson.slug}.`,
    )

    const quizRow = await unwrapSingle<{ id: string }>(
      supabase
        .from('repo_learning_quizzes')
        .upsert(
          {
            lesson_id: lessonRow.id,
            title: lesson.quiz.title,
            passing_score: lesson.quiz.passingScore,
            question_count: lesson.quiz.questions.length,
            updated_at: timestamp,
          },
          { onConflict: 'lesson_id' },
        )
        .select('id')
        .single(),
      `Failed to sync quiz for lesson ${lesson.slug}.`,
    )

    for (const [index, question] of lesson.quiz.questions.entries()) {
      await unwrapSingle<{ id: string }>(
        supabase
          .from('repo_learning_quiz_questions')
          .upsert(
            {
              quiz_id: quizRow.id,
              order_index: index + 1,
              prompt: question.prompt,
              options_json: question.options,
              correct_option: question.correctOption,
              explanation: question.explanation,
              updated_at: timestamp,
            },
            { onConflict: 'quiz_id,order_index' },
          )
          .select('id')
          .single(),
        `Failed to sync question ${index + 1} for lesson ${lesson.slug}.`,
      )
    }

    await ensureNoError(
      supabase.from('repo_learning_lesson_progress').upsert(
        {
          lesson_id: lessonRow.id,
          status: 'not_started',
          confidence: 1,
          quiz_average: 0,
          quiz_best: 0,
          updated_at: timestamp,
        },
        {
          onConflict: 'lesson_id',
          ignoreDuplicates: true,
        },
      ),
    )
  }

  return {
    lessons: lessons.length,
    researchDocuments: researchDocuments.length,
  }
}

export const getBootstrapData = async () => {
  const project = await getProject()

  const [
    { data: lessonRows, error: lessonError },
    { data: progressRows, error: progressError },
    { data: commentRows, error: commentError },
    { data: researchRows, error: researchError },
    { data: attemptRows, error: attemptError },
  ] = await Promise.all([
    supabase
      .from('repo_learning_lessons')
      .select(
        'id, slug, title, stage, difficulty, order_index, estimated_minutes, summary',
      )
      .order('order_index'),
    supabase
      .from('repo_learning_lesson_progress')
      .select(
        'lesson_id, status, confidence, quiz_average, quiz_best, last_viewed_at, completed_at',
      ),
    supabase
      .from('repo_learning_lesson_comments')
      .select('lesson_id, understanding_state'),
    supabase
      .from('repo_learning_research_documents')
      .select('slug, title, summary, category')
      .order('title'),
    supabase.from('repo_learning_quiz_attempts').select('score'),
  ])

  if (lessonError) throw new Error(lessonError.message)
  if (progressError) throw new Error(progressError.message)
  if (commentError) throw new Error(commentError.message)
  if (researchError) throw new Error(researchError.message)
  if (attemptError) throw new Error(attemptError.message)

  const progressByLessonId = new Map(
    (progressRows ?? []).map((row) => [row.lesson_id, row as ProgressRow]),
  )
  const followUpCounts = new Map<string, number>()

  for (const row of commentRows ?? []) {
    if (
      row.understanding_state === 'confused' ||
      row.understanding_state === 'want_more_depth' ||
      row.understanding_state === 'want_examples'
    ) {
      followUpCounts.set(
        row.lesson_id,
        (followUpCounts.get(row.lesson_id) ?? 0) + 1,
      )
    }
  }

  const lessons = (lessonRows ?? []).map((lesson) => {
    const progress = progressByLessonId.get(lesson.id)

    return {
      slug: lesson.slug,
      title: lesson.title,
      stage: lesson.stage,
      difficulty: lesson.difficulty,
      orderIndex: lesson.order_index,
      estimatedMinutes: lesson.estimated_minutes,
      summary: lesson.summary,
      status: progress?.status ?? 'not_started',
      confidence: progress?.confidence ?? 1,
      quizAverage: progress?.quiz_average ?? 0,
      quizBest: progress?.quiz_best ?? 0,
      followUpCount: followUpCounts.get(lesson.id) ?? 0,
    }
  })

  const completedLessons = lessons.filter(
    (lesson) => lesson.status === 'completed',
  ).length
  const scores = (attemptRows ?? []).map((row) => row.score)

  return {
    project: {
      slug: project.slug,
      title: project.title,
      description: project.description,
      audience: project.audience,
    },
    dashboard: {
      totalLessons: lessons.length,
      completedLessons,
      averageQuizScore:
        scores.length > 0
          ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
          : 0,
      attemptCount: scores.length,
      followUpCount: lessons.reduce(
        (sum, lesson) => sum + lesson.followUpCount,
        0,
      ),
      nextRecommendedLesson:
        lessons.find((lesson) => lesson.status !== 'completed')?.slug ?? null,
    },
    lessons,
    researchDocuments: (researchRows ?? []).map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      category: row.category,
    })),
    brainBridge: getBrainBridgeState(),
  }
}

export const getLessonDetail = async (slug: string) => {
  const lesson = await getLessonRowBySlug(slug)
  const [progress, quiz, commentResponse] = await Promise.all([
    getProgressByLessonId(lesson.id),
    getQuizByLessonId(lesson.id),
    supabase
      .from('repo_learning_lesson_comments')
      .select('id, body, understanding_state, created_at')
      .eq('lesson_id', lesson.id)
      .order('created_at', { ascending: false }),
  ])

  if (commentResponse.error) {
    throw new Error(commentResponse.error.message)
  }

  const [
    questionRows,
    attemptResponse,
    relatedResearchResponse,
  ] = await Promise.all([
    getQuestionRowsByQuizId(quiz.id, quiz.question_count),
    supabase
      .from('repo_learning_quiz_attempts')
      .select('id, score, total_questions, created_at')
      .eq('quiz_id', quiz.id)
      .order('created_at', { ascending: false })
      .limit(5),
    (() => {
      const relatedResearchSlugs = parseStringArray(
        lesson.related_research_json,
        'related_research_json',
      )

      if (relatedResearchSlugs.length === 0) {
        return Promise.resolve({ data: [], error: null })
      }

      return supabase
        .from('repo_learning_research_documents')
        .select('slug, title, summary, category')
        .in('slug', relatedResearchSlugs)
    })(),
  ])

  if (attemptResponse.error) {
    throw new Error(attemptResponse.error.message)
  }

  if (relatedResearchResponse.error) {
    throw new Error(relatedResearchResponse.error.message)
  }

  const goals = parseStringArray(lesson.goals_json, 'goals_json')
  const relatedResearchSlugs = parseStringArray(
    lesson.related_research_json,
    'related_research_json',
  )
  const relatedResearch = relatedResearchSlugs
    .map((value) =>
      (relatedResearchResponse.data ?? []).find((document) => document.slug === value),
    )
    .filter((document): document is NonNullable<typeof document> => Boolean(document))
    .map((document) => ({
      slug: document.slug,
      title: document.title,
      summary: document.summary,
      category: document.category,
    }))

  const { brainBridge, relatedThoughts } = await getBrainBridgeForLesson(
    {
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      goals,
    },
    relatedResearch.map((document) => document.title),
  )

  return {
    lesson: {
      slug: lesson.slug,
      title: lesson.title,
      stage: lesson.stage,
      difficulty: lesson.difficulty,
      orderIndex: lesson.order_index,
      estimatedMinutes: lesson.estimated_minutes,
      summary: lesson.summary,
      goals,
      content: lesson.content,
      status: progress?.status ?? 'not_started',
      confidence: progress?.confidence ?? 1,
      quizAverage: progress?.quiz_average ?? 0,
      quizBest: progress?.quiz_best ?? 0,
      lastViewedAt: progress?.last_viewed_at ?? null,
      completedAt: progress?.completed_at ?? null,
    },
    quiz: {
      id: quiz.id,
      title: quiz.title,
      passingScore: quiz.passing_score,
      questions: questionRows.map((question) => ({
        id: question.id,
        orderIndex: question.order_index,
        prompt: question.prompt,
        options: parseStringArray(question.options_json, 'options_json'),
        explanation: question.explanation,
      })),
      recentAttempts: (attemptResponse.data ?? []).map((attempt) => ({
        id: attempt.id,
        score: attempt.score,
        totalQuestions: attempt.total_questions,
        createdAt: attempt.created_at,
      })),
    },
    comments: (commentResponse.data ?? []).map((comment) => ({
      id: comment.id,
      body: comment.body,
      understandingState: comment.understanding_state as UnderstandingState,
      createdAt: comment.created_at,
    })),
    relatedResearch,
    relatedThoughts,
    brainBridge,
  }
}

export const getResearchDocumentDetail = async (slug: string) =>
  unwrapSingle<ResearchDocumentDetailRow>(
    supabase
      .from('repo_learning_research_documents')
      .select('slug, title, summary, category, content, source_path, source_url')
      .eq('slug', slug)
      .single(),
    `Research document ${slug} was not found.`,
  ).then((document) => ({
    slug: document.slug,
    title: document.title,
    summary: document.summary,
    category: document.category,
    content: document.content,
    sourcePath: document.source_path,
    sourceUrl: document.source_url,
  }))

export const updateLessonProgress = async (
  slug: string,
  status: LessonStatus,
  confidence: number,
) => {
  const lesson = await getLessonRowBySlug(slug)
  const existingProgress = await getProgressByLessonId(lesson.id)
  const timestamp = now()

  await ensureNoError(
    supabase.from('repo_learning_lesson_progress').upsert(
      {
        lesson_id: lesson.id,
        status,
        confidence,
        quiz_average: existingProgress?.quiz_average ?? 0,
        quiz_best: existingProgress?.quiz_best ?? 0,
        last_viewed_at: timestamp,
        completed_at:
          status === 'completed'
            ? existingProgress?.completed_at ?? timestamp
            : existingProgress?.completed_at,
        updated_at: timestamp,
      },
      { onConflict: 'lesson_id' },
    ),
  )

  return getLessonDetail(slug)
}

export const addLessonComment = async (
  slug: string,
  body: string,
  understandingState: UnderstandingState,
) => {
  const lesson = await getLessonRowBySlug(slug)
  const existingProgress = await getProgressByLessonId(lesson.id)
  const timestamp = now()

  await ensureNoError(
    supabase.from('repo_learning_lesson_comments').insert({
      lesson_id: lesson.id,
      body,
      understanding_state: understandingState,
    }),
  )

  await ensureNoError(
    supabase.from('repo_learning_lesson_progress').upsert(
      {
        lesson_id: lesson.id,
        status: existingProgress?.status ?? 'not_started',
        confidence: existingProgress?.confidence ?? 1,
        quiz_average: existingProgress?.quiz_average ?? 0,
        quiz_best: existingProgress?.quiz_best ?? 0,
        last_viewed_at: timestamp,
        completed_at: existingProgress?.completed_at,
        updated_at: timestamp,
      },
      { onConflict: 'lesson_id' },
    ),
  )

  return getLessonDetail(slug)
}

export const submitQuizAnswers = async (
  quizId: string,
  answers: Array<{ questionId: string; selectedOption: string }>,
) => {
  const quiz = await unwrapSingle<QuizRow>(
    supabase
      .from('repo_learning_quizzes')
      .select('id, lesson_id, title, passing_score, question_count')
      .eq('id', quizId)
      .single(),
    `Quiz ${quizId} was not found.`,
  ) as QuizRow

  const questionRows = await getQuestionRowsByQuizId(quizId, quiz.question_count)

  if (questionRows.length === 0) {
    throw new Error('Quiz questions were not found.')
  }

  const answerMap = new Map(
    answers.map((answer) => [answer.questionId, answer.selectedOption]),
  )
  const results = questionRows.map((question) => {
    const selectedOption = answerMap.get(question.id) ?? ''
    const isCorrect = selectedOption === question.correct_option

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedOption,
      correctOption: question.correct_option,
      explanation: question.explanation,
      isCorrect,
    }
  })

  const correctCount = results.filter((result) => result.isCorrect).length
  const score = Math.round((correctCount / questionRows.length) * 100)

  const attempt = await unwrapSingle<{ id: string }>(
    supabase
      .from('repo_learning_quiz_attempts')
      .insert({
        quiz_id: quizId,
        score,
        total_questions: questionRows.length,
      })
      .select('id')
      .single(),
    `Failed to save quiz attempt for ${quizId}.`,
  )

  await ensureNoError(
    supabase.from('repo_learning_quiz_responses').insert(
      results.map((result) => ({
        attempt_id: attempt.id,
        question_id: result.questionId,
        selected_option: result.selectedOption,
        is_correct: result.isCorrect,
      })),
    ),
  )

  const { data: attemptRows, error: attemptError } = await supabase
    .from('repo_learning_quiz_attempts')
    .select('score')
    .eq('quiz_id', quizId)

  if (attemptError) {
    throw new Error(attemptError.message)
  }

  const existingProgress = await getProgressByLessonId(quiz.lesson_id)
  const allScores = (attemptRows ?? []).map((row) => row.score)
  const timestamp = now()

  await ensureNoError(
    supabase.from('repo_learning_lesson_progress').upsert(
      {
        lesson_id: quiz.lesson_id,
        status:
          existingProgress?.status === 'not_started'
            ? 'in_progress'
            : existingProgress?.status ?? 'in_progress',
        confidence: existingProgress?.confidence ?? 1,
        quiz_average:
          allScores.length > 0
            ? Math.round(
                allScores.reduce((sum, value) => sum + value, 0) / allScores.length,
              )
            : 0,
        quiz_best: allScores.length > 0 ? Math.max(...allScores) : 0,
        last_viewed_at: timestamp,
        completed_at: existingProgress?.completed_at,
        updated_at: timestamp,
      },
      { onConflict: 'lesson_id' },
    ),
  )

  return {
    score,
    totalQuestions: questionRows.length,
    correctCount,
    results,
  }
}

export const captureLessonArtifact = async (
  slug: string,
  kind: LearningArtifactKind,
  content: string,
) => {
  const detail = await getLessonDetail(slug)
  const result = await captureLearningArtifact({
    kind,
    content,
    lesson: {
      slug: detail.lesson.slug,
      title: detail.lesson.title,
      summary: detail.lesson.summary,
      goals: detail.lesson.goals,
      status: detail.lesson.status,
      confidence: detail.lesson.confidence,
    },
  })

  return result
}
