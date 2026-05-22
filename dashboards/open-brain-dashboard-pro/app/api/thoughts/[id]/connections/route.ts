import { NextResponse } from "next/server";
import { requireSession, getSession, AuthError } from "@/lib/auth";

export async function GET(
  _request: Request,
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

  // WR-04: Validate id is a positive integer before forwarding
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  if (!API_URL) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_API_URL not configured" },
      { status: 500 }
    );
  }

  // BL-02: Derive excludeRestricted from server session, NEVER client query string
  const session = await getSession();
  const excludeRestricted = session.restrictedUnlocked !== true;

  try {
    const res = await fetch(
      `${API_URL}/thought/${idNum}/connections?exclude_restricted=${excludeRestricted}&limit=20`,
      {
        headers: {
          "x-brain-key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await res.json();
    if (!res.ok) {
      // WR-05: Do not leak backend error details to client
      console.error("[thoughts/[id]/connections] upstream error", res.status, data);
      return NextResponse.json(
        { error: "Upstream error" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    // WR-05: Log detail server-side, return generic to client
    console.error("[thoughts/[id]/connections]", err);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
