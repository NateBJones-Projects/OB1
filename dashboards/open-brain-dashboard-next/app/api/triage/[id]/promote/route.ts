import { NextResponse } from "next/server";
import { AuthError, requireSession } from "@/lib/auth";
import { promotePendingThought } from "@/lib/triage";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  try {
    const { id } = await params;
    const result = await promotePendingThought(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to promote thought" },
      { status: 500 },
    );
  }
}
