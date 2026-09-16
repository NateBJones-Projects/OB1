import { NextRequest, NextResponse } from "next/server";
import { searchThoughts } from "@/lib/api";
import { requireSession, getSession, AuthError } from "@/lib/auth";

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

  const q = request.nextUrl.searchParams.get("q");
  const mode = (request.nextUrl.searchParams.get("mode") || "semantic") as
    | "semantic"
    | "text";
  const page = parseInt(request.nextUrl.searchParams.get("page") || "1", 10);

  if (!q) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  try {
    const data = await searchThoughts(apiKey, q, mode, 100, page, excludeRestricted);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
