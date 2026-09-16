import { NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

export async function POST(
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

  // WR-04 / BL-03: Validate id is a positive integer before forwarding
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
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
    // BL-03: Re-verify the session owns this job by fetching it first.
    // The REST gateway filters by the session's x-brain-key, so a 404/403 here
    // indicates the job is not visible to the caller.
    const verifyRes = await fetch(`${API_URL}/ingestion-jobs/${idNum}`, {
      headers: { "x-brain-key": apiKey, "Content-Type": "application/json" },
    });
    if (!verifyRes.ok) {
      // REVIEW-CODEX-3 P2#2: Differentiate transient upstream 5xx from
      // authorization 4xx so the client can show a retry affordance instead
      // of a misleading "denied" message.
      if (verifyRes.status >= 500) {
        console.error(
          `[ingest/[id]/execute] preflight upstream 5xx for job ${idNum}:`,
          verifyRes.status
        );
        return NextResponse.json(
          { error: "Upstream API temporarily unavailable", retryable: true },
          { status: 503 }
        );
      }
      console.error(
        "[ingest/[id]/execute] ownership check failed",
        verifyRes.status
      );
      // 4xx (403/404) — treat as "not yours" without leaking upstream detail
      return NextResponse.json(
        { error: "Job not found or not accessible" },
        { status: verifyRes.status === 404 ? 404 : 403 }
      );
    }

    const res = await fetch(`${API_URL}/ingestion-jobs/${idNum}/execute`, {
      method: "POST",
      headers: { "x-brain-key": apiKey, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      // WR-05: Log detail server-side, return generic to client
      console.error("[ingest/[id]/execute] upstream error", res.status, data);
      return NextResponse.json(
        { error: "Upstream error" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    // REVIEW-CODEX-3 P2#2: Network/fetch throw is transient — signal retryable
    // rather than a blanket 500 "Failed".
    console.error("[ingest/[id]/execute]", err);
    return NextResponse.json(
      { error: "Upstream API temporarily unavailable", retryable: true },
      { status: 503 }
    );
  }
}
