import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { deleteThought } from "@/lib/api";

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
    const { thoughtId } = body;

    if (!thoughtId || typeof thoughtId !== "number") {
      return NextResponse.json(
        { error: "thoughtId (number) is required" },
        { status: 400 }
      );
    }

    await deleteThought(apiKey, thoughtId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
