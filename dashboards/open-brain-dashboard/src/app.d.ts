/// <reference types="@sveltejs/kit" />

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			user: User | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Preferred: server-only MCP credentials (set MCP_URL / MCP_KEY in env).
	// Fallback: PUBLIC_MCP_URL / PUBLIC_MCP_KEY (exposed in browser bundle).
	interface ImportMetaEnv {
		PUBLIC_SUPABASE_URL: string;
		PUBLIC_SUPABASE_ANON_KEY: string;
		PUBLIC_MCP_URL?: string;
		PUBLIC_MCP_KEY?: string;
	}

	interface ImportMeta {
		env: ImportMetaEnv;
	}
}

export {};
