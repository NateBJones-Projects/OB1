import { NextRequest, NextResponse } from "next/server";
import { resolveDuplicate, fetchDuplicates, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// BL-03: Lowest threshold the dashboard UI ever surfaces is 0.80 — use it as the
// server-side re-verification floor. A pair only counts as a "duplicate" if the
// backend still agrees at this threshold.
const MIN_DUPLICATE_THRESHOLD = 0.8;
// BL-03: Sanity bound on how many pairs we'll scan through to find this pair.
const VERIFY_SCAN_LIMIT = 500;

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
      thought_id_a: unknown;
      thought_id_b: unknown;
    };

    // BL-03: Validate IDs are positive integers, not truthy-but-wrong values
    if (
      !Number.isInteger(thought_id_a) ||
      (thought_id_a as number) <= 0 ||
      !Number.isInteger(thought_id_b) ||
      (thought_id_b as number) <= 0
    ) {
      return NextResponse.json(
        { error: "Both thought_id_a and thought_id_b must be positive integers" },
        { status: 400 }
      );
    }
    const idA = thought_id_a as number;
    const idB = thought_id_b as number;

    if (idA === idB) {
      return NextResponse.json(
        { error: "thought_id_a and thought_id_b must differ" },
        { status: 400 }
      );
    }

    if (!["keep_a", "keep_b", "keep_both"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    // BL-03: Re-verify the pair is an actual near-duplicate at MIN_DUPLICATE_THRESHOLD.
    // This prevents a user from passing arbitrary IDs with action:"keep_a"
    // to delete an arbitrary thought B that is NOT actually a duplicate.
    const dups = await fetchDuplicates(apiKey, {
      threshold: MIN_DUPLICATE_THRESHOLD,
      limit: VERIFY_SCAN_LIMIT,
      offset: 0,
    });
    const pairMatches = dups.pairs.some(
      (p) =>
        (p.thought_id_a === idA && p.thought_id_b === idB) ||
        (p.thought_id_a === idB && p.thought_id_b === idA)
    );
    if (!pairMatches) {
      return NextResponse.json(
        { error: "Pair is not a recognized duplicate" },
        { status: 403 }
      );
    }

    const result = await resolveDuplicate(apiKey, {
      thought_id_a: idA,
      thought_id_b: idB,
      action,
    });

    return NextResponse.json(result);
  } catch (err) {
    // WR-05: Log detail server-side, return generic to client
    console.error("[duplicates/resolve]", err);
    if (err instanceof ApiError) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}
