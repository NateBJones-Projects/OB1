import { NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

export async function GET() {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  if (!API_URL) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_API_URL not configured" },
      { status: 500 }
    );
  }
  const headers = { "x-brain-key": apiKey, "Content-Type": "application/json" };

  try {
    // Use /count endpoint (simple, reliable) with /health as a secondary liveness check
    const [countRes, healthRes, statsRes] = await Promise.allSettled([
      fetch(`${API_URL}/count`, { headers }),
      fetch(`${API_URL}/health`, { headers }),
      fetch(`${API_URL}/stats`, { headers }),
    ]);

    // Parse count
    let totalThoughts = 0;
    if (countRes.status === "fulfilled" && countRes.value.ok) {
      const data = await countRes.value.json();
      totalThoughts = data.count ?? data.total ?? 0;
    }

    // Parse health
    let healthy = false;
    if (healthRes.status === "fulfilled" && healthRes.value.ok) {
      const data = await healthRes.value.json();
      healthy = data.status === "ok";
    }
    // If health endpoint fails but count worked, we're still connected
    if (!healthy && totalThoughts > 0) healthy = true;

    // CR-01 / WR-01 / WR-02: pull real types + top_topics from /stats
    // instead of the previous hardcoded type list and empty placeholders.
    // If /stats doesn't return types we fall through to an empty map and
    // the UI renders "type distribution not available".
    const types: Record<string, number> = {};
    const topTopics: Array<{ topic: string; count: number }> = [];
    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      try {
        const statsData = await statsRes.value.json();
        if (statsData && typeof statsData.types === "object" && statsData.types) {
          for (const [k, v] of Object.entries(statsData.types)) {
            if (typeof v === "number" && v > 0) types[k] = v;
          }
        }
        if (Array.isArray(statsData?.top_topics)) {
          for (const entry of statsData.top_topics) {
            if (
              entry &&
              typeof entry.topic === "string" &&
              typeof entry.count === "number"
            ) {
              topTopics.push({ topic: entry.topic, count: entry.count });
            }
          }
        }
      } catch (err) {
        console.error("[settings/status] failed to parse /stats", err);
      }
    }

    return NextResponse.json({
      healthy,
      totalThoughts,
      // CR-01: embeddingCoverage removed — the previous "99.2%" was fabricated.
      // TODO: wire a real /embeddings/coverage endpoint on the REST gateway,
      // then restore this field with the computed value.
      types,
      topTopics,
      // WR-02: sources is not yet populated by /stats — keep as empty until
      // the REST gateway ships a source breakdown.
      sources: {},
      apiKeyPrefix: apiKey.substring(0, 8),
    });
  } catch (err) {
    // WR-05: Log detail server-side, return generic to client
    console.error("[settings/status]", err);
    return NextResponse.json(
      { error: "Failed to load status" },
      { status: 500 }
    );
  }
}
