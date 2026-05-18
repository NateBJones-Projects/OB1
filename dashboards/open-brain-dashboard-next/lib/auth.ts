import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface SessionData {
  userId?: string;
  email?: string;
  loggedIn?: boolean;
  restrictedUnlocked?: boolean;
}

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

// Fail fast if SESSION_SECRET is missing or too short
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET env var is required and must be at least 32 characters"
  );
}

export const sessionOptions: SessionOptions = {
  cookieName: "open_brain_session",
  password: SESSION_SECRET,
  ttl: 60 * 60 * 24, // 24 hours
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * For API route handlers: returns apiKey or throws AuthError.
 * Call BEFORE parsing request body so unauthed requests get 401, not 400.
 */
export async function requireSession(): Promise<{ apiKey: string }> {
  const apiKey =
    process.env.OPEN_BRAIN_MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
  if (!apiKey) {
    throw new Error("OPEN_BRAIN_MCP_ACCESS_KEY env var is required");
  }

  const session = await getSession();
  if (!session.loggedIn || !session.userId) {
    throw new AuthError();
  }
  return { apiKey };
}

/**
 * For server components and server actions: returns session or redirects to /login.
 */
export async function requireSessionOrRedirect(): Promise<{
  apiKey: string;
}> {
  const apiKey =
    process.env.OPEN_BRAIN_MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
  if (!apiKey) {
    throw new Error("OPEN_BRAIN_MCP_ACCESS_KEY env var is required");
  }

  const session = await getSession();
  if (!session.loggedIn || !session.userId) {
    redirect("/login");
  }
  return { apiKey };
}
