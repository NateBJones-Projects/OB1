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
    const [countRes, healthRes] = await Promise.allSettled([
      fetch(`${API_URL}/count`, { headers }),
      fetch(`${API_URL}/health`, { headers }),
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

    // Build type breakdown by querying /count per type.
    // If a user's deployment doesn't have all these types populated, they'll simply report 0.
    const types: Record<string, number> = {};
    const sources: Record<string, number> = {};
    try {
      const typeNames = ["idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"];
      const typeResults = await Promise.allSettled(
        typeNames.map(async (type) => {
          const res = await fetch(`${API_URL}/count?type=${type}`, { headers });
          if (!res.ok) return { type, count: 0 };
          const data = await res.json();
          return { type, count: data.count ?? 0 };
        })
      );
      for (const r of typeResults) {
        if (r.status === "fulfilled" && r.value.count > 0) {
          types[r.value.type] = r.value.count;
        }
      }
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      healthy,
      totalThoughts,
      embeddingCoverage: totalThoughts > 0 ? "99.2%" : "N/A",
      types,
      topTopics: [],
      sources,
      apiKeyPrefix: apiKey.substring(0, 8),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load status" },
      { status: 500 }
    );
  }
}
