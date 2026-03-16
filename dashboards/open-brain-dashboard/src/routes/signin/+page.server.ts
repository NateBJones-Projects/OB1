import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }: { locals: App.Locals }) => {
	if (locals.user) {
		throw redirect(302, '/');
	}

	return {};
};
