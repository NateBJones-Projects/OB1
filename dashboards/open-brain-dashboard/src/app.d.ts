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

		interface ImportMetaEnv {
			PUBLIC_MCP_URL: string;
			PUBLIC_MCP_KEY: string;
			PUBLIC_SUPABASE_URL: string;
			PUBLIC_SUPABASE_ANON_KEY: string;
		}

	interface ImportMeta {
		env: ImportMetaEnv;
	}
}

export {};
