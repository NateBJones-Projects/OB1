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
      console.error(
        "[ingest/[id]/execute] ownership check failed",
        verifyRes.status
      );
      // Any non-2xx is treated as "not yours" — don't leak upstream detail
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
    // WR-05: Log detail server-side, return generic to client
    console.error("[ingest/[id]/execute]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
