import { NextRequest, NextResponse } from "next/server";
import { resolveDuplicate } from "@/lib/api";
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

    if (!["keep_a", "keep_b", "keep_both"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    const result = await resolveDuplicate(apiKey, {
      thought_id_a,
      thought_id_b,
      action,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Resolve failed" },
      { status: 500 }
    );
  }
}
