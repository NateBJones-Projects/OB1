<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabase';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMessage = $state('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		loading = true;
		errorMessage = '';

		const { error } = await supabase.auth.signInWithPassword({
			email: email.trim(),
			password,
		});

		if (error) {
			errorMessage = error.message;
			loading = false;
			return;
		}

		await goto('/');
	}
</script>

<div class="max-w-md mx-auto px-6 py-16">
	<div class="bg-bg-card border border-white/10 rounded-2xl p-8">
		<h1 class="text-2xl font-semibold mb-8">Sign in</h1>

		<form class="space-y-4" onsubmit={handleSubmit}>
			<div>
				<label class="text-sm text-text-muted" for="email">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					autocomplete="email"
					required
					class="mt-2 w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
				/>
			</div>

			<div>
				<label class="text-sm text-text-muted" for="password">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					autocomplete="current-password"
					required
					class="mt-2 w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
				/>
			</div>

			{#if errorMessage}
				<div class="text-sm text-red-400">{errorMessage}</div>
			{/if}

			<button
				type="submit"
				disabled={loading}
				class="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-light disabled:opacity-60 text-white font-medium"
			>
				{loading ? 'Signing in...' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
