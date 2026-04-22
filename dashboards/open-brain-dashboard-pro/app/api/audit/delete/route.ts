import { NextRequest, NextResponse } from "next/server";
import { deleteThought, fetchThought, ApiError } from "@/lib/api";
import { requireSession, AuthError, getSession } from "@/lib/auth";

// BL-03: Cap bulk-delete to prevent accidental or malicious wipes
const MAX_DELETE_IDS = 50;
// BL-03: Audit page explicitly targets quality_score < 30; enforce server-side
const AUDIT_QUALITY_THRESHOLD = 30;

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

  // REVIEW-CODEX-2-P1: honor the session's restricted lock state — never
  // hard-code `excludeRestricted=false`, or a locked session can bulk-delete
  // restricted thoughts just by knowing their IDs.
  const session = await getSession();
  const excludeRestricted = !session.restrictedUnlocked;

  try {
    const { ids } = (await request.json()) as { ids: unknown };

    // BL-03: Strict input validation — array of positive integers only
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }
    if (ids.length > MAX_DELETE_IDS) {
      return NextResponse.json(
        { error: `Cannot delete more than ${MAX_DELETE_IDS} thoughts per request` },
        { status: 400 }
      );
    }
    const sanitized: number[] = [];
    for (const raw of ids) {
      if (!Number.isInteger(raw) || (raw as number) <= 0) {
        return NextResponse.json(
          { error: "All IDs must be positive integers" },
          { status: 400 }
        );
      }
      sanitized.push(raw as number);
    }

    // BL-03: Re-verify each thought actually has quality_score < 30 before deleting
    // Prevents a user from passing arbitrary IDs (e.g. importance-6 thoughts) to this route.
    // REVIEW-CODEX-2-P1: excludeRestricted is derived from session — a locked
    // session will see 403/404 on restricted thoughts here, which correctly
    // drops them out of the delete set via the rejected branch below.
    const verifyResults = await Promise.allSettled(
      sanitized.map((id) => fetchThought(apiKey, id, excludeRestricted))
    );

    const verifiedIds: number[] = [];
    let rejected = 0;
    for (let i = 0; i < verifyResults.length; i++) {
      const r = verifyResults[i];
      if (r.status === "fulfilled" && typeof r.value.quality_score === "number" && r.value.quality_score < AUDIT_QUALITY_THRESHOLD) {
        verifiedIds.push(sanitized[i]);
      } else {
        rejected += 1;
      }
    }

    if (verifiedIds.length === 0) {
      return NextResponse.json(
        { error: "No IDs matched audit criteria (quality_score < 30)" },
        { status: 403 }
      );
    }

    const results = await Promise.allSettled(
      verifiedIds.map((id) => deleteThought(apiKey, id))
    );
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({
      deleted: verifiedIds.length - failed,
      failed: failed + rejected,
      rejected_non_audit: rejected,
    });
  } catch (err) {
    // WR-05: Log detail server-side, return generic to client
    console.error("[audit/delete]", err);
    if (err instanceof ApiError) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
