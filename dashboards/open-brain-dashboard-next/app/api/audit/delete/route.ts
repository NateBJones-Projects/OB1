import { NextRequest, NextResponse } from "next/server";
import { deleteThought } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // Auth BEFORE body parse — unauthed requests get 401, not 400
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    const { ids } = (await request.json()) as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }

    const results = await Promise.allSettled(
      ids.map((id) => deleteThought(apiKey, id))
    );
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({
      deleted: ids.length - failed,
      failed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
