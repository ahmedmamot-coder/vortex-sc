import { NextResponse, type NextRequest } from "next/server";

// The Vortex app runs entirely client-side from /proto.html and talks to Supabase
// directly from the browser (anon key), so there is NOTHING for server-side
// middleware to do here. Previously this file created a Supabase server client and
// called auth.getUser() on every request — when that (or the @supabase/ssr import in
// the Edge runtime) failed, users saw "500: MIDDLEWARE_INVOCATION_FAILED".
//
// It is now a pure pass-through with no external imports and no async work, so it can
// never throw at init or at runtime.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images/|fonts/|assets/|proto.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|ttf)$).*)",
  ],
};
