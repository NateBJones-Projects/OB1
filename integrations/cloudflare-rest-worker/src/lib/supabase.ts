import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./types";

// Build a service-role client for a single request. We don't cache across
// requests in module scope because each request lives in a separate Worker
// isolate context and the client is cheap to construct (no connection pool;
// PostgREST calls go over HTTPS).
export function supabaseFor(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
