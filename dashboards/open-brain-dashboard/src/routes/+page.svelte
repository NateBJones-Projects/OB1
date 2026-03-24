<script lang="ts">
	import { getStats, getThoughts, captureThought } from '$lib/api';
	import { THOUGHT_TYPES, type Thought, type ThoughtType } from '$lib/types';
	import { onMount } from 'svelte';

	let thoughts = $state<Thought[]>([]);
	let loading = $state(true);
	let searching = $state(false);
	let hasSearched = $state(false);
	let searchQuery = $state('');
	let selectedType = $state<ThoughtType | null>(null);
	let selectedTopic = $state<string | null>(null);
	let selectedPerson = $state<string | null>(null);
	let allTopics = $state<string[]>([]);
	let allPeople = $state<string[]>([]);
	let stats = $state({ total: 0, types: {} as Record<string, number> });
	let showCapture = $state(false);
	let captureContent = $state('');
	let capturing = $state(false);
	let selectedThought = $state<Thought | null>(null);
	let latestResultKey = $state<string | null>(null);
	let searchInput: HTMLInputElement | null = null;

	const typeButtonClass: Record<ThoughtType, string> = {
		observation: 'bg-observation text-white',
		task: 'bg-task text-white',
		idea: 'bg-idea text-white',
		reference: 'bg-reference text-white',
		person_note: 'bg-person-note text-white'
	};

	const typeDotClass: Record<ThoughtType, string> = {
		observation: 'bg-observation',
		task: 'bg-task',
		idea: 'bg-idea',
		reference: 'bg-reference',
		person_note: 'bg-person-note'
	};

	const typeBadgeClass: Record<ThoughtType, string> = {
		observation: 'bg-observation/20 text-observation',
		task: 'bg-task/20 text-task',
		idea: 'bg-idea/20 text-idea',
		reference: 'bg-reference/20 text-reference',
		person_note: 'bg-person-note/20 text-person-note'
	};

	function safeType(type?: ThoughtType): ThoughtType {
		return type ?? 'observation';
	}

	function thoughtKey(thought: Thought): string {
		return `${thought.created_at}::${thought.content}`;
	}

	onMount(async () => {
		searchInput?.focus();
		await loadStats();
		loading = false;
	});

	async function loadThoughts() {
		const query = searchQuery.trim();
		if (!query) {
			return;
		}

		searching = true;
		try {
			const fetchedThoughts = await getThoughts({
				search: query,
			});
			const sortedFetchedThoughts = fetchedThoughts.sort(
				(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
			);

			latestResultKey = sortedFetchedThoughts.length ? thoughtKey(sortedFetchedThoughts[0]) : null;

			const seen = new Set<string>();
			const merged: Thought[] = [];

			for (const t of sortedFetchedThoughts) {
				const key = thoughtKey(t);
				if (seen.has(key)) continue;
				seen.add(key);
				merged.push(t);
			}

			for (const t of thoughts) {
				const key = thoughtKey(t);
				if (seen.has(key)) continue;
				seen.add(key);
				merged.push(t);
			}

			thoughts = merged;
			hasSearched = true;
			extractFilters();
		} catch (err) {
			console.error('Failed to load thoughts:', err);
		} finally {
			searching = false;
		}
	}

	async function loadStats() {
		try {
			const s = await getStats();
			stats = s;
			allTopics = Object.keys(s.topics);
			allPeople = Object.keys(s.people);
		} catch (err) {
			console.error('Failed to load stats:', err);
		}
	}

	function extractFilters() {
		const topics = new Set<string>();
		const people = new Set<string>();
		for (const t of thoughts) {
			if (t.metadata.topics) t.metadata.topics.forEach(x => topics.add(x));
			if (t.metadata.people) t.metadata.people.forEach(x => people.add(x));
		}
		allTopics = Array.from(topics).sort();
		allPeople = Array.from(people).sort();
	}

	function handleSearchInput() {
		// Keep existing results when query is cleared.
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.code !== 'NumpadEnter') return;
		event.preventDefault();
		loadThoughts();
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		loadThoughts();
	}

	function clearSearchQuery() {
		searchQuery = '';
		searchInput?.focus();
	}

	function clearResults() {
		hasSearched = false;
		thoughts = [];
		latestResultKey = null;
		selectedType = null;
		selectedTopic = null;
		selectedPerson = null;
	}

	function filterByType(type: ThoughtType | null) {
		selectedType = type;
	}

	function filterByTopic(topic: string | null) {
		selectedTopic = topic;
	}

	function filterByPerson(person: string | null) {
		selectedPerson = person;
	}

	function clearFilters() {
		selectedType = null;
		selectedTopic = null;
		selectedPerson = null;
	}

	function getVisibleThoughts(): Thought[] {
		return thoughts.filter((t) => {
			if (selectedType && t.metadata.type !== selectedType) return false;
			if (selectedTopic && !(t.metadata.topics || []).includes(selectedTopic)) return false;
			if (selectedPerson && !(t.metadata.people || []).includes(selectedPerson)) return false;
			return true;
		});
	}

	function getTypeCountInResults(type: ThoughtType): number {
		return thoughts.filter((t) => t.metadata.type === type).length;
	}

	function formatDate(date: string): string {
		return new Date(date).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function openThought(thought: Thought) {
		selectedThought = thought;
	}

	function closeThoughtModal() {
		selectedThought = null;
	}

	function handleCardKeydown(event: KeyboardEvent, thought: Thought) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		openThought(thought);
	}

	async function handleCapture() {
		if (!captureContent.trim()) return;
		capturing = true;
		try {
			await captureThought(captureContent);
			captureContent = '';
			showCapture = false;
			await loadStats();
			if (hasSearched) await loadThoughts();
		} catch (err) {
			console.error('Failed to capture:', err);
		}
		capturing = false;
	}
