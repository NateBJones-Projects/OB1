import { env } from '$env/dynamic/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
	throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (
				cookiesToSet: Array<{
					name: string;
					value: string;
					options: Parameters<typeof event.cookies.set>[2];
				}>,
			) => {
				for (const cookie of cookiesToSet) {
					event.cookies.set(cookie.name, cookie.value, cookie.options);
				}
			},
		},
	});

	const {
		data: { user },
		error,
	} = await event.locals.supabase.auth.getUser();

	event.locals.user = error ? null : user;
	event.locals.session = null;

	const response = await resolve(event);
	return response;
};
