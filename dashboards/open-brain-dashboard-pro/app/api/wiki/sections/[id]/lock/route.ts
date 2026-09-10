import { NextRequest, NextResponse } from "next/server";
import { setWikiSectionLock, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// POST /api/wiki/sections/:id/lock — lock or unlock a section. A locked section
// only ever receives pending drafts from machine writers. Proxies to
// POST /wiki/sections/:id/lock with { locked }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth BEFORE body parse — unauthed requests get 401, not 400 (house rule).
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
    const body = (await request.json()) as { locked?: unknown };
    if (typeof body.locked !== "boolean") {
      return NextResponse.json({ error: "locked must be a boolean" }, { status: 400 });
    }

    const result = await setWikiSectionLock(apiKey, id, body.locked);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/section:lock] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/section:lock]", err);
    return NextResponse.json({ error: "Failed to update lock" }, { status: 500 });
  }
}
