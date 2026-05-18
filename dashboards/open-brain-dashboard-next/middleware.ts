import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.OB1_DEMO_AUTH_BYPASS === "true") {
    return NextResponse.next();
  }

  // Allow login page, API routes, and static assets
  if (
    pathname === "/login" ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/brand") ||
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
