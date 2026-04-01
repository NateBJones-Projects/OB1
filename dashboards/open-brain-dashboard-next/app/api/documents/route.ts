import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn || !session.apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const matterName = formData.get("matter_name") as string | null;
  const contactName = formData.get("contact_name") as string | null;
  const description = formData.get("description") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "xlsx", "md", "txt"].includes(ext || "")) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PDF, DOCX, XLSX, MD, or TXT." },
      { status: 400 }
    );
  }

  // Convert to base64
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  // Call the MCP upload_document tool via REST-style endpoint
  // We'll add a /upload endpoint to the REST API
  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: {
      "x-brain-key": session.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_base64: base64,
      filename: file.name,
      matter_name: matterName || undefined,
      contact_name: contactName || undefined,
      description: description || undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error || "Upload failed" },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
