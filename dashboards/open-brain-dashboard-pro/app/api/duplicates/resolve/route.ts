import { NextRequest, NextResponse } from "next/server";
import { resolveDuplicate, fetchDuplicates, ApiError } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

// BL-03: Lowest threshold the dashboard UI ever surfaces is 0.80 — use it as the
// server-side re-verification floor. A pair only counts as a "duplicate" if the
// backend still agrees at this threshold.
const MIN_DUPLICATE_THRESHOLD = 0.8;
// REVIEW-CODEX-2-P2: paginate through candidate pairs until we either find the
// requested pair or hit the safety cap. The previous single-page 500-pair
// window made pairs on later UI pages impossible to resolve.
const VERIFY_PAGE_SIZE = 500;
const VERIFY_MAX_SCAN = 5000;

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
    // REVIEW-CODEX-2-P2: walk pages until we find the pair or exceed the cap.
    // Previously we only scanned the first 500-pair page, so pairs surfaced
    // on later UI pages could not be resolved.
    let pairMatches = false;
    let scanned = 0;
    let offset = 0;
    while (scanned < VERIFY_MAX_SCAN) {
      const dups = await fetchDuplicates(apiKey, {
        threshold: MIN_DUPLICATE_THRESHOLD,
        limit: VERIFY_PAGE_SIZE,
        offset,
      });
      const pageLen = dups.pairs.length;
      if (
        dups.pairs.some(
          (p) =>
            (p.thought_id_a === idA && p.thought_id_b === idB) ||
            (p.thought_id_a === idB && p.thought_id_b === idA)
        )
      ) {
        pairMatches = true;
        break;
      }
      scanned += pageLen;
      // Backend returned fewer than a full page → no more pairs to scan.
      if (pageLen < VERIFY_PAGE_SIZE) break;
      offset += VERIFY_PAGE_SIZE;
    }
    if (!pairMatches) {
      // If we hit the cap without finding the pair, tell the caller so they
      // can narrow threshold / retry rather than silently 403-ing forever.
      const hitCap = scanned >= VERIFY_MAX_SCAN;
      return NextResponse.json(
        {
          error: hitCap
            ? `Pair not found after scanning ${VERIFY_MAX_SCAN} candidates — raise the UI threshold and retry`
            : "Pair is not a recognized duplicate",
        },
        { status: hitCap ? 404 : 403 }
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
