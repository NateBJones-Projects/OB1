import { syncContentToSupabase } from './db.js'

const run = async () => {
  const result = await syncContentToSupabase()
  console.log(
    `Synced ${result.lessons} lessons and ${result.researchDocuments} research documents.`,
  )
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
