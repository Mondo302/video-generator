import { NextResponse, type NextRequest } from "next/server";
import {
  createServerSupabase,
  ensureAnonymousSession,
  getSessionUserId,
} from "@/lib/supabase/core";

// Next 16 "proxy" (formerly middleware): refreshes the Supabase session on every
// request and gives a first-time visitor an anonymous session, so every page
// request has an auth.uid(). API routes only refresh: a request without a
// session must still reach the route and get its 401.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerSupabase({
    getAll: () => request.cookies.getAll(),
    setAll(list, headers) {
      for (const { name, value } of list) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of list) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    },
  });

  if (request.nextUrl.pathname.startsWith("/api/")) {
    await getSessionUserId(supabase);
  } else {
    await ensureAnonymousSession(supabase);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
