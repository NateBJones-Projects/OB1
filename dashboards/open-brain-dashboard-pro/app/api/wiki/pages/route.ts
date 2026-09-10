import { NextRequest, NextResponse } from "next/server";
import { createWikiPage, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";
import type { WikiPageKind } from "@/lib/types";

const PAGE_KINDS: WikiPageKind[] = ["topic", "entity", "autobiography", "custom"];

// POST /api/wiki/pages — create a wiki page. Proxies to POST /wiki/pages.
export async function POST(request: NextRequest) {
  // Auth BEFORE body parse — unauthed requests get 401, not 400 (house rule).
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    const body = (await request.json()) as {
      slug?: unknown;
      title?: unknown;
      page_kind?: unknown;
      metadata?: unknown;
    };

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    // page_kind is optional; when present it must be one of the allowed kinds so a
    // bad value never reaches the DB CHECK constraint as a 500.
    let pageKind: WikiPageKind | undefined;
    if (body.page_kind !== undefined && body.page_kind !== "") {
      if (typeof body.page_kind !== "string" || !PAGE_KINDS.includes(body.page_kind as WikiPageKind)) {
        return NextResponse.json({ error: "Invalid page_kind" }, { status: 400 });
      }
      pageKind = body.page_kind as WikiPageKind;
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : undefined;

    const result = await createWikiPage(apiKey, { slug, title, page_kind: pageKind, metadata });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      // Log the full upstream body server-side; never render it to the client.
      console.error("[wiki/pages] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/pages]", err);
    return NextResponse.json({ error: "Failed to create page" }, { status: 500 });
  }
}
