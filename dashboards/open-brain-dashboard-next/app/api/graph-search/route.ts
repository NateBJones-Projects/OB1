import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { mcpSearchThoughts } from "@/lib/openBrainMcp";

export async function GET(request: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const q = request.nextUrl.searchParams.get("q");
  if (!q?.trim()) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  try {
    const documents = await mcpSearchThoughts(apiKey, q.trim());
    const results = documents.map((doc) => {
      const metadata = doc.metadata || {};
      return {
        id: doc.id,
        content: doc.text,
        type:
          typeof metadata.type === "string" ? metadata.type : "reference",
        created_at:
          typeof metadata.created_at === "string"
            ? metadata.created_at
            : new Date().toISOString(),
        metadata,
      };
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
