import { timingSafeEqual } from "crypto";

export function validateAccessKey(key: string): boolean {
  const expected = process.env.BRAIN_ACCESS_KEY;
  if (!expected) throw new Error("BRAIN_ACCESS_KEY is not configured");

  if (key.length !== expected.length) return false;

  return timingSafeEqual(
    Buffer.from(key),
    Buffer.from(expected),
  );
}

export function extractKey(req: Request): string | null {
  // Header: x-brain-key
  const headerKey = req.headers.get("x-brain-key");
  if (headerKey) return headerKey;

  // Header: Authorization: Bearer <key>
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  // Query param: ?key=<key> (for clients that can't send headers, e.g. ChatGPT)
  const url = new URL(req.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey) return queryKey;

  return null;
}

export function requireAuth(req: Request): { error?: Response } {
  const key = extractKey(req);
  if (!key || !validateAccessKey(key)) {
    return {
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return {};
}
