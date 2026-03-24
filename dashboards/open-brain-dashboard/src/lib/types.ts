export type ThoughtType = 'observation' | 'task' | 'idea' | 'reference' | 'person_note';

export interface ThoughtMetadata {
	type: ThoughtType;
	topics: string[];
	people: string[];
	action_items: string[];
	dates_mentioned: string[];
	source?: string;
}

export interface Thought {
	id: string;
	content: string;
	embedding?: number[];
	metadata: ThoughtMetadata;
	created_at: string;
}

export const THOUGHT_TYPES: { value: ThoughtType; label: string; color: string }[] = [
	{ value: 'observation', label: 'Observation', color: 'observation' },
	{ value: 'task', label: 'Task', color: 'task' },
	{ value: 'idea', label: 'Idea', color: 'idea' },
	{ value: 'reference', label: 'Reference', color: 'reference' },
	{ value: 'person_note', label: 'Person Note', color: 'person-note' }
];
