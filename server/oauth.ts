// OAuth 2.1 authorization for the Open Brain MCP server.
//
// Single-user, stateless. One shared secret (OAUTH_PASSWORD) gates issuance of
// short-lived bearer JWTs. No DB tables — codes/tokens are self-contained JWTs
// signed with OAUTH_JWT_SECRET. Rotating that secret is the panic button.
//
// Additive: legacy x-brain-key / ?key= auth paths remain intact in index.ts.

import type { Context, Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";

const OAUTH_PASSWORD = Deno.env.get("OAUTH_PASSWORD") ?? Deno.env.get("MCP_ACCESS_KEY") ?? "";
const OAUTH_JWT_SECRET = Deno.env.get("OAUTH_JWT_SECRET") ?? "";

const ACCESS_TTL = 60 * 60;              // 1 hour
const REFRESH_TTL = 60 * 60 * 24 * 30;   // 30 days
const CODE_TTL = 60 * 5;                 // 5 min

const ISSUER = "open-brain-mcp";
const SUBJECT = "owner";

type TokenType = "code" | "access" | "refresh";

function jwtKey(): Uint8Array {
  return new TextEncoder().encode(OAUTH_JWT_SECRET);
}

function oauthReady(): boolean {
  return OAUTH_PASSWORD.length > 0 && OAUTH_JWT_SECRET.length > 0;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function sha256b64url(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sign(claims: Record<string, unknown>, typ: TokenType, ttl: number): Promise<string> {
  return await new SignJWT({ ...claims, typ })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(jwtKey());
}

async function verify(token: string, typ: TokenType): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(), { issuer: ISSUER, subject: SUBJECT });
    if (payload.typ !== typ) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Verify a Bearer token from an Authorization header. Returns true if valid.
export async function verifyBearer(header: string | undefined): Promise<boolean> {
  if (!header) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  if (!OAUTH_JWT_SECRET) return false;
  return (await verify(m[1], "access")) !== null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loginPage(params: Record<string, string>, error?: string): string {
  const hidden = Object.entries(params)
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
  <form method="post" action="">
    ${hidden}
    <input type="password" name="password" autofocus required placeholder="Password">
    <button type="submit">Authorize</button>
  </form>
</body></html>`;
}

function corsJson(c: Context, body: unknown, status: number, corsHeaders: Record<string, string>) {
  return c.json(body as Record<string, unknown>, status as 200, corsHeaders);
}

type CorsHeaders = Record<string, string>;

export function registerOAuthRoutes(app: Hono, corsHeaders: CorsHeaders): void {
  // RFC 8414 — authorization server metadata.
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const base = new URL(c.req.url);
    base.pathname = base.pathname.replace(/\/\.well-known\/oauth-authorization-server$/, "");
    const root = base.origin + base.pathname.replace(/\/$/, "");
    return c.json(
      {
        issuer: ISSUER,
        authorization_endpoint: `${root}/authorize`,
        token_endpoint: `${root}/token`,
        registration_endpoint: `${root}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
      200,
      corsHeaders,
    );
  });

  // RFC 7591 — dynamic client registration. Stateless: any client may register.
  app.post("/register", async (c) => {
    if (!oauthReady()) return corsJson(c, { error: "oauth_not_configured" }, 501, corsHeaders);
    const body = await c.req.json().catch(() => ({}));
    const clientId = crypto.randomUUID();
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
        redirect_uris: body.redirect_uris ?? [],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
      corsHeaders,
    );
  });

  // Render the password form.
  app.get("/authorize", (c) => {
    if (!oauthReady()) return c.text("OAuth not configured on this server.", 501, corsHeaders);
    const q = c.req.query();
    const required = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"];
    for (const k of required) {
      if (!q[k]) return c.text(`Missing query parameter: ${k}`, 400, corsHeaders);
    }
    if (q.response_type && q.response_type !== "code") {
      return c.text("Only response_type=code is supported", 400, corsHeaders);
    }
    if (q.code_challenge_method !== "S256") {
      return c.text("Only code_challenge_method=S256 is supported", 400, corsHeaders);
    }
    return c.html(loginPage(q));
  });

  // Verify password, issue code.
  app.post("/authorize", async (c) => {
    if (!oauthReady()) return c.text("OAuth not configured on this server.", 501, corsHeaders);
    const form = await c.req.parseBody();
    const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
    const password = asStr(form.password);
    const params = {
      client_id: asStr(form.client_id),
      redirect_uri: asStr(form.redirect_uri),
      code_challenge: asStr(form.code_challenge),
      code_challenge_method: asStr(form.code_challenge_method),
      state: asStr(form.state),
    };

    for (const [k, v] of Object.entries(params)) {
      if (!v) return c.text(`Missing parameter: ${k}`, 400, corsHeaders);
    }

    if (!timingSafeEqual(password, OAUTH_PASSWORD)) {
      return c.html(loginPage(params, "Incorrect password."), 401);
    }

    const code = await sign(
      {
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
      },
      "code",
      CODE_TTL,
    );

    const redirect = new URL(params.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", params.state);
    return c.redirect(redirect.toString(), 302);
  });

  // Token endpoint — authorization_code + refresh_token grants.
  app.post("/token", async (c) => {
    if (!oauthReady()) return corsJson(c, { error: "oauth_not_configured" }, 501, corsHeaders);
    const form = await c.req.parseBody();
    const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
    const grantType = asStr(form.grant_type);

    if (grantType === "authorization_code") {
      const code = asStr(form.code);
      const clientId = asStr(form.client_id);
      const codeVerifier = asStr(form.code_verifier);
      const redirectUri = asStr(form.redirect_uri);

      if (!code || !clientId || !codeVerifier || !redirectUri) {
        return corsJson(c, { error: "invalid_request" }, 400, corsHeaders);
      }

      const payload = await verify(code, "code");
      if (!payload) return corsJson(c, { error: "invalid_grant" }, 400, corsHeaders);
      if (payload.client_id !== clientId) return corsJson(c, { error: "invalid_grant" }, 400, corsHeaders);
      if (payload.redirect_uri !== redirectUri) return corsJson(c, { error: "invalid_grant" }, 400, corsHeaders);

      const expected = await sha256b64url(codeVerifier);
      if (expected !== payload.code_challenge) {
        return corsJson(c, { error: "invalid_grant" }, 400, corsHeaders);
      }

      const access = await sign({ aud: clientId }, "access", ACCESS_TTL);
      const refresh = await sign({ aud: clientId }, "refresh", REFRESH_TTL);
      return corsJson(
        c,
        { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh },
        200,
        corsHeaders,
      );
    }

    if (grantType === "refresh_token") {
      const refresh = asStr(form.refresh_token);
      if (!refresh) return corsJson(c, { error: "invalid_request" }, 400, corsHeaders);
      const payload = await verify(refresh, "refresh");
      if (!payload) return corsJson(c, { error: "invalid_grant" }, 400, corsHeaders);
      const aud = typeof payload.aud === "string" ? payload.aud : "";
      const access = await sign({ aud }, "access", ACCESS_TTL);
      return corsJson(
        c,
        { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL },
        200,
        corsHeaders,
      );
    }

    return corsJson(c, { error: "unsupported_grant_type" }, 400, corsHeaders);
  });
}
