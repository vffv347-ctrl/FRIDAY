import Link from "next/link";
import { Logo } from "./Logo";
import type { Role } from "@/lib/types";

// Шапка для личного кабинета и бэк-офиса.
export function AppHeader({ email, role }: { email: string; role: Role }) {
  const isAdmin = role === "admin" || role === "superadmin";

  return (
    <header className="border-b border-line">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/dashboard">
          <Logo className="text-glow text-[11px]" />
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/dashboard" className="text-dim hover:text-fg transition-colors">
            Кабинет
          </Link>
          {isAdmin && (
            <Link href="/admin" className="text-dim hover:text-fg transition-colors">
              Бэк-офис
            </Link>
          )}
          <span className="text-dim hidden sm:inline">{email}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-dim hover:text-fg transition-colors"
            >
              Выйти
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
