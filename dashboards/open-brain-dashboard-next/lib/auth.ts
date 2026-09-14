import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface SessionData {
  apiKey?: string;
  loggedIn?: boolean;
  restrictedUnlocked?: boolean;
  rememberDevice?: boolean;
  expiresAt?: number;
}

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

function shouldUseSecureCookie() {
  if (process.env.AUTH_COOKIE_SECURE) {
    return process.env.AUTH_COOKIE_SECURE === "true";
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
  return appUrl.startsWith("https://") || process.env.VERCEL === "1";
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
    secure: shouldUseSecureCookie(),
    sameSite: "lax" as const,
    path: "/",
  },
};

function demoAuthBypass() {
  if (process.env.OB1_DEMO_AUTH_BYPASS !== "true") return null;
  return {
    apiKey: process.env.OB1_DASHBOARD_DEMO_KEY || "local-screenshot-key",
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  // Do not write cookies during Server Component reads. Removing the payload
  // makes every existing authentication guard fail closed for expired sessions.
  if (session.expiresAt !== undefined &&
      (!Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now())) {
    for (const key of Object.keys(session)) delete session[key as keyof SessionData];
  }
  if (session.expiresAt !== undefined) {
    const remaining = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
    session.updateConfig({ ...sessionOptions, ttl: remaining });
  }
  return session;
}

/** Called only after the access key has been validated by the login action. */
export async function startSession(apiKey: string, rememberDevice: boolean) {
  const session = await getSession();
  const remember = process.env.LOCAL_DASHBOARD_AUTH === "true" && rememberDevice === true;
  const ttl = 60 * 60 * 24 * (remember ? 30 : 1);
  session.apiKey = apiKey;
  session.loggedIn = true;
  session.restrictedUnlocked = false;
  session.rememberDevice = remember;
  session.expiresAt = Date.now() + ttl * 1000;
  session.updateConfig({ ...sessionOptions, ttl });
  await session.save();
}

/**
 * For API route handlers: returns apiKey or throws AuthError.
 * Call BEFORE parsing request body so unauthed requests get 401, not 400.
 */
export async function requireSession(): Promise<{ apiKey: string }> {
  const demoSession = demoAuthBypass();
  if (demoSession) return demoSession;

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
  const demoSession = demoAuthBypass();
  if (demoSession) return demoSession;

  const session = await getSession();
  if (!session.loggedIn || !session.apiKey) {
    redirect("/login");
  }
  return { apiKey: session.apiKey };
}
