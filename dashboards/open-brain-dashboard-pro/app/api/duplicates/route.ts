import { NextRequest, NextResponse } from "next/server";
import { fetchDuplicates } from "@/lib/api";
import { requireSession, AuthError } from "@/lib/auth";

export async function GET(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const threshold = parseFloat(
    request.nextUrl.searchParams.get("threshold") || "0.85"
  );
  const limit = parseInt(
    request.nextUrl.searchParams.get("limit") || "50",
    10
  );
  const offset = parseInt(
    request.nextUrl.searchParams.get("offset") || "0",
    10
  );

  try {
    const data = await fetchDuplicates(apiKey, { threshold, limit, offset });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
