import { NextRequest, NextResponse } from "next/server";
import {
  fetchIngestionJobs,
  triggerIngest,
  captureThought,
} from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// ── Auto-routing heuristic ──────────────────────────────────────────────────

/**
 * Determines whether input text should be routed to smart-ingest extraction
 * (multiple thoughts) rather than single-thought capture.
 *
 * Heuristic rules (any match → extract):
 *  1. Long text (> 500 chars)
 *  2. Multiple paragraphs (2+)
 *  3. Bullet or numbered lists (2+ items)
 *  4. Transcript/speaker markers (2+ lines like "Alan: ...")
 *  5. Timestamp patterns (e.g. "10:32 AM")
 *  6. Email-style headers (From:, Subject:, Date:, To:)
 */
function shouldExtract(text: string): boolean {
  if (text.length > 500) return true;

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length >= 2) return true;

  const lines = text.split("\n");
  const bulletLines = lines.filter((l) =>
    /^\s*[-*\u2022]\s|^\s*\d+[.)]\s/.test(l)
  );
  if (bulletLines.length >= 2) return true;

  const speakerLines = lines.filter((l) => /^\s*\w+:\s/.test(l));
  if (speakerLines.length >= 2) return true;

  if (/\d{1,2}:\d{2}\s*(AM|PM)?/i.test(text)) return true;

  if (/^(From|Subject|Date|To):\s/m.test(text)) return true;

  return false;
}

// ── GET — list ingestion jobs ───────────────────────────────────────────────

export async function GET() {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    const jobs = await fetchIngestionJobs(apiKey);
    return NextResponse.json(jobs);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

// ── POST — unified Add to Brain ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    const body = await request.json();
    const { text, mode = "auto", dry_run } = body as {
      text: string;
      mode?: "auto" | "single" | "extract";
      dry_run?: boolean;
    };

    if (!text?.trim()) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    const trimmed = text.trim();
    const resolvedMode =
      mode === "auto"
        ? shouldExtract(trimmed)
          ? "extract"
          : "single"
        : mode;

    if (resolvedMode === "single") {
      const result = await captureThought(apiKey, trimmed);
      return NextResponse.json({
        path: "single" as const,
        thought_id: result.thought_id,
        type: result.type,
        message: "Saved as 1 thought",
      });
    }

    // extract path → smart-ingest
    const result = await triggerIngest(apiKey, trimmed, { dry_run });
    const extracted =
      (result as Record<string, unknown>).extracted_count ?? null;
    const isDryRun = result.status === "dry_run_complete";
    return NextResponse.json({
      path: "extract" as const,
      job_id: result.job_id,
      status: result.status,
      extracted_count: extracted,
      message: isDryRun
        ? `Extracted ${extracted ?? "?"} candidate thoughts (dry run)`
        : `Extracted thoughts from your input`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
