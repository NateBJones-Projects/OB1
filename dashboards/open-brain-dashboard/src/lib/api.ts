import type { Thought, ThoughtType } from './types';

interface McpToolResult {
	content: { type: string; text: string }[];
}

interface McpJsonRpcResponse {
	result?: McpToolResult;
	error?: { message?: string };
}

interface ApiThought {
	id: string;
	content: string;
	metadata: {
		type: ThoughtType;
		topics: string[];
		people: string[];
		action_items?: string[];
	};
	created_at: string;
}

async function callMcpTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
	const response = await fetch('/api/mcp', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			name,
			args
		})
	});
	
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error || `HTTP ${response.status}`);
	}

	const result = (await response.json()) as McpJsonRpcResponse;
	
	if (result.error) {
		throw new Error(result.error.message || 'MCP error');
	}

	if (!result.result) {
		throw new Error('Missing MCP result payload');
	}

	return result.result;
}

function parseThoughtsFromText(text: string): ApiThought[] {
	// Parse the formatted text response from list_thoughts
	const thoughts: ApiThought[] = [];
	const lines = text.split('\n');
	
	for (const line of lines) {
		// Format: "1. [Mar 15, 2026] (observation - topic1, topic2)\n   Content here"
		const match = line.match(/^(\d+)\.\s*\[([^\]]+)\]\s*\(([^)]+)\)\s*\n?\s*(.+)$/);
		if (match) {
			const [, , dateStr, metaStr, content] = match;
			const [type, topicsStr] = metaStr.split(' - ');
			
			thoughts.push({
				id: crypto.randomUUID(),
				content: content.trim(),
				metadata: {
					type: type.trim() as ThoughtType,
					topics: topicsStr ? topicsStr.split(', ').map(t => t.trim()) : [],
					people: [],
				},
				created_at: new Date(dateStr).toISOString(),
			});
		}
	}
	
	return thoughts;
}

function parseStatsFromText(text: string): {
	total: number;
	types: Record<string, number>;
	topics: Record<string, number>;
	people: Record<string, number>;
} {
	const lines = text.split('\n');
	const stats = {
		total: 0,
		types: {} as Record<string, number>,
		topics: {} as Record<string, number>,
		people: {} as Record<string, number>,
	};
	
	let section = '';
	for (const line of lines) {
		if (line.startsWith('Total thoughts:')) {
			stats.total = parseInt(line.match(/\d+/)?.[0] || '0');
		} else if (line === 'Types:') {
			section = 'types';
		} else if (line === 'Top topics:') {
			section = 'topics';
		} else if (line === 'People mentioned:') {
			section = 'people';
		} else if (/^\s{2}\S/.test(line)) {
			const match = line.trim().match(/^([^:]+):\s*(\d+)/);
			if (match) {
				const [, key, value] = match;
				if (section === 'types') stats.types[key] = parseInt(value);
				else if (section === 'topics') stats.topics[key] = parseInt(value);
				else if (section === 'people') stats.people[key] = parseInt(value);
			}
		}
	}
	
	return stats;
}

export async function getStats(): Promise<{
	total: number;
	types: Record<string, number>;
	topics: Record<string, number>;
	people: Record<string, number>;
}> {
	const result = await callMcpTool('thought_stats');
	const text = result.content[0]?.text || '';
	return parseStatsFromText(text);
}

export async function getThoughts(params: {
	limit?: number;
	type?: ThoughtType | null;
	topic?: string | null;
	person?: string | null;
	search?: string;
}): Promise<Thought[]> {
	// If searching, use search_thoughts, otherwise use list_thoughts
	if (params.search) {
		const result = await callMcpTool('search_thoughts', {
			query: params.search,
			limit: params.limit || 50,
		});
		// Parse search results - different format
		const text = result.content[0]?.text || '';
		return parseSearchResults(text);
	}
	
	const args: Record<string, unknown> = {
		limit: params.limit || 50,
	};
	if (params.type) args.type = params.type;
	if (params.topic) args.topic = params.topic;
	if (params.person) args.person = params.person;
	
	const result = await callMcpTool('list_thoughts', args);
	const text = result.content[0]?.text || '';
	return parseListResults(text);
}

function parseSearchResults(text: string): Thought[] {
	const thoughts: Thought[] = [];
	const blocks = text.match(/--- Result \d+[\s\S]*?(?=(\n\n--- Result \d+|\n\nSearch strategy:|$))/g) || [];

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		let content = '';
		let createdAt = '';
		let type: ThoughtType = 'observation';
		const topics: string[] = [];
		const people: string[] = [];
		const actionItems: string[] = [];
		let inContent = false;
		const contentLines: string[] = [];
		
		for (const line of lines) {
			if (line.startsWith('--- Result ')) {
				continue;
			} else if (line.startsWith('Captured:')) {
				createdAt = line.replace('Captured:', '').trim();
			} else if (line.startsWith('Type:')) {
				type = line.replace('Type:', '').trim() as ThoughtType;
			} else if (line.startsWith('Topics:')) {
				topics.push(...line.replace('Topics:', '').trim().split(', '));
			} else if (line.startsWith('People:')) {
				people.push(...line.replace('People:', '').trim().split(', '));
			} else if (line.startsWith('Actions:')) {
				actionItems.push(...line.replace('Actions:', '').trim().split('; ').filter(Boolean));
			} else if (line.trim() === '') {
				if (!inContent) inContent = true;
				else contentLines.push('');
			} else if (inContent) {
				contentLines.push(line.trimStart());
			}
		}

		content = contentLines.join('\n').trim();
		
		if (content) {
			thoughts.push({
				id: crypto.randomUUID(),
				content,
				metadata: { type, topics, people, action_items: actionItems, dates_mentioned: [] },
				created_at: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
			});
		}
	}
	
	return thoughts;
}

function parseListResults(text: string): Thought[] {
	const thoughts: Thought[] = [];

	if (text.includes('No thoughts found.')) {
		return thoughts;
	}

	const normalized = text.replace(/^\d+\s+recent thought\(s\):\s*/i, '').trim();
	const chunks = normalized.split(/\n\n(?=\d+\.\s*\[)/);

	for (const chunk of chunks) {
		const lines = chunk.split('\n');
		const header = lines.shift()?.trim() || '';
		const content = lines.join('\n').trim();
		const match = header.match(/^\d+\.\s*\[([^\]]+)\]\s*\(([^)]+)\)$/);
		if (!match || !content) continue;

		const [, dateStr, metaStr] = match;
		const [type, ...topicParts] = metaStr.split(' - ');

		thoughts.push({
			id: crypto.randomUUID(),
			content,
			metadata: {
				type: type.trim() as ThoughtType,
				topics: topicParts.join(' - ').split(', ').map(t => t.trim()).filter(Boolean),
				people: [],
				action_items: [],
				dates_mentioned: [],
			},
			created_at: new Date(dateStr).toISOString(),
		});
	}
	
	return thoughts;
}

export async function captureThought(content: string): Promise<Thought> {
	const result = await callMcpTool('capture_thought', { content });
	const text = result.content[0]?.text || '';
	
	// Response: "Captured as observation — topic1, topic2"
	const match = text.match(/Captured as (\w+)/);
	
	return {
		id: crypto.randomUUID(),
		content,
		metadata: {
			type: (match?.[1] || 'observation') as ThoughtType,
			topics: [],
			people: [],
			action_items: [],
			dates_mentioned: [],
		},
		created_at: new Date().toISOString(),
	};
}
