import { NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import type { IngestionItem, IngestionItemMeta } from "@/lib/types";

/** Normalize a raw DB ingestion_item row into the web API contract. */
function normalizeItem(raw: Record<string, unknown>): IngestionItem {
  const meta = (raw.metadata ?? {}) as Record<string, unknown>;
  const parsedMeta: IngestionItemMeta = {
    type: typeof meta.type === "string" ? meta.type : undefined,
    importance: typeof meta.importance === "number" ? meta.importance : undefined,
    tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string") : undefined,
    source_snippet: typeof meta.source_snippet === "string" ? meta.source_snippet : undefined,
  };

  return {
    id: raw.id as string,
    job_id: raw.job_id as string,
    content: (raw.extracted_content ?? raw.content ?? "") as string,
    action: (raw.action ?? "skip") as string,
    reason: (raw.reason as string) ?? null,
    status: (raw.status ?? "pending") as string,
    matched_thought_id: (raw.matched_thought_id as string) ?? null,
    similarity_score: raw.similarity_score != null ? Number(raw.similarity_score) : null,
    result_thought_id: (raw.result_thought_id as string) ?? null,
    meta: parsedMeta,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const { id } = await params;

  // WR-04: Validate id is a UUID before forwarding. OB1 ingestion job ids are
  // UUIDs, not integers — the old positive-integer check rejected them.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  if (!API_URL) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_API_URL not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${API_URL}/ingestion-jobs/${id}`, {
      headers: { "x-brain-key": apiKey, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      // WR-05: Log detail server-side, return generic to client
      console.error("[ingest/[id]] upstream error", res.status, data);
      return NextResponse.json(
        { error: "Upstream error" },
        { status: res.status }
      );
    }

    // Normalize items from raw DB shape to web contract
    const items = Array.isArray(data.items)
      ? data.items.map((raw: Record<string, unknown>) => normalizeItem(raw))
      : [];

    return NextResponse.json({ job: data.job, items });
  } catch (err) {
    // WR-05: Log detail server-side, return generic to client
    console.error("[ingest/[id]]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
