import { NextRequest, NextResponse } from "next/server";

// Next.js 16 renamed the middleware convention to "proxy". The former
// `middleware.ts` filename still works but triggers a build-time deprecation
// warning. We preserve the auth defense-in-depth behavior (session-cookie
// redirect) here. See README → Deployment for the Cloudflare caveat.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, API routes, and static assets
  if (
    pathname === "/login" ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Check for session cookie existence (iron-session encrypts it)
  const sessionCookie = request.cookies.get("open_brain_session");
  if (!sessionCookie?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
