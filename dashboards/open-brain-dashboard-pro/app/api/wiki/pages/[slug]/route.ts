import { NextRequest, NextResponse } from "next/server";
import { archiveWikiPage, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// DELETE /api/wiki/pages/:slug — archive a page (soft delete).
// Proxies to DELETE /wiki/pages/:slug, which sets status='archived'.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  try {
    const result = await archiveWikiPage(apiKey, slug);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/page:delete] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/page:delete]", err);
    return NextResponse.json({ error: "Failed to archive page" }, { status: 500 });
  }
}
