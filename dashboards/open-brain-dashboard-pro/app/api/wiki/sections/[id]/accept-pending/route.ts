import { NextRequest, NextResponse } from "next/server";
import { acceptWikiPending, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// POST /api/wiki/sections/:id/accept-pending — promote a parked machine draft to
// the live body. Proxies to POST /wiki/sections/:id/accept-pending.
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
    const result = await acceptWikiPending(apiKey, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/section:accept] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/section:accept]", err);
    return NextResponse.json({ error: "Failed to accept draft" }, { status: 500 });
  }
}
