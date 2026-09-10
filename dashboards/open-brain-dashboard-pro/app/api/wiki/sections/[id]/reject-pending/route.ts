import { NextRequest, NextResponse } from "next/server";
import { rejectWikiPending, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// POST /api/wiki/sections/:id/reject-pending — discard a parked machine draft,
// leaving the live body untouched. Proxies to POST /wiki/sections/:id/reject-pending.
export async function POST(
  _request: NextRequest,
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
  if (!id) {
    return NextResponse.json({ error: "Missing section id" }, { status: 400 });
  }

  try {
    const result = await rejectWikiPending(apiKey, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/section:reject] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/section:reject]", err);
    return NextResponse.json({ error: "Failed to reject draft" }, { status: 500 });
  }
}
