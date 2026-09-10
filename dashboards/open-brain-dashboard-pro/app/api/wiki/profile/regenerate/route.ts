import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

// POST /api/wiki/profile/regenerate — trigger the wiki-profile consolidation
// worker (integrations/consolidation-workers/wiki-profile) to synthesize the
// "user-profile" wiki page. The worker bootstraps the page itself via
// wiki_upsert_page, so this one route serves both "create" and "regenerate".
//
// The worker is its own Edge Function, separate from the open-brain-rest
// gateway that lib/api.ts talks to, so this route resolves the worker URL
// itself instead of reusing apiFetch:
//   1. WIKI_PROFILE_URL wins when set. It is a plain server env — route
//      handlers run server-side, so no NEXT_PUBLIC_ prefix is needed (and a
//      restart, not a rebuild, picks up changes).
//   2. Otherwise derive from NEXT_PUBLIC_API_URL by swapping the Edge Function
//      name: …/functions/v1/open-brain-rest → …/functions/v1/wiki-profile.

/**
 * How long to wait for the worker. A full profile run makes up to 10 LLM
 * calls; the platform default fetch has no timeout and would pin this route
 * until the host kills it. 120s covers a normal run — the Edge Function's own
 * 150s wall clock is the true upper bound.
 */
const WORKER_TIMEOUT_MS = 120_000;

/**
 * Mirror lib/api.ts's WR-06 check: refuse to send the session's brain key to
 * a non-https host (localhost excepted for dev), so a misconfigured env var
 * cannot fan the key out to an attacker-controlled URL.
 */
function validateWorkerUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    ) {
      return null;
    }
    // fetch() rejects credentialed URLs outright (TypeError before any
    // network attempt), which would surface as a misleading generic 502.
    if (parsed.username || parsed.password) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function resolveWorkerUrl(): string | null {
  const override = process.env.WIKI_PROFILE_URL?.trim();
  if (override) return validateWorkerUrl(override);

  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  if (!base) return null;
  const derived = base.replace(/\/open-brain-rest\/?$/, "/wiki-profile");
  // If the base doesn't end in /open-brain-rest the swap is a no-op and we
  // cannot guess the worker URL — the operator must set WIKI_PROFILE_URL.
  if (derived === base) return null;
  return validateWorkerUrl(derived);
}

export async function POST(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const workerUrl = resolveWorkerUrl();
  if (!workerUrl) {
    console.error(
      "[wiki/profile:regenerate] cannot resolve worker URL — set WIKI_PROFILE_URL " +
        "(NEXT_PUBLIC_API_URL does not end in /open-brain-rest, or the URL is not https)"
    );
    return NextResponse.json(
      {
        error:
          "wiki-profile worker URL is not configured — set WIKI_PROFILE_URL to the worker's https URL.",
      },
      { status: 500 }
    );
  }

  // Optional {dry_run: true} body flag. The worker takes dry-run as a query
  // param, so translate body → query here; anything else in the body is ignored.
  const body = (await request.json().catch(() => ({}))) as { dry_run?: unknown };
  const target = body?.dry_run === true ? `${workerUrl}?dry_run=true` : workerUrl;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`wiki-profile worker timeout after ${WORKER_TIMEOUT_MS}ms`)),
    WORKER_TIMEOUT_MS
  );
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers: { "x-brain-key": apiKey, "Content-Type": "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    // With an abort reason, undici rejects with that Error; older runtimes
    // reject with a DOMException named AbortError. Catch both shapes.
    const isTimeout =
      (err instanceof Error && err.message.startsWith("wiki-profile worker timeout")) ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "AbortError");
    if (isTimeout) {
      console.error(`[wiki/profile:regenerate] worker timed out after ${WORKER_TIMEOUT_MS}ms`);
      return NextResponse.json(
        {
          error:
            "Profile generation timed out. The worker may still be finishing — refresh in a minute to see the result.",
        },
        { status: 504 }
      );
    }
    console.error("[wiki/profile:regenerate] fetch failed", err);
    return NextResponse.json(
      { error: "Could not reach the wiki-profile worker." },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // ApiError discipline: log the upstream body server-side for debugging,
    // return only a safe hand-written message to the browser.
    const upstreamBody = await res.text().catch(() => "");
    console.error("[wiki/profile:regenerate] upstream", res.status, upstreamBody);
    if (res.status === 404) {
      // The Supabase functions host answers 404 when the function isn't
      // deployed — the single most likely failure for a fresh install.
      return NextResponse.json(
        {
          error:
            "wiki-profile worker not deployed — deploy integrations/consolidation-workers/wiki-profile " +
            "(supabase functions deploy wiki-profile --no-verify-jwt), then try again.",
        },
        { status: 404 }
      );
    }
    if (res.status === 401) {
      return NextResponse.json(
        { error: "The worker rejected the brain key (MCP_ACCESS_KEY mismatch between functions)." },
        { status: 401 }
      );
    }
    if (res.status === 503) {
      return NextResponse.json(
        {
          error:
            "The worker is missing configuration (LLM API keys or MCP_ACCESS_KEY) — check its Supabase secrets.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: `Profile generation failed (upstream ${res.status}).` },
      { status: res.status }
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    console.error("[wiki/profile:regenerate] unreadable worker response", err);
    return NextResponse.json(
      { error: "The worker returned an unreadable response." },
      { status: 502 }
    );
  }

  // Pass the worker's JSON through unchanged — the client renders the
  // per-section outcomes (created / updated / pending / skipped / error).
  return NextResponse.json(payload);
}
