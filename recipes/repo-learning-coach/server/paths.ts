import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_LEARNING_CONFIG } from '../repo-learning.config.js'

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))

export const APP_ROOT = resolve(CURRENT_DIR, '..')
export const DIST_DIR = resolve(APP_ROOT, 'dist')
export const RESEARCH_DIR = resolve(APP_ROOT, ...REPO_LEARNING_CONFIG.researchDirectory)
export const LESSON_DIR = resolve(APP_ROOT, ...REPO_LEARNING_CONFIG.lessonDirectory)

export const toAppRelativePath = (absolutePath: string) => relative(APP_ROOT, absolutePath)
