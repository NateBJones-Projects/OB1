// Cloudflare Worker — OAuth origin proxy for Supabase-hosted MCP servers.
//
// Why this exists: the MCP TypeScript SDK (Claude Desktop, mcp-remote, and
// others) strips the URL path when composing OAuth discovery and endpoint
// URLs. Supabase Edge Functions mount under /functions/v1/<name>/, so the
// SDK can't reach the OAuth endpoints directly. This Worker gives each MCP
// function a path-less origin — the SDK has no path to strip, and OAuth
// resolves cleanly.
//
// Mostly a path-rewriter: forward every request to
//   `${UPSTREAM_BASE}/functions/v1/${FUNCTION_NAME}${incoming-path}`
// and return the response verbatim.
//
// One exception: GET /authorize. Supabase Edge Functions force
// `content-type: text/plain` + `content-security-policy: default-src 'none';
// sandbox` on any HTML response (a platform-level security policy we can't
// override from inside the function). That breaks the OAuth login form. So
// the Worker serves the form itself for GET /authorize; everything else
// (POST /authorize password verification, /token, /register, /.well-known,
// MCP calls) still proxies through to Supabase.

export interface Env {
  UPSTREAM_BASE: string;    // e.g. "https://<ref>.supabase.co"
  FUNCTION_NAME: string;    // e.g. "open-brain-mcp" or "life-crm-mcp"
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    if (request.method === "GET" && incoming.pathname === "/authorize") {
      return renderAuthorizeForm(incoming.searchParams);
    }

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

const REQUIRED_PARAMS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
] as const;

function renderAuthorizeForm(q: URLSearchParams): Response {
  for (const k of REQUIRED_PARAMS) {
    if (!q.get(k)) return plain(`Missing query parameter: ${k}`, 400);
  }
  if (q.get("response_type") && q.get("response_type") !== "code") {
    return plain("Only response_type=code is supported", 400);
  }
  if (q.get("code_challenge_method") !== "S256") {
    return plain("Only code_challenge_method=S256 is supported", 400);
  }

  const params = Object.fromEntries(q.entries());
  const error = q.get("error") === "invalid_password" ? "Incorrect password." : "";

  return new Response(loginPage(params, error), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      // No form-action directive. CSP Level 3 doesn't fall form-action back
      // to default-src, so omitting it leaves form submission unrestricted.
      // The OAuth form must submit to /authorize on this origin AND follow a
      // redirect to an arbitrary redirect_uri (the MCP client's callback URL,
      // which can be localhost or any HTTPS host) — restricting form-action
      // reliably enough to permit both has been fragile; the password itself
      // is the real security control here.
      "Content-Security-Policy":
        "default-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

function plain(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loginPage(params: Record<string, string>, error: string): string {
  const hidden = Object.entries(params)
    .filter(([k]) => k !== "password" && k !== "error")
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n        ");
  const errHtml = error ? `<p style="color:#b00">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Open Brain — Sign in</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:400px;margin:4rem auto;padding:0 1rem;color:#222}
  h1{font-size:1.4rem;margin-bottom:0.5rem}
  p.lede{color:#666;margin-top:0}
  form{display:flex;flex-direction:column;gap:0.75rem;margin-top:1.5rem}
  input[type=password]{padding:0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:4px}
  button{padding:0.6rem;font-size:1rem;background:#111;color:#fff;border:0;border-radius:4px;cursor:pointer}
  button:hover{background:#333}
</style></head>
<body>
  <h1>Open Brain</h1>
  <p class="lede">Enter your password to authorize this client.</p>
  ${errHtml}
  <form method="post" action="/authorize">
    ${hidden}
    <input type="password" name="password" autofocus required placeholder="Password">
    <button type="submit">Authorize</button>
  </form>
</body></html>`;
}
