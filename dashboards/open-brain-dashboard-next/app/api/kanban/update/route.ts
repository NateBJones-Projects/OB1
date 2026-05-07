import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { updateThought } from "@/lib/api";

const VALID_STATUSES = [
  "new",
  "planning",
  "active",
  "review",
  "done",
  "archived",
];

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
    const { thoughtId, status, importance, content, type } = body;

    if (!thoughtId || typeof thoughtId !== "string") {
      return NextResponse.json(
        { error: "thoughtId (string) is required" },
        { status: 400 }
      );
    }

    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (importance !== undefined) updates.importance = importance;
    if (content !== undefined) updates.content = content;
    if (type !== undefined) updates.type = type;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const result = await updateThought(apiKey, thoughtId, updates);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
