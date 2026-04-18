import express from 'express'
import { existsSync } from 'node:fs'
import { z } from 'zod'

import {
  addLessonComment,
  captureLessonArtifact,
  getBootstrapData,
  getLessonDetail,
  getResearchDocumentDetail,
  submitQuizAnswers,
  syncContentToSupabase,
  updateLessonProgress,
} from './db.js'
import { DIST_DIR } from './paths.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(express.json())

app.get('/api/bootstrap', async (_request, response) => {
  try {
    response.json(await getBootstrapData())
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load bootstrap data.',
    })
  }
})

app.get('/api/lessons/:slug', async (request, response) => {
  try {
    response.json(await getLessonDetail(request.params.slug))
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Lesson not found.',
    })
  }
})

app.post('/api/lessons/:slug/progress', async (request, response) => {
  const payload = z.object({
    status: z.enum(['not_started', 'in_progress', 'completed']),
    confidence: z.number().int().min(1).max(5),
  })

  const parsed = payload.safeParse(request.body)

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid lesson progress payload.' })
    return
  }

  try {
    response.json(
      await updateLessonProgress(
        request.params.slug,
        parsed.data.status,
        parsed.data.confidence,
      ),
    )
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update lesson progress.',
    })
  }
})

app.post('/api/lessons/:slug/comments', async (request, response) => {
  const payload = z.object({
    body: z.string().trim().min(10).max(5000),
    understandingState: z.enum([
      'clear',
      'unsure',
      'confused',
      'want_more_depth',
      'want_examples',
    ]),
  })

  const parsed = payload.safeParse(request.body)

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid comment payload.' })
    return
  }

  try {
    response.json(
      await addLessonComment(
        request.params.slug,
        parsed.data.body,
        parsed.data.understandingState,
      ),
    )
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save comment.',
    })
  }
})

app.post('/api/lessons/:slug/capture', async (request, response) => {
  const payload = z.object({
    kind: z.enum(['takeaway', 'confusion', 'summary']),
    content: z.string().max(5000).default(''),
  })

  const parsed = payload.safeParse(request.body)

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid capture payload.' })
    return
  }

  try {
    response.json(
      await captureLessonArtifact(
        request.params.slug,
        parsed.data.kind,
        parsed.data.content,
      ),
    )
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to capture artifact.',
    })
  }
})

app.post('/api/quizzes/:quizId/submit', async (request, response) => {
  const payload = z.object({
    answers: z.array(
      z.object({
        questionId: z.string().uuid(),
        selectedOption: z.string().min(1),
      }),
    ),
  })

  const parsed = payload.safeParse(request.body)

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid quiz payload.' })
    return
  }

  try {
    response.json(await submitQuizAnswers(request.params.quizId, parsed.data.answers))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to submit quiz.',
    })
  }
})

app.get('/api/research/:slug', async (request, response) => {
  try {
    response.json(await getResearchDocumentDetail(request.params.slug))
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Research document not found.',
    })
  }
})

if (process.env.NODE_ENV === 'production' && existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*', (_request, response) => {
    response.sendFile('index.html', { root: DIST_DIR })
  })
}

const start = async () => {
  await syncContentToSupabase()

  app.listen(port, () => {
    console.log(`repo-learning-coach server listening on http://localhost:${port}`)
  })
}

void start().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
