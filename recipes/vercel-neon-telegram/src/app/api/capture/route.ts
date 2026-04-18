import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { captureThought } from "@/lib/capture";

const MAX_CONTENT_LENGTH = 10_000; // ~10KB max per thought

export async function POST(req: Request) {
  const { error } = requireAuth(req);
  if (error) return error;

  const rl = checkRateLimit();
  if (!rl.ok) {
    return Response.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await req.json();
  const content = body?.content;
  if (!content || typeof content !== "string") {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return Response.json(
      { error: `content exceeds max length of ${MAX_CONTENT_LENGTH} characters` },
      { status: 400 },
    );
  }

  const source = body?.source ?? "api";
  const result = await captureThought(content, source);
  return Response.json(result);
}
