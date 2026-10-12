import { scanAll } from './scanner.ts'
import { enrich, llmAvailable } from './describe.ts'
import { CATEGORIES } from './categories.ts'

try {
  process.loadEnvFile()
} catch {
  // no .env file
}

if (!llmAvailable()) {
  console.error('OPENROUTER_API_KEY is not set — nothing to do. See .env.example.')
  process.exit(1)
}

const { enrichTargets } = scanAll()
console.log(`${enrichTargets.length} skills need enrichment (missing description or category "Other")`)
const added = await enrich(enrichTargets, CATEGORIES)
console.log(`done — ${added} cache entries written`)
