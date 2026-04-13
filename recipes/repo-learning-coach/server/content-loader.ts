import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import matter from 'gray-matter'
import { z } from 'zod'

import { LESSON_DIR, RESEARCH_DIR, toAppRelativePath } from './paths.js'

const slugFromFileName = (fileName: string) =>
  basename(fileName, extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const researchFrontmatterSchema = z.object({
  slug: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.string().min(1),
  sourceUrl: z.string().min(1).optional(),
})

const quizQuestionSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctOption: z.string().min(1),
  explanation: z.string().min(1),
})

const lessonFrontmatterSchema = z.object({
  slug: z.string().min(1).optional(),
  title: z.string().min(1),
  stage: z.string().min(1),
  difficulty: z.string().min(1),
  order: z.number().int().positive(),
  estimatedMinutes: z.number().int().positive(),
  summary: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  relatedResearch: z.array(z.string().min(1)).default([]),
  quiz: z.object({
    title: z.string().min(1),
    passingScore: z.number().int().min(0).max(100).default(70),
    questions: z.array(quizQuestionSchema).min(1),
  }),
})

export type LoadedResearchDocument = {
  slug: string
  title: string
  summary: string
  category: string
  content: string
  sourcePath: string
  sourceUrl: string | null
  contentHash: string
}

export type LoadedLesson = {
  slug: string
  title: string
  stage: string
  difficulty: string
  orderIndex: number
  estimatedMinutes: number
  summary: string
  goals: string[]
  content: string
  relatedResearchSlugs: string[]
  quiz: {
    title: string
    passingScore: number
    questions: Array<{
      prompt: string
      options: string[]
      correctOption: string
      explanation: string
    }>
  }
  sourcePath: string
}

const markdownFilesIn = (directory: string) =>
  readdirSync(directory)
    .filter((fileName) => extname(fileName) === '.md')
    .sort()

export const loadResearchDocuments = (): LoadedResearchDocument[] =>
  markdownFilesIn(RESEARCH_DIR).map((fileName) => {
    const absolutePath = resolve(RESEARCH_DIR, fileName)
    const file = matter(readFileSync(absolutePath, 'utf8'))
    const frontmatter = researchFrontmatterSchema.parse(file.data)
    const content = file.content.trim()

    return {
      slug: frontmatter.slug ?? slugFromFileName(fileName),
      title: frontmatter.title,
      summary: frontmatter.summary,
      category: frontmatter.category,
      content,
      sourcePath: toAppRelativePath(absolutePath),
      sourceUrl: frontmatter.sourceUrl ?? null,
      contentHash: createHash('sha1').update(content).digest('hex'),
    }
  })

export const loadLessons = (): LoadedLesson[] =>
  markdownFilesIn(LESSON_DIR)
    .map((fileName) => {
      const absolutePath = resolve(LESSON_DIR, fileName)
      const file = matter(readFileSync(absolutePath, 'utf8'))
      const frontmatter = lessonFrontmatterSchema.parse(file.data)

      return {
        slug: frontmatter.slug ?? slugFromFileName(fileName),
        title: frontmatter.title,
        stage: frontmatter.stage,
        difficulty: frontmatter.difficulty,
        orderIndex: frontmatter.order,
        estimatedMinutes: frontmatter.estimatedMinutes,
        summary: frontmatter.summary,
        goals: frontmatter.goals,
        content: file.content.trim(),
        relatedResearchSlugs: frontmatter.relatedResearch,
        quiz: frontmatter.quiz,
        sourcePath: toAppRelativePath(absolutePath),
      }
    })
    .sort((a, b) => a.orderIndex - b.orderIndex)
