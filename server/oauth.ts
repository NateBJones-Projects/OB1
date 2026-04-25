// OAuth 2.1 authorization for the Open Brain MCP server.
//
// Single-user, stateless. One shared secret (OAUTH_PASSWORD) gates issuance of
// short-lived bearer JWTs. No DB tables — codes/tokens are self-contained JWTs
// signed with OAUTH_JWT_SECRET. Rotating that secret is the panic button.
//
// Additive: legacy x-brain-key / ?key= auth paths remain intact in index.ts.

import type { Context, Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";

function getPassword(): string {
  return Deno.env.get("OAUTH_PASSWORD") ?? Deno.env.get("MCP_ACCESS_KEY") ?? "";
}
function getJwtSecret(): string {
  return Deno.env.get("OAUTH_JWT_SECRET") ?? "";
}

const ACCESS_TTL = 60 * 60;              // 1 hour
const REFRESH_TTL = 60 * 60 * 24 * 30;   // 30 days
const CODE_TTL = 60 * 5;                 // 5 min

const ISSUER = "open-brain-mcp";
const SUBJECT = "owner";

type TokenType = "code" | "access" | "refresh";

function jwtKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

function oauthReady(): boolean {
  return getPassword().length > 0 && getJwtSecret().length > 0;
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
  if (!getJwtSecret()) return false;
  return (await verify(m[1], "access")) !== null;
}

function corsJson(c: Context, body: unknown, status: number, corsHeaders: Record<string, string>) {
  return c.json(body as Record<string, unknown>, status as 200, corsHeaders);
}

type CorsHeaders = Record<string, string>;

// Supabase Edge Functions mount at `/functions/v1/<name>/...`, so Hono sees
// that full prefix. We match on path suffix instead of absolute routes so the
// same module works for any function name without configuration.

// Derive the client-facing URL root for this Edge Function.
// Supabase sees URLs like `http://<ref>.supabase.co/<function-name>/...`
// (scheme downgraded, /functions/v1/ stripped). We rebuild the public URL
// that clients actually used to reach us.
function publicRoot(c: Context): string {
  //   1. OAUTH_ISSUER_URL_<FUNCTION_NAME> — per-function override. Needed when
  //      an extension or recipe behind its own proxy shares a Supabase project
  //      with the core server (Supabase secrets are project-wide).
  //   2. OAUTH_ISSUER_URL — default for the core server.
  //   3. SUPABASE_URL + /functions/v1/<function-name> — bare Supabase URL.
  //   4. X-Forwarded-* headers — self-hosting fallback.

  // First path segment of the internal URL is the function name.
  const functionName = new URL(c.req.url).pathname.split("/").filter(Boolean)[0] ?? "";

  if (functionName) {
    const perFnKey = `OAUTH_ISSUER_URL_${functionName.toUpperCase().replace(/-/g, "_")}`;
    const perFn = Deno.env.get(perFnKey);
    if (perFn) return perFn.replace(/\/$/, "");
  }

  const override = Deno.env.get("OAUTH_ISSUER_URL");
  if (override) return override.replace(/\/$/, "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl && functionName) {
    return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`;
  }

  const proto = c.req.header("x-forwarded-proto") ?? "https";
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  return `${proto}://${host}/functions/v1/${functionName}`;
}

async function handleDiscovery(c: Context, corsHeaders: CorsHeaders) {
  const root = publicRoot(c);
  return c.json(
    {
      issuer: root,
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
}

// RFC 9728 — OAuth 2.0 Protected Resource Metadata. MCP clients use this to
// discover which authorization server guards this MCP endpoint. Triggered by
// the WWW-Authenticate challenge on 401 (see buildWwwAuthenticate).
async function handleProtectedResource(c: Context, corsHeaders: CorsHeaders) {
  const root = publicRoot(c);
  return c.json(
    {
      resource: root,
      authorization_servers: [root],
      bearer_methods_supported: ["header"],
      scopes_supported: [],
    },
    200,
    corsHeaders,
  );
}

// Build a WWW-Authenticate: Bearer challenge header pointing at the
// protected-resource metadata URL, per RFC 9728 §5.2.
export function buildWwwAuthenticate(c: Context): string {
  const root = publicRoot(c);
  return `Bearer realm="${root}", resource_metadata="${root}/.well-known/oauth-protected-resource"`;
}

async function handleRegister(c: Context, corsHeaders: CorsHeaders) {
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
}

// Supabase Edge Functions force `content-type: text/plain` and a
// sandbox CSP on all HTML responses (platform-level, not overridable),
// which breaks the OAuth login form. The Cloudflare Worker proxy
// serves GET /authorize itself from its own origin, so this handler
// is only hit if someone bypasses the Worker and talks to the Supabase
// URL directly. We return plain text pointing them at the Worker.
async function handleAuthorizeGet(c: Context, corsHeaders: CorsHeaders) {
  return c.text(
    "OAuth login forms cannot be rendered directly from this Edge Function.\n" +
      "Route /authorize through the Cloudflare Worker proxy — see\n" +
      "integrations/cloudflare-oauth-proxy/README.md for setup.",
    501,
    corsHeaders,
  );
}

async function handleAuthorizePost(c: Context, corsHeaders: CorsHeaders) {
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

  if (!timingSafeEqual(password, getPassword())) {
    // Redirect back to GET /authorize?error=invalid_password&<original-params>.
    // The Worker re-renders the login form with the error message. We use a
    // relative path so the redirect resolves to the Worker origin that made
    // the POST (not the Supabase origin the Edge Function lives on).
    console.warn("[oauth] /authorize wrong password", { client_id: params.client_id });
    const qs = new URLSearchParams({ ...params, error: "invalid_password" });
    return c.redirect(`/authorize?${qs.toString()}`, 302);
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
}

async function handleToken(c: Context, corsHeaders: CorsHeaders) {
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
}

export function registerOAuthRoutes(app: Hono, corsHeaders: CorsHeaders): void {
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;

    if (method === "GET" && path.endsWith("/.well-known/oauth-authorization-server")) {
      return await handleDiscovery(c, corsHeaders);
    }
    if (method === "GET" && path.endsWith("/.well-known/oauth-protected-resource")) {
      return await handleProtectedResource(c, corsHeaders);
    }
    if (method === "POST" && path.endsWith("/register")) {
      return await handleRegister(c, corsHeaders);
    }
    if (path.endsWith("/authorize")) {
      if (method === "GET") return await handleAuthorizeGet(c, corsHeaders);
      if (method === "POST") return await handleAuthorizePost(c, corsHeaders);
    }
    if (method === "POST" && path.endsWith("/token")) {
      return await handleToken(c, corsHeaders);
    }

    await next();
  });
}