</script>

<svelte:head>
	<title>Open Brain</title>
	<meta name="description" content="Visualize and search your captured thoughts" />
</svelte:head>

<div class="max-w-5xl mx-auto px-6 py-8">
	<!-- Header -->
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-6 text-sm text-text-muted">
			<span class="text-2xl font-bold text-text">{stats.total}</span>
			<span>thoughts captured</span>
		</div>
		<button
			onclick={() => showCapture = !showCapture}
			class="px-4 py-2 bg-primary hover:bg-primary-light text-white rounded-lg font-medium transition-colors"
		>
			{showCapture ? 'Close' : '+ Capture'}
		</button>
	</div>

	<!-- Capture Form -->
	{#if showCapture}
		<div class="mb-6 bg-bg-card border border-white/10 rounded-xl p-5">
			<textarea
				bind:value={captureContent}
				placeholder="What's on your mind?"
				rows={3}
				class="w-full bg-transparent text-text placeholder:text-text-muted focus:outline-none resize-none"
			></textarea>
			<div class="flex justify-end gap-3 mt-3">
				<button
					onclick={() => showCapture = false}
					class="px-4 py-2 text-text-muted hover:text-text transition-colors"
				>
					Cancel
				</button>
				<button
					onclick={handleCapture}
					disabled={!captureContent.trim() || capturing}
					class="px-4 py-2 bg-primary hover:bg-primary-light disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
				>
					{capturing ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Search -->
	<div class="mb-6">
		<form class="relative" onsubmit={submitSearch}>
			<input
				bind:this={searchInput}
				type="text"
				bind:value={searchQuery}
				oninput={handleSearchInput}
				onkeydown={handleSearchKeydown}
				placeholder="Search thoughts..."
				class="w-full bg-bg-elevated border border-white/10 rounded-xl px-5 py-3.5 pl-12 pr-56 text-text placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
			/>
			<svg class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
				{#if searchQuery.trim()}
				<button
					type="button"
					onclick={clearSearchQuery}
					aria-label="Clear search"
					class="w-8 h-8 inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-text-muted hover:text-text rounded-full text-sm font-medium transition-colors"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
				{/if}
				<button
					type="submit"
					disabled={searching}
					class="w-28 px-4 py-1.5 bg-primary hover:bg-primary-light disabled:opacity-70 text-white rounded-lg text-sm font-medium transition-colors text-center"
				>
					{searching ? 'Searching...' : 'Search'}
				</button>
			</div>
		</form>
		{#if searching}
			<div class="mt-2 text-sm text-text-muted">Searching thoughts...</div>
		{/if}
		{#if hasSearched && !searching}
			<div class="mt-2">
				<button
					type="button"
					onclick={clearResults}
					class="text-sm text-text-muted hover:text-text transition-colors"
				>
					Clear results
				</button>
			</div>
		{/if}
	</div>

	<!-- Type Filters -->
	<div class="mb-6">
		<div class="flex flex-wrap gap-2">
			<button
				onclick={() => filterByType(null)}
				class="px-4 py-2 rounded-full text-sm font-medium transition-all {!selectedType ? 'bg-primary text-white' : 'bg-bg-elevated text-text-muted hover:text-text'}"
			>
				All
			</button>
			{#each THOUGHT_TYPES as type}
				<button
					onclick={() => filterByType(type.value)}
					class="px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 {selectedType === type.value ? typeButtonClass[type.value] : 'bg-bg-elevated text-text-muted hover:text-text'}"
				>
					<span class="w-2 h-2 rounded-full {typeDotClass[type.value]}"></span>
					{type.label}
					{#if hasSearched && getTypeCountInResults(type.value) > 0}
						<span class="opacity-60">({getTypeCountInResults(type.value)})</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Active Filters -->
	{#if selectedType || selectedTopic || selectedPerson}
		<div class="mb-6 flex items-center gap-2 flex-wrap">
			<span class="text-text-muted text-sm">Filters:</span>
			{#if selectedType}
				<span class="inline-flex items-center gap-2 px-3 py-1 bg-primary/20 text-primary rounded-full text-sm">
					{THOUGHT_TYPES.find(t => t.value === selectedType)?.label}
					<button onclick={() => filterByType(null)} class="hover:text-white">×</button>
				</span>
			{/if}
			{#if selectedTopic}
				<span class="inline-flex items-center gap-2 px-3 py-1 bg-accent/20 text-accent rounded-full text-sm">
					{selectedTopic}
					<button onclick={() => filterByTopic(null)} class="hover:text-white">×</button>
				</span>
			{/if}
			{#if selectedPerson}
				<span class="inline-flex items-center gap-2 px-3 py-1 bg-person-note/20 text-person-note rounded-full text-sm">
					{selectedPerson}
					<button onclick={() => filterByPerson(null)} class="hover:text-white">×</button>
				</span>
			{/if}
			<button onclick={clearFilters} class="text-text-muted text-sm hover:text-text transition-colors">
				Clear all
			</button>
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="text-text-muted">Loading thoughts...</div>
		</div>
	{:else if searching && !hasSearched}
		<div class="flex items-center justify-center py-20">
			<div class="text-text-muted">Searching...</div>
		</div>
	{:else if !hasSearched}
		<div class="text-center py-20">
			<div class="text-4xl mb-4">🔎</div>
			<div class="text-text-muted">Search to explore your thoughts</div>
		</div>
	{:else if getVisibleThoughts().length === 0}
		<div class="text-center py-20">
			<div class="text-4xl mb-4">🧠</div>
			<div class="text-text-muted">No thoughts found</div>
			{#if searchQuery || selectedType || selectedTopic || selectedPerson}
				<button onclick={clearFilters} class="mt-4 text-primary hover:text-primary-light transition-colors">
					Clear filters
				</button>
			{/if}
		</div>
	{:else}
		<!-- Thoughts Grid -->
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each getVisibleThoughts() as thought}
				{@const thoughtType = safeType(thought.metadata.type)}
				{@const isLatestResult = latestResultKey === thoughtKey(thought)}
				<div
					tabindex="0"
					role="button"
					onclick={() => openThought(thought)}
					onkeydown={(event) => handleCardKeydown(event, thought)}
					class="h-full bg-bg-card border rounded-xl p-5 transition-colors cursor-pointer focus:outline-none focus:border-primary {isLatestResult ? 'border-primary/50 ring-2 ring-primary/30 animate-pulse shadow-[0_0_24px_rgba(99,102,241,0.35)]' : 'border-white/5 hover:border-white/10'}"
				>
					<div class="flex items-start justify-between gap-4 mb-3">
						<span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium {typeBadgeClass[thoughtType]}">
							<span class="w-1.5 h-1.5 rounded-full {typeDotClass[thoughtType]}"></span>
							{THOUGHT_TYPES.find(t => t.value === thought.metadata.type)?.label || 'Thought'}
						</span>
						<time class="text-text-muted text-xs">{formatDate(thought.created_at)}</time>
					</div>
					
					<p class="text-text leading-relaxed">{thought.content}</p>
					
					{#if thought.metadata.topics?.length || thought.metadata.people?.length}
						<div class="mt-4 flex flex-wrap gap-2">
							{#each thought.metadata.topics || [] as topic}
								<button
									onclick={(event) => {
										event.stopPropagation();
										filterByTopic(topic);
									}}
									class="px-2 py-0.5 bg-white/5 hover:bg-accent/20 hover:text-accent rounded text-xs text-text-muted transition-colors"
								>
									#{topic}
								</button>
							{/each}
							{#each thought.metadata.people || [] as person}
								<button
									onclick={(event) => {
										event.stopPropagation();
										filterByPerson(person);
									}}
									class="px-2 py-0.5 bg-white/5 hover:bg-person-note/20 hover:text-person-note rounded text-xs text-text-muted transition-colors"
								>
									@{person}
								</button>
							{/each}
						</div>
					{/if}
					
					{#if thought.metadata.action_items?.length}
						<div class="mt-4 pt-4 border-t border-white/5">
							<div class="text-xs text-text-muted mb-2">Action items:</div>
							<ul class="text-sm text-text-muted space-y-1">
								{#each thought.metadata.action_items as item}
									<li class="flex items-start gap-2">
										<span class="text-task mt-1">○</span>
										<span>{item}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if selectedThought}
	{@const activeThought = selectedThought}
	<div class="fixed inset-0 z-50 p-4 flex items-center justify-center">
		<button
			type="button"
			class="absolute inset-0 bg-black/70 backdrop-blur-sm"
			onclick={closeThoughtModal}
			aria-label="Close thought modal"
		></button>
		<div class="relative w-full max-w-2xl bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
			<div class="flex items-start justify-between gap-3 p-5 border-b border-white/10">
				<div>
					<div class="text-xs text-text-muted mb-1">{formatDate(activeThought.created_at)}</div>
					<div class="text-sm font-medium text-text">
						{THOUGHT_TYPES.find((t) => t.value === activeThought.metadata.type)?.label || 'Thought'}
					</div>
				</div>
				<button
					type="button"
					onclick={closeThoughtModal}
					class="w-8 h-8 inline-flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-text-muted hover:text-text transition-colors"
					aria-label="Close thought modal"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="p-5">
				<div class="max-h-[65vh] overflow-y-auto pr-1 text-text leading-relaxed whitespace-pre-wrap">
					{activeThought.content}
				</div>
			</div>
		</div>
	</div>
{/if}
