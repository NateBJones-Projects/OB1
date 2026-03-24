import { redirect } from '@sveltejs/kit';

export const load = async ({
	locals,
	url,
}: {
	locals: App.Locals;
	url: URL;
}) => {
	if (!locals.user && url.pathname !== '/signin') {
		throw redirect(302, '/signin');
	}

	return {
		user: locals.user,
	};
};
