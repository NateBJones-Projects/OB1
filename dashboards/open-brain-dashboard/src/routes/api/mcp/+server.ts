import { json } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

type McpJsonRpcResponse = {
	result?: unknown;
	error?: { message?: string };
};

function parseMcpResponse(body: string): McpJsonRpcResponse {
	const trimmed = body.trim();
	if (!trimmed) return {};

	if (trimmed.startsWith('{')) {
		return JSON.parse(trimmed) as McpJsonRpcResponse;
	}

	const dataLines = trimmed
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trim())
		.filter((line) => line && line !== '[DONE]');

	for (let i = dataLines.length - 1; i >= 0; i--) {
		try {
			return JSON.parse(dataLines[i]) as McpJsonRpcResponse;
		} catch {
			continue;
		}
	}

	throw new Error('Unable to parse MCP response');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const payload = await request.json();
		const { name, args } = payload as { name?: string; args?: Record<string, unknown> };

		if (!name) {
			return json({ error: 'Missing tool name' }, { status: 400 });
		}

		const mcpUrl = privateEnv.MCP_URL || publicEnv.PUBLIC_MCP_URL;
		const mcpKey = privateEnv.MCP_KEY || publicEnv.PUBLIC_MCP_KEY;

		if (!mcpUrl || !mcpKey) {
			return json(
				{ error: 'Missing MCP_URL/MCP_KEY (or PUBLIC_MCP_URL/PUBLIC_MCP_KEY) in your environment config' },
				{ status: 500 },
			);
		}

		const upstream = await fetch(`${mcpUrl}?key=${mcpKey}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: Date.now(),
				method: 'tools/call',
				params: {
					name,
					arguments: args || {}
				}
			})
		});

		if (!upstream.ok) {
			const text = await upstream.text().catch(() => '');
			return json({ error: `MCP upstream HTTP ${upstream.status}`, details: text }, { status: 502 });
		}

		const parsed = parseMcpResponse(await upstream.text());
		if (parsed.error) {
			return json({ error: parsed.error.message || 'MCP error' }, { status: 502 });
		}

		return json({ result: parsed.result ?? null });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown proxy error';
		return json({ error: message }, { status: 500 });
	}
};
