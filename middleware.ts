import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — MUST be called to keep auth working
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes — no auth required.
  // NOTE: any unauthenticated server-to-server receiver (a payment/email webhook, or
  // a secret-authenticated admin/cron job) MUST be added here in the same change that
  // adds the route, or the !user check below 307-redirects it to /login and the caller
  // (which doesn't follow redirects) never reaches the handler. Such routes carry
  // their OWN auth (a signature or a Bearer secret) — the middleware bypass here does
  // not make them open. `/api/admin/*` is the ADMIN_TASK_SECRET-gated recompute job.
  const publicRoutes = ["/", "/login", "/signup", "/privacy", "/terms"];
  const isPublicRoute =
    publicRoutes.some((route) => pathname === route) ||
    pathname.startsWith("/api/auth") ||
    // Trailing slash so ONLY the /api/admin/* namespace matches — not a sibling like
    // /api/admin-report, which would then silently bypass the session gate.
    pathname.startsWith("/api/admin/");

  // If not authenticated and trying to access protected route → redirect to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If authenticated and trying to access login/signup → send to the app home.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
