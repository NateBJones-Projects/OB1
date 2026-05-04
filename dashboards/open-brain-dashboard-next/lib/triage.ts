import "server-only";

import type { PendingThought } from "./types";

type RestEnv = {
  baseUrl: string;
  serviceKey: string;
};

type PromoteResult = {
  thought_id: string;
  pending_id: string;
};

function getRestEnv(): RestEnv {
  const projectUrl = process.env.OPEN_BRAIN_URL || process.env.SUPABASE_URL;
  const serviceKey =
    process.env.OPEN_BRAIN_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!projectUrl || !serviceKey) {
    throw new Error(
      "OPEN_BRAIN_URL/SUPABASE_URL and OPEN_BRAIN_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY are required for triage.",
    );
  }

  return {
    baseUrl: `${projectUrl.replace(/\/+$/, "")}/rest/v1`,
    serviceKey,
  };
}

function headers(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function restFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const env = getRestEnv();
  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers: { ...headers(env.serviceKey), ...(init?.headers || {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open Brain REST ${res.status}: ${text || res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function listPendingThoughts(limit = 50): Promise<PendingThought[]> {
  const sp = new URLSearchParams();
  sp.set(
    "select",
    "id,content,candidate_metadata,confidence,surrounding_context,source_ref,created_at",
  );
  sp.set("resolved_at", "is.null");
  sp.set("order", "created_at.desc");
  sp.set("limit", String(limit));

  return restFetch<PendingThought[]>(`/thoughts_pending?${sp.toString()}`);
}

export async function promotePendingThought(id: string): Promise<PromoteResult> {
  const sp = new URLSearchParams();
  sp.set(
    "select",
    "id,content,embedding,candidate_metadata,confidence,surrounding_context,source_ref,created_at",
  );
  sp.set("id", `eq.${id}`);
  sp.set("resolved_at", "is.null");
  sp.set("limit", "1");

  const rows = await restFetch<
    Array<PendingThought & { embedding?: unknown }>
  >(`/thoughts_pending?${sp.toString()}`);
  const pending = rows[0];
  if (!pending) {
    throw new Error("Pending thought not found or already resolved.");
  }

  const metadata = {
    ...(pending.candidate_metadata || {}),
    needs_review: false,
    promoted_from_pending_id: pending.id,
    pending_confidence: pending.confidence,
    source_ref:
      pending.source_ref ||
      (pending.candidate_metadata?.source_ref as string | undefined) ||
      null,
  };

  const inserted = await restFetch<Array<{ id: string }>>("/thoughts", {
    method: "POST",
    body: JSON.stringify({
      content: pending.content,
      embedding: pending.embedding,
      metadata,
    }),
  });

  const thoughtId = inserted[0]?.id;
  if (!thoughtId) throw new Error("Promote insert did not return a thought id.");

  await restFetch(`/thoughts_pending?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved_at: new Date().toISOString() }),
  });

  return { thought_id: thoughtId, pending_id: id };
}
