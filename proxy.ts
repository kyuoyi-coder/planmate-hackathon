import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with SESSION_COOKIE in lib/auth.ts (not imported, so the proxy
// stays free of database code).
const SESSION_COOKIE = "planmate_session";

/**
 * A cheap first check: without a session cookie, go straight to the login
 * page. It does not validate the cookie. The real check is requireUser() in
 * the data layer and getCurrentUser() in every Server Action.
 */
export function proxy(request: NextRequest) {
  if (
    !request.cookies.has(SESSION_COOKIE) &&
    request.nextUrl.pathname !== "/login"
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
