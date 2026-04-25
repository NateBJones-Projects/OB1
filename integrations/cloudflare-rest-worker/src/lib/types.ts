// Worker bindings injected by Wrangler. These are set as secrets via
// `wrangler secret put` — see README.
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MCP_ACCESS_KEY: string;
  OPENROUTER_API_KEY: string;
}
