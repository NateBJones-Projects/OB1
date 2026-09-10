import { NextRequest, NextResponse } from "next/server";
import { writeWikiSection, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// PUT /api/wiki/pages/:slug/sections/:sectionKey — create or edit a section.
// Proxies to PUT /wiki/pages/:slug/sections/:sectionKey. REST edits are
// manual-origin: the first human edit transfers ownership of the section.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; sectionKey: string }> }
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

  const { slug, sectionKey } = await params;
  if (!slug || !sectionKey) {
    return NextResponse.json({ error: "Missing slug or section key" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      body_md?: unknown;
      heading?: unknown;
      display_order?: unknown;
    };

    // body_md is required but may legitimately be an empty string (clears the
    // section). Only reject when it is missing or not a string.
    if (typeof body.body_md !== "string") {
      return NextResponse.json({ error: "body_md is required" }, { status: 400 });
    }
    const heading =
      typeof body.heading === "string" ? body.heading : undefined;

    let displayOrder: number | undefined;
    if (body.display_order !== undefined && body.display_order !== null) {
      const n = Number(body.display_order);
      if (!Number.isInteger(n)) {
        return NextResponse.json({ error: "display_order must be an integer" }, { status: 400 });
      }
      displayOrder = n;
    }

    const result = await writeWikiSection(apiKey, slug, sectionKey, {
      body_md: body.body_md,
      heading,
      display_order: displayOrder,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[wiki/section:put] upstream", err.status, err.upstreamBody);
      return NextResponse.json({ error: "Upstream error" }, { status: err.status });
    }
    console.error("[wiki/section:put]", err);
    return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
  }
}
