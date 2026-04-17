// Cloudflare Worker — OAuth origin proxy for Supabase-hosted MCP servers.
//
// Why this exists: the MCP TypeScript SDK (Claude Desktop, mcp-remote, and
// others) strips the URL path when composing OAuth discovery and endpoint
// URLs. Supabase Edge Functions mount under /functions/v1/<name>/, so the
// SDK can't reach the OAuth endpoints directly. This Worker gives each MCP
// function a path-less origin — the SDK has no path to strip, and OAuth
// resolves cleanly.
//
// Pure path-rewriter: every request is forwarded to
//   `${UPSTREAM_BASE}/functions/v1/${FUNCTION_NAME}${incoming-path}`
// Response is returned verbatim. No auth, no caching, no transforms.

export interface Env {
  UPSTREAM_BASE: string;    // e.g. "https://<ref>.supabase.co"
  FUNCTION_NAME: string;    // e.g. "open-brain-mcp" or "life-crm-mcp"
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);
    const target = new URL(
      `${env.UPSTREAM_BASE.replace(/\/$/, "")}` +
        `/functions/v1/${env.FUNCTION_NAME}${incoming.pathname}`,
    );
    target.search = incoming.search;

    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      // Critical: without manual redirect handling, fetch() auto-follows the
      // 302 that /authorize issues, and the OAuth callback to the MCP client
      // is lost.
      redirect: "manual",
    };

    return fetch(target.toString(), init);
  },
};
