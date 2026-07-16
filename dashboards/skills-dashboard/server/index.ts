import express from 'express'
import path from 'node:path'

// tsx does not auto-load .env; Node's built-in loader picks up OPENROUTER_API_KEY etc.
try {
  process.loadEnvFile()
} catch {
  // no .env file — fine, everything it configures is optional
}
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { scanAll } from './scanner.ts'
import { buildTree, guardPath, readFileCapped } from './files.ts'
import { enrich, llmAvailable } from './describe.ts'
import { judgeDuplicates } from './dedup.ts'
import { CATEGORIES } from './categories.ts'

const app = express()
const port = Number(process.env.SKILLS_DASH_PORT ?? 8788)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// Fresh rescan on every request — a few hundred small files, well under 200ms.
// Never calls the LLM (this route is polled); enrichment is POST /api/enrich.
app.get('/api/skills', (_req, res) => {
  try {
    res.json(scanAll().payload)
  } catch (err) {
    console.error('[api] scan failed:', err)
    res.status(500).json({ error: 'scan failed' })
  }
})

const guarded = (req: express.Request): string | null => {
  const requested = String(req.query.path ?? '')
  if (!requested) return null
  return guardPath(requested, scanAll().roots)
}

app.get('/api/skill-tree', (req, res) => {
  const real = guarded(req)
  if (!real) {
    res.status(403).json({ error: 'path outside skill roots' })
    return
  }
  res.json(buildTree(real))
})

app.get('/api/skill-file', (req, res) => {
  const real = guarded(req)
  if (!real) {
    res.status(403).json({ error: 'path outside skill roots' })
    return
  }
  const file = readFileCapped(real)
  if (!file) {
    res.status(404).json({ error: 'not a readable file' })
    return
  }
  res.json(file)
})

let deduping = false
app.post('/api/dedup', (req, res) => {
  if (!llmAvailable()) {
    res.status(400).json({ error: 'OPENROUTER_API_KEY not set' })
    return
  }
  if (deduping) {
    res.status(409).json({ error: 'dedup judgment already running' })
    return
  }
  deduping = true
  const onlyId = typeof req.query.id === 'string' ? req.query.id : undefined
  judgeDuplicates(scanAll().payload.duplicates, onlyId)
    .then((result) => res.json(result))
    .catch((err) => res.status(500).json({ error: String(err) }))
    .finally(() => {
      deduping = false
    })
})

let enriching = false
app.post('/api/enrich', (_req, res) => {
  if (!llmAvailable()) {
    res.status(400).json({ error: 'OPENROUTER_API_KEY not set' })
    return
  }
  if (enriching) {
    res.status(409).json({ error: 'enrichment already running' })
    return
  }
  enriching = true
  const { enrichTargets } = scanAll()
  enrich(enrichTargets, CATEGORIES)
    .then((added) => res.json({ enriched: added, candidates: enrichTargets.length }))
    .catch((err) => res.status(500).json({ error: String(err) }))
    .finally(() => {
      enriching = false
    })
})

// Production: serve the built client with an SPA fallback.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
}

app.listen(port, () => {
  console.log(`skills-dashboard server on http://localhost:${port}`)
})
