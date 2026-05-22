import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface SessionData {
  apiKey?: string;
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
  const session = await getSession();
  if (!session.loggedIn || !session.apiKey) {
    throw new AuthError();
  }
  return { apiKey: session.apiKey };
}

/**
 * For server components and server actions: returns session or redirects to /login.
 */
export async function requireSessionOrRedirect(): Promise<{
  apiKey: string;
}> {
  const session = await getSession();
  if (!session.loggedIn || !session.apiKey) {
    redirect("/login");
  }
  return { apiKey: session.apiKey };
}
