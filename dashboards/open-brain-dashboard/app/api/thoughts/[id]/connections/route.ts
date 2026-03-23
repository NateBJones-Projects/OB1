import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const { id } = await params;
  const API_URL = process.env.NEXT_PUBLIC_API_URL!;
  const excludeRestricted =
    request.nextUrl.searchParams.get("exclude_restricted") !== "false";

  try {
    const res = await fetch(
      `${API_URL}/thought/${id}/connections?exclude_restricted=${excludeRestricted}&limit=20`,
      {
        headers: {
          "x-brain-key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
