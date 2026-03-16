<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';

	let {
		children,
		data,
	}: {
		children: Snippet;
		data: { user: { email?: string | null } | null };
	} = $props();
	const user = $derived(data.user);
</script>

<div class="min-h-screen flex flex-col">
	<header class="border-b border-white/10 bg-bg-elevated/50 backdrop-blur-sm sticky top-0 z-50">
		<div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
			<a href="/" class="flex items-center gap-3">
				<span class="text-2xl">🧠</span>
				<h1 class="text-xl font-bold">Open Brain</h1>
			</a>
			<div class="flex items-center gap-3 text-sm">
				{#if user}
					<span class="text-text-muted">{user.email ?? 'Signed in'}</span>
					<a href="/signout" class="text-text-muted hover:text-text transition-colors">Sign out</a>
				{:else}
					<a href="/signin" class="text-text-muted hover:text-text transition-colors">Sign in</a>
				{/if}
			</div>
		</div>
	</header>
	
	<main class="flex-1">
		{@render children()}
	</main>
	
	<footer class="border-t border-white/10 py-6 text-center text-text-muted text-sm">
		<p>Open Brain • Capture and search your thoughts</p>
	</footer>
</div>
