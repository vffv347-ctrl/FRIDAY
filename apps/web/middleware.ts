import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Обновляет сессию Supabase на каждом запросе (refresh токена).
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
