import { createClient } from '@supabase/supabase-js'

const requireEnv = (name: string) => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const APP_ENV = {
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterEmbeddingModel:
    process.env.OPENROUTER_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
}

export const supabase = createClient(
  APP_ENV.supabaseUrl,
  APP_ENV.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)
