import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { fetchKanbanThoughts } from "@/lib/api";

export async function GET(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const session = await getSession();
  const excludeRestricted = session.restrictedUnlocked !== true;
  const includeArchived =
    request.nextUrl.searchParams.get("archived") === "true";

  const statusFilter = includeArchived
    ? "new,planning,active,review,done,archived"
    : "new,planning,active,review,done";

  try {
    const thoughts = await fetchKanbanThoughts(apiKey, {
      status: statusFilter,
      exclude_restricted: excludeRestricted,
    });
    return NextResponse.json({ thoughts });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch kanban data",
      },
      { status: 500 }
    );
  }
}
