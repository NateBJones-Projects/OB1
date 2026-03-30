import { redirect } from '@sveltejs/kit';

export const GET = async ({ locals }: { locals: App.Locals }) => {
	if (locals.supabase) {
		await locals.supabase.auth.signOut();
	}

	throw redirect(303, '/signin');
};
