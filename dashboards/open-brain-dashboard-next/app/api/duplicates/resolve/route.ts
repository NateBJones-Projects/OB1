import { NextRequest, NextResponse } from "next/server";
import { deleteThought } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

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
    const { action, thought_id_a, thought_id_b } = (await request.json()) as {
      action: "keep_a" | "keep_b" | "keep_both";
      thought_id_a: number;
      thought_id_b: number;
    };

    if (!thought_id_a || !thought_id_b) {
      return NextResponse.json(
        { error: "Both thought_id_a and thought_id_b are required" },
        { status: 400 }
      );
    }

    if (action === "keep_a") {
      await deleteThought(apiKey, thought_id_b);
      return NextResponse.json({ deleted: thought_id_b, kept: thought_id_a });
    }

    if (action === "keep_b") {
      await deleteThought(apiKey, thought_id_a);
      return NextResponse.json({ deleted: thought_id_a, kept: thought_id_b });
    }

    if (action === "keep_both") {
      return NextResponse.json({ kept: [thought_id_a, thought_id_b] });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Resolve failed" },
      { status: 500 }
    );
  }
}
